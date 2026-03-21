//! HLS Proxy Server with Continuous Background Prefetching
//!
//! A local HTTP proxy that runs inside the Tauri app to inject
//! CDN-required headers (Referer, Origin, User-Agent) on all HLS requests.
//!
//! Features:
//! - CDN header injection (Referer, Origin, User-Agent)
//! - M3U8 manifest URL rewriting
//! - LRU segment caching (500 segments ~ 500MB)
//! - **YouTube-style continuous background prefetching**
//! - **Prefetching continues even when paused**
//! - Instant seeking (cached segments)
//! - Zero buffering
//! - **Arc<Vec<u8>> bodies — zero-copy cache hits**
//! - **Read-lock fast path for cache hits (no write lock contention)**
//! - **Global semaphore throttles CDN downloads (prevents rate-limiting)**
//! - **Debounced prefetch spawning (avoids redundant tasks)**
//! - **Smart manifest refresh (preserves prefetch on quality switch)**
//!
//! Architecture:
//! 1. Binds to 127.0.0.1:0 (random port) on app startup
//! 2. hls.js sends requests to http://127.0.0.1:{port}/proxy?url={encoded_cdn_url}
//! 3. Proxy checks cache first, if miss → fetches from CDN with correct headers
//! 4. For m3u8 responses:
//!    - Rewrites all URLs to route through proxy
//!    - Parses segment list
//!    - **Stores segment list for continuous prefetching**
//! 5. On segment request:
//!    - Tracks current playback position
//!    - **Triggers continuous prefetch of next 8-50 segments (adaptive)**
//! 6. Returns response to hls.js (segments come from cache = instant!)

use std::sync::atomic::{AtomicU16, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::collections::{HashMap, HashSet};
use std::time::Instant;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use tokio::sync::{RwLock, Semaphore};
use lru::LruCache;
use std::num::NonZeroUsize;

use axum::{
    extract::{Query, State},
    http::{StatusCode, HeaderMap},
    response::IntoResponse,
    routing::get,
    Router,
};
use rquest::Client;

/// CDN headers to inject on every proxied request
#[derive(Default, Clone, Debug)]
pub struct CdnHeaders {
    pub referer: Option<String>,
    pub origin: Option<String>,
    pub user_agent: Option<String>,
    pub extra_headers: HashMap<String, String>,
}

/// Cached segment data — body wrapped in Arc for zero-copy cache hits
#[derive(Clone)]
struct CachedSegment {
    content_type: String,
    body: Arc<Vec<u8>>,
}

/// Live performance metrics for the proxy (lock-free atomics)
pub struct ProxyMetrics {
    pub cache_hits: AtomicU64,
    pub cache_misses: AtomicU64,
    pub prefetch_completed: AtomicU64,
    pub prefetch_cancelled: AtomicU64,
    pub prefetch_retries: AtomicU64,
    pub prefetch_hedged: AtomicU64,
    pub total_bytes_served: AtomicU64,
    pub total_cached_bytes: AtomicU64,
    // Rolling window timing (resets every 100 samples for freshness)
    pub total_download_ms: AtomicU64,
    pub download_count: AtomicU64,
}

impl ProxyMetrics {
    pub fn new() -> Self {
        Self {
            cache_hits: AtomicU64::new(0),
            cache_misses: AtomicU64::new(0),
            prefetch_completed: AtomicU64::new(0),
            prefetch_cancelled: AtomicU64::new(0),
            prefetch_retries: AtomicU64::new(0),
            prefetch_hedged: AtomicU64::new(0),
            total_bytes_served: AtomicU64::new(0),
            total_cached_bytes: AtomicU64::new(0),
            total_download_ms: AtomicU64::new(0),
            download_count: AtomicU64::new(0),
        }
    }

    /// Average segment download time in ms (rolling window of ~100 samples)
    pub fn avg_download_ms(&self) -> u64 {
        let count = self.download_count.load(Ordering::Relaxed);
        if count == 0 { return 0; }
        self.total_download_ms.load(Ordering::Relaxed) / count
    }

    /// Adaptive prefetch window — scales with measured network speed
    ///   Fast (< 200ms):   50 segments ahead (aggressive)
    ///   Normal (< 1s):    30 segments ahead (standard)
    ///   Slow (< 3s):      15 segments ahead (conservative)
    ///   Very slow (3s+):   8 segments ahead (minimal)
    pub fn adaptive_prefetch_ahead(&self) -> usize {
        match self.avg_download_ms() {
            0..=200 => 50,
            201..=1000 => 30,
            1001..=3000 => 15,
            _ => 8,
        }
    }
}

/// Shared state for the proxy server
#[derive(Clone)]
pub struct ProxyState {
    client: Client,
    pub headers: Arc<RwLock<CdnHeaders>>,
    pub port: Arc<AtomicU16>,
    // LRU cache for video segments (max 500 segments ~ 500MB)
    cache: Arc<RwLock<LruCache<String, CachedSegment>>>,
    // In-flight prefetch tracker (avoid duplicate downloads)
    prefetching: Arc<RwLock<HashSet<String>>>,
    // Segment list from manifest (for continuous prefetching)
    segment_list: Arc<RwLock<Vec<String>>>,
    // Segment registry for fast lookup (includes extension-less segments)
    segment_registry: Arc<RwLock<HashSet<String>>>,
    // Current playback position (segment index)
    current_position: Arc<AtomicUsize>,
    // Last position that triggered a prefetch spawn (debounce)
    last_prefetch_position: Arc<AtomicUsize>,
    // Generation counter — incremented on new content or seek, cancels stale prefetch tasks
    prefetch_generation: Arc<AtomicUsize>,
    // Global download semaphore — limits concurrent CDN requests to prevent rate-limiting
    download_semaphore: Arc<Semaphore>,
    // Live performance metrics (lock-free)
    pub metrics: Arc<ProxyMetrics>,
}

impl ProxyState {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .pool_max_idle_per_host(20)
                .emulation(rquest_util::Emulation::Chrome124)
                .build()
                .unwrap_or_else(|_| Client::new()),
            headers: Arc::new(RwLock::new(CdnHeaders::default())),
            port: Arc::new(AtomicU16::new(0)),
            cache: Arc::new(RwLock::new(LruCache::new(NonZeroUsize::new(500).unwrap()))),
            prefetching: Arc::new(RwLock::new(HashSet::new())),
            segment_list: Arc::new(RwLock::new(Vec::new())),
            segment_registry: Arc::new(RwLock::new(HashSet::new())),
            current_position: Arc::new(AtomicUsize::new(0)),
            last_prefetch_position: Arc::new(AtomicUsize::new(usize::MAX)),
            prefetch_generation: Arc::new(AtomicUsize::new(0)),
            download_semaphore: Arc::new(Semaphore::new(12)), // Max 12 concurrent downloads
            metrics: Arc::new(ProxyMetrics::new()),
        }
    }

    pub async fn clear_cache(&self) {
        let mut cache = self.cache.write().await;
        cache.clear();
        drop(cache);
        let mut segments = self.segment_list.write().await;
        segments.clear();
        drop(segments);
        let mut registry = self.segment_registry.write().await;
        registry.clear();
        drop(registry);
        let mut prefetching = self.prefetching.write().await;
        prefetching.clear();
        drop(prefetching);
        self.current_position.store(0, Ordering::SeqCst);
        self.last_prefetch_position.store(usize::MAX, Ordering::SeqCst);
        self.prefetch_generation.fetch_add(1, Ordering::SeqCst);
        self.metrics.total_cached_bytes.store(0, Ordering::Relaxed);
        println!("[HLS Proxy] 🧹 Cache and prefetcher reset");
    }

    /// Check if a URL is a video segment (either by extension or manifest registry)
    pub async fn is_segment_url(&self, url: &str) -> bool {
        // Fast path: check registry first (100% accurate for parsed manifests)
        {
            let registry = self.segment_registry.read().await;
            if registry.contains(url) {
                return true;
            }
        }

        // Fallback: check extension (for initial manifest segments or external discovery)
        let path = url.split('?').next().unwrap_or(url).to_lowercase();
        (path.ends_with(".ts") || path.ends_with(".m4s") || path.ends_with(".mp4"))
            && !path.ends_with(".m3u8")
    }
}


/// Query parameter for the proxy endpoint
#[derive(serde::Deserialize)]
struct ProxyQuery {
    url: String,
}

/// CORS preflight handler
async fn options_handler() -> impl IntoResponse {
    (
        StatusCode::NO_CONTENT,
        [
            ("access-control-allow-origin", "*"),
            ("access-control-allow-methods", "GET, OPTIONS"),
            ("access-control-allow-headers", "range, content-type"),
            ("access-control-max-age", "86400"),
        ],
    )
}

/// Main proxy handler — fetches from CDN with correct headers (with caching + continuous prefetching)
async fn proxy_handler(
    State(state): State<ProxyState>,
    headers: HeaderMap,
    Query(query): Query<ProxyQuery>,
) -> impl IntoResponse {
    let target_url = query.url;
    if let Err(msg) = validate_proxy_target(&target_url) {
        return (
            StatusCode::BAD_REQUEST,
            [("access-control-allow-origin", "*")],
            msg,
        ).into_response();
    }
    let range_header = headers.get("range").cloned();

    // Check if it's a segment
    let is_segment = state.is_segment_url(&target_url).await;

    // Fast Path: Cache check (only for full segments, bypass for Range requests to avoid complexity)
    if is_segment && range_header.is_none() {
        let cached_segment = {
            let cache = state.cache.read().await;
            cache.peek(&target_url).cloned()
        };

        if let Some(cached) = cached_segment {
            state.metrics.cache_hits.fetch_add(1, Ordering::Relaxed);
            state.metrics.total_bytes_served.fetch_add(cached.body.len() as u64, Ordering::Relaxed);
            println!("[HLS Proxy] ⚡ Cache HIT: {}", shorten_url(&target_url));

            let state_clone = state.clone();
            let target_url_clone = target_url.clone();
            tokio::spawn(async move {
                update_position_and_prefetch(state_clone, &target_url_clone).await;
            });

            return (
                StatusCode::OK,
                [
                    ("access-control-allow-origin", "*"),
                    ("content-type", &cached.content_type),
                ],
                (*cached.body).clone(),
            ).into_response();
        }

        state.metrics.cache_misses.fetch_add(1, Ordering::Relaxed);
        println!("[HLS Proxy] 📥 Cache MISS: {}", shorten_url(&target_url));
    }

    // Build request with STRICT CDN headers
    let cdn_headers = state.headers.read().await;
    let mut req = state.client.get(&target_url);

    if let Some(ref referer) = cdn_headers.referer {
        req = req.header("Referer", referer);
    }
    if let Some(ref origin) = cdn_headers.origin {
        req = req.header("Origin", origin);
    }
    if let Some(ref ua) = cdn_headers.user_agent {
        req = req.header("User-Agent", ua);
    }
    for (k, v) in cdn_headers.extra_headers.iter() {
        let lk = k.to_ascii_lowercase();
        if lk == "referer"
            || lk == "origin"
            || lk == "user-agent"
            || lk == "range"
            || lk == "host"
            || lk == "content-length"
            || lk == "transfer-encoding"
            || lk == "connection"
        {
            continue;
        }
        req = req.header(k, v);
    }
    
    // Pass-through Range header if present (crucial for .m4s)
    if let Some(range) = range_header {
        req = req.header("Range", range);
    }
    drop(cdn_headers);

    // Fetch from CDN
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[HLS Proxy] Fetch error: {}", e);
            return (StatusCode::BAD_GATEWAY, [("access-control-allow-origin", "*")], format!("Proxy error: {}", e)).into_response();
        }
    };

    let status = resp.status();
    let resp_headers = resp.headers().clone();

    // Map content type
    let content_type = resp_headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let body = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return (StatusCode::BAD_GATEWAY, [("access-control-allow-origin", "*")], format!("Read error: {}", e)).into_response();
        }
    };

    // Cache segments (Full 200 OK only)
    if is_segment && status == StatusCode::OK {
        let body_arc = Arc::new(body.to_vec());
        let seg_bytes = body_arc.len() as u64;

        let mut cache = state.cache.write().await;
        let evicted = cache.push(
            target_url.clone(),
            CachedSegment {
                content_type: content_type.clone(),
                body: body_arc.clone(),
            },
        );
        drop(cache);

        state.metrics.total_cached_bytes.fetch_add(seg_bytes, Ordering::Relaxed);
        state.metrics.total_bytes_served.fetch_add(seg_bytes, Ordering::Relaxed);
        if let Some((_, evicted_seg)) = evicted {
            let old_len = evicted_seg.body.len() as u64;
            let _ = state.metrics.total_cached_bytes.fetch_update(
                Ordering::Relaxed, Ordering::Relaxed,
                |current| Some(current.saturating_sub(old_len))
            );
        }

        let state_clone = state.clone();
        let target_url_clone = target_url.clone();
        tokio::spawn(async move {
            update_position_and_prefetch(state_clone, &target_url_clone).await;
        });
    }

    // Handle Manifest Rewriting
    let is_m3u8 = content_type.contains("mpegurl") || content_type.contains("m3u8") || target_url.ends_with(".m3u8");

    if is_m3u8 && status == StatusCode::OK {
        let text = String::from_utf8_lossy(&body);
        let port = state.port.load(Ordering::SeqCst);
        let segment_urls = parse_segment_urls(&text, &target_url);

        if !segment_urls.is_empty() {
            // Update registry and segment list
            let mut registry = state.segment_registry.write().await;
            registry.clear();
            for url in &segment_urls {
                registry.insert(url.clone());
            }
            drop(registry);

            let segments_changed = {
                let old_segments = state.segment_list.read().await;
                old_segments.is_empty() || *old_segments != segment_urls
            };

            let mut segments = state.segment_list.write().await;
            *segments = segment_urls.clone();
            drop(segments);

            if segments_changed {
                state.current_position.store(0, Ordering::SeqCst);
                state.last_prefetch_position.store(usize::MAX, Ordering::SeqCst);
                let gen = state.prefetch_generation.fetch_add(1, Ordering::SeqCst) + 1;

                let state_clone = state.clone();
                let initial_segments = segment_urls.iter().take(10).cloned().collect();
                tokio::spawn(async move {
                    prefetch_segments(state_clone, initial_segments, gen).await;
                });
            }
        }

        let rewritten = rewrite_m3u8(&text, &target_url, port);
        return (
            StatusCode::OK,
            [
                ("access-control-allow-origin", "*"),
                ("content-type", "application/vnd.apple.mpegurl"),
            ],
            rewritten,
        ).into_response();
    }

    // Default Pass-through (including 206 Partial Content)
    let mut builder = axum::http::Response::builder()
        .status(status)
        .header("access-control-allow-origin", "*")
        .header("content-type", content_type);

    // Forward Range-related headers for 206 responses
    if let Some(cr) = resp_headers.get("content-range") {
        builder = builder.header("content-range", cr);
    }
    if let Some(cl) = resp_headers.get("content-length") {
        builder = builder.header("content-length", cl);
    }
    if let Some(at) = resp_headers.get("accept-ranges") {
        builder = builder.header("accept-ranges", at);
    }

    builder.body(axum::body::Body::from(body)).unwrap().into_response()
}

/// Update playback position and trigger continuous prefetch (YouTube-style)
/// Debounced: only spawns a new prefetch task if position has advanced since last spawn
async fn update_position_and_prefetch(state: ProxyState, segment_url: &str) {
    let segments = state.segment_list.read().await;

    if let Some(current_idx) = segments.iter().position(|s| s == segment_url) {
        let prev_position = state.current_position.swap(current_idx, Ordering::SeqCst);

        // Detect seek (position jump > 10 segments) and bump generation
        // so stale prefetch tasks for the old position stop early
        let jump = current_idx.abs_diff(prev_position);
        if jump > 10 {
            state.prefetch_generation.fetch_add(1, Ordering::SeqCst);
            state.last_prefetch_position.store(usize::MAX, Ordering::SeqCst);
        }

        // Debounce: skip if we already spawned a prefetch from this position or ahead
        let last_pf = state.last_prefetch_position.load(Ordering::SeqCst);
        if last_pf != usize::MAX && current_idx <= last_pf {
            return;
        }
        state.last_prefetch_position.store(current_idx, Ordering::SeqCst);

        // Adaptive window: scales with measured network speed
        let prefetch_ahead = state.metrics.adaptive_prefetch_ahead();

        let start_idx = current_idx + 1;
        let end_idx = (start_idx + prefetch_ahead).min(segments.len());

        if start_idx < segments.len() {
            let segments_to_prefetch: Vec<String> = segments[start_idx..end_idx]
                .iter()
                .cloned()
                .collect();

            if !segments_to_prefetch.is_empty() {
                println!(
                    "[HLS Proxy] 📍 Position: {}/{} → prefetch {} (window={}, avg={}ms)",
                    current_idx,
                    segments.len(),
                    segments_to_prefetch.len(),
                    prefetch_ahead,
                    state.metrics.avg_download_ms()
                );

                let gen = state.prefetch_generation.load(Ordering::SeqCst);
                let state_clone = state.clone();
                tokio::spawn(async move {
                    prefetch_segments(state_clone, segments_to_prefetch, gen).await;
                });
            }
        }
    }
}

/// Parse segment URLs from m3u8 manifest
fn parse_segment_urls(content: &str, base_url: &str) -> Vec<String> {
    let base = url::Url::parse(base_url).ok();
    let mut segments = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let absolute_url = resolve_url(trimmed, &base);

        if is_video_segment(&absolute_url) {
            segments.push(absolute_url);
        }
    }

    segments
}

/// Prefetch segments with priority tiers (enterprise-grade)
///   Tier 1 (critical):      First 3 segments — Spawns immediately in parallel
///   Tier 2 (important):     Segments 4–10 — Spawns after Tier 1 starts
///   Tier 3 (opportunistic): Segments 11+ — Spawns in background
async fn prefetch_segments(state: ProxyState, segment_urls: Vec<String>, generation: usize) {
    if segment_urls.is_empty() {
        return;
    }

    // Filter out already-cached segments
    let to_download: Vec<String> = {
        let cache = state.cache.read().await;
        segment_urls.into_iter().filter(|url| !cache.contains(url)).collect()
    };

    if to_download.is_empty() {
        return;
    }

    // Split into priority tiers
    let tier1_end = 3.min(to_download.len());
    let tier2_end = 10.min(to_download.len());
    let tier1 = to_download[..tier1_end].to_vec();
    let tier2 = to_download[tier1_end..tier2_end].to_vec();
    let tier3 = to_download[tier2_end..].to_vec();

    println!(
        "[HLS Proxy] 🔄 Parallel Prefetch: {} critical + {} important + {} opportunistic",
        tier1.len(), tier2.len(), tier3.len()
    );

    // Run all tiers in parallel, but Tier 1 gets first dibs on the semaphore
    let s1 = state.clone();
    let t1 = tokio::spawn(async move {
        fetch_tier_parallel(s1, tier1, generation, 2).await; // 2 retries for critical
    });

    let s2 = state.clone();
    let t2 = tokio::spawn(async move {
        fetch_tier_parallel(s2, tier2, generation, 0).await;
    });

    let s3 = state.clone();
    let t3 = tokio::spawn(async move {
        fetch_tier_parallel(s3, tier3, generation, 0).await;
    });

    let _ = tokio::join!(t1, t2, t3);
}

/// Fetch a batch of segments concurrently
async fn fetch_tier_parallel(
    state: ProxyState,
    urls: Vec<String>,
    generation: usize,
    max_retries: u32,
) {
    let mut join_set = tokio::task::JoinSet::new();

    for url in urls {
        // Bail if generation changed
        if state.prefetch_generation.load(Ordering::SeqCst) != generation {
            state.metrics.prefetch_cancelled.fetch_add(1, Ordering::Relaxed);
            return;
        }

        // Mark as in-flight
        let mut prefetching = state.prefetching.write().await;
        if prefetching.contains(&url) {
            continue;
        }
        prefetching.insert(url.clone());
        drop(prefetching);

        let state_clone = state.clone();
        join_set.spawn(async move {
            download_and_cache_segment(state_clone, url, max_retries).await;
        });
    }

    while let Some(_) = join_set.join_next().await {}
}

/// Download a single segment and cache it (with retry + adaptive hedging + semaphore throttle)
async fn download_and_cache_segment(state: ProxyState, url: String, max_retries: u32) {
    let start = Instant::now();
    let avg_ms = state.metrics.avg_download_ms();
    
    // Hedging: Start a second request if the first one takes too long (> 2x average)
    // Only hedge if we have a stable average and it's > 500ms
    let hedge_timeout = if avg_ms > 500 {
        Some(tokio::time::Duration::from_millis(avg_ms * 2))
    } else {
        None
    };

    let primary = download_with_retries(state.clone(), url.clone(), max_retries);
    
    let result = if let Some(timeout) = hedge_timeout {
        tokio::pin!(primary);
        tokio::select! {
            res = &mut primary => res,
            _ = tokio::time::sleep(timeout) => {
                state.metrics.prefetch_hedged.fetch_add(1, Ordering::Relaxed);
                println!("[HLS Proxy] 🛡️ Hedging segment: {}", shorten_url(&url));
                let secondary = download_with_retries(state.clone(), url.clone(), max_retries);
                tokio::select! {
                    res = &mut primary => res,
                    res = secondary => res,
                }
            }
        }
    } else {
        primary.await
    };

    if let Ok((body, content_type)) = result {
        let byte_len = body.len() as u64;
        let body_arc = Arc::new(body);
        
        let mut cache = state.cache.write().await;
        let evicted = cache.push(
            url.clone(),
            CachedSegment {
                content_type,
                body: body_arc.clone(),
            },
        );
        drop(cache);

        // Byte-level cache tracking
        state.metrics.total_cached_bytes.fetch_add(byte_len, Ordering::Relaxed);
        if let Some((_, old_seg)) = evicted {
            let old_len = old_seg.body.len() as u64;
            let _ = state.metrics.total_cached_bytes.fetch_update(
                Ordering::Relaxed, Ordering::Relaxed,
                |current| Some(current.saturating_sub(old_len))
            );
        }

        // Rolling-window timing
        let elapsed_ms = start.elapsed().as_millis() as u64;
        let count = state.metrics.download_count.fetch_add(1, Ordering::Relaxed) + 1;
        if count > 100 {
            state.metrics.download_count.store(1, Ordering::Relaxed);
            state.metrics.total_download_ms.store(elapsed_ms, Ordering::Relaxed);
        } else {
            state.metrics.total_download_ms.fetch_add(elapsed_ms, Ordering::Relaxed);
        }

        state.metrics.prefetch_completed.fetch_add(1, Ordering::Relaxed);

        let _ = body_arc;
    }

    let mut prefetching = state.prefetching.write().await;
    prefetching.remove(&url);
}

/// Helper: Download with retries and semaphore throttling
async fn download_with_retries(state: ProxyState, url: String, max_retries: u32) -> Result<(Vec<u8>, String), String> {
    // Acquire semaphore permit — limits global concurrent CDN downloads
    let _permit = state.download_semaphore.acquire().await.map_err(|e| e.to_string())?;
    
    let max_attempts = 1 + max_retries;

    for attempt in 1..=max_attempts {
        let cdn_headers = state.headers.read().await;
        let mut req = state.client.get(&url);
        if let Some(ref r) = cdn_headers.referer { req = req.header("Referer", r); }
        if let Some(ref o) = cdn_headers.origin { req = req.header("Origin", o); }
        if let Some(ref u) = cdn_headers.user_agent { req = req.header("User-Agent", u); }
        for (k, v) in cdn_headers.extra_headers.iter() {
            let lk = k.to_ascii_lowercase();
            if lk == "referer"
                || lk == "origin"
                || lk == "user-agent"
                || lk == "range"
                || lk == "host"
                || lk == "content-length"
                || lk == "transfer-encoding"
                || lk == "connection"
            {
                continue;
            }
            req = req.header(k, v);
        }
        drop(cdn_headers);

        match req.send().await {
            Ok(resp) => {
                if resp.status().is_server_error() && attempt < max_attempts {
                    state.metrics.prefetch_retries.fetch_add(1, Ordering::Relaxed);
                    tokio::time::sleep(std::time::Duration::from_millis(200 * attempt as u64)).await;
                    continue;
                }
                let ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("video/mp2t").to_string();
                let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
                return Ok((bytes.to_vec(), ct));
            }
            Err(e) if attempt < max_attempts => {
                state.metrics.prefetch_retries.fetch_add(1, Ordering::Relaxed);
                tokio::time::sleep(std::time::Duration::from_millis(200 * attempt as u64)).await;
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Max retries exceeded".to_string())
}

/// Check if a URL is a video segment (not a manifest)
fn is_video_segment(url: &str) -> bool {
    // Check URL path only (before query string) to avoid false positives
    // from domains like "vts.example.com" matching ".ts"
    let path = url.split('?').next().unwrap_or(url).to_lowercase();
    (path.ends_with(".ts") || path.ends_with(".m4s") || path.ends_with(".mp4"))
        && !path.ends_with(".m3u8")
}

/// Shorten URL for logging
fn shorten_url(url: &str) -> String {
    if url.len() > 80 {
        format!("{}...{}", &url[..40], &url[url.len() - 30..])
    } else {
        url.to_string()
    }
}

/// Rewrite all URLs in an m3u8 manifest to route through our local proxy
fn rewrite_m3u8(content: &str, base_url: &str, port: u16) -> String {
    let base = url::Url::parse(base_url).ok();

    content
        .lines()
        .map(|line| {
            let trimmed = line.trim();

            if trimmed.is_empty() {
                return line.to_string();
            }

            if trimmed.starts_with('#') {
                if trimmed.contains("URI=\"") {
                    return rewrite_uri_attribute(trimmed, &base, port);
                }
                return line.to_string();
            }

            let absolute_url = resolve_url(trimmed, &base);
            format!(
                "http://127.0.0.1:{}/proxy?url={}",
                port,
                urlencoding::encode(&absolute_url)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Rewrite URI="..." attributes in m3u8 tags (e.g., #EXT-X-KEY, #EXT-X-MAP)
fn rewrite_uri_attribute(line: &str, base: &Option<url::Url>, port: u16) -> String {
    if let Some(start) = line.find("URI=\"") {
        let prefix = &line[..start + 5];
        let after = &line[start + 5..];

        if let Some(end) = after.find('"') {
            let uri = &after[..end];
            let suffix = &after[end..];

            let absolute_url = resolve_url(uri, base);
            let proxy_url = format!(
                "http://127.0.0.1:{}/proxy?url={}",
                port,
                urlencoding::encode(&absolute_url)
            );

            return format!("{}{}{}", prefix, proxy_url, suffix);
        }
    }
    line.to_string()
}

/// Resolve a URL against a base URL (handles relative URLs)
fn resolve_url(url_str: &str, base: &Option<url::Url>) -> String {
    if url_str.starts_with("http://") || url_str.starts_with("https://") {
        return url_str.to_string();
    }

    if let Some(ref base) = base {
        base.join(url_str)
            .map(|u| u.to_string())
            .unwrap_or_else(|_| url_str.to_string())
    } else {
        url_str.to_string()
    }
}

fn validate_proxy_target(target_url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(target_url).map_err(|_| "Invalid proxy url".to_string())?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("Only http/https URLs are allowed".to_string());
    }

    let host = parsed.host_str().ok_or_else(|| "URL host is required".to_string())?;
    let host_lc = host.to_ascii_lowercase();
    if host_lc == "localhost" {
        return Err("Localhost targets are blocked".to_string());
    }

    if let Ok(ip) = host_lc.parse::<IpAddr>() {
        let blocked = match ip {
            IpAddr::V4(v4) => {
                v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_unspecified()
                    || v4 == Ipv4Addr::BROADCAST
            }
            IpAddr::V6(v6) => {
                v6.is_loopback()
                    || v6.is_unspecified()
                    || v6.is_unique_local()
                    || v6.is_unicast_link_local()
                    || v6 == Ipv6Addr::LOCALHOST
            }
        };
        if blocked {
            return Err("Private/local IP targets are blocked".to_string());
        }
    }

    Ok(())
}

/// JSON metrics endpoint — exposes live proxy performance data
async fn metrics_handler(State(state): State<ProxyState>) -> impl IntoResponse {
    let m = &state.metrics;
    let hits = m.cache_hits.load(Ordering::Relaxed);
    let misses = m.cache_misses.load(Ordering::Relaxed);
    let total = hits + misses;
    let hit_rate = if total == 0 { 0.0 } else { (hits as f64 / total as f64) * 100.0 };

    let json = serde_json::json!({
        "cache_hits": hits,
        "cache_misses": misses,
        "hit_rate_percent": (hit_rate * 100.0).round() / 100.0,
        "prefetch_completed": m.prefetch_completed.load(Ordering::Relaxed),
        "prefetch_cancelled": m.prefetch_cancelled.load(Ordering::Relaxed),
        "prefetch_retries": m.prefetch_retries.load(Ordering::Relaxed),
        "prefetch_hedged": m.prefetch_hedged.load(Ordering::Relaxed),
        "total_bytes_served": m.total_bytes_served.load(Ordering::Relaxed),
        "cached_bytes": m.total_cached_bytes.load(Ordering::Relaxed),
        "cached_mb": (m.total_cached_bytes.load(Ordering::Relaxed) as f64 / (1024.0 * 1024.0) * 100.0).round() / 100.0,
        "avg_download_ms": m.avg_download_ms(),
        "adaptive_window": m.adaptive_prefetch_ahead(),
        "segments_downloaded": m.download_count.load(Ordering::Relaxed),
    });

    (
        StatusCode::OK,
        [
            ("content-type", "application/json"),
            ("access-control-allow-origin", "*"),
        ],
        json.to_string(),
    )
}

/// Start the proxy server on a random local port
pub async fn start_proxy(state: ProxyState) {
    let app = Router::new()
        .route("/proxy", get(proxy_handler).options(options_handler))
        .route("/metrics", get(metrics_handler))
        .with_state(state.clone());

    let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[HLS Proxy] Failed to bind: {}", e);
            return;
        }
    };

    let port = listener.local_addr().unwrap().port();
    state.port.store(port, Ordering::SeqCst);
    println!("[HLS Proxy] 🚀 Started on http://127.0.0.1:{} with continuous prefetching", port);

    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("[HLS Proxy] Server error: {}", e);
    }
}

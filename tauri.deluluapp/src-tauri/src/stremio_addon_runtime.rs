use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const STREMIO_STATE_FILE: &str = "addon_manager/stremio_state.json";
const STREMIO_MANIFEST_TTL_MS: u64 = 60 * 60 * 1000;
const STREMIO_STREAM_CACHE_TTL_MS: u64 = 120 * 1000;
const STREMIO_DEFAULT_TIMEOUT_MS: u64 = 5_000;
const STREMIO_MAX_RETRY: u8 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StremioManifestLite {
    pub id: String,
    pub version: String,
    pub name: String,
    pub description: String,
    pub resources: Vec<Value>,
    pub types: Vec<String>,
    pub id_prefixes: Option<Vec<String>>,
    pub catalogs: Option<Value>,
    pub behavior_hints: Option<Value>,
    pub logo: Option<String>,
    pub background: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StremioInstalledAddon {
    pub id: String,
    pub base_url: String,
    pub manifest_url: String,
    pub manifest: StremioManifestLite,
    pub enabled: bool,
    pub installed_at: u64,
    pub updated_at: u64,
    pub last_manifest_fetch_at: u64,
    pub last_error: Option<String>,
    pub fail_count: u32,
    pub success_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StremioAddonState {
    pub addons: Vec<StremioInstalledAddon>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StremioCommunityAddonEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub manifest_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StremioUnifiedStream {
    pub id: String,
    pub title: String,
    pub r#type: String, // torrent | direct
    pub info_hash: Option<String>,
    pub url: Option<String>,
    pub quality: Option<String>,
    pub size: Option<String>,
    pub seeders: Option<i64>,
    pub source_addon: String,
    pub raw: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StremioAggregateResult {
    pub streams: Vec<StremioUnifiedStream>,
    pub errors: Vec<Value>,
    pub cache_hit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StremioFetchResourceResponse {
    pub request_url: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StremioTmdbAggregateRequest {
    pub media_type: String,
    pub tmdb_id: u32,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone)]
struct StreamCacheEntry {
    payload: StremioAggregateResult,
    created_at: u64,
}

static STREAM_CACHE: std::sync::OnceLock<std::sync::RwLock<BTreeMap<String, StreamCacheEntry>>> =
    std::sync::OnceLock::new();

fn stream_cache_map() -> &'static std::sync::RwLock<BTreeMap<String, StreamCacheEntry>> {
    STREAM_CACHE.get_or_init(|| std::sync::RwLock::new(BTreeMap::new()))
}

fn now_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn app_data_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {e}"))?;
    }
    Ok(())
}

fn state_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app_data_path(app)?.join(STREMIO_STATE_FILE);
    ensure_parent(&path)?;
    Ok(path)
}

fn read_state(app: &tauri::AppHandle) -> Result<StremioAddonState, String> {
    let path = state_file_path(app)?;
    if !path.exists() {
        return Ok(StremioAddonState::default());
    }
    let raw = std::fs::read_to_string(path).map_err(|e| format!("Failed to read stremio state: {e}"))?;
    serde_json::from_str::<StremioAddonState>(&raw).map_err(|e| format!("Invalid stremio state JSON: {e}"))
}

fn write_state(app: &tauri::AppHandle, state: &StremioAddonState) -> Result<(), String> {
    let path = state_file_path(app)?;
    let raw = serde_json::to_string_pretty(state).map_err(|e| format!("State serialize error: {e}"))?;
    std::fs::write(path, raw).map_err(|e| format!("Failed to write stremio state: {e}"))
}

fn validate_url_allow_http_https(url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(url).map_err(|_| "Invalid URL".to_string())?;
    match parsed.scheme() {
        "https" | "http" => Ok(parsed),
        _ => Err("Only HTTP/HTTPS URLs are supported for Stremio addons".to_string()),
    }
}

fn normalize_manifest_url(input: &str) -> Result<(String, String), String> {
    let parsed = validate_url_allow_http_https(input.trim())?;
    let mut path = parsed.path().trim_end_matches('/').to_string();
    if !path.ends_with("manifest.json") {
        if path.is_empty() || path == "/" {
            path = "/manifest.json".to_string();
        } else {
            path = format!("{}/manifest.json", path);
        }
    }
    let mut manifest = parsed;
    manifest.set_path(&path);
    manifest.set_query(None);
    manifest.set_fragment(None);

    let manifest_url = manifest.to_string();
    let base_url = manifest_url
        .trim_end_matches("manifest.json")
        .trim_end_matches('/')
        .to_string();
    Ok((manifest_url, base_url))
}

fn validate_semver_like(version: &str) -> bool {
    let v = version.trim();
    if v.is_empty() {
        return false;
    }
    let core = v.split('-').next().unwrap_or(v);
    let parts: Vec<&str> = core.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

fn parse_manifest(raw: Value) -> Result<StremioManifestLite, String> {
    let manifest: StremioManifestLite =
        serde_json::from_value(raw).map_err(|e| format!("Invalid manifest format: {e}"))?;

    if manifest.id.trim().is_empty() {
        return Err("Manifest validation failed: id is required".to_string());
    }
    if manifest.name.trim().is_empty() {
        return Err("Manifest validation failed: name is required".to_string());
    }
    if manifest.description.trim().is_empty() {
        return Err("Manifest validation failed: description is required".to_string());
    }
    if !validate_semver_like(&manifest.version) {
        return Err("Manifest validation failed: version must be semver-like (x.y.z)".to_string());
    }
    if manifest.resources.is_empty() {
        return Err("Manifest validation failed: resources must be non-empty array".to_string());
    }
    if manifest.types.is_empty() {
        return Err("Manifest validation failed: types must be non-empty array".to_string());
    }
    Ok(manifest)
}

fn normalize_resource_path(resource: &str, media_type: &str, media_id: &str) -> Result<String, String> {
    let r = resource.trim();
    let t = media_type.trim();
    let id = media_id.trim();
    if r.is_empty() || t.is_empty() || id.is_empty() {
        return Err("resource/type/id are required".to_string());
    }
    Ok(format!("{}/{}/{}.json", r, t, id))
}

fn normalize_stream_media_type(input: &str) -> Result<String, String> {
    let lower = input.trim().to_ascii_lowercase();
    match lower.as_str() {
        "movie" => Ok("movie".to_string()),
        "series" | "tv" | "show" => Ok("series".to_string()),
        other => Err(format!("Unsupported Stremio media type: {other}")),
    }
}

fn stremio_type_matches(addon_type: &str, requested: &str) -> bool {
    let a = addon_type.trim().to_ascii_lowercase();
    let r = requested.trim().to_ascii_lowercase();
    if r == "series" {
        a == "series" || a == "tv"
    } else {
        a == r
    }
}

fn addon_supports_stream_resource(addon: &StremioInstalledAddon, requested_type: &str) -> bool {
    let mut has_stream = false;
    let mut stream_type_match = false;

    for resource in &addon.manifest.resources {
        if let Some(name) = resource.as_str() {
            if name == "stream" {
                has_stream = true;
                if addon
                    .manifest
                    .types
                    .iter()
                    .any(|t| stremio_type_matches(t, requested_type))
                {
                    stream_type_match = true;
                }
            }
            continue;
        }

        let Some(obj) = resource.as_object() else {
            continue;
        };
        let Some(name) = obj.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        if name != "stream" {
            continue;
        }

        has_stream = true;
        if let Some(types) = obj.get("types").and_then(|v| v.as_array()) {
            if types
                .iter()
                .filter_map(|v| v.as_str())
                .any(|t| stremio_type_matches(t, requested_type))
            {
                stream_type_match = true;
            }
        } else if addon
            .manifest
            .types
            .iter()
            .any(|t| stremio_type_matches(t, requested_type))
        {
            stream_type_match = true;
        }
    }

    has_stream && stream_type_match
}

fn addon_stream_id_prefixes(addon: &StremioInstalledAddon) -> Option<Vec<String>> {
    let mut discovered_prefixes: Vec<String> = Vec::new();
    let mut has_unrestricted_stream_object = false;

    for resource in &addon.manifest.resources {
        let Some(obj) = resource.as_object() else {
            continue;
        };
        let Some(name) = obj.get("name").and_then(|v| v.as_str()) else {
            continue;
        };
        if name != "stream" {
            continue;
        }

        if let Some(prefixes) = obj.get("idPrefixes").and_then(|v| v.as_array()) {
            for prefix in prefixes.iter().filter_map(|v| v.as_str()) {
                let normalized = prefix.trim().to_ascii_lowercase();
                if !normalized.is_empty() {
                    discovered_prefixes.push(normalized);
                }
            }
        } else {
            has_unrestricted_stream_object = true;
        }
    }

    if has_unrestricted_stream_object {
        return None;
    }

    if discovered_prefixes.is_empty() {
        if let Some(prefixes) = &addon.manifest.id_prefixes {
            for prefix in prefixes {
                let normalized = prefix.trim().to_ascii_lowercase();
                if !normalized.is_empty() {
                    discovered_prefixes.push(normalized);
                }
            }
        }
    }

    if discovered_prefixes.is_empty() {
        None
    } else {
        discovered_prefixes.sort();
        discovered_prefixes.dedup();
        Some(discovered_prefixes)
    }
}

fn tmdb_token() -> Result<String, String> {
    crate::get_env_required("TMDB_READ_TOKEN")
        .map_err(|_| "Missing TMDB_READ_TOKEN for TMDb normalization layer".to_string())
}

async fn fetch_tmdb_imdb_id(stremio_media_type: &str, tmdb_id: u32) -> Result<Option<String>, String> {
    let tmdb_type = if stremio_media_type == "movie" { "movie" } else { "tv" };
    let token = tmdb_token()?;
    let url = format!(
        "https://api.themoviedb.org/3/{}/{}/external_ids",
        tmdb_type, tmdb_id
    );
    let client = rquest::Client::new();
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("TMDb external_ids request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "TMDb external_ids HTTP {} for {}",
            resp.status().as_u16(),
            url
        ));
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("TMDb response read failed: {e}"))?;
    let json: Value = serde_json::from_str(&body)
        .map_err(|e| format!("TMDb JSON parse failed: {e}"))?;

    let imdb = json
        .get("imdb_id")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Ok(imdb)
}

fn build_tmdb_video_id_candidates(
    stremio_media_type: &str,
    tmdb_id: u32,
    season: Option<u32>,
    episode: Option<u32>,
    imdb_id: Option<&str>,
) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();

    if stremio_media_type == "movie" {
        if let Some(imdb) = imdb_id {
            out.push(imdb.to_string());
        }
        out.push(format!("tmdb:movie:{}", tmdb_id));
        out.push(format!("tmdb:{}", tmdb_id));
        out.push(tmdb_id.to_string());
    } else {
        if let (Some(imdb), Some(s), Some(e)) = (imdb_id, season, episode) {
            out.push(format!("{}:{}:{}", imdb, s, e));
        }
        if let Some(imdb) = imdb_id {
            out.push(imdb.to_string());
        }
        if let (Some(s), Some(e)) = (season, episode) {
            out.push(format!("tmdb:series:{}:{}:{}", tmdb_id, s, e));
            out.push(format!("tmdb:tv:{}:{}:{}", tmdb_id, s, e));
            out.push(format!("tmdb:{}:{}:{}", tmdb_id, s, e));
            out.push(format!("{}:{}:{}", tmdb_id, s, e));
        }
        out.push(format!("tmdb:series:{}", tmdb_id));
        out.push(format!("tmdb:tv:{}", tmdb_id));
        out.push(format!("tmdb:{}", tmdb_id));
        out.push(tmdb_id.to_string());
    }

    let mut seen = HashSet::new();
    out.into_iter()
        .filter(|v| {
            let key = v.to_ascii_lowercase();
            if seen.contains(&key) {
                false
            } else {
                seen.insert(key);
                true
            }
        })
        .collect()
}

fn filter_ids_for_addon(addon: &StremioInstalledAddon, ids: &[String]) -> Vec<String> {
    match addon_stream_id_prefixes(addon) {
        None => ids.to_vec(),
        Some(prefixes) => ids
            .iter()
            .filter(|id| {
                let lowered = id.to_ascii_lowercase();
                prefixes.iter().any(|prefix| lowered.starts_with(prefix))
            })
            .cloned()
            .collect(),
    }
}

fn quality_score_from_stream(stream: &Value) -> i64 {
    let quality = stream
        .get("quality")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let title = stream
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let hay = format!("{quality} {title}");
    if hay.contains("2160") || hay.contains("4k") {
        5
    } else if hay.contains("1440") {
        4
    } else if hay.contains("1080") {
        3
    } else if hay.contains("720") {
        2
    } else if hay.contains("480") {
        1
    } else {
        0
    }
}

fn size_score_from_stream(stream: &Value) -> i64 {
    let size = stream
        .get("size")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if size.is_empty() {
        return 0;
    }
    let numeric: f64 = size
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.')
        .collect::<String>()
        .parse()
        .unwrap_or(0.0);
    if size.contains("gb") {
        (numeric * 1000.0) as i64
    } else if size.contains("mb") {
        numeric as i64
    } else {
        0
    }
}

fn make_stream_id(source_addon: &str, info_hash: Option<&str>, url: Option<&str>, idx: usize) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source_addon.as_bytes());
    hasher.update(b"|");
    if let Some(hash) = info_hash {
        hasher.update(hash.as_bytes());
    }
    hasher.update(b"|");
    if let Some(u) = url {
        hasher.update(u.as_bytes());
    }
    hasher.update(b"|");
    hasher.update(idx.to_string().as_bytes());
    hex::encode(hasher.finalize())
}

fn curated_stremio_catalog() -> Vec<StremioCommunityAddonEntry> {
    vec![
        StremioCommunityAddonEntry {
            id: "com.stremio.torrentio.addon".to_string(),
            name: "Torrentio".to_string(),
            description: "Popular community torrent/debrid addon (third-party).".to_string(),
            manifest_url: "https://torrentio.strem.fun/manifest.json".to_string(),
        },
        StremioCommunityAddonEntry {
            id: "com.linvo.cinemeta".to_string(),
            name: "Cinemeta".to_string(),
            description: "Metadata-focused addon endpoint used by Stremio ecosystem.".to_string(),
            manifest_url: "https://v3-cinemeta.strem.io/manifest.json".to_string(),
        },
        StremioCommunityAddonEntry {
            id: "org.stremio.opensubtitlesv3".to_string(),
            name: "OpenSubtitles v3".to_string(),
            description: "Subtitle addon for multiple languages.".to_string(),
            manifest_url: "https://opensubtitles-v3.strem.io/manifest.json".to_string(),
        },
        StremioCommunityAddonEntry {
            id: "stremio.addons.mediafusion|elfhosted".to_string(),
            name: "MediaFusion | ElfHosted".to_string(),
            description: "Community streaming addon endpoint (third-party).".to_string(),
            manifest_url: "https://mediafusion.elfhosted.com/manifest.json".to_string(),
        },
    ]
}

async fn fetch_json_with_retry(url: &str, timeout_ms: u64, retry: u8) -> Result<Value, String> {
    let _ = validate_url_allow_http_https(url)?;
    let client = rquest::Client::new();
    let mut attempt: u8 = 0;
    let max_attempts = retry.saturating_add(1);
    let mut last_err = String::new();

    while attempt < max_attempts {
        attempt += 1;
        let request = async {
            let resp = client
                .get(url)
                .send()
                .await
                .map_err(|e| format!("Network request failed: {e}"))?;
            if !resp.status().is_success() {
                return Err(format!("HTTP {} while fetching {}", resp.status().as_u16(), url));
            }
            let body = resp
                .text()
                .await
                .map_err(|e| format!("Failed to read response body: {e}"))?;
            serde_json::from_str::<Value>(&body).map_err(|e| format!("Invalid JSON response: {e}"))
        };
        match tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), request).await {
            Ok(Ok(json)) => return Ok(json),
            Ok(Err(e)) => {
                last_err = e;
            }
            Err(_) => {
                last_err = format!("Request timeout after {timeout_ms}ms");
            }
        }
    }

    Err(last_err)
}

fn should_refresh_manifest(addon: &StremioInstalledAddon) -> bool {
    now_ts().saturating_sub(addon.last_manifest_fetch_at) > STREMIO_MANIFEST_TTL_MS
}

async fn refresh_manifest_if_needed(addon: &mut StremioInstalledAddon) -> Result<(), String> {
    if !should_refresh_manifest(addon) {
        return Ok(());
    }
    let raw = fetch_json_with_retry(&addon.manifest_url, STREMIO_DEFAULT_TIMEOUT_MS, STREMIO_MAX_RETRY).await?;
    let parsed = parse_manifest(raw)?;
    if parsed.id != addon.id {
        return Err(format!(
            "Manifest id mismatch: expected {}, got {}",
            addon.id, parsed.id
        ));
    }
    addon.manifest = parsed;
    addon.updated_at = now_ts();
    addon.last_manifest_fetch_at = addon.updated_at;
    addon.last_error = None;
    Ok(())
}

#[tauri::command]
pub fn stremio_addon_list(app: tauri::AppHandle) -> Result<StremioAddonState, String> {
    read_state(&app)
}

#[tauri::command]
pub fn stremio_addon_get_curated_catalog() -> Result<Vec<StremioCommunityAddonEntry>, String> {
    Ok(curated_stremio_catalog())
}

#[tauri::command]
pub async fn stremio_addon_install_from_manifest_url(
    app: tauri::AppHandle,
    manifest_url: String,
) -> Result<StremioInstalledAddon, String> {
    let (normalized_manifest_url, base_url) = normalize_manifest_url(&manifest_url)?;
    let raw_manifest = fetch_json_with_retry(
        &normalized_manifest_url,
        STREMIO_DEFAULT_TIMEOUT_MS,
        STREMIO_MAX_RETRY,
    )
    .await?;
    let parsed_manifest = parse_manifest(raw_manifest)?;

    let mut state = read_state(&app)?;
    if state
        .addons
        .iter()
        .any(|a| a.id == parsed_manifest.id && a.manifest_url != normalized_manifest_url)
    {
        return Err(format!("Addon id '{}' already installed from another URL", parsed_manifest.id));
    }

    let now = now_ts();
    let record = StremioInstalledAddon {
        id: parsed_manifest.id.clone(),
        base_url,
        manifest_url: normalized_manifest_url.clone(),
        manifest: parsed_manifest,
        enabled: true,
        installed_at: now,
        updated_at: now,
        last_manifest_fetch_at: now,
        last_error: None,
        fail_count: 0,
        success_count: 0,
    };

    if let Some(idx) = state.addons.iter().position(|a| a.id == record.id) {
        state.addons[idx] = record.clone();
    } else {
        state.addons.push(record.clone());
    }
    write_state(&app, &state)?;
    Ok(record)
}

#[tauri::command]
pub fn stremio_addon_set_enabled(
    app: tauri::AppHandle,
    addon_id: String,
    enabled: bool,
) -> Result<StremioAddonState, String> {
    let mut state = read_state(&app)?;
    let addon = state
        .addons
        .iter_mut()
        .find(|a| a.id == addon_id)
        .ok_or_else(|| format!("Stremio addon '{}' not found", addon_id))?;
    addon.enabled = enabled;
    addon.updated_at = now_ts();
    write_state(&app, &state)?;
    Ok(state)
}

#[tauri::command]
pub fn stremio_addon_remove(app: tauri::AppHandle, addon_id: String) -> Result<StremioAddonState, String> {
    let mut state = read_state(&app)?;
    state.addons.retain(|a| a.id != addon_id);
    write_state(&app, &state)?;
    Ok(state)
}

#[tauri::command]
pub async fn stremio_addon_health_check_by_id(
    app: tauri::AppHandle,
    addon_id: String,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let mut state = read_state(&app)?;
    let idx = state
        .addons
        .iter()
        .position(|a| a.id == addon_id)
        .ok_or_else(|| format!("Stremio addon '{}' not found", addon_id))?;

    let snapshot = state.addons[idx].clone();
    let timeout = timeout_ms.unwrap_or(STREMIO_DEFAULT_TIMEOUT_MS).clamp(3000, 10000);
    let started_at = now_ts();

    let health = fetch_json_with_retry(&snapshot.manifest_url, timeout, STREMIO_MAX_RETRY).await;
    match health {
        Ok(raw_manifest) => {
            let parsed = parse_manifest(raw_manifest)?;
            if parsed.id != snapshot.id {
                return Ok(json!({
                    "ok": false,
                    "addonId": snapshot.id,
                    "addonName": snapshot.manifest.name,
                    "error": format!(
                        "Manifest id mismatch: expected {}, got {}",
                        snapshot.id,
                        parsed.id
                    )
                }));
            }

            let latency = now_ts().saturating_sub(started_at);
            let (addon_id, addon_name, manifest_version) = {
                let addon = &mut state.addons[idx];
                addon.manifest = parsed;
                addon.last_manifest_fetch_at = now_ts();
                addon.updated_at = now_ts();
                addon.last_error = None;
                addon.success_count = addon.success_count.saturating_add(1);
                if addon.fail_count > 0 {
                    addon.fail_count -= 1;
                }
                (
                    addon.id.clone(),
                    addon.manifest.name.clone(),
                    addon.manifest.version.clone(),
                )
            };
            write_state(&app, &state)?;

            Ok(json!({
                "ok": true,
                "addonId": addon_id,
                "addonName": addon_name,
                "latencyMs": latency,
                "manifestVersion": manifest_version
            }))
        }
        Err(err) => {
            let (addon_id, addon_name) = {
                let addon = &mut state.addons[idx];
                addon.last_error = Some(err.clone());
                addon.fail_count = addon.fail_count.saturating_add(1);
                addon.updated_at = now_ts();
                (addon.id.clone(), addon.manifest.name.clone())
            };
            write_state(&app, &state)?;

            Ok(json!({
                "ok": false,
                "addonId": addon_id,
                "addonName": addon_name,
                "error": err
            }))
        }
    }
}

#[tauri::command]
pub async fn stremio_addon_fetch_resource(
    app: tauri::AppHandle,
    addon_id: String,
    resource: String,
    media_type: String,
    media_id: String,
    extra_query: Option<BTreeMap<String, String>>,
    timeout_ms: Option<u64>,
) -> Result<StremioFetchResourceResponse, String> {
    let mut state = read_state(&app)?;
    let addon = state
        .addons
        .iter_mut()
        .find(|a| a.id == addon_id)
        .ok_or_else(|| "Addon not found".to_string())?;
    refresh_manifest_if_needed(addon).await?;
    let base_url = addon.base_url.clone();
    write_state(&app, &state)?;

    let path = normalize_resource_path(&resource, &media_type, &media_id)?;
    let mut url = url::Url::parse(&format!("{}/", base_url))
        .map_err(|e| format!("Invalid addon base URL: {e}"))?
        .join(&path)
        .map_err(|e| format!("Failed to build resource URL: {e}"))?;
    if let Some(extra) = extra_query {
        {
            let mut qp = url.query_pairs_mut();
            for (k, v) in extra {
                if !k.trim().is_empty() {
                    qp.append_pair(k.trim(), v.trim());
                }
            }
        }
    }
    let payload = fetch_json_with_retry(
        url.as_str(),
        timeout_ms.unwrap_or(STREMIO_DEFAULT_TIMEOUT_MS),
        STREMIO_MAX_RETRY,
    )
    .await?;
    Ok(StremioFetchResourceResponse {
        request_url: url.to_string(),
        payload,
    })
}

#[tauri::command]
pub async fn stremio_addon_aggregate_streams(
    app: tauri::AppHandle,
    media_type: String,
    media_id: String,
    timeout_ms: Option<u64>,
) -> Result<StremioAggregateResult, String> {
    let timeout = timeout_ms.unwrap_or(STREMIO_DEFAULT_TIMEOUT_MS).clamp(3000, 7000);
    let cache_key = format!(
        "{}::{}::{}",
        media_type.trim().to_ascii_lowercase(),
        media_id.trim().to_ascii_lowercase(),
        timeout
    );
    {
        let cache = stream_cache_map()
            .read()
            .map_err(|_| "Cache lock poisoned".to_string())?;
        if let Some(entry) = cache.get(&cache_key) {
            if now_ts().saturating_sub(entry.created_at) <= STREMIO_STREAM_CACHE_TTL_MS {
                let mut payload = entry.payload.clone();
                payload.cache_hit = true;
                return Ok(payload);
            }
        }
    }

    let mut state = read_state(&app)?;
    for addon in state.addons.iter_mut() {
        if addon.enabled {
            if let Err(e) = refresh_manifest_if_needed(addon).await {
                addon.last_error = Some(e);
                addon.fail_count = addon.fail_count.saturating_add(1);
            }
        }
    }
    write_state(&app, &state)?;

    let enabled_addons: Vec<StremioInstalledAddon> = state.addons.iter().filter(|a| a.enabled).cloned().collect();
    if enabled_addons.is_empty() {
        return Ok(StremioAggregateResult {
            streams: vec![],
            errors: vec![json!({"error":"No enabled Stremio addons"})],
            cache_hit: false,
        });
    }

    let mut jobs = tokio::task::JoinSet::new();
    let path = normalize_resource_path("stream", &media_type, &media_id)?;

    for addon in enabled_addons {
        let addon_id = addon.id.clone();
        let addon_name = addon.manifest.name.clone();
        let request_url = match url::Url::parse(&format!("{}/", addon.base_url))
            .and_then(|base| base.join(&path))
        {
            Ok(url) => url.to_string(),
            Err(e) => {
                jobs.spawn(async move {
                    Err::<(String, String, String, Value), (String, String)>((
                        addon_id,
                        format!("Invalid resource URL: {e}"),
                    ))
                });
                continue;
            }
        };
        jobs.spawn(async move {
            let payload = fetch_json_with_retry(&request_url, timeout, STREMIO_MAX_RETRY).await;
            match payload {
                Ok(json) => Ok::<(String, String, String, Value), (String, String)>((
                    addon_id,
                    addon_name,
                    request_url,
                    json,
                )),
                Err(e) => Err::<(String, String, String, Value), (String, String)>((addon_id, e)),
            }
        });
    }

    let mut normalized: Vec<StremioUnifiedStream> = Vec::new();
    let mut errors: Vec<Value> = Vec::new();
    let mut addon_health: BTreeMap<String, (bool, Option<String>)> = BTreeMap::new();
    let mut seen_infohash: HashSet<String> = HashSet::new();
    let mut seen_url: HashSet<String> = HashSet::new();

    while let Some(done) = jobs.join_next().await {
        match done {
            Ok(Ok((addon_id, addon_name, request_url, payload))) => {
                let streams = payload
                    .get("streams")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                for (idx, stream) in streams.iter().enumerate() {
                    let info_hash = stream.get("infoHash").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let url = stream.get("url").and_then(|v| v.as_str()).map(|s| s.to_string());
                    if info_hash.is_none() && url.is_none() {
                        continue;
                    }

                    if let Some(hash) = info_hash.as_deref() {
                        let key = hash.to_ascii_lowercase();
                        if seen_infohash.contains(&key) {
                            continue;
                        }
                        seen_infohash.insert(key);
                    } else if let Some(link) = url.as_deref() {
                        let key = link.trim().to_ascii_lowercase();
                        if seen_url.contains(&key) {
                            continue;
                        }
                        seen_url.insert(key);
                    }

                    let title = stream
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Untitled Stream")
                        .to_string();
                    let quality = stream.get("quality").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let size = stream.get("size").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let seeders = stream.get("seeders").and_then(|v| v.as_i64());
                    let stream_type = if info_hash.is_some() { "torrent" } else { "direct" }.to_string();
                    let sid = make_stream_id(&addon_id, info_hash.as_deref(), url.as_deref(), idx);

                    normalized.push(StremioUnifiedStream {
                        id: sid,
                        title,
                        r#type: stream_type,
                        info_hash,
                        url,
                        quality,
                        size,
                        seeders,
                        source_addon: addon_name.clone(),
                        raw: stream.clone(),
                    });
                }

                errors.push(json!({
                    "addonId": addon_id,
                    "status": "ok",
                    "requestUrl": request_url
                }));
                addon_health.insert(addon_id, (true, None));
            }
            Ok(Err((addon_id, err))) => {
                errors.push(json!({
                    "addonId": addon_id,
                    "status": "failed",
                    "error": err
                }));
                addon_health.insert(addon_id, (false, Some(err)));
            }
            Err(e) => {
                errors.push(json!({
                    "addonId": "unknown",
                    "status": "failed",
                    "error": format!("task join error: {e}")
                }));
            }
        }
    }

    for addon in state.addons.iter_mut() {
        if let Some((ok, err)) = addon_health.get(&addon.id) {
            if *ok {
                addon.success_count = addon.success_count.saturating_add(1);
                addon.last_error = None;
                if addon.fail_count > 0 {
                    addon.fail_count -= 1;
                }
            } else {
                addon.fail_count = addon.fail_count.saturating_add(1);
                addon.last_error = err.clone();
                if addon.fail_count >= 5 {
                    addon.enabled = false;
                    addon.last_error = Some("Auto-disabled after repeated failures".to_string());
                }
            }
            addon.updated_at = now_ts();
        }
    }
    let _ = write_state(&app, &state);

    normalized.sort_by(|a, b| {
        let seeders_a = a.seeders.unwrap_or(0);
        let seeders_b = b.seeders.unwrap_or(0);
        let qa = quality_score_from_stream(&a.raw);
        let qb = quality_score_from_stream(&b.raw);
        let sa = size_score_from_stream(&a.raw);
        let sb = size_score_from_stream(&b.raw);
        seeders_b
            .cmp(&seeders_a)
            .then(qb.cmp(&qa))
            .then(sb.cmp(&sa))
    });

    let result = StremioAggregateResult {
        streams: normalized,
        errors,
        cache_hit: false,
    };

    {
        let mut cache = stream_cache_map()
            .write()
            .map_err(|_| "Cache lock poisoned".to_string())?;
        cache.insert(
            cache_key,
            StreamCacheEntry {
                payload: result.clone(),
                created_at: now_ts(),
            },
        );
    }

    Ok(result)
}

#[tauri::command]
pub async fn stremio_addon_aggregate_streams_tmdb(
    app: tauri::AppHandle,
    request: StremioTmdbAggregateRequest,
) -> Result<StremioAggregateResult, String> {
    let media_type = normalize_stream_media_type(&request.media_type)?;
    let timeout = request
        .timeout_ms
        .unwrap_or(STREMIO_DEFAULT_TIMEOUT_MS)
        .clamp(3000, 7000);

    let cache_key = format!(
        "tmdb::{}::{}::{}::{}::{}",
        media_type,
        request.tmdb_id,
        request.season.unwrap_or(0),
        request.episode.unwrap_or(0),
        timeout
    );
    {
        let cache = stream_cache_map()
            .read()
            .map_err(|_| "Cache lock poisoned".to_string())?;
        if let Some(entry) = cache.get(&cache_key) {
            if now_ts().saturating_sub(entry.created_at) <= STREMIO_STREAM_CACHE_TTL_MS {
                let mut payload = entry.payload.clone();
                payload.cache_hit = true;
                return Ok(payload);
            }
        }
    }

    let mut state = read_state(&app)?;
    for addon in state.addons.iter_mut() {
        if addon.enabled {
            if let Err(e) = refresh_manifest_if_needed(addon).await {
                addon.last_error = Some(e);
                addon.fail_count = addon.fail_count.saturating_add(1);
            }
        }
    }
    write_state(&app, &state)?;

    let enabled_addons: Vec<StremioInstalledAddon> = state.addons.iter().filter(|a| a.enabled).cloned().collect();
    if enabled_addons.is_empty() {
        return Ok(StremioAggregateResult {
            streams: vec![],
            errors: vec![json!({"error":"No enabled Stremio addons"})],
            cache_hit: false,
        });
    }

    let imdb_id = match fetch_tmdb_imdb_id(&media_type, request.tmdb_id).await {
        Ok(id) => id,
        Err(_) => None,
    };
    let global_candidates = build_tmdb_video_id_candidates(
        &media_type,
        request.tmdb_id,
        request.season,
        request.episode,
        imdb_id.as_deref(),
    );

    let mut jobs = tokio::task::JoinSet::new();
    let mut errors: Vec<Value> = Vec::new();

    for addon in enabled_addons {
        if !addon_supports_stream_resource(&addon, &media_type) {
            errors.push(json!({
                "addonId": addon.id,
                "status": "skipped",
                "reason": format!("Addon does not support stream/{}", media_type)
            }));
            continue;
        }

        let addon_id = addon.id.clone();
        let addon_name = addon.manifest.name.clone();
        let addon_base_url = addon.base_url.clone();
        let candidate_ids = filter_ids_for_addon(&addon, &global_candidates);
        if candidate_ids.is_empty() {
            errors.push(json!({
                "addonId": addon_id,
                "status": "skipped",
                "reason": "No candidate IDs matched addon's idPrefixes"
            }));
            continue;
        }

        let requested_type = media_type.clone();
        jobs.spawn(async move {
            let mut last_err: Option<String> = None;

            for candidate_id in candidate_ids {
                let path = match normalize_resource_path("stream", &requested_type, &candidate_id) {
                    Ok(path) => path,
                    Err(e) => {
                        last_err = Some(e);
                        continue;
                    }
                };

                let request_url = match url::Url::parse(&format!("{}/", addon_base_url))
                    .and_then(|base| base.join(&path))
                {
                    Ok(url) => url.to_string(),
                    Err(e) => {
                        last_err = Some(format!("Invalid resource URL: {e}"));
                        continue;
                    }
                };

                match fetch_json_with_retry(&request_url, timeout, STREMIO_MAX_RETRY).await {
                    Ok(payload) => {
                        let has_streams = payload
                            .get("streams")
                            .and_then(|v| v.as_array())
                            .map(|a| !a.is_empty())
                            .unwrap_or(false);
                        if has_streams {
                            return Ok::<(String, String, String, String, Value), (String, String)>(
                                (addon_id, addon_name, request_url, candidate_id, payload),
                            );
                        }
                        last_err = Some(format!("No streams for candidate ID {}", candidate_id));
                    }
                    Err(e) => {
                        last_err = Some(format!("{} (candidate: {})", e, candidate_id));
                    }
                }
            }

            Err::<(String, String, String, String, Value), (String, String)>(
                (addon_id, last_err.unwrap_or_else(|| "No streams returned".to_string())),
            )
        });
    }

    let mut normalized: Vec<StremioUnifiedStream> = Vec::new();
    let mut addon_health: BTreeMap<String, (bool, Option<String>)> = BTreeMap::new();
    let mut seen_infohash: HashSet<String> = HashSet::new();
    let mut seen_url: HashSet<String> = HashSet::new();

    while let Some(done) = jobs.join_next().await {
        match done {
            Ok(Ok((addon_id, addon_name, request_url, requested_video_id, payload))) => {
                let streams = payload
                    .get("streams")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                for (idx, stream) in streams.iter().enumerate() {
                    let info_hash = stream.get("infoHash").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let url = stream.get("url").and_then(|v| v.as_str()).map(|s| s.to_string());
                    if info_hash.is_none() && url.is_none() {
                        continue;
                    }

                    if let Some(hash) = info_hash.as_deref() {
                        let key = hash.to_ascii_lowercase();
                        if seen_infohash.contains(&key) {
                            continue;
                        }
                        seen_infohash.insert(key);
                    } else if let Some(link) = url.as_deref() {
                        let key = link.trim().to_ascii_lowercase();
                        if seen_url.contains(&key) {
                            continue;
                        }
                        seen_url.insert(key);
                    }

                    let title = stream
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Untitled Stream")
                        .to_string();
                    let quality = stream.get("quality").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let size = stream.get("size").and_then(|v| v.as_str()).map(|s| s.to_string());
                    let seeders = stream.get("seeders").and_then(|v| v.as_i64());
                    let stream_type = if info_hash.is_some() { "torrent" } else { "direct" }.to_string();
                    let sid = make_stream_id(&addon_id, info_hash.as_deref(), url.as_deref(), idx);

                    normalized.push(StremioUnifiedStream {
                        id: sid,
                        title,
                        r#type: stream_type,
                        info_hash,
                        url,
                        quality,
                        size,
                        seeders,
                        source_addon: addon_name.clone(),
                        raw: stream.clone(),
                    });
                }

                errors.push(json!({
                    "addonId": addon_id,
                    "status": "ok",
                    "requestUrl": request_url,
                    "requestedVideoId": requested_video_id
                }));
                addon_health.insert(addon_id, (true, None));
            }
            Ok(Err((addon_id, err))) => {
                errors.push(json!({
                    "addonId": addon_id,
                    "status": "failed",
                    "error": err
                }));
                addon_health.insert(addon_id, (false, Some(err)));
            }
            Err(e) => {
                errors.push(json!({
                    "addonId": "unknown",
                    "status": "failed",
                    "error": format!("task join error: {e}")
                }));
            }
        }
    }

    for addon in state.addons.iter_mut() {
        if let Some((ok, err)) = addon_health.get(&addon.id) {
            if *ok {
                addon.success_count = addon.success_count.saturating_add(1);
                addon.last_error = None;
                if addon.fail_count > 0 {
                    addon.fail_count -= 1;
                }
            } else {
                addon.fail_count = addon.fail_count.saturating_add(1);
                addon.last_error = err.clone();
                if addon.fail_count >= 5 {
                    addon.enabled = false;
                    addon.last_error = Some("Auto-disabled after repeated failures".to_string());
                }
            }
            addon.updated_at = now_ts();
        }
    }
    let _ = write_state(&app, &state);

    normalized.sort_by(|a, b| {
        let seeders_a = a.seeders.unwrap_or(0);
        let seeders_b = b.seeders.unwrap_or(0);
        let qa = quality_score_from_stream(&a.raw);
        let qb = quality_score_from_stream(&b.raw);
        let sa = size_score_from_stream(&a.raw);
        let sb = size_score_from_stream(&b.raw);
        seeders_b
            .cmp(&seeders_a)
            .then(qb.cmp(&qa))
            .then(sb.cmp(&sa))
    });

    let result = StremioAggregateResult {
        streams: normalized,
        errors,
        cache_hit: false,
    };

    {
        let mut cache = stream_cache_map()
            .write()
            .map_err(|_| "Cache lock poisoned".to_string())?;
        cache.insert(
            cache_key,
            StreamCacheEntry {
                payload: result.clone(),
                created_at: now_ts(),
            },
        );
    }

    Ok(result)
}

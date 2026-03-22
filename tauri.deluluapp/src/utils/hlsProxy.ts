/**
 * HLS Proxy Utility
 * 
 * Interfaces with the Rust-side local proxy server for CDN header injection.
 * The proxy runs on 127.0.0.1:{random_port} and forwards all HLS requests
 * with the correct Referer/Origin headers that CDNs require.
 */

import { invoke } from '@tauri-apps/api/core';

let cachedPort: number | null = null;
const VIDLINK_ORIGIN = 'https://vidlink.pro';
const VIDSRCME_ORIGIN = 'https://vidsrcme.ru';

function extractHeaderHintsFromUrl(streamUrlHint?: string): { referer?: string; origin?: string } {
    if (!streamUrlHint) return {};
    try {
        const parsed = new URL(streamUrlHint);
        const rawHeaders = parsed.searchParams.get('headers');
        if (!rawHeaders) return {};
        const decoded = JSON.parse(rawHeaders) as Record<string, string>;
        return {
            referer: decoded.referer ?? decoded.Referer,
            origin: decoded.origin ?? decoded.Origin,
        };
    } catch {
        return {};
    }
}

function resolveProxyOriginAndReferer(
    headers?: Record<string, string>,
    streamUrlHint?: string,
): { origin: string; referer: string } {
    const headerReferer = headers?.Referer ?? headers?.referer ?? '';
    const headerOrigin = headers?.Origin ?? headers?.origin ?? '';
    const urlHints = extractHeaderHintsFromUrl(streamUrlHint);
    const hintedReferer = urlHints.referer ?? '';
    const hintedOrigin = urlHints.origin ?? '';
    const needsVidsrcHeaders =
        headerReferer.toLowerCase().includes('vidsrcme.ru') ||
        headerOrigin.toLowerCase().includes('vidsrcme.ru') ||
        hintedReferer.toLowerCase().includes('vidsrcme.ru') ||
        hintedOrigin.toLowerCase().includes('vidsrcme.ru');

    if (needsVidsrcHeaders) {
        return {
            origin: VIDSRCME_ORIGIN,
            referer: `${VIDSRCME_ORIGIN}/`,
        };
    }

    return {
        origin: VIDLINK_ORIGIN,
        referer: `${VIDLINK_ORIGIN}/`,
    };
}

export function resetProxyClientCache(): void {
    cachedPort = null;
}

/**
 * Get the local proxy server port.
 * The proxy starts on app launch — this polls until it's ready.
 */
export async function getProxyPort(): Promise<number> {
    if (cachedPort) return cachedPort;

    try {
        const port = await invoke<number>('get_proxy_port');
        cachedPort = port;
        console.log(`[HLS Proxy] Running on port ${port}`);
        return port;
    } catch (e) {
        console.error('[HLS Proxy] Failed to get port:', e);
        throw e;
    }
}

/**
 * Set CDN headers on the proxy. Call this before starting HLS playback.
 * These headers (Referer, Origin, User-Agent) will be injected into
 * every request the proxy makes to the CDN.
 *
 * Headers are taken directly from the stream provider result.
 * If the provider didn't specify a Referer, we derive the origin
 * automatically from the stream URL so CDNs never see a missing Referer.
 */
export async function setProxyHeaders(
    headers?: Record<string, string>,
    streamUrlHint?: string,
): Promise<void> {
    const profile = resolveProxyOriginAndReferer(headers, streamUrlHint);

    const extraHeaders: Record<string, string> = {};
    if (headers) {
        for (const [key, value] of Object.entries(headers)) {
            if (!value) continue;
            const lower = key.toLowerCase();
            if (lower === 'referer' || lower === 'origin' || lower === 'user-agent') continue;
            extraHeaders[key] = value;
        }
    }

    try {
        await invoke('set_proxy_headers', {
            referer: profile.referer,
            origin: profile.origin,
            userAgent: headers?.['User-Agent'] ?? headers?.['user-agent'] ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            extraHeaders,
        });
        console.log(`[HLS Proxy] Headers set: referer=${profile.referer ? `Some("${profile.referer}")` : 'None'}, origin=${profile.origin ? `Some("${profile.origin}")` : 'None'}, extra=${Object.keys(extraHeaders).length}`);
    } catch (e) {
        console.error('[HLS Proxy] Failed to set headers:', e);
        throw e;
    }
}

/**
 * Convert a CDN stream URL to a proxied URL.
 * The returned URL routes through the local Rust proxy which adds CDN headers.
 * 
 * Example:
 *   Input:  https://cdn.example.com/master.m3u8
 *   Output: http://127.0.0.1:54321/proxy?url=https%3A%2F%2Fcdn.example.com%2Fmaster.m3u8
 */
export function getProxiedUrl(originalUrl: string, port: number): string {
    return `http://127.0.0.1:${port}/proxy?url=${encodeURIComponent(originalUrl)}`;
}

/**
 * Clear the Rust-side proxy cache.
 * Called before starting a new stream so stale segments don't waste memory.
 */
export async function clearProxyCache(): Promise<void> {
    try {
        await invoke('clear_proxy_cache');
        console.log('[HLS Proxy] Cache cleared for new stream');
    } catch (e) {
        console.error('[HLS Proxy] Failed to clear cache:', e);
        throw e;
    }
}

/**
 * Monotonically-incrementing counter used to detect stale proxy setups.
 * When two streams race to configure the proxy (clearProxyCache +
 * setProxyHeaders), the EARLIER call detects it was superseded and aborts,
 * preventing it from corrupting the LATER call's header state.
 */
let _proxySetupId = 0;

/** Thrown by proxyStreamUrl when a newer stream request supersedes this one. */
export const PROXY_SUPERSEDED = 'PROXY_SUPERSEDED';

/**
 * Initialize the proxy and convert a stream URL to proxied form.
 *
 * Only ONE setup can be "active" at a time. If a second call arrives before
 * the first completes, the first call throws PROXY_SUPERSEDED so callers
 * can safely ignore it without showing an error to the user.
 */
export async function proxyStreamUrl(
    streamUrl: string,
    headers?: Record<string, string>
): Promise<string> {
    // Claim this setup slot
    const myId = ++_proxySetupId;

    // Fire off cache clear, header setup, and port lookup in parallel
    const [port] = await Promise.all([
        getProxyPort(),
        clearProxyCache(),
        setProxyHeaders(headers, streamUrl),
    ]);

    // If a newer call came in while we were awaiting, our headers were
    // overwritten  abort to avoid returning a URL that will 400.
    if (myId !== _proxySetupId) {
        console.warn('[HLS Proxy] Setup superseded by newer request, aborting stale setup');
        throw new Error(PROXY_SUPERSEDED);
    }

    return getProxiedUrl(streamUrl, port);
}

/**
 * Validate that a proxied HLS manifest is reachable before handing it to hls.js.
 * This avoids entering playback flow with expired/bad tokens.
 */
export async function probeProxiedHlsManifest(
    proxiedUrl: string,
    timeoutMs = 20000,
): Promise<boolean> {
    const maxAttempts = 2;
    const retryDelayMs = 450;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const controller = new AbortController();
        // Give a bit more room on retry for cold/slow upstream manifests.
        const attemptTimeout = attempt === 1 ? timeoutMs : timeoutMs + 5000;
        const timeout = window.setTimeout(() => controller.abort(), attemptTimeout);
        try {
            const resp = await fetch(proxiedUrl, {
                method: 'GET',
                cache: 'no-store',
                signal: controller.signal,
            });
            if (!resp.ok) {
                console.warn(`[HLS Proxy] Manifest probe failed: HTTP ${resp.status} (attempt ${attempt}/${maxAttempts})`);
                const retryableStatus = resp.status >= 500;
                if (retryableStatus && attempt < maxAttempts) {
                    await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
                    continue;
                }
                return false;
            }
            const text = await resp.text();
            const ok = text.includes('#EXTM3U');
            if (!ok) {
                console.warn(`[HLS Proxy] Manifest probe failed: missing #EXTM3U signature (attempt ${attempt}/${maxAttempts})`);
                if (attempt < maxAttempts) {
                    await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
                    continue;
                }
                return false;
            }
            return true;
        } catch (err) {
            console.warn(`[HLS Proxy] Manifest probe failed with exception (attempt ${attempt}/${maxAttempts}):`, err);
            if (attempt < maxAttempts) {
                await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
                continue;
            }
            return false;
        } finally {
            window.clearTimeout(timeout);
        }
    }

    return false;
}

import { clearStreamCache } from './streamCache';
import { clearTMDBCache } from './tmdb';
import { clearProxyCache, resetProxyClientCache } from '../utils/hlsProxy';

const NON_POSTER_CACHE_LOCAL_KEYS = [
    'delulu_recent_searches',
    'delulu_player_subtitle_prefs_v1',
    'delulu_advanced_error_logs',
] as const;

/**
 * Clears app caches except poster/image cache.
 * Poster/image cache is intentionally excluded per product requirement.
 */
export async function clearAllNonPosterCaches(): Promise<void> {
    // Persistent stream extraction cache (SQLite)
    await clearStreamCache();

    // Rust-side HLS proxy segment/header cache
    await clearProxyCache();
    resetProxyClientCache();

    // In-memory TMDB API response cache
    clearTMDBCache();

    // Lightweight local cache-like keys
    for (const key of NON_POSTER_CACHE_LOCAL_KEYS) {
        localStorage.removeItem(key);
    }
}


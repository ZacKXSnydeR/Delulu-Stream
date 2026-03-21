/**
 * Stream Cache Service
 * 
 * Caches extracted VidLink stream URLs locally using SQLite via Tauri Plugin.
 * - Stored natively in the app data directory
 * - Key format: movie-{tmdbId} or tv-{tmdbId}-S{season}E{episode}
 * - Cache is long-lived but verified upon request
 * - Bypasses extractors on HIT
 */

import Database from '@tauri-apps/plugin-sql';

// Subtitle track
export interface SubtitleTrack {
    language: string;
    url: string;
}

// Cache structure
export interface CachedStream {
    streamUrl: string;
    headers?: {
        Referer?: string;
        Origin?: string;
        'User-Agent'?: string;
    };
    subtitles?: SubtitleTrack[]; // Subtitle tracks from extractor
    cachedAt: number; // timestamp
    quality?: string;
    provider?: 'godseye';
    queryTitle?: string;
}

// Database schema
interface StreamCacheRow {
    key: string;
    streamUrl: string;
    headers: string; // JSON string
    subtitles: string; // JSON string
    cachedAt: number;
    provider?: string;
    queryTitle?: string;
}

// Cache key generators
export function getMovieCacheKey(tmdbId: number): string {
    return `movie-${tmdbId}`;
}

export function getTVCacheKey(tmdbId: number, season: number, episode: number): string {
    return `tv-${tmdbId}-S${season}E${episode}`;
}

const CACHE_MAX_AGE_HOURS_DEFAULT = 24; // gods_EYE / default
let dbInstance: Database | null = null;

/**
 * Initialize the SQLite database
 */
async function getDb(): Promise<Database> {
    if (dbInstance) return dbInstance;

    try {
        dbInstance = await Database.load('sqlite:cache.db');

        await dbInstance.execute(`
            CREATE TABLE IF NOT EXISTS streams (
                key TEXT PRIMARY KEY,
                streamUrl TEXT NOT NULL,
                headers TEXT,
                subtitles TEXT,
                cachedAt INTEGER NOT NULL,
                provider TEXT,
                queryTitle TEXT
            )
        `);
        // Lightweight migration for existing users
        try {
            await dbInstance.execute(`ALTER TABLE streams ADD COLUMN provider TEXT`);
        } catch {
            // Column likely already exists
        }
        try {
            await dbInstance.execute(`ALTER TABLE streams ADD COLUMN queryTitle TEXT`);
        } catch {
            // Column likely already exists
        }
        console.log('[StreamCache] SQLite Database initialized');
        return dbInstance;
    } catch (e) {
        console.error('[StreamCache] Failed to initialize SQLite database:', e);
        throw e;
    }
}

/**
 * Check if cached entry is still valid
 */
function inferProviderFromHeaders(headers?: CachedStream['headers']): 'godseye' | undefined {
    const referer = headers?.Referer?.toLowerCase() || '';
    if (!referer) return undefined;
    return referer.includes('vidlink.pro') ? 'godseye' : undefined;
}

function isEntryValid(cachedAt: number): boolean {
    const ttlHours = CACHE_MAX_AGE_HOURS_DEFAULT;
    const maxAge = ttlHours * 60 * 60 * 1000;
    return Date.now() - cachedAt < maxAge;
}

async function getCachedStreamByKey(key: string): Promise<CachedStream | null> {
    try {
        const db = await getDb();
        const result = await db.select<StreamCacheRow[]>('SELECT * FROM streams WHERE key = $1', [key]);

        if (result && result.length > 0) {
            const row = result[0];
            const parsedHeaders = row.headers ? JSON.parse(row.headers) : undefined;
            const declaredProvider =
                row.provider === 'godseye'
                    ? row.provider
                    : undefined;
            const provider = declaredProvider || inferProviderFromHeaders(parsedHeaders);

            if (isEntryValid(row.cachedAt)) {
                return {
                    streamUrl: row.streamUrl,
                    headers: parsedHeaders,
                    subtitles: row.subtitles ? JSON.parse(row.subtitles) : undefined,
                    cachedAt: row.cachedAt,
                    provider,
                    queryTitle: row.queryTitle || undefined,
                };
            } else {
                // Expired, delete it
                await db.execute('DELETE FROM streams WHERE key = $1', [key]);
                console.log(`[StreamCache] Expired cache deleted for ${key}`);
            }
        }
    } catch (e) {
        console.error(`[StreamCache] Error reading cache for ${key}:`, e);
    }

    return null;
}

/**
 * Get cached stream for a movie
 */
export async function getCachedMovieStream(tmdbId: number): Promise<CachedStream | null> {
    const key = getMovieCacheKey(tmdbId);
    const entry = await getCachedStreamByKey(key);

    if (entry) {
        console.log(`[StreamCache] Cache HIT for movie ${tmdbId}`);
    } else {
        console.log(`[StreamCache] Cache MISS for movie ${tmdbId}`);
    }

    return entry;
}

/**
 * Get cached stream for a TV episode
 */
export async function getCachedTVStream(tmdbId: number, season: number, episode: number): Promise<CachedStream | null> {
    const key = getTVCacheKey(tmdbId, season, episode);
    const entry = await getCachedStreamByKey(key);

    if (entry) {
        console.log(`[StreamCache] Cache HIT for TV ${tmdbId} S${season}E${episode}`);
    } else {
        console.log(`[StreamCache] Cache MISS for TV ${tmdbId} S${season}E${episode}`);
    }

    return entry;
}

/**
 * Cache a movie stream
 */
export async function cacheMovieStream(
    tmdbId: number,
    streamUrl: string,
    headers?: CachedStream['headers'],
    subtitles?: SubtitleTrack[],
    provider?: 'godseye',
    queryTitle?: string
): Promise<void> {
    const key = getMovieCacheKey(tmdbId);
    await saveCachedStream(key, streamUrl, headers, subtitles, provider, queryTitle);
    console.log(`[StreamCache] Cached movie ${tmdbId}`);
}

/**
 * Cache a TV episode stream
 */
export async function cacheTVStream(
    tmdbId: number,
    season: number,
    episode: number,
    streamUrl: string,
    headers?: CachedStream['headers'],
    subtitles?: SubtitleTrack[],
    provider?: 'godseye',
    queryTitle?: string
): Promise<void> {
    const key = getTVCacheKey(tmdbId, season, episode);
    await saveCachedStream(key, streamUrl, headers, subtitles, provider, queryTitle);
    console.log(`[StreamCache] Cached TV ${tmdbId} S${season}E${episode}`);
}

async function saveCachedStream(
    key: string,
    streamUrl: string,
    headers?: CachedStream['headers'],
    subtitles?: SubtitleTrack[],
    provider?: 'godseye',
    queryTitle?: string
): Promise<void> {
    try {
        const db = await getDb();
        const headersJson = headers ? JSON.stringify(headers) : null;
        const subtitlesJson = subtitles ? JSON.stringify(subtitles) : null;
        const now = Date.now();

        await db.execute(
            `INSERT OR REPLACE INTO streams (key, streamUrl, headers, subtitles, cachedAt, provider, queryTitle) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [key, streamUrl, headersJson, subtitlesJson, now, provider || null, queryTitle || null]
        );
    } catch (e) {
        console.error(`[StreamCache] Failed to save cache for ${key}:`, e);
    }
}

/**
 * Clear entire cache
 */
export async function clearStreamCache(): Promise<void> {
    try {
        const db = await getDb();
        await db.execute('DELETE FROM streams');
        console.log('[StreamCache] Cache cleared');
    } catch (e) {
        console.error('[StreamCache] Failed to clear cache:', e);
    }
}

/**
 * Invalidate cached movie stream immediately.
 */
export async function invalidateCachedMovieStream(tmdbId: number): Promise<void> {
    const key = getMovieCacheKey(tmdbId);
    try {
        const db = await getDb();
        await db.execute('DELETE FROM streams WHERE key = $1', [key]);
        console.log(`[StreamCache] Invalidated movie cache ${tmdbId}`);
    } catch (e) {
        console.error(`[StreamCache] Failed to invalidate movie cache ${tmdbId}:`, e);
    }
}

/**
 * Invalidate cached TV episode stream immediately.
 */
export async function invalidateCachedTVStream(tmdbId: number, season: number, episode: number): Promise<void> {
    const key = getTVCacheKey(tmdbId, season, episode);
    try {
        const db = await getDb();
        await db.execute('DELETE FROM streams WHERE key = $1', [key]);
        console.log(`[StreamCache] Invalidated TV cache ${tmdbId} S${season}E${episode}`);
    } catch (e) {
        console.error(`[StreamCache] Failed to invalidate TV cache ${tmdbId} S${season}E${episode}:`, e);
    }
}

/**
 * Get cache stats
 */
export async function getCacheStats(): Promise<{ count: number; sizeKB: number }> {
    try {
        const db = await getDb();
        const result = await db.select<{ count: number }[]>('SELECT COUNT(*) as count FROM streams');
        const count = result && result.length > 0 ? result[0].count : 0;

        // SQLite doesn't have a direct way to get table size via simple queries easily across all platforms,
        // so we'll just return the count for now.
        return { count, sizeKB: 0 };
    } catch (e) {
        console.error('[StreamCache] Failed to get stats:', e);
        return { count: 0, sizeKB: 0 };
    }
}

/**
 * Remove expired entries (cleanup)
 */
export async function cleanupExpiredEntries(): Promise<number> {
    try {
        const db = await getDb();
        const maxAge = CACHE_MAX_AGE_HOURS_DEFAULT * 60 * 60 * 1000;
        const cutoffTime = Date.now() - maxAge;

        const result = await db.execute('DELETE FROM streams WHERE cachedAt < $1', [cutoffTime]);

        const removed = result.rowsAffected;
        if (removed > 0) {
            console.log(`[StreamCache] Cleaned up ${removed} expired entries`);
        }
        return removed;
    } catch (e) {
        console.error('[StreamCache] Failed to cleanup cache:', e);
        return 0;
    }
}

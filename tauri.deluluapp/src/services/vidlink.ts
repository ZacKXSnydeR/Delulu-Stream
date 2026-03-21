/**
 * VidLink Streaming Service (Tauri Frontend)
 *
 * Uses local Tauri command that runs local-extractor CLI.
 * No remote extractor API key/server required.
 */

import { invoke } from '@tauri-apps/api/core';
import { getCachedMovieStream, getCachedTVStream, cacheMovieStream, cacheTVStream, type SubtitleTrack } from './streamCache';

const VIDLINK_BASE = 'https://vidlink.pro';

export interface VidLinkStreamResult {
    success: boolean;
    streamUrl?: string;
    headers?: {
        Referer?: string;
        Origin?: string;
        'User-Agent'?: string;
        [key: string]: string | undefined;
    };
    subtitles?: SubtitleTrack[];
    vidlinkUrl?: string;
    error?: string;
}

interface LocalExtractorResponse {
    success: boolean;
    streamUrl?: string;
    stream_url?: string;
    headers?: Record<string, string>;
    subtitles?: Array<{ url: string; language?: string }>;
    error?: string;
}

const LANG_MAP: Record<string, string> = {
    eng: 'English', ara: 'Arabic', deu: 'German', ger: 'German',
    fre: 'French', fra: 'French', spa: 'Spanish', por: 'Portuguese',
    ita: 'Italian', rus: 'Russian', jpn: 'Japanese', kor: 'Korean',
    chi: 'Chinese', zho: 'Chinese', hin: 'Hindi', ben: 'Bengali',
    tur: 'Turkish', pol: 'Polish', vie: 'Vietnamese', tha: 'Thai',
    ind: 'Indonesian',
};

function buildVidLinkUrl(
    tmdbId: number,
    type: 'movie' | 'tv',
    season?: number,
    episode?: number
): string {
    if (type === 'movie') {
        return `${VIDLINK_BASE}/movie/${tmdbId}`;
    }
    return `${VIDLINK_BASE}/tv/${tmdbId}/${season || 1}/${episode || 1}`;
}

function processSubtitles(rawSubs: Array<{ url: string; language?: string }>): SubtitleTrack[] {
    return rawSubs.map((sub) => {
        let detectedLang = sub.language || 'Unknown';

        const urlMatch = sub.url.match(/\/([a-z]{2,3})(?:-\d+)?\.vtt$/i);
        if (urlMatch) {
            const langCode = urlMatch[1].toLowerCase();
            detectedLang = LANG_MAP[langCode] || langCode.toUpperCase();
        }

        return { url: sub.url, language: detectedLang };
    });
}

const inFlightRequests = new Map<string, Promise<VidLinkStreamResult>>();

async function callLocalExtractor(
    type: 'movie' | 'tv',
    tmdbId: number,
    season?: number,
    episode?: number
): Promise<VidLinkStreamResult> {
    const vidlinkUrl = buildVidLinkUrl(tmdbId, type, season, episode);
    console.log(`[VidLink] Calling local extractor for: ${vidlinkUrl}`);

    const data = await invoke<LocalExtractorResponse>('extract_provider_stream', {
        args: {
            mediaType: type,
            tmdbId,
            season,
            episode,
        },
    });

    const streamUrl = data.streamUrl || data.stream_url;
    if (data.success && streamUrl) {
        const subtitles = processSubtitles(data.subtitles || []);
        console.log(`[VidLink] Local extraction success, subtitles=${subtitles.length}`);

        // The extracted CDN URL (e.g. storm.vodvidl.site, stormfox.live) is a
        // sub-CDN embedded inside vidlink.pro. The CDN whitelists vidlink.pro as
        // the allowed Referer — NOT its own domain. Always use vidlink.pro here
        // regardless of what headers gods_EYE may have returned.
        const vidlinkOrigin = new URL(vidlinkUrl).origin; // https://vidlink.pro
        return {
            success: true,
            streamUrl,
            headers: {
                ...data.headers,
                Referer: `${vidlinkOrigin}/`,
                Origin: vidlinkOrigin,
            },
            subtitles,
            vidlinkUrl,
        };
    }

    return {
        success: false,
        error: data.error || 'Failed to extract stream locally',
        vidlinkUrl,
    };
}

export async function getMovieStream(tmdbId: number, bypassCache = false, title?: string): Promise<VidLinkStreamResult> {
    const cacheKey = `movie-${tmdbId}`;

    if (!bypassCache) {
        const cached = await getCachedMovieStream(tmdbId);
        if (cached) {
            console.log(`[VidLink] Cache HIT for movie ${tmdbId}`);
            return {
                success: true,
                streamUrl: cached.streamUrl,
                headers: cached.headers,
                subtitles: cached.subtitles,
            };
        }
    }

    if (!bypassCache && inFlightRequests.has(cacheKey)) {
        return inFlightRequests.get(cacheKey)!;
    }

    const requestPromise = (async () => {
        try {
            const result = await callLocalExtractor('movie', tmdbId);
            if (result.success && result.streamUrl) {
                await cacheMovieStream(tmdbId, result.streamUrl, result.headers, result.subtitles, 'godseye', title);
                return result;
            }

            // Both failed — return the first error
            return result;
        } catch (error) {
            console.error(`[VidLink] Error extracting movie ${tmdbId}:`, error);

            return { success: false, error: String(error) };
        } finally {
            inFlightRequests.delete(cacheKey);
        }
    })();

    if (!bypassCache) inFlightRequests.set(cacheKey, requestPromise);
    return requestPromise;
}

export async function getTVStream(
    tmdbId: number,
    season: number,
    episode: number,
    bypassCache = false,
    title?: string,
): Promise<VidLinkStreamResult> {
    const cacheKey = `tv-${tmdbId}-S${season}E${episode}`;

    if (!bypassCache) {
        const cached = await getCachedTVStream(tmdbId, season, episode);
        if (cached) {
            console.log(`[VidLink] Cache HIT for TV ${tmdbId} S${season}E${episode}`);
            return {
                success: true,
                streamUrl: cached.streamUrl,
                headers: cached.headers,
                subtitles: cached.subtitles,
            };
        }
    }

    if (!bypassCache && inFlightRequests.has(cacheKey)) {
        return inFlightRequests.get(cacheKey)!;
    }

    const requestPromise = (async () => {
        try {
            const result = await callLocalExtractor('tv', tmdbId, season, episode);
            if (result.success && result.streamUrl) {
                await cacheTVStream(tmdbId, season, episode, result.streamUrl, result.headers, result.subtitles, 'godseye', title);
                return result;
            }

            // Both failed — return the first error
            return result;
        } catch (error) {
            console.error(`[VidLink] Error extracting TV ${tmdbId} S${season}E${episode}:`, error);

            return { success: false, error: String(error) };
        } finally {
            inFlightRequests.delete(cacheKey);
        }
    })();

    if (!bypassCache) inFlightRequests.set(cacheKey, requestPromise);
    return requestPromise;
}

export async function isVidLinkAvailable(): Promise<boolean> {
    try {
        await invoke('extract_provider_stream', {
            args: {
                mediaType: 'movie',
                tmdbId: 157336,
            },
        });
        return true;
    } catch {
        return false;
    }
}

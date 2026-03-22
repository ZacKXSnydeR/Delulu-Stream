/**
 * VidLink Streaming Service (Tauri Frontend)
 *
 * Uses local Tauri command that runs local-extractor CLI.
 * No remote extractor API key/server required.
 */

import { invoke } from '@tauri-apps/api/core';
import { getCachedMovieStream, getCachedTVStream, cacheMovieStream, cacheTVStream, type SubtitleTrack } from './streamCache';

const VIDLINK_BASE = 'https://vidlink.pro';
const VIDLINK_ORIGIN = 'https://vidlink.pro';
const VIDSRCME_ORIGIN = 'https://vidsrcme.ru';

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

function extractHeaderHintsFromUrl(streamUrl: string): { referer?: string; origin?: string } {
    try {
        const parsed = new URL(streamUrl);
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

function resolvePlaybackHeaders(
    streamUrl: string,
    rawHeaders: Record<string, string> | undefined,
    vidlinkUrl: string
): Record<string, string> {
    const baseOrigin = new URL(vidlinkUrl).origin;
    const hintedReferer = rawHeaders?.Referer ?? rawHeaders?.referer ?? '';
    const hintedOrigin = rawHeaders?.Origin ?? rawHeaders?.origin ?? '';
    const urlHints = extractHeaderHintsFromUrl(streamUrl);
    const urlHintReferer = urlHints.referer ?? '';
    const urlHintOrigin = urlHints.origin ?? '';

    const useVidsrcHeaders =
        hintedReferer.toLowerCase().includes('vidsrcme.ru') ||
        hintedOrigin.toLowerCase().includes('vidsrcme.ru') ||
        urlHintReferer.toLowerCase().includes('vidsrcme.ru') ||
        urlHintOrigin.toLowerCase().includes('vidsrcme.ru');

    const origin = useVidsrcHeaders ? VIDSRCME_ORIGIN : (baseOrigin || VIDLINK_ORIGIN);
    const referer = `${origin}/`;

    return {
        ...rawHeaders,
        Referer: referer,
        Origin: origin,
    };
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

        const resolvedHeaders = resolvePlaybackHeaders(streamUrl, data.headers, vidlinkUrl);
        return {
            success: true,
            streamUrl,
            headers: {
                ...resolvedHeaders,
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

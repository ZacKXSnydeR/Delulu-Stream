import {
  getCachedMovieStream,
  getCachedTVStream,
  cacheMovieStream,
  cacheTVStream,
  type SubtitleTrack,
} from './streamCache';
import {
  bootstrapAddonManager,
  aggregateStremioStreamsByTmdb,
  resolveStreamViaAddon,
  healthCheckActiveAddon,
} from '../addon_manager/manager';

export interface StreamAdapterResult {
  success: boolean;
  streamUrl?: string;
  headers?: {
    Referer?: string;
    Origin?: string;
    'User-Agent'?: string;
    [key: string]: string | undefined;
  };
  subtitles?: SubtitleTrack[];
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

function normalizeHeaders(rawHeaders?: Record<string, string>): Record<string, string> {
  if (!rawHeaders) return {};
  const referer = rawHeaders.Referer ?? rawHeaders.referer;
  const origin = rawHeaders.Origin ?? rawHeaders.origin;
  const userAgent = rawHeaders['User-Agent'] ?? rawHeaders['user-agent'];
  return {
    ...rawHeaders,
    ...(referer ? { Referer: referer } : {}),
    ...(origin ? { Origin: origin } : {}),
    ...(userAgent ? { 'User-Agent': userAgent } : {}),
  };
}

const inFlightRequests = new Map<string, Promise<StreamAdapterResult>>();

async function resolveViaStremioNormalizationLayer(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number,
): Promise<StreamAdapterResult | null> {
  try {
    const result = await aggregateStremioStreamsByTmdb({
      mediaType: type === 'movie' ? 'movie' : 'series',
      tmdbId,
      season,
      episode,
      timeoutMs: 7000,
    });

    const direct = result.streams.find((s) => typeof s.url === 'string' && s.url.length > 0);
    if (!direct?.url) {
      return null;
    }

    return {
      success: true,
      streamUrl: direct.url,
      headers: {},
      subtitles: [],
    };
  } catch {
    return null;
  }
}

async function callAddonRuntime(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number,
): Promise<StreamAdapterResult> {
  await bootstrapAddonManager();

  const data = await resolveStreamViaAddon({
    mediaType: type,
    tmdbId,
    season,
    episode,
    timeoutMs: 30_000,
  });

  if (!data.success || !data.streamUrl) {
    const stremioFallback = await resolveViaStremioNormalizationLayer(type, tmdbId, season, episode);
    if (stremioFallback?.success) {
      return stremioFallback;
    }

    const reason = data.errorMessage || 'No stream available from active addon';
    return {
      success: false,
      error: `${reason}. Try Retry or switch/install another addon in Settings.`,
    };
  }

  const subtitles = processSubtitles((data.subtitles || []) as Array<{ url: string; language?: string }>);
  return {
    success: true,
    streamUrl: data.streamUrl,
    headers: normalizeHeaders(data.headers),
    subtitles,
  };
}

export async function getMovieStream(tmdbId: number, bypassCache = false, title?: string): Promise<StreamAdapterResult> {
  const cacheKey = `movie-${tmdbId}`;

  if (!bypassCache) {
    const cached = await getCachedMovieStream(tmdbId);
    if (cached) {
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
      const result = await callAddonRuntime('movie', tmdbId);
      if (result.success && result.streamUrl) {
        await cacheMovieStream(tmdbId, result.streamUrl, result.headers, result.subtitles, 'addon', title);
      }
      return result;
    } catch (error) {
      console.error(`[StreamAdapter] Error extracting movie ${tmdbId}:`, error);
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
): Promise<StreamAdapterResult> {
  const cacheKey = `tv-${tmdbId}-S${season}E${episode}`;

  if (!bypassCache) {
    const cached = await getCachedTVStream(tmdbId, season, episode);
    if (cached) {
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
      const result = await callAddonRuntime('tv', tmdbId, season, episode);
      if (result.success && result.streamUrl) {
        await cacheTVStream(tmdbId, season, episode, result.streamUrl, result.headers, result.subtitles, 'addon', title);
      }
      return result;
    } catch (error) {
      console.error(`[StreamAdapter] Error extracting TV ${tmdbId} S${season}E${episode}:`, error);
      return { success: false, error: String(error) };
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  if (!bypassCache) inFlightRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

export async function isAddonRuntimeAvailable(): Promise<boolean> {
  try {
    await bootstrapAddonManager();
    const health = await healthCheckActiveAddon();
    return Boolean(health.ok);
  } catch {
    return false;
  }
}

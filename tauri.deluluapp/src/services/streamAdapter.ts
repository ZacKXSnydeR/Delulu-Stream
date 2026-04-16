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
  resolveStreamRace,
  getRaceSources,
  healthCheckActiveAddon,
} from '../addon_manager/manager';
import type { AddonStreamSource } from '../addon_manager/types';

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
  /** All successful addon sources (for source switching UI) */
  allSources?: AddonStreamSource[];
  /** The addon that produced this stream */
  sourceAddonId?: string;
  sourceAddonName?: string;
  /** Multi-audio map from motherbox: { audioName: { quality: url } } */
  audios?: Record<string, Record<string, string>>;
  /** Embedded proxy port (motherbox) */
  proxyPort?: number;
  /** Session ID (motherbox) */
  sessionId?: string;
  /** When true, addon handles its own proxying */
  selfProxy?: boolean;
}

const LANG_MAP: Record<string, string> = {
  eng: 'English', ara: 'Arabic', deu: 'German', ger: 'German',
  fre: 'French', fra: 'French', spa: 'Spanish', por: 'Portuguese',
  ita: 'Italian', rus: 'Russian', jpn: 'Japanese', kor: 'Korean',
  chi: 'Chinese', zho: 'Chinese', hin: 'Hindi', ben: 'Bengali',
  tur: 'Turkish', pol: 'Polish', vie: 'Vietnamese', tha: 'Thai',
  ind: 'Indonesian',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeAudioMap(rawAudios: unknown): Record<string, Record<string, string>> | undefined {
  if (!isRecord(rawAudios)) return undefined;

  const normalized: Record<string, Record<string, string>> = {};

  for (const [audioName, audioEntry] of Object.entries(rawAudios)) {
    if (!isRecord(audioEntry)) continue;

    // MotherBox shape: { audioName: { streams: { "1080p": "..." } } }
    // Legacy shape:   { audioName: { "1080p": "..." } }
    const qualitySource = isRecord(audioEntry.streams)
      ? (audioEntry.streams as Record<string, unknown>)
      : audioEntry;

    const filteredQualities: Record<string, string> = {};
    for (const [quality, url] of Object.entries(qualitySource)) {
      if (typeof url === 'string' && url.trim().length > 0) {
        filteredQualities[quality] = url;
      }
    }

    if (Object.keys(filteredQualities).length > 0) {
      normalized[audioName] = filteredQualities;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeSource(source: AddonStreamSource): AddonStreamSource {
  const streamUrl = typeof source.streamUrl === 'string' && source.streamUrl.trim().length > 0
    ? source.streamUrl
    : undefined;

  const subtitles = Array.isArray(source.subtitles)
    ? source.subtitles.filter((sub) => typeof sub?.url === 'string' && sub.url.trim().length > 0)
    : source.subtitles;

  return {
    ...source,
    streamUrl,
    subtitles,
    audios: normalizeAudioMap(source.audios),
  };
}

function isPlayableSource(source: AddonStreamSource): boolean {
  return Boolean(source.success && source.streamUrl && source.streamUrl.trim().length > 0);
}

function processSubtitles(rawSubs: Array<{ url: string; language?: string }>): SubtitleTrack[] {
  return rawSubs
    .filter((sub) => typeof sub.url === 'string' && sub.url.trim().length > 0)
    .map((sub) => {
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

function mergeSourcesByAddonId(
  existing: AddonStreamSource[],
  incoming: AddonStreamSource[],
): AddonStreamSource[] {
  const merged = new Map<string, AddonStreamSource>();
  for (const source of existing.map(normalizeSource)) {
    if (isPlayableSource(source)) {
      merged.set(source.addonId, source);
    }
  }
  for (const source of incoming.map(normalizeSource)) {
    if (isPlayableSource(source)) {
      merged.set(source.addonId, source);
    }
  }
  return Array.from(merged.values());
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

/** Build a StreamAdapterResult from a single AddonStreamSource */
function sourceToResult(
  source: AddonStreamSource,
  allSources: AddonStreamSource[],
): StreamAdapterResult {
  const normalizedSource = normalizeSource(source);
  const sanitizedSources = mergeSourcesByAddonId([], [normalizedSource, ...allSources]);
  const subtitles = processSubtitles(
    (normalizedSource.subtitles || []) as Array<{ url: string; language?: string }>,
  );
  return {
    success: true,
    streamUrl: normalizedSource.streamUrl,
    headers: normalizedSource.selfProxy ? {} : normalizeHeaders(normalizedSource.headers),
    subtitles,
    allSources: sanitizedSources,
    sourceAddonId: normalizedSource.addonId,
    sourceAddonName: normalizedSource.addonName,
    audios: normalizedSource.audios,
    proxyPort: normalizedSource.proxyPort,
    sessionId: normalizedSource.sessionId,
    selfProxy: normalizedSource.selfProxy,
  };
}

async function callAddonRuntime(
  type: 'movie' | 'tv',
  tmdbId: number,
  season?: number,
  episode?: number,
): Promise<StreamAdapterResult> {
  await bootstrapAddonManager();
  const mediaKey = `${type}-${tmdbId}-${season}-${episode}`;
  const raceRequest = {
    mediaType: type,
    tmdbId,
    season,
    episode,
    timeoutMs: 30_000,
  };

  // Try the parallel race first (multi-addon)
  try {
    const race = await resolveStreamRace(raceRequest);
    const winner = normalizeSource(race.winner);
    const initialSources = mergeSourcesByAddonId([], race.allSources);

    if (isPlayableSource(winner)) {
      console.log(
        `[StreamAdapter] Race winner: ${winner.addonId} (${winner.latencyMs}ms)`,
      );
      const result = sourceToResult(winner, initialSources);

      // Poll for late-arriving sources in the background and scope updates to the current media key.
      setTimeout(() => {
        const maxPolls = 5;
        let pollCount = 0;

        const pollLateSources = async () => {
          pollCount += 1;
          try {
            const lateSources = mergeSourcesByAddonId([], await getRaceSources(raceRequest));
            if (lateSources.length > 0) {
              const merged = mergeSourcesByAddonId(result.allSources || [], lateSources);
              if (merged.length > (result.allSources || []).length) {
                result.allSources = merged;
                console.log(`[StreamAdapter] 📥 ${lateSources.length} late source(s) for ${mediaKey}`);
                window.dispatchEvent(
                  new CustomEvent('delulu-late-sources', {
                    detail: { mediaKey, sources: merged },
                  }),
                );
              }
            }
          } catch (e) {
            console.warn('[StreamAdapter] Late source poll failed:', e);
          }

          if (pollCount < maxPolls) {
            setTimeout(pollLateSources, 2000);
          }
        };

        void pollLateSources();
      }, 1500);

      return result;
    }
  } catch (raceErr) {
    console.warn('[StreamAdapter] Race failed, falling back to single addon:', raceErr);
  }

  // Fallback: single active addon
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

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { DeluluPlayer } from '../components/player/DeluluPlayer';
import { CinematicMiniPlayer } from '../components/player/CinematicMiniPlayer';
import { PremiumLoader } from '../components/loading/PremiumLoader';
import { PlayerChromeBar } from '../components/player/PlayerChromeBar';
import { usePlayer } from '../context/PlayerContext';
import { getMovieStream, getTVStream } from '../services/streamAdapter';
import { getPosterUrl, getSeasonDetails } from '../services/tmdb';
import { proxyStreamUrl, probeProxiedHlsManifest, PROXY_SUPERSEDED } from '../utils/hlsProxy';
import { watchService } from '../services/watchHistory';
import { appendAdvancedErrorLog } from '../services/advancedLogs';
import { invalidateCachedMovieStream, invalidateCachedTVStream } from '../services/streamCache';
import type { StreamAdapterResult } from '../services/streamAdapter';
import './PlayerStream.css';

interface NextEpisodeInfo {
    title: string;
    seasonNumber: number;
    episodeNumber: number;
    episodeName?: string;
    posterUrl?: string;
}

const MANIFEST_RETRY_ATTEMPTS = 3;

export function GlobalPlayer() {
    const navigate = useNavigate();
    const { playerState, minimizePlayer, maximizePlayer, closePlayer, playMedia } = usePlayer();
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const { viewState, media } = playerState;
    const isActive = viewState !== 'hidden' && media !== null;
    const isMini = viewState === 'mini';

    const type = media?.mediaType;
    const id = media?.tmdbId?.toString();
    const season = media?.season ?? 1;
    const episode = media?.episode ?? 1;
    const title = media?.title ?? 'Video';
    const posterPath = media?.posterPath ?? '';
    const genre = media?.genre ?? '';
    const initialTime = media?.initialTime ?? 0;
    const parsedTmdbId = media?.tmdbId;

    const [streamData, setStreamData] = useState<StreamAdapterResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [nextEpisode, setNextEpisode] = useState<NextEpisodeInfo | null>(null);
    const [retryKey, setRetryKey] = useState(0);
    const [showControls, setShowControls] = useState(true);
    const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);
    const frameRef = useRef<HTMLDivElement | null>(null);

    // Track real browser fullscreen — ONLY when the player container itself is fullscreen.
    // Using !!document.fullscreenElement was too broad: any element becoming fullscreen
    // (e.g. video auto-fullscreen for certain CDNs/movies) would hide the topbar.
    // Now we specifically check that the fullscreen element is INSIDE our player frame.
    useEffect(() => {
        const sync = () => {
            const fsEl = document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ?? null;
            // Only treat as "player fullscreen" if the fullscreen element is our frame or a descendant
            const isPlayerFs = fsEl !== null && frameRef.current !== null && frameRef.current.contains(fsEl);
            setIsBrowserFullscreen(isPlayerFs);
        };
        document.addEventListener('fullscreenchange', sync);
        document.addEventListener('webkitfullscreenchange', sync);
        sync();
        return () => {
            document.removeEventListener('fullscreenchange', sync);
            document.removeEventListener('webkitfullscreenchange', sync);
        };
    }, []);
    const [upNextPrefetchDisabled, setUpNextPrefetchDisabled] = useState(false);
    const hasRetriedRef = useRef(false);
    const mediaKeyRef = useRef<string | null>(null);
    const fetchRunIdRef = useRef(0);
    const nextEpPrefetchedRef = useRef<string | null>(null);
    const logAdvancedError = useCallback((code: string, message: string) => {
        const mediaLabel = type === 'tv'
            ? `${title} (TV ${parsedTmdbId ?? 'unknown'} S${season}E${episode})`
            : `${title} (${type ?? 'unknown'} ${parsedTmdbId ?? 'unknown'})`;
        appendAdvancedErrorLog({
            engine: 'GlobalPlayer',
            code,
            message,
            media: mediaLabel,
        });
    }, [type, title, parsedTmdbId, season, episode]);
    const invalidateCurrentStreamCache = useCallback(async () => {
        if (!parsedTmdbId || !type) return;
        if (type === 'movie') {
            await invalidateCachedMovieStream(parsedTmdbId);
            return;
        }
        await invalidateCachedTVStream(parsedTmdbId, season, episode);
    }, [parsedTmdbId, type, season, episode]);

    const [miniIsPlaying, setMiniIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [position, setPosition] = useState({ x: 28, y: 28 });
    const dragStart = useRef({ x: 0, y: 0 });
    const positionStart = useRef({ x: 28, y: 28 });
    const dragPending = useRef(false);
    const dragMoved = useRef(false);
    const suppressExpandUntil = useRef(0);
    const rafIdRef = useRef<number | null>(null);
    const pendingPositionRef = useRef<{ x: number; y: number } | null>(null);

    const MINI_WIDTH = 400;
    const MINI_HEIGHT = 204;

    useEffect(() => {
        if (!isMini) {
            dragPending.current = false;
            dragMoved.current = false;
            setIsDragging(false);
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
            pendingPositionRef.current = null;
        }
    }, [isMini]);

    useEffect(() => {
        if (!isMini) return;
        const video = videoRef.current;
        if (!video) return;

        const sync = () => {
            setMiniIsPlaying(!video.paused && !video.ended);
            setCurrentTime(video.currentTime || 0);
            setDuration(video.duration || 0);
        };

        sync();
        video.addEventListener('play', sync);
        video.addEventListener('pause', sync);
        video.addEventListener('timeupdate', sync);
        video.addEventListener('durationchange', sync);
        video.addEventListener('ended', sync);

        return () => {
            video.removeEventListener('play', sync);
            video.removeEventListener('pause', sync);
            video.removeEventListener('timeupdate', sync);
            video.removeEventListener('durationchange', sync);
            video.removeEventListener('ended', sync);
        };
    }, [isMini, streamData?.streamUrl, retryKey]);

    const formatTime = (secs: number) => {
        if (!secs || isNaN(secs)) return '0:00';
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = Math.floor(secs % 60);
        const ss = s.toString().padStart(2, '0');
        if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${ss}`;
        return `${m}:${ss}`;
    };

    const detailsPath = useCallback(() => {
        if (!parsedTmdbId || !type) return null;
        return `/details/${type}/${parsedTmdbId}`;
    }, [parsedTmdbId, type]);

    useEffect(() => {
        if (!isActive || type !== 'tv' || !parsedTmdbId) return;
        try {
            sessionStorage.setItem(`delulu-season-${parsedTmdbId}`, String(season));
            sessionStorage.setItem(`delulu-episode-${parsedTmdbId}`, String(episode));
        } catch {
            // ignore storage failures
        }
    }, [isActive, type, parsedTmdbId, season, episode]);

    const runAfterVideoFullscreenExit = useCallback((action: () => void) => {
        if (!document.fullscreenElement) {
            action();
            return;
        }

        let fired = false;
        const finish = () => {
            if (fired) return;
            fired = true;
            action();
        };

        const onFullscreenChange = () => {
            if (document.fullscreenElement) return;
            document.removeEventListener('fullscreenchange', onFullscreenChange);
            finish();
        };

        document.addEventListener('fullscreenchange', onFullscreenChange);

        const forceFallback = window.setTimeout(() => {
            document.removeEventListener('fullscreenchange', onFullscreenChange);
            finish();
        }, 300);

        document.exitFullscreen().catch(() => {
            clearTimeout(forceFallback);
            document.removeEventListener('fullscreenchange', onFullscreenChange);
            finish();
        });
    }, []);

    const mediaKey = media ? `${media.mediaType}-${media.tmdbId}-${media.season}-${media.episode}` : null;
    useEffect(() => {
        setUpNextPrefetchDisabled(false);
    }, [mediaKey]);

    useEffect(() => {
        if (!isActive || !type || !id) return;
        if (mediaKey === mediaKeyRef.current && streamData?.streamUrl) return;

        mediaKeyRef.current = mediaKey;
        const runId = ++fetchRunIdRef.current;
        let isMounted = true;
        setIsLoading(true);
        setError(null);
        setStreamData(null);

        const isRunActive = () => isMounted && fetchRunIdRef.current === runId;
        const fetchStream = async (forceBypassCache = false) => {
            const tmdbId = parseInt(id, 10);
            const cleanTitle = title.split(' - ')[0].trim() || title;
            let lastFailure = 'Stream not available';

            for (let attempt = 0; attempt < MANIFEST_RETRY_ATTEMPTS; attempt += 1) {
                const bypassCache = forceBypassCache || attempt > 0;
                try {
                    let result: StreamAdapterResult;
                    if (type === 'movie') {
                        result = await getMovieStream(tmdbId, bypassCache, cleanTitle);
                    } else {
                        result = await getTVStream(tmdbId, season, episode, bypassCache, cleanTitle);
                    }

                    if (!isRunActive()) return;
                    if (!(result.success && result.streamUrl)) {
                        lastFailure = result.error || 'Stream not available';
                        logAdvancedError('EXTRACT_FAIL', `[attempt ${attempt + 1}] ${lastFailure}`);
                        continue;
                    }

                    try {
                        const proxiedUrl = await proxyStreamUrl(
                            result.streamUrl,
                            result.headers as Record<string, string> | undefined
                        );
                        result = { ...result, streamUrl: proxiedUrl };
                    } catch (proxyErr) {
                        if (proxyErr instanceof Error && proxyErr.message === PROXY_SUPERSEDED) {
                            console.log('[GlobalPlayer] Proxy setup superseded, aborting stale fetch');
                            return;
                        }
                        console.error('[GlobalPlayer] Proxy setup failed, aborting playback:', proxyErr);
                        lastFailure = String(proxyErr);
                        logAdvancedError('PROXY_SETUP_FAIL', `[attempt ${attempt + 1}] ${lastFailure}`);
                        continue;
                    }

                    const preparedUrl = result.streamUrl;
                    if (!preparedUrl) {
                        lastFailure = 'Stream URL missing after proxy preparation';
                        logAdvancedError('STREAM_URL_MISSING', `[attempt ${attempt + 1}] ${lastFailure}`);
                        continue;
                    }

                    const shouldProbeManifest = preparedUrl.includes('.m3u8') || preparedUrl.includes('m3u8');
                    if (shouldProbeManifest) {
                        const probeOk = await probeProxiedHlsManifest(preparedUrl);
                        if (!isRunActive()) return;
                        if (!probeOk) {
                            lastFailure = `Manifest probe failed for URL: ${preparedUrl}`;
                            logAdvancedError('MANIFEST_PROBE_FAIL', `[attempt ${attempt + 1}] ${lastFailure}`);
                            await invalidateCurrentStreamCache();
                            continue;
                        }
                    }

                    setIsTransitioning(true);
                    setTimeout(() => {
                        if (!isRunActive()) return;
                        setStreamData(result);
                        setRetryKey((k) => k + 1);
                        setIsLoading(false);
                        setTimeout(() => {
                            if (isRunActive()) setIsTransitioning(false);
                        }, 350);
                    }, 200);
                    return;
                } catch (err) {
                    if (!isRunActive()) return;
                    lastFailure = String(err);
                    logAdvancedError('FETCH_EXCEPTION', `[attempt ${attempt + 1}] ${lastFailure}`);
                    await invalidateCurrentStreamCache();
                }
            }

            if (!isRunActive()) return;
            setStreamData(null);
            setError('PLAYBACK_UNAVAILABLE');
            setIsLoading(false);
            logAdvancedError('FINAL_PLAYBACK_FAIL', `All ${MANIFEST_RETRY_ATTEMPTS} attempts failed. Last error: ${lastFailure}`);
        };

        fetchStream(false);
        hasRetriedRef.current = false;
        return () => {
            isMounted = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mediaKey, isActive, invalidateCurrentStreamCache, logAdvancedError]);

    const handleFatalError = useCallback((errorType: string, details: string) => {
        if (isLoading || !streamData?.streamUrl) {
            console.warn('[GlobalPlayer] Ignoring stale fatal error', { errorType, details, isLoading });
            return;
        }

        if (hasRetriedRef.current) {
            console.error('[GlobalPlayer] Fatal error after retry, showing error screen', { errorType, details });
            logAdvancedError('HLS_FATAL_AFTER_RETRY', `${errorType} | ${details}`);
            setError('PLAYBACK_UNAVAILABLE');
            return;
        }

        const isRetryable = errorType === 'networkError' || details.includes('manifest');
        if (!isRetryable) {
            logAdvancedError('HLS_FATAL_NON_RETRYABLE', `${errorType} | ${details}`);
            setError('PLAYBACK_UNAVAILABLE');
            return;
        }

        if (!type || !id) return;

        hasRetriedRef.current = true;
        let isMounted = true;
        setIsLoading(true);
        setError(null);
        console.warn('[GlobalPlayer] Retrying stream after fatal playback error', { errorType, details });

        const tmdbId = parseInt(id, 10);
        const cleanTitle = title.split(' - ')[0].trim() || title;
        const retry = async () => {
            try {
                const result = type === 'movie'
                    ? await getMovieStream(tmdbId, true, cleanTitle)
                    : await getTVStream(tmdbId, season, episode, true, cleanTitle);

                if (!isMounted) return;

                if (result.success && result.streamUrl) {
                    try {
                        const proxied = await proxyStreamUrl(
                            result.streamUrl,
                            result.headers as Record<string, string> | undefined
                        );
                        const prepared = { ...result, streamUrl: proxied };
                        const shouldProbeManifest = proxied.includes('.m3u8') || proxied.includes('m3u8');
                        if (shouldProbeManifest) {
                            const probeOk = await probeProxiedHlsManifest(proxied);
                            if (!probeOk) {
                                logAdvancedError('MANIFEST_PROBE_FAIL_RETRY', `Manifest probe failed on retry URL: ${proxied}`);
                                setError('PLAYBACK_UNAVAILABLE');
                                setIsLoading(false);
                                return;
                            }
                        }
                        setStreamData(prepared);
                    } catch (proxyErr) {
                        if (proxyErr instanceof Error && proxyErr.message === PROXY_SUPERSEDED) {
                            setIsLoading(false);
                            return;
                        }
                        console.error('[GlobalPlayer] Retry proxy setup failed:', proxyErr);
                        logAdvancedError('PROXY_SETUP_FAIL_RETRY', String(proxyErr));
                        setError('PLAYBACK_UNAVAILABLE');
                        setIsLoading(false);
                        return;
                    }
                    setRetryKey((k) => k + 1);
                    setIsLoading(false);
                } else {
                    console.error('[GlobalPlayer] Retry failed: stream unavailable', { errorType, details, resultError: result.error });
                    logAdvancedError('RETRY_EXTRACT_FAIL', result.error || 'Stream unavailable after retry');
                    setError('PLAYBACK_UNAVAILABLE');
                    setIsLoading(false);
                }
            } catch (err) {
                if (!isMounted) return;
                console.error('[GlobalPlayer] Retry failed with exception', err);
                logAdvancedError('RETRY_EXCEPTION', String(err));
                setError('PLAYBACK_UNAVAILABLE');
                setIsLoading(false);
            }
        };

        retry();
        return () => {
            isMounted = false;
        };
    }, [type, id, season, episode, isLoading, streamData?.streamUrl, logAdvancedError]);

    useEffect(() => {
        if (type !== 'tv' || !parsedTmdbId) {
            setNextEpisode(null);
            return;
        }

        let isMounted = true;
        const poster = posterPath ? getPosterUrl(posterPath, 'large') : undefined;
        const cleanTitle = title.split(' - ')[0].trim() || title;

        const resolve = async () => {
            try {
                const currentSeason = await getSeasonDetails(parsedTmdbId, season);
                const nextInSeason = currentSeason.episodes.find((ep) => ep.episode_number === episode + 1);
                if (!isMounted) return;

                if (nextInSeason) {
                    setNextEpisode({
                        title: cleanTitle,
                        seasonNumber: season,
                        episodeNumber: nextInSeason.episode_number,
                        episodeName: nextInSeason.name,
                        posterUrl: poster,
                    });
                    return;
                }

                const nextSeason = await getSeasonDetails(parsedTmdbId, season + 1);
                const firstEp = nextSeason.episodes.find((ep) => ep.episode_number === 1);
                if (!isMounted) return;

                setNextEpisode(firstEp
                    ? {
                        title: cleanTitle,
                        seasonNumber: season + 1,
                        episodeNumber: 1,
                        episodeName: firstEp.name,
                        posterUrl: poster,
                    }
                    : null);
            } catch {
                if (isMounted) setNextEpisode(null);
            }
        };

        resolve();
        return () => {
            isMounted = false;
        };
    }, [type, parsedTmdbId, season, episode, title, posterPath]);

    useEffect(() => {
        if (!isActive || isMini) {
            invoke('presence_clear').catch(() => { });
        }
    }, [isActive, isMini]);

    const syncProgressNow = useCallback(async () => {
        if (!parsedTmdbId || !videoRef.current) return;
        if (type !== 'movie' && type !== 'tv') return;

        const video = videoRef.current;
        if (!video.duration || Number.isNaN(video.duration) || video.duration <= 0) return;
        if (video.currentTime < 90) return;

        await watchService.immediateSave({
            tmdbId: parsedTmdbId,
            mediaType: type,
            seasonNumber: type === 'tv' ? season : undefined,
            episodeNumber: type === 'tv' ? episode : undefined,
            currentTime: video.currentTime,
            totalDuration: video.duration,
        });
    }, [parsedTmdbId, type, season, episode]);

    const persistEpisodeSelectionNow = useCallback(() => {
        if (type !== 'tv' || !parsedTmdbId) return;
        try {
            sessionStorage.setItem(`delulu-season-${parsedTmdbId}`, String(season));
            sessionStorage.setItem(`delulu-episode-${parsedTmdbId}`, String(episode));
        } catch {
            // ignore storage failures
        }
    }, [type, parsedTmdbId, season, episode]);

    const handleBackToDetails = useCallback(() => {
        syncProgressNow().catch(console.error);
        persistEpisodeSelectionNow();
        const target = detailsPath();
        runAfterVideoFullscreenExit(() => {
            minimizePlayer();
            if (target) {
                navigate(target, {
                    state: {
                        source: 'player-back',
                        mediaType: type,
                        tmdbId: parsedTmdbId,
                        season,
                        episode,
                    },
                });
            }
        });
    }, [syncProgressNow, persistEpisodeSelectionNow, detailsPath, runAfterVideoFullscreenExit, minimizePlayer, navigate, type, parsedTmdbId, season, episode]);

    const handleCloseToDetails = useCallback(() => {
        syncProgressNow().catch(console.error);
        persistEpisodeSelectionNow();
        const target = detailsPath();
        runAfterVideoFullscreenExit(() => {
            closePlayer();
            if (target) {
                navigate(target, {
                    state: {
                        source: 'player-close',
                        mediaType: type,
                        tmdbId: parsedTmdbId,
                        season,
                        episode,
                    },
                });
            }
        });
    }, [closePlayer, syncProgressNow, persistEpisodeSelectionNow, detailsPath, navigate, runAfterVideoFullscreenExit, type, parsedTmdbId, season, episode]);
    const handleManualRetry = useCallback(async () => {
        if (!type || !id) return;
        const runId = ++fetchRunIdRef.current;
        const isRunActive = () => fetchRunIdRef.current === runId;
        const tmdbId = parseInt(id, 10);
        const cleanTitle = title.split(' - ')[0].trim() || title;
        setError(null);
        setStreamData(null);
        setIsLoading(true);
        let lastFailure = 'Manual retry failed';

        for (let attempt = 0; attempt < MANIFEST_RETRY_ATTEMPTS; attempt += 1) {
            try {
                let result: StreamAdapterResult;
                if (type === 'movie') {
                    result = await getMovieStream(tmdbId, true, cleanTitle);
                } else {
                    result = await getTVStream(tmdbId, season, episode, true, cleanTitle);
                }

                if (!isRunActive()) return;
                if (!(result.success && result.streamUrl)) {
                    lastFailure = result.error || 'Stream unavailable after retry';
                    logAdvancedError('MANUAL_RETRY_EXTRACT_FAIL', `[attempt ${attempt + 1}] ${lastFailure}`);
                    await invalidateCurrentStreamCache();
                    continue;
                }

                const proxied = await proxyStreamUrl(result.streamUrl, result.headers as Record<string, string> | undefined);
                if (!isRunActive()) return;
                const shouldProbeManifest = proxied.includes('.m3u8') || proxied.includes('m3u8');
                if (shouldProbeManifest) {
                    const probeOk = await probeProxiedHlsManifest(proxied);
                    if (!isRunActive()) return;
                    if (!probeOk) {
                        lastFailure = `Manual retry manifest probe failed for URL: ${proxied}`;
                        logAdvancedError('MANUAL_RETRY_PROBE_FAIL', `[attempt ${attempt + 1}] ${lastFailure}`);
                        await invalidateCurrentStreamCache();
                        continue;
                    }
                }

                setStreamData({ ...result, streamUrl: proxied });
                setRetryKey((k) => k + 1);
                setIsLoading(false);
                return;
            } catch (err) {
                if (!isRunActive()) return;
                lastFailure = String(err);
                logAdvancedError('MANUAL_RETRY_EXCEPTION', `[attempt ${attempt + 1}] ${lastFailure}`);
                await invalidateCurrentStreamCache();
            }
        }

        if (!isRunActive()) return;
        setStreamData(null);
        setError('PLAYBACK_UNAVAILABLE');
        setIsLoading(false);
        logAdvancedError('MANUAL_RETRY_FINAL_FAIL', `All ${MANIFEST_RETRY_ATTEMPTS} attempts failed. Last error: ${lastFailure}`);
    }, [type, id, title, season, episode, logAdvancedError, invalidateCurrentStreamCache]);

    const handleMiniCloseStayOnRoute = useCallback(() => {
        syncProgressNow().catch(console.error);
        persistEpisodeSelectionNow();
        runAfterVideoFullscreenExit(() => {
            closePlayer();
        });
    }, [closePlayer, syncProgressNow, persistEpisodeSelectionNow, runAfterVideoFullscreenExit]);

    const handleCancel = handleCloseToDetails;

    const handlePlayNextEpisode = useCallback(() => {
        if (type !== 'tv' || !nextEpisode || !parsedTmdbId) return;
        const nextTitle = nextEpisode.episodeName
            ? `${nextEpisode.title} - S${nextEpisode.seasonNumber}E${nextEpisode.episodeNumber}: ${nextEpisode.episodeName}`
            : `${nextEpisode.title} - S${nextEpisode.seasonNumber}E${nextEpisode.episodeNumber}`;

        playMedia({
            mediaType: 'tv',
            tmdbId: parsedTmdbId,
            season: nextEpisode.seasonNumber,
            episode: nextEpisode.episodeNumber,
            title: nextTitle,
            posterPath,
            genre,
            initialTime: 0,
            returnRoute: media?.returnRoute,
        });
    }, [type, nextEpisode, parsedTmdbId, playMedia, posterPath, genre, media?.returnRoute]);

    const handleQueueNextEpisode = useCallback(() => {
        if (type !== 'tv' || !nextEpisode || !parsedTmdbId || upNextPrefetchDisabled) return;
        const prefetchKey = `${parsedTmdbId}-S${nextEpisode.seasonNumber}E${nextEpisode.episodeNumber}`;
        if (nextEpPrefetchedRef.current === prefetchKey) return;
        nextEpPrefetchedRef.current = prefetchKey;
        getTVStream(parsedTmdbId, nextEpisode.seasonNumber, nextEpisode.episodeNumber, false, nextEpisode.title)
            .catch((e) => console.warn('[GlobalPlayer] Queue prefetch failed:', e));
    }, [type, nextEpisode, parsedTmdbId, upNextPrefetchDisabled]);

    const handleDisableUpNext = useCallback(() => {
        setUpNextPrefetchDisabled(true);
    }, []);

    const toggleMiniPlay = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;

        if (video.paused) {
            video.play().catch(() => { });
        } else {
            video.pause();
        }
    }, []);

    const handleMiniExpand = useCallback(() => {
        if (Date.now() < suppressExpandUntil.current) return;
        maximizePlayer();
    }, [maximizePlayer]);

    const handleDragStart = (e: React.MouseEvent) => {
        if (!isMini || e.button !== 0) return;
        const target = e.target as HTMLElement;
        if (target.closest('button')) return;

        dragPending.current = true;
        dragMoved.current = false;
        dragStart.current = { x: e.clientX, y: e.clientY };
        positionStart.current = { ...position };
    };

    useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (!dragPending.current || !isMini) return;

            const dx = e.clientX - dragStart.current.x;
            const dy = e.clientY - dragStart.current.y;

            if (!dragMoved.current && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
            dragMoved.current = true;
            setIsDragging(true);

            const maxRight = Math.max(12, window.innerWidth - MINI_WIDTH - 12);
            const maxBottom = Math.max(12, window.innerHeight - MINI_HEIGHT - 12);
            pendingPositionRef.current = {
                x: Math.min(maxRight, Math.max(12, positionStart.current.x - dx)),
                y: Math.min(maxBottom, Math.max(12, positionStart.current.y - dy)),
            };

            if (rafIdRef.current !== null) return;
            rafIdRef.current = requestAnimationFrame(() => {
                rafIdRef.current = null;
                if (!pendingPositionRef.current) return;
                setPosition(pendingPositionRef.current);
                pendingPositionRef.current = null;
            });
        };

        const onUp = () => {
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
            if (pendingPositionRef.current) {
                setPosition(pendingPositionRef.current);
                pendingPositionRef.current = null;
            }
            if (dragMoved.current) {
                suppressExpandUntil.current = Date.now() + 180;
            }
            dragPending.current = false;
            dragMoved.current = false;
            setIsDragging(false);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);

        return () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
            pendingPositionRef.current = null;
        };
    }, [isMini]);

    const posterUrl = posterPath ? getPosterUrl(posterPath, 'large') : undefined;
    const backdropUrl = posterPath ? `https://image.tmdb.org/t/p/original${posterPath}` : undefined;
    const bgImage = backdropUrl || posterUrl;
    const metadataLabel = type === 'tv' ? `Season ${season} - Episode ${episode}` : 'Movie';
    const showAppTitlebar = !isMini && !isBrowserFullscreen;

    const playerSubtitles = useMemo(() => (
        streamData?.subtitles?.map((sub) => ({
            label: sub.language,
            src: sub.url,
            language: sub.language.toLowerCase().split(' ')[0],
        })) || []
    ), [streamData?.subtitles]);

    if (!isActive) return null;

    if (isLoading) {
        return (
            <div className="global-player-shell">
                {showAppTitlebar && (
                    <div className="global-player-app-titlebar-layer">
                        <PlayerChromeBar />
                    </div>
                )}
                <div className="global-player-frame mode-fullscreen app-fullscreen">
                    <PremiumLoader
                        posterUrl={posterUrl}
                        backdropUrl={backdropUrl}
                        title={title}
                        quality="HD"
                        onCancel={handleCancel}
                    />
                </div>
            </div>
        );
    }

    if (error || !streamData?.streamUrl) {
        return (
            <div className="global-player-shell">
                {showAppTitlebar && (
                    <div className="global-player-app-titlebar-layer">
                        <PlayerChromeBar />
                    </div>
                )}
                <div className="global-player-frame mode-fullscreen">
                    <div className="premium-loader">
                        {bgImage && (
                            <div className="premium-loader-backdrop" style={{ backgroundImage: `url(${bgImage})` }} />
                        )}
                        <div className="premium-loader-gradient-left" />
                        <div className="premium-loader-gradient-bottom" />
                        <div className="error-center-layout">
                            {posterUrl && <img src={posterUrl} alt={title} className="error-poster-tile" />}
                            <div className="error-info">
                                <h2 className="error-title">{title}</h2>
                                <p className="error-msg">
                                    Sorry, this stream is not available right now.
                                </p>
                                <div className="error-btns">
                                    <button className="error-retry-btn" onClick={handleManualRetry}>
                                        Retry
                                    </button>
                                    <button className="error-back-btn" onClick={handleCloseToDetails}>Go Back</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="global-player-shell">
            {showAppTitlebar && (
                <div className="global-player-app-titlebar-layer">
                    <PlayerChromeBar />
                </div>
            )}

            <div
                ref={frameRef}
                className={`global-player-frame ${isMini ? 'mode-mini' : 'mode-fullscreen'} ${!isMini ? 'with-app-titlebar' : ''} ${isTransitioning ? 'transitioning' : ''} ${isDragging ? 'dragging' : ''} ${showControls ? 'show-controls' : 'hide-controls'}`}
                style={isMini ? { right: `${position.x}px`, bottom: `${position.y}px` } : undefined}
                onMouseDown={handleDragStart}
            >
                <DeluluPlayer
                    src={streamData.streamUrl}
                    headers={streamData.headers}
                    title={title}
                    posterUrl={posterUrl}
                    metadataLabel={metadataLabel}
                    genreLabel={genre}
                    isSeries={type === 'tv'}
                    nextEpisode={nextEpisode || undefined}
                    onPlayNextEpisode={handlePlayNextEpisode}
                    onQueueNextEpisode={handleQueueNextEpisode}
                    onDisableUpNext={handleDisableUpNext}
                    onMinimize={handleBackToDetails}
                    onBack={handleCloseToDetails}
                    showQualitySelector
                    videoRef={videoRef}
                    initialTime={initialTime}
                    tmdbId={parsedTmdbId}
                    mediaType={type}
                    seasonNumber={type === 'tv' ? season : undefined}
                    episodeNumber={type === 'tv' ? episode : undefined}
                    subtitles={playerSubtitles}
                    onFatalError={handleFatalError}
                    isActive={isActive && !isMini}
                    reloadToken={retryKey}
                    onControlsVisibilityChange={setShowControls}
                />

                {isMini && (
                    <CinematicMiniPlayer
                        visible={isMini}
                        embedded
                        title={title.split(' - ')[0].trim() || title}
                        thumbnailUrl={backdropUrl || posterUrl || ''}
                        currentTimeLabel={formatTime(currentTime)}
                        remainingTimeLabel={duration > 0 ? `-${formatTime(Math.max(0, duration - currentTime))}` : undefined}
                        progress={duration > 0 ? currentTime / duration : 0}
                        isPaused={!miniIsPlaying}
                        onTogglePlay={toggleMiniPlay}
                        onExpand={handleMiniExpand}
                        onClose={handleMiniCloseStayOnRoute}
                        onFullscreen={handleMiniExpand}
                    />
                )}
            </div>
        </div>
    );
}


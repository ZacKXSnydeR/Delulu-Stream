import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { MutableRefObject } from 'react';
import Hls from 'hls.js';
import {
    Play,
    Pause,
    Volume2,
    VolumeX,
    Volume1,
    Maximize,
    Minimize,
    SkipBack,
    SkipForward,
    Settings,
    Subtitles,
    PictureInPicture,
    ChevronLeft,
    Check,
    X,
    Layers,
    Music,
} from 'lucide-react';
import { watchService } from '../../services/watchHistory';
import { invoke } from '@tauri-apps/api/core';

import './DeluluPlayer.css';

// ============================================
// VTT PARSER
// ============================================
function parseVTT(vttContent: string): Array<{ start: number; end: number; text: string }> {
    const cues: Array<{ start: number; end: number; text: string }> = [];
    const lines = vttContent.split('\n');

    let i = 0;
    while (i < lines.length) {
        const line = lines[i].trim();

        if (line.includes('-->')) {
            const timeParts = line.split('-->');
            if (timeParts.length === 2) {
                const start = parseVTTTime(timeParts[0].trim());
                const end = parseVTTTime(timeParts[1].trim().split(' ')[0]);

                const textLines: string[] = [];
                i++;
                while (i < lines.length && lines[i].trim() !== '') {
                    textLines.push(lines[i].trim());
                    i++;
                }

                if (textLines.length > 0 && !isNaN(start) && !isNaN(end)) {
                    cues.push({
                        start,
                        end,
                        text: textLines.join('\n').replace(/<[^>]+>/g, ''),
                    });
                }
            }
        }
        i++;
    }

    return cues;
}

function parseVTTTime(timeStr: string): number {
    const parts = timeStr.split(':');
    if (parts.length === 3) {
        const hours = parseFloat(parts[0]);
        const minutes = parseFloat(parts[1]);
        const seconds = parseFloat(parts[2]);
        return hours * 3600 + minutes * 60 + seconds;
    } else if (parts.length === 2) {
        const minutes = parseFloat(parts[0]);
        const seconds = parseFloat(parts[1]);
        return minutes * 60 + seconds;
    }
    return NaN;
}

// ============================================
// TYPES
// ============================================
interface DeluluPlayerProps {
    src: string;
    title?: string;
    posterUrl?: string;
    metadataLabel?: string;
    genreLabel?: string;
    isSeries?: boolean;
    nextEpisode?: {
        title: string;
        seasonNumber: number;
        episodeNumber: number;
        episodeName?: string;
        posterUrl?: string;
    };
    onPlayNextEpisode?: () => void;
    onQueueNextEpisode?: () => void;
    onDisableUpNext?: () => void;
    onBack?: () => void;
    onMinimize?: () => void;
    onReady?: () => void;
    onFatalError?: (type: string, details: string) => void;
    initialTime?: number;
    startPaused?: boolean;
    videoRef?: MutableRefObject<HTMLVideoElement | null>;
    showQualitySelector?: boolean;
    headers?: {
        Referer?: string;
        Origin?: string;
        'User-Agent'?: string;
    };
    subtitles?: SubtitleTrack[];
    tmdbId?: number;
    mediaType?: 'movie' | 'tv';
    seasonNumber?: number;
    episodeNumber?: number;
    isActive?: boolean;
    reloadToken?: number;
    onControlsVisibilityChange?: (visible: boolean) => void;
    // ── Source switching (race engine) ──
    /** All successful addon sources from the race */
    allSources?: Array<{
        addonId: string;
        addonName: string;
        success: boolean;
        streamUrl?: string;
        headers?: Record<string, string>;
        subtitles?: Array<{ url: string; language?: string }>;
        audios?: Record<string, Record<string, string>>;
        proxyPort?: number;
        sessionId?: string;
        selfProxy?: boolean;
        latencyMs: number;
    }>;
    /** Multi-audio map from current source */
    audios?: Record<string, Record<string, string>>;
    /** Currently playing addon ID */
    sourceAddonId?: string;
    /** Currently playing addon name */
    sourceAddonName?: string;
    /** Self-proxy flag for current source */
    selfProxy?: boolean;
    /** Switch to a different source */
    onSourceSwitch?: (source: {
        addonId: string;
        addonName: string;
        success: boolean;
        streamUrl?: string;
        headers?: Record<string, string>;
        subtitles?: Array<{ url: string; language?: string }>;
        audios?: Record<string, Record<string, string>>;
        proxyPort?: number;
        sessionId?: string;
        selfProxy?: boolean;
        latencyMs: number;
    }, context?: {
        resumeTime?: number;
        startPaused?: boolean;
    }) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function qualityScore(label: string): number {
    const n = Number.parseInt(label, 10);
    if (Number.isFinite(n)) return n;
    const normalized = label.trim().toLowerCase();
    if (normalized === 'best') return 10_000;
    if (normalized === 'auto') return 9_000;
    return 0;
}

interface SubtitleTrack {
    label: string;
    src: string;
    language: string;
    default?: boolean;
}

interface QualityLevel {
    height: number;
    index: number;
    bitrate: number;
}

interface SubtitleSettings {
    fontSize: number;
    textColor: string;
    bgOpacity: number;
    position: 'bottom' | 'top';
}

interface PersistedSubtitlePrefs {
    enabled: boolean;
    languageKey?: string;
    sourceKey?: string;
    settings?: SubtitleSettings;
}

const SUBTITLE_PREFS_KEY = 'delulu_player_subtitle_prefs_v1';
const UP_NEXT_POPUP_TRIGGER_SECONDS = 120;
const UP_NEXT_AUTO_PLAY_SECONDS = 60;

const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
    fontSize: 32,
    textColor: '#ffffff',
    bgOpacity: 0.5,
    position: 'bottom',
};

function isContainerInFullscreen(container: HTMLDivElement | null): boolean {
    if (!container) return false;
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    const fsEl = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
    if (!fsEl) return false;
    return fsEl === container;
}

function makeLanguageKey(track: SubtitleTrack): string {
    const lang = track.language?.trim().toLowerCase() || '';
    const label = track.label?.trim().toLowerCase() || '';
    return `${lang}::${label}`;
}

function makeSourceKey(src: string): string {
    try {
        const url = new URL(src, window.location.origin);
        return `${url.origin}${url.pathname}`.toLowerCase();
    } catch {
        return src.split('?')[0].toLowerCase();
    }
}

function readSubtitlePrefs(): PersistedSubtitlePrefs | null {
    try {
        const raw = localStorage.getItem(SUBTITLE_PREFS_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as PersistedSubtitlePrefs;
    } catch {
        return null;
    }
}

function writeSubtitlePrefs(next: PersistedSubtitlePrefs): void {
    try {
        localStorage.setItem(SUBTITLE_PREFS_KEY, JSON.stringify(next));
    } catch {
        // ignore persistence failures
    }
}

function hideAllNativeTextTracks(video: HTMLVideoElement): void {
    for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = 'hidden';
    }
}

// ============================================
// COMPONENT
// ============================================
export function DeluluPlayer({
    src,
    title = 'Video',
    posterUrl,
    metadataLabel: _metadataLabel,
    genreLabel,
    isSeries = false,
    nextEpisode,
    onPlayNextEpisode,
    onQueueNextEpisode,
    onDisableUpNext,
    onBack,
    onMinimize,
    onReady,
    onFatalError,
    initialTime = 0,
    startPaused = false,
    videoRef: externalVideoRef,
    showQualitySelector = true,
    headers,
    subtitles = [],
    tmdbId,
    mediaType,
    seasonNumber,
    episodeNumber,
    isActive = true,
    reloadToken = 0,
    onControlsVisibilityChange,
    allSources,
    audios,
    sourceAddonId,
    sourceAddonName: _sourceAddonName,
    selfProxy: _selfProxy,
    onSourceSwitch,
}: DeluluPlayerProps) {
    const internalVideoRef = useRef<HTMLVideoElement>(null);
    const videoRef = externalVideoRef || internalVideoRef;
    const containerRef = useRef<HTMLDivElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const settingsPanelRef = useRef<HTMLDivElement>(null);
    const subtitlePanelRef = useRef<HTMLDivElement>(null);
    const subtitleOptionsRef = useRef<HTMLDivElement>(null);
    const subtitleOptionsScrollTopRef = useRef(0);
    const suppressNextToggleRef = useRef(false);
    const hlsRef = useRef<Hls | null>(null);
    const currentQualityRef = useRef<number>(-1);
    const hideControlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pauseOverlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const upNextAutoTriggeredRef = useRef(false);
    const readyNotifiedRef = useRef(false);
    const networkRecoveryAttemptsRef = useRef(0);
    const mediaRecoveryAttemptsRef = useRef(0);
    const activeLoadSessionRef = useRef(0);
    const volumeHudTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const seekHudTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Keep latest initialTime / startPaused in refs so the HLS load effect
    // can read them without listing them as dependencies (which would destroy
    // and recreate HLS — resetting the position — whenever they change).
    const initialTimeRef = useRef(initialTime);
    const startPausedRef = useRef(startPaused);
    useEffect(() => { initialTimeRef.current = initialTime; }, [initialTime]);
    useEffect(() => { startPausedRef.current = startPaused; }, [startPaused]);

    const [isPlaying, setIsPlaying] = useState(false);
    const [isEnded, setIsEnded] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [showPauseOverlay, setShowPauseOverlay] = useState(false);
    const [showUpNextPrompt, setShowUpNextPrompt] = useState(false);
    const [queueModeOnly, setQueueModeOnly] = useState(false);
    const [upNextDisabled, setUpNextDisabled] = useState(false);
    const [isBuffering, setIsBuffering] = useState(false);
    const [buffered, setBuffered] = useState(0);
    const [showSettings, setShowSettings] = useState(false);
    const [showSubtitleSettings, setShowSubtitleSettings] = useState(false);
    const [showSourcesPanel, setShowSourcesPanel] = useState(false);
    const [showAudioPanel, setShowAudioPanel] = useState(false);
    const [volumeHud, setVolumeHud] = useState<{ level: number; muted: boolean } | null>(null);
    const [seekHud, setSeekHud] = useState<{ delta: number; tick: number } | null>(null);

    useEffect(() => {
        onControlsVisibilityChange?.(showControls);
    }, [showControls, onControlsVisibilityChange]);

    const audioOptions = useMemo(() => {
        if (!isRecord(audios)) return [] as Array<{ audioName: string; bestQuality: string; bestUrl: string }>;

        const options: Array<{ audioName: string; bestQuality: string; bestUrl: string }> = [];

        for (const [audioName, audioEntry] of Object.entries(audios)) {
            if (!isRecord(audioEntry)) continue;

            const qualitySource = isRecord(audioEntry.streams)
                ? (audioEntry.streams as Record<string, unknown>)
                : audioEntry;

            const validEntries = Object.entries(qualitySource)
                .filter(([, url]) => typeof url === 'string' && url.trim().length > 0)
                .map(([quality, url]) => [quality, url as string] as const);

            if (validEntries.length === 0) continue;

            validEntries.sort((a, b) => qualityScore(b[0]) - qualityScore(a[0]));
            const [bestQuality, bestUrl] = validEntries[0];
            options.push({ audioName, bestQuality, bestUrl });
        }

        return options;
    }, [audios]);

    useEffect(() => {
        if (!showPauseOverlay) return;
        setVolumeHud(null);
        setSeekHud(null);
    }, [showPauseOverlay]);

    useEffect(() => {
        return () => {
            if (volumeHudTimeoutRef.current) clearTimeout(volumeHudTimeoutRef.current);
            if (seekHudTimeoutRef.current) clearTimeout(seekHudTimeoutRef.current);
        };
    }, []);

    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [hoverPosition, setHoverPosition] = useState(0);

    const [qualities, setQualities] = useState<QualityLevel[]>([]);
    const [currentQuality, setCurrentQuality] = useState<number>(-1);
    const [isHLS, setIsHLS] = useState(false);
    const [isPiP, setIsPiP] = useState(false);

    useEffect(() => {
        if (!showSubtitleSettings) return;
        const restore = () => {
            if (subtitleOptionsRef.current) {
                subtitleOptionsRef.current.scrollTop = subtitleOptionsScrollTopRef.current;
            }
        };
        requestAnimationFrame(restore);
    }, [showSubtitleSettings]);

    const togglePiP = async () => {
        if (!videoRef.current) return;
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                await videoRef.current.requestPictureInPicture();
            }
        } catch (err) {
            console.error('[DeluluPlayer] PiP Error:', err);
        }
    };

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onEnterPiP = () => setIsPiP(true);
        const onLeavePiP = () => setIsPiP(false);
        video.addEventListener('enterpictureinpicture', onEnterPiP);
        video.addEventListener('leavepictureinpicture', onLeavePiP);
        return () => {
            video.removeEventListener('enterpictureinpicture', onEnterPiP);
            video.removeEventListener('leavepictureinpicture', onLeavePiP);
        };
    }, [videoRef]);

    useEffect(() => {
        currentQualityRef.current = currentQuality;
    }, [currentQuality]);

    const [activeSubtitle, setActiveSubtitle] = useState<number>(0);
    const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>(() => {
        const persisted = readSubtitlePrefs();
        return persisted?.settings ? { ...DEFAULT_SUBTITLE_SETTINGS, ...persisted.settings } : DEFAULT_SUBTITLE_SETTINGS;
    });
    const subtitleLoadSeqRef = useRef(0);

    const [subtitleCues, setSubtitleCues] = useState<Array<{ start: number; end: number; text: string }>>([]);
    const [currentSubtitleText, setCurrentSubtitleText] = useState<string>('');

    useEffect(() => {
        if (!tmdbId || !mediaType || !videoRef.current) return;
        const video = videoRef.current;
        const trackProgress = () => {
            if (!video.duration || isNaN(video.duration)) return;
            watchService.updateProgress({
                tmdbId,
                mediaType,
                seasonNumber,
                episodeNumber,
                currentTime: video.currentTime,
                totalDuration: video.duration,
            });
        };
        const progressTimer = setInterval(trackProgress, 5000);
        const handlePause = () => trackProgress();
        const handleEnded = () => trackProgress();
        video.addEventListener('pause', handlePause);
        video.addEventListener('ended', handleEnded);
        return () => {
            clearInterval(progressTimer);
            video.removeEventListener('pause', handlePause);
            video.removeEventListener('ended', handleEnded);
            trackProgress();
            watchService.syncToDatabase().catch(console.error);
        };
    }, [tmdbId, mediaType, seasonNumber, episodeNumber, videoRef]);

    useEffect(() => {
        if (activeSubtitle < 0 || !subtitles[activeSubtitle]) {
            subtitleLoadSeqRef.current += 1;
            setSubtitleCues([]);
            setCurrentSubtitleText('');
            return;
        }
        const loadSeq = subtitleLoadSeqRef.current + 1;
        subtitleLoadSeqRef.current = loadSeq;
        setSubtitleCues([]);
        setCurrentSubtitleText('');
        const loadSubtitle = async () => {
            try {
                const response = await fetch(subtitles[activeSubtitle].src);
                if (!response.ok) throw new Error('Failed to fetch subtitle');
                const vttContent = await response.text();
                const cues = parseVTT(vttContent);
                if (subtitleLoadSeqRef.current !== loadSeq) return;
                setSubtitleCues(cues);
            } catch (err) {
                console.error('[DeluluPlayer] Failed to load subtitle:', err);
                if (subtitleLoadSeqRef.current !== loadSeq) return;
                setSubtitleCues([]);
                setCurrentSubtitleText('');
            }
        };
        loadSubtitle();
    }, [activeSubtitle, subtitles]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const hideTracksNow = () => hideAllNativeTextTracks(video);
        hideTracksNow();
        video.addEventListener('loadedmetadata', hideTracksNow);
        video.addEventListener('loadeddata', hideTracksNow);
        video.textTracks?.addEventListener?.('addtrack', hideTracksNow as EventListener);
        video.textTracks?.addEventListener?.('change', hideTracksNow as EventListener);
        return () => {
            video.removeEventListener('loadedmetadata', hideTracksNow);
            video.removeEventListener('loadeddata', hideTracksNow);
            video.textTracks?.removeEventListener?.('addtrack', hideTracksNow as EventListener);
            video.textTracks?.removeEventListener?.('change', hideTracksNow as EventListener);
        };
    }, [videoRef, src, reloadToken]);

    useEffect(() => {
        if (!subtitles.length) {
            setActiveSubtitle(-1);
            return;
        }
        const persisted = readSubtitlePrefs();
        if (persisted?.enabled === false) {
            setActiveSubtitle(-1);
            return;
        }
        if (persisted?.sourceKey) {
            const preferredBySource = subtitles.findIndex((sub) => makeSourceKey(sub.src) === persisted.sourceKey);
            if (preferredBySource >= 0) {
                setActiveSubtitle(preferredBySource);
                return;
            }
        }
        if (persisted?.languageKey) {
            const preferredMatches = subtitles
                .map((sub, idx) => ({ idx, key: makeLanguageKey(sub) }))
                .filter((entry) => entry.key === persisted.languageKey);
            if (preferredMatches.length === 1) {
                setActiveSubtitle(preferredMatches[0].idx);
                return;
            }
            if (preferredMatches.length > 1) {
                setActiveSubtitle(preferredMatches[preferredMatches.length - 1].idx);
                return;
            }
        }
        const defaultIndex = subtitles.findIndex((sub) => sub.default);
        setActiveSubtitle(defaultIndex >= 0 ? defaultIndex : 0);
    }, [src, subtitles]);

    useEffect(() => {
        writeSubtitlePrefs({
            ...(readSubtitlePrefs() || {}),
            enabled: activeSubtitle >= 0,
            settings: subtitleSettings,
        });
    }, [subtitleSettings, activeSubtitle]);

    useEffect(() => {
        if (subtitleCues.length === 0) {
            setCurrentSubtitleText('');
            return;
        }
        const cue = subtitleCues.find(c => currentTime >= c.start && currentTime <= c.end);
        setCurrentSubtitleText(cue?.text || '');
    }, [currentTime, subtitleCues]);

    useEffect(() => {
        if (!title) return;
        const details = isSeries && seasonNumber && episodeNumber ? `S${seasonNumber}E${episodeNumber}` : '';
        const cleanTitle = title.split(' - ')[0].trim();
        const currentSeconds = videoRef.current?.currentTime || 0;

        if (isPlaying) {
            const startTimestamp = Math.floor(Date.now() / 1000) - Math.floor(currentSeconds);
            invoke('presence_update', {
                data: {
                    title: cleanTitle,
                    state: details ? `${details}` : 'Watching',
                    large_image: 'poster',
                    small_image: 'delulu_logo',
                    start_timestamp: startTimestamp,
                }
            }).catch(() => {});
        } else {
            invoke('presence_update', {
                data: {
                    title: cleanTitle,
                    state: `${details ? details + ' • ' : ''}Paused`,
                    large_image: 'poster',
                    small_image: 'delulu_logo',
                    start_timestamp: null,
                }
            }).catch(() => {});
        }
    }, [isPlaying, title, seasonNumber, episodeNumber, isSeries]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !src) return;
        const loadSession = activeLoadSessionRef.current + 1;
        activeLoadSessionRef.current = loadSession;
        let disposed = false;
        const isCurrentSession = () => !disposed && activeLoadSessionRef.current === loadSession;
        readyNotifiedRef.current = false;
        networkRecoveryAttemptsRef.current = 0;
        mediaRecoveryAttemptsRef.current = 0;
        // Snapshot seek/pause intent at the moment this load fires.
        // We read from refs so that changes to initialTime/startPaused props
        // do NOT re-run this effect and destroy the HLS instance.
        const seekTo = initialTimeRef.current;
        const pauseAfterLoad = startPausedRef.current;
        const isM3U8 = src.includes('.m3u8') || src.includes('m3u8');
        if (isM3U8 && Hls.isSupported()) {
            setIsHLS(true);
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                startPosition: seekTo > 0 ? seekTo : -1,
                backBufferLength: 90,
                maxBufferLength: 90,
                maxMaxBufferLength: 180,
                maxBufferSize: 120 * 1000 * 1000,
                maxBufferHole: 0.5,
                startLevel: -1,
                abrEwmaDefaultEstimate: 16_000_000,
                abrBandWidthFactor: 0.95,
                abrBandWidthUpFactor: 0.85,
                fragLoadingMaxRetry: 6,
                manifestLoadingMaxRetry: 4,
                levelLoadingMaxRetry: 4,
                fragLoadingRetryDelay: 1000,
            });
            hlsRef.current = hls;
            hls.loadSource(src);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
                if (!isCurrentSession()) return;
                const sourceLevels = data.levels.map((level, index) => ({
                    height: level.height || 0,
                    index,
                    bitrate: level.bitrate || 0,
                }));
                const levels = sourceLevels.sort((a, b) => b.height - a.height);
                setQualities(levels);
                if (sourceLevels.length > 0) {
                    const highest = [...sourceLevels].sort((a, b) => (b.bitrate !== a.bitrate ? b.bitrate - a.bitrate : b.height - a.height))[0];
                    hls.autoLevelCapping = highest.index;
                    hls.nextAutoLevel = highest.index;
                    hls.loadLevel = highest.index;
                    hls.nextLoadLevel = highest.index;
                }
                if (seekTo > 0) video.currentTime = seekTo;
                if (!pauseAfterLoad) {
                    video.play().catch(console.error);
                } else {
                    video.pause();
                }
            });
            const handleHlsError = (_event: unknown, data: {
                fatal: boolean;
                type: string;
                details?: string;
            }) => {
                if (!isCurrentSession()) return;
                if (!data.fatal) return;

                const details = String(data.details || 'unknown');
                console.warn('[DeluluPlayer] Fatal HLS error:', {
                    type: data.type,
                    details,
                    networkRecoveryAttempts: networkRecoveryAttemptsRef.current,
                    mediaRecoveryAttempts: mediaRecoveryAttemptsRef.current,
                });

                if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRecoveryAttemptsRef.current < 1) {
                    networkRecoveryAttemptsRef.current += 1;
                    hls.startLoad();
                    return;
                }

                if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveryAttemptsRef.current < 1) {
                    mediaRecoveryAttemptsRef.current += 1;
                    hls.recoverMediaError();
                    return;
                }

                onFatalError?.(data.type, details);
            };

            hls.on(Hls.Events.ERROR, handleHlsError);
            return () => {
                disposed = true;
                hls.off(Hls.Events.ERROR, handleHlsError);
                hls.destroy();
                hlsRef.current = null;
            };
        } else if (isM3U8 && video.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS (Safari / WebKit) — set src then play
            setIsHLS(true);
            video.src = src;
            video.load();
            if (seekTo > 0) video.currentTime = seekTo;
            if (!pauseAfterLoad) {
                video.play().catch((e) => console.warn('[DeluluPlayer] Native HLS autoplay suppressed:', e));
            } else {
                video.pause();
            }
        } else {
            // Direct video (MP4, self-proxy stream URL, etc.)
            setIsHLS(false);
            video.src = src;
            video.load();
            if (seekTo > 0) video.currentTime = seekTo;
            if (!pauseAfterLoad) {
                video.play().catch((e) => console.warn('[DeluluPlayer] Direct video autoplay suppressed:', e));
            } else {
                video.pause();
            }
        }
        return () => {
            disposed = true;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, headers, reloadToken]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !onReady) return;
        const notifyReady = () => { if (!readyNotifiedRef.current) { readyNotifiedRef.current = true; onReady(); } };
        video.addEventListener('loadeddata', notifyReady);
        video.addEventListener('canplay', notifyReady);
        return () => { video.removeEventListener('loadeddata', notifyReady); video.removeEventListener('canplay', notifyReady); };
    }, [videoRef, onReady, src, reloadToken]);

    const handleQualityChange = (levelIndex: number) => {
        if (hlsRef.current) {
            if (levelIndex === -1) {
                hlsRef.current.currentLevel = -1;
            } else {
                hlsRef.current.autoLevelCapping = -1;
                hlsRef.current.currentLevel = levelIndex;
            }
            setCurrentQuality(levelIndex);
        }
        setShowSettings(false);
    };

    const formatTime = (seconds: number): string => {
        if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return hrs > 0 ? `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}` : `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const resetHideTimeout = useCallback(() => {
        if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current);
        setShowControls(true);
        hideControlsTimeout.current = setTimeout(() => {
            const video = videoRef.current;
            if (video && !video.paused && !video.ended && !showSettings && !showSubtitleSettings) setShowControls(false);
        }, 3000);
    }, [showSettings, showSubtitleSettings, videoRef]);

    useEffect(() => {
        if (isPlaying) resetHideTimeout();
        else if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current);
        setShowControls(true);
    }, [isPlaying, resetHideTimeout]);

    useEffect(() => {
        if (pauseOverlayTimeoutRef.current) {
            clearTimeout(pauseOverlayTimeoutRef.current);
            pauseOverlayTimeoutRef.current = null;
        }

        if (isEnded) {
            setShowPauseOverlay(true);
        } else if (!isPlaying && !isBuffering) {
            setShowPauseOverlay(false);
            pauseOverlayTimeoutRef.current = setTimeout(() => {
                setShowPauseOverlay(true);
            }, 5000);
        } else {
            setShowPauseOverlay(false);
        }

        return () => {
            if (pauseOverlayTimeoutRef.current) {
                clearTimeout(pauseOverlayTimeoutRef.current);
                pauseOverlayTimeoutRef.current = null;
            }
        };
    }, [isPlaying, isBuffering, isEnded]);

    const canUseUpNext = Boolean(isSeries && nextEpisode && onPlayNextEpisode);
    const remainingSeconds = duration > 0 && isFinite(duration)
        ? Math.max(0, Math.ceil(duration - currentTime))
        : null;
    const inUpNextWindow = canUseUpNext && remainingSeconds !== null && remainingSeconds <= UP_NEXT_POPUP_TRIGGER_SECONDS;
    const secondsUntilAutoNext = canUseUpNext && remainingSeconds !== null
        ? Math.max(0, remainingSeconds - UP_NEXT_AUTO_PLAY_SECONDS)
        : null;

    useEffect(() => {
        setShowUpNextPrompt(false);
        setQueueModeOnly(false);
        setUpNextDisabled(false);
        upNextAutoTriggeredRef.current = false;
    }, [src, reloadToken, nextEpisode?.seasonNumber, nextEpisode?.episodeNumber, onPlayNextEpisode, isSeries]);

    useEffect(() => {
        if (!canUseUpNext || upNextDisabled) {
            if (showUpNextPrompt) setShowUpNextPrompt(false);
            return;
        }

        const shouldShowPrompt = !queueModeOnly && (isEnded || (isPlaying && inUpNextWindow));
        if (showUpNextPrompt !== shouldShowPrompt) {
            setShowUpNextPrompt(shouldShowPrompt);
        }
    }, [canUseUpNext, upNextDisabled, queueModeOnly, isEnded, isPlaying, inUpNextWindow, showUpNextPrompt]);

    useEffect(() => {
        if (!queueModeOnly || isEnded || remainingSeconds === null) return;
        if (remainingSeconds <= UP_NEXT_POPUP_TRIGGER_SECONDS + 5) return;
        setQueueModeOnly(false);
    }, [queueModeOnly, isEnded, remainingSeconds]);

    useEffect(() => {
        if (!canUseUpNext || upNextDisabled || upNextAutoTriggeredRef.current) return;
        const shouldAutoPlay = isEnded || (isPlaying && remainingSeconds !== null && remainingSeconds <= UP_NEXT_AUTO_PLAY_SECONDS);
        if (!shouldAutoPlay) return;
        if (upNextAutoTriggeredRef.current) return;
        upNextAutoTriggeredRef.current = true;
        setShowUpNextPrompt(false);
        onPlayNextEpisode?.();
    }, [canUseUpNext, upNextDisabled, onPlayNextEpisode, isPlaying, isEnded, remainingSeconds]);

    const togglePlay = () => {
        if (videoRef.current) {
            if (isEnded) { videoRef.current.currentTime = 0; setIsEnded(false); }
            isPlaying ? videoRef.current.pause() : videoRef.current.play();
        }
    };

    const toggleFullscreen = () => {
        const doc = document as Document & {
            webkitExitFullscreen?: () => Promise<void> | void;
        };
        if (!isContainerInFullscreen(containerRef.current)) {
            containerRef.current?.requestFullscreen();
        } else {
            if (doc.exitFullscreen) {
                doc.exitFullscreen().catch(() => { });
            } else {
                doc.webkitExitFullscreen?.();
            }
        }
    };

    const showSeekHud = (delta: number) => {
        setSeekHud({ delta, tick: Date.now() });
        if (seekHudTimeoutRef.current) clearTimeout(seekHudTimeoutRef.current);
        seekHudTimeoutRef.current = setTimeout(() => setSeekHud(null), 760);
    };

    const showVolumeHud = (level: number, muted: boolean) => {
        setVolumeHud({ level, muted });
        if (volumeHudTimeoutRef.current) clearTimeout(volumeHudTimeoutRef.current);
        volumeHudTimeoutRef.current = setTimeout(() => setVolumeHud(null), 650);
    };

    const skip = (seconds: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + seconds));
            showSeekHud(seconds);
        }
    };

    const jumpToPercent = (percent: number) => {
        if (!videoRef.current || !duration || !isFinite(duration)) return;
        videoRef.current.currentTime = (percent / 100) * duration;
    };

    const adjustVolume = (delta: number) => {
        if (!videoRef.current) return;
        const newVol = Math.max(0, Math.min(1, volume + delta));
        videoRef.current.volume = newVol;
        setVolume(newVol);
        setIsMuted(newVol === 0);
        showVolumeHud(newVol, newVol === 0);
    };

    const toggleMute = () => {
        if (videoRef.current) {
            const nextMuted = !isMuted;
            videoRef.current.muted = nextMuted;
            setIsMuted(nextMuted);
        }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = parseFloat(e.target.value);
        if (videoRef.current) {
            videoRef.current.volume = newVolume;
            setVolume(newVolume);
            setIsMuted(newVolume === 0);
        }
    };

    const toggleSubtitles = () => {
        if (!subtitles.length) return;
        if (activeSubtitle >= 0) {
            handleSubtitleChange(-1);
        } else {
            handleSubtitleChange(0);
        }
    };

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (progressRef.current && videoRef.current) {
            const rect = progressRef.current.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            videoRef.current.currentTime = pos * duration;
        }
    };

    const handleProgressHover = (e: React.MouseEvent<HTMLDivElement>) => {
        if (progressRef.current) {
            const rect = progressRef.current.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            setHoverPosition(e.clientX - rect.left);
            setHoverTime(pos * duration);
        }
    };

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const syncFullscreenState = () => {
            setIsFullscreen(isContainerInFullscreen(containerRef.current));
        };
        const onPlay = () => { setIsPlaying(true); setIsEnded(false); };
        const onPause = () => setIsPlaying(false);
        const onTimeUpdate = () => setCurrentTime(video.currentTime);
        const onDurationChange = () => setDuration(video.duration);
        const onWaiting = () => setIsBuffering(true);
        const onPlaying = () => setIsBuffering(false);
        const onEnded = () => { setIsPlaying(false); setIsEnded(true); };
        const onProgress = () => { if (video.buffered.length > 0) setBuffered((video.buffered.end(video.buffered.length - 1) / video.duration) * 100); };
        const onFullscreenChange = () => syncFullscreenState();
        
        video.addEventListener('play', onPlay);
        video.addEventListener('pause', onPause);
        video.addEventListener('timeupdate', onTimeUpdate);
        video.addEventListener('durationchange', onDurationChange);
        video.addEventListener('waiting', onWaiting);
        video.addEventListener('playing', onPlaying);
        video.addEventListener('ended', onEnded);
        video.addEventListener('progress', onProgress);
        document.addEventListener('fullscreenchange', onFullscreenChange);
        document.addEventListener('webkitfullscreenchange', onFullscreenChange as EventListener);
        document.addEventListener('visibilitychange', onFullscreenChange);
        window.addEventListener('focus', onFullscreenChange);
        const reconcileTimer = window.setInterval(syncFullscreenState, 500);
        syncFullscreenState();

        return () => {
            video.removeEventListener('play', onPlay);
            video.removeEventListener('pause', onPause);
            video.removeEventListener('timeupdate', onTimeUpdate);
            video.removeEventListener('durationchange', onDurationChange);
            video.removeEventListener('waiting', onWaiting);
            video.removeEventListener('playing', onPlaying);
            video.removeEventListener('ended', onEnded);
            video.removeEventListener('progress', onProgress);
            document.removeEventListener('fullscreenchange', onFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', onFullscreenChange as EventListener);
            document.removeEventListener('visibilitychange', onFullscreenChange);
            window.removeEventListener('focus', onFullscreenChange);
            window.clearInterval(reconcileTimer);
        };
    }, [videoRef, src, reloadToken]);

    useEffect(() => {
        if (!isActive) setIsFullscreen(false);
    }, [isActive]);

    useEffect(() => {
        if (!isActive) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
            const key = e.key.toLowerCase();
            let handled = true;

            if (key >= '0' && key <= '9') {
                e.preventDefault();
                jumpToPercent(Number(key) * 10);
            } else {
                switch (e.code) {
                    case 'Space': case 'KeyK': e.preventDefault(); togglePlay(); break;
                    case 'KeyJ': e.preventDefault(); skip(-10); break;
                    case 'KeyL': e.preventDefault(); skip(10); break;
                    case 'ArrowLeft': e.preventDefault(); skip(-5); break;
                    case 'ArrowRight': e.preventDefault(); skip(5); break;
                    case 'ArrowUp': e.preventDefault(); adjustVolume(0.05); break;
                    case 'ArrowDown': e.preventDefault(); adjustVolume(-0.05); break;
                    case 'KeyF': e.preventDefault(); toggleFullscreen(); break;
                    case 'KeyM': e.preventDefault(); toggleMute(); break;
                    case 'KeyC': e.preventDefault(); toggleSubtitles(); break;
                    case 'KeyS': e.preventDefault(); setShowSettings(!showSettings); break;
                    default: handled = false; break;
                }
            }
            if (handled) resetHideTimeout();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isActive, duration, currentTime, isPlaying, volume, isMuted, showSettings, showSubtitleSettings, resetHideTimeout]);

    const handleSubtitleChange = (index: number) => {
        setActiveSubtitle(index);
        if (index < 0) writeSubtitlePrefs({ ...(readSubtitlePrefs() || {}), enabled: false, sourceKey: undefined, settings: subtitleSettings });
        else if (subtitles[index]) writeSubtitlePrefs({ ...(readSubtitlePrefs() || {}), enabled: true, languageKey: makeLanguageKey(subtitles[index]), sourceKey: makeSourceKey(subtitles[index].src), settings: subtitleSettings });
    };

    const buildSwitchContext = useCallback(() => {
        const video = videoRef.current;
        const resumeTime = video && Number.isFinite(video.currentTime)
            ? Math.max(0, video.currentTime)
            : 0;
        const shouldStartPaused = Boolean(video?.paused);

        if (activeSubtitle >= 0 && subtitles[activeSubtitle]) {
            writeSubtitlePrefs({
                ...(readSubtitlePrefs() || {}),
                enabled: true,
                languageKey: makeLanguageKey(subtitles[activeSubtitle]),
                sourceKey: undefined,
                settings: subtitleSettings,
            });
        } else {
            writeSubtitlePrefs({
                ...(readSubtitlePrefs() || {}),
                enabled: false,
                sourceKey: undefined,
                settings: subtitleSettings,
            });
        }

        return {
            resumeTime,
            startPaused: shouldStartPaused,
        };
    }, [videoRef, activeSubtitle, subtitles, subtitleSettings]);

    const completionThreshold = 0.95;
    const shouldShowNextEpisodeCta = Boolean(isSeries && nextEpisode && onPlayNextEpisode && (isEnded || (!isPlaying && duration > 0 && (currentTime / duration) >= completionThreshold)));
    const pauseTitle = isEnded && nextEpisode ? nextEpisode.title : title;
    let pausePrimaryTitle = pauseTitle;
    let pauseEpisodeTitle: string | null = null;
    if (isSeries) {
        const [showTitlePart, detailPart] = pauseTitle.split(' - ', 2);
        if (showTitlePart?.trim()) pausePrimaryTitle = showTitlePart.trim();
        if (detailPart?.trim()) {
            const colonIndex = detailPart.indexOf(':');
            const extractedEpisodeTitle = (colonIndex >= 0 ? detailPart.slice(colonIndex + 1) : detailPart).trim();
            if (extractedEpisodeTitle) {
                pauseEpisodeTitle = extractedEpisodeTitle;
            }
        }
    }
    const playedSeconds = Math.floor(currentTime);
    const remainingWholeSeconds = Math.ceil(Math.max(0, duration - currentTime));

    const VolumeIconComp = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
    const upNextPoster = nextEpisode?.posterUrl || posterUrl;

    const handlePlayNextNow = () => {
        upNextAutoTriggeredRef.current = true;
        setShowUpNextPrompt(false);
        onPlayNextEpisode?.();
    };

    const handleKeepInQueue = () => {
        onQueueNextEpisode?.();
        setQueueModeOnly(true);
        setShowUpNextPrompt(false);
    };

    const handleShowQueuePopup = () => {
        setQueueModeOnly(false);
        setShowUpNextPrompt(true);
    };

    const handleDisableUpNext = () => {
        setUpNextDisabled(true);
        setShowUpNextPrompt(false);
        setQueueModeOnly(false);
        onDisableUpNext?.();
    };

    return (
        <div
            ref={containerRef}
            className={`delulu-player ${showControls ? 'show-controls' : ''} ${showPauseOverlay ? 'is-paused' : ''} ${isFullscreen ? 'is-video-fullscreen' : ''} ${isPiP ? 'is-pip-active' : ''}`}
            onMouseMove={resetHideTimeout}
            onClick={(e) => {
                if (suppressNextToggleRef.current) { suppressNextToggleRef.current = false; return; }
                if (showSettings || showSubtitleSettings) { setShowSettings(false); setShowSubtitleSettings(false); return; }
                if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'VIDEO') togglePlay();
            }}
        >
            <video
                ref={videoRef}
                className="delulu-video"
                playsInline
                style={{
                    '--subtitle-font-size': `${subtitleSettings.fontSize}px`,
                    '--subtitle-color': subtitleSettings.textColor,
                    '--subtitle-bg-opacity': subtitleSettings.bgOpacity,
                } as React.CSSProperties}
            />

            {isBuffering && <div className="delulu-buffering"><div className="delulu-buffering-spinner" /></div>}
            {volumeHud && !showPauseOverlay && (
                <div className="delulu-hud delulu-volume-hud">
                    <div className="delulu-hud-icon">
                        {volumeHud.muted || volumeHud.level === 0
                            ? <VolumeX size={22} />
                            : volumeHud.level < 0.5
                                ? <Volume1 size={22} />
                                : <Volume2 size={22} />}
                    </div>
                    <div className="delulu-hud-text">{Math.round(volumeHud.level * 100)}%</div>
                    <div className="delulu-hud-meter">
                        <span className="delulu-hud-meter-fill" style={{ width: `${Math.round(volumeHud.level * 100)}%` }} />
                    </div>
                </div>
            )}
            {seekHud && !showPauseOverlay && (
                <div
                    key={`seek-${seekHud.tick}`}
                    className={`delulu-hud delulu-seek-hud ${seekHud.delta > 0 ? 'forward' : 'backward'}`}
                >
                    {seekHud.delta > 0 ? <SkipForward size={24} /> : <SkipBack size={24} />}
                    <span>{seekHud.delta > 0 ? '+' : '-'}{Math.abs(seekHud.delta)}s</span>
                </div>
            )}
            {isPiP && (
                <div className="delulu-pip-overlay">
                    <p className="delulu-pip-label">Playing in picture-in-picture</p>
                    <h3 className="delulu-pip-title">{title}</h3>
                </div>
            )}

            {currentSubtitleText && (
                <div
                    className={`delulu-subtitle-overlay ${(!isPlaying || isPiP) ? 'is-subtitle-hidden' : ''}`}
                    style={{
                        fontSize: `${subtitleSettings.fontSize}px`,
                        color: subtitleSettings.textColor,
                        backgroundColor: `rgba(0, 0, 0, ${subtitleSettings.bgOpacity})`,
                        bottom: subtitleSettings.position === 'bottom' ? '80px' : 'auto',
                        top: subtitleSettings.position === 'top' ? '80px' : 'auto',
                    }}
                >
                    {currentSubtitleText.split('\n').map((line, i) => (<span key={i}>{line}<br /></span>))}
                </div>
            )}

            <div className="delulu-gradient-top" />
            <div className="delulu-gradient-bottom" />

            <div className="delulu-controls-header">
                <button className="delulu-back-btn" onClick={onMinimize || onBack}>
                    <ChevronLeft size={24} strokeWidth={1.5} />
                </button>
                <span className="delulu-title">{title}</span>
            </div>

            {showPauseOverlay && !showUpNextPrompt && (
                <div className="delulu-pause-overlay">
                    <div className="delulu-pause-card" onClick={() => { if (!isEnded) togglePlay(); }}>
                        {(isEnded && nextEpisode?.posterUrl ? nextEpisode.posterUrl : posterUrl) && (
                            <img 
                                className="delulu-pause-poster" 
                                src={isEnded && nextEpisode?.posterUrl ? nextEpisode.posterUrl : posterUrl} 
                                alt={pauseTitle} 
                            />
                        )}
                        <div className="delulu-pause-content">
                            {isEnded && shouldShowNextEpisodeCta && (
                                <p className="delulu-pause-status">Episode Finished</p>
                            )}
                            <h3 className="delulu-pause-title">{pausePrimaryTitle}</h3>
                            {!isEnded && pauseEpisodeTitle && (
                                <p className="delulu-pause-episode-title">{pauseEpisodeTitle}</p>
                            )}
                            {shouldShowNextEpisodeCta && nextEpisode && (
                                <p className="delulu-pause-upnext">Up Next - S{nextEpisode.seasonNumber} E{nextEpisode.episodeNumber}</p>
                            )}
                            {genreLabel && (
                                <p className="delulu-pause-genre">{genreLabel}</p>
                            )}
                            <div className="delulu-pause-stats">
                                {isEnded ? (
                                    <>
                                        <span>{formatTime(Math.floor(duration))} watched</span>
                                        <span>Ready for next episode</span>
                                    </>
                                ) : (
                                    <>
                                        <span>{formatTime(playedSeconds)} played</span>
                                        <span>{formatTime(remainingWholeSeconds)} left</span>
                                    </>
                                )}
                            </div>
                            {shouldShowNextEpisodeCta && (
                                <button className="delulu-next-episode-btn" onClick={(e) => { e.stopPropagation(); onPlayNextEpisode?.(); }}>Play Next Episode</button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {showUpNextPrompt && canUseUpNext && nextEpisode && (
                <div className="delulu-upnext-popup">
                    <button className="delulu-upnext-close" onClick={handleDisableUpNext} aria-label="Dismiss Up Next">
                        <X size={16} />
                    </button>
                    {upNextPoster && (
                        <img
                            className="delulu-upnext-poster"
                            src={upNextPoster}
                            alt={nextEpisode.title}
                        />
                    )}
                    <div className="delulu-upnext-content">
                        <p className="delulu-upnext-eyebrow">Up next</p>
                        <h4 className="delulu-upnext-title">{nextEpisode.title}</h4>
                        <p className="delulu-upnext-meta">
                            Season {nextEpisode.seasonNumber} Episode {nextEpisode.episodeNumber}
                        </p>
                        <p className="delulu-upnext-countdown">
                            Next episode in {secondsUntilAutoNext ?? 0}s
                        </p>
                        <div className="delulu-upnext-actions">
                            <button className="delulu-upnext-play-btn" onClick={handlePlayNextNow}>
                                Play now
                            </button>
                            <button className="delulu-upnext-cancel-btn" onClick={handleKeepInQueue}>
                                Keep in queue
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="delulu-controls">
                <div 
                    ref={progressRef} 
                    className="delulu-progress" 
                    onClick={handleSeek}
                    onMouseMove={handleProgressHover}
                    onMouseLeave={() => setHoverTime(null)}
                >
                    <div className="delulu-progress-buffered" style={{ width: `${buffered}%` }} />
                    <div className="delulu-progress-played" style={{ width: `${(currentTime / duration) * 100}%` }} />
                    <div className="delulu-progress-scrubber" style={{ left: `${(currentTime / duration) * 100}%` }} />
                    {hoverTime !== null && (
                        <div className="delulu-progress-hover" style={{ left: hoverPosition }}>
                            {formatTime(hoverTime)}
                        </div>
                    )}
                </div>
                <div className="delulu-control-bar">
                    <div className="delulu-controls-left">
                        <button className="delulu-btn" onClick={togglePlay}>{isPlaying ? <Pause size={22} /> : <Play size={22} />}</button>
                        <button className="delulu-btn" onClick={() => skip(-10)}><SkipBack size={20} /></button>
                        <button className="delulu-btn" onClick={() => skip(10)}><SkipForward size={20} /></button>
                        <div className="delulu-volume">
                            <button className="delulu-btn" onClick={toggleMute}><VolumeIconComp size={20} /></button>
                            <input type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume} onChange={handleVolumeChange} className="delulu-volume-slider" />
                        </div>
                        <span className="delulu-time">{formatTime(currentTime)} / {formatTime(duration)}</span>
                    </div>
                    <div className="delulu-controls-right">
                        {canUseUpNext && (
                            <button
                                className="delulu-next-episode-control-btn"
                                onClick={handlePlayNextNow}
                                title={`Play next episode${nextEpisode ? `: S${nextEpisode.seasonNumber}E${nextEpisode.episodeNumber}` : ''}`}
                            >
                                <SkipForward size={16} />
                                <span>Next Ep</span>
                            </button>
                        )}
                        {canUseUpNext && !upNextDisabled && queueModeOnly && secondsUntilAutoNext !== null && secondsUntilAutoNext > 0 && (
                            <button className="delulu-next-queue-chip" onClick={handleShowQueuePopup}>
                                Next in {secondsUntilAutoNext}s
                            </button>
                        )}
                        {subtitles.length > 0 && <button className={`delulu-btn ${activeSubtitle >= 0 ? 'active' : ''}`} onClick={() => setShowSubtitleSettings((v) => !v)}><Subtitles size={20} /></button>}
                        {allSources && allSources.length > 1 && (
                            <button className={`delulu-btn ${showSourcesPanel ? 'active' : ''}`} onClick={() => { setShowSourcesPanel((v) => !v); setShowAudioPanel(false); }} title="Sources">
                                <Layers size={20} />
                            </button>
                        )}
                        {audioOptions.length > 1 && (
                            <button className={`delulu-btn ${showAudioPanel ? 'active' : ''}`} onClick={() => { setShowAudioPanel((v) => !v); setShowSourcesPanel(false); }} title="Audio Track">
                                <Music size={20} />
                            </button>
                        )}
                        <button className={`delulu-btn ${isPiP ? 'active' : ''}`} onClick={togglePiP} title="Picture in Picture"><PictureInPicture size={20} /></button>
                        {showQualitySelector && isHLS && qualities.length > 0 && (
                            <button className="delulu-btn" onClick={() => setShowSettings(!showSettings)}>
                                <Settings size={20} />
                                <span className="delulu-quality-badge">{currentQuality === -1 ? 'Auto' : `${qualities.find(q => q.index === currentQuality)?.height || 0}p`}</span>
                            </button>
                        )}
                        <button className="delulu-btn" onClick={toggleFullscreen}>{isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}</button>
                    </div>
                </div>
            </div>

            {showSettings && (
                <div ref={settingsPanelRef} className="delulu-panel delulu-settings-panel">
                    <div className="delulu-panel-header"><span>Quality</span><button onClick={() => setShowSettings(false)}><X size={18} /></button></div>
                    <div
                        ref={subtitleOptionsRef}
                        className="delulu-panel-options delulu-panel-options-subtitles"
                        data-lenis-prevent="true"
                        onScroll={(e) => {
                            subtitleOptionsScrollTopRef.current = e.currentTarget.scrollTop;
                        }}
                    >
                        <button className={`delulu-option ${currentQuality === -1 ? 'active' : ''}`} onClick={() => handleQualityChange(-1)}><span>Auto</span>{currentQuality === -1 && <Check size={16} />}</button>
                        {qualities.map((q) => (<button key={q.index} className={`delulu-option ${currentQuality === q.index ? 'active' : ''}`} onClick={() => handleQualityChange(q.index)}><span>{q.height}p</span>{currentQuality === q.index && <Check size={16} />}</button>))}
                    </div>
                </div>
            )}

            {showSubtitleSettings && (
                <div ref={subtitlePanelRef} className="delulu-panel delulu-subtitle-panel">
                    <div className="delulu-panel-header"><span>Subtitles</span><button onClick={() => setShowSubtitleSettings(false)}><X size={18} /></button></div>
                    <div className="delulu-panel-options" data-lenis-prevent="true">
                        <button className={`delulu-option ${activeSubtitle === -1 ? 'active' : ''}`} onClick={() => handleSubtitleChange(-1)}><span>Off</span>{activeSubtitle === -1 && <Check size={16} />}</button>
                        {subtitles.map((sub, index) => (<button key={index} className={`delulu-option ${activeSubtitle === index ? 'active' : ''}`} onClick={() => handleSubtitleChange(index)}><span>{sub.label}</span>{activeSubtitle === index && <Check size={16} />}</button>))}
                    </div>
                    {activeSubtitle >= 0 && (
                        <div className="delulu-subtitle-customize">
                            <div className="delulu-customize-row">
                                <label>Font Size</label>
                                <input
                                    type="range"
                                    min="14"
                                    max="60"
                                    value={subtitleSettings.fontSize}
                                    onChange={(e) => setSubtitleSettings(s => ({
                                        ...s,
                                        fontSize: parseInt(e.target.value)
                                    }))}
                                />
                                <span>{subtitleSettings.fontSize}px</span>
                            </div>
                            <div className="delulu-customize-row">
                                <label>Background</label>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={subtitleSettings.bgOpacity}
                                    onChange={(e) => setSubtitleSettings(s => ({
                                        ...s,
                                        bgOpacity: parseFloat(e.target.value)
                                    }))}
                                />
                                <span>{Math.round(subtitleSettings.bgOpacity * 100)}%</span>
                            </div>
                        </div>
                    )}
                </div>
            )}
            {showSourcesPanel && allSources && allSources.length > 1 && (
                <div className="delulu-panel delulu-sources-panel">
                    <div className="delulu-panel-header"><span>Sources</span><button onClick={() => setShowSourcesPanel(false)}><X size={18} /></button></div>
                    <div className="delulu-panel-options" data-lenis-prevent="true">
                        {allSources.map((source) => {
                            const isActive = source.addonId === sourceAddonId;
                            return (
                                <button
                                    key={source.addonId}
                                    className={`delulu-option ${isActive ? 'active' : ''}`}
                                    onClick={() => {
                                        if (!isActive && onSourceSwitch) {
                                            onSourceSwitch(source, buildSwitchContext());
                                            setShowSourcesPanel(false);
                                        }
                                    }}
                                >
                                    <span className="delulu-source-label">
                                        <strong>{source.addonName}</strong>
                                        <span className="delulu-source-meta">{source.latencyMs}ms</span>
                                    </span>
                                    {isActive && <Check size={16} />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {showAudioPanel && audioOptions.length > 1 && (
                <div className="delulu-panel delulu-audio-panel">
                    <div className="delulu-panel-header"><span>Audio</span><button onClick={() => setShowAudioPanel(false)}><X size={18} /></button></div>
                    <div className="delulu-panel-options" data-lenis-prevent="true">
                        {audioOptions.map(({ audioName, bestQuality, bestUrl }) => {
                            const isPlaying = src === bestUrl;
                            return (
                                <button
                                    key={audioName}
                                    className={`delulu-option ${isPlaying ? 'active' : ''}`}
                                    onClick={() => {
                                        if (!isPlaying && onSourceSwitch && sourceAddonId) {
                                            const currentSource = allSources?.find(s => s.addonId === sourceAddonId);
                                            if (currentSource) {
                                                onSourceSwitch({ ...currentSource, streamUrl: bestUrl }, buildSwitchContext());
                                                setShowAudioPanel(false);
                                            }
                                        }
                                    }}
                                >
                                    <span className="delulu-source-label">
                                        <strong>{audioName}</strong>
                                        <span className="delulu-source-meta">{bestQuality}</span>
                                    </span>
                                    {isPlaying && <Check size={16} />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

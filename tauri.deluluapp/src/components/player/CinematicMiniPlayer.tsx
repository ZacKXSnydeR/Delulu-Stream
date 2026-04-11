import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Pause, Play, X } from 'lucide-react';
import './CinematicMiniPlayer.css';

export interface CinematicMiniPlayerProps {
    visible: boolean;
    embedded?: boolean;
    title: string;
    thumbnailUrl: string;
    currentTimeLabel: string;
    remainingTimeLabel?: string;
    progress: number; // 0..1
    isPaused: boolean;
    onTogglePlay: () => void;
    onExpand: () => void;
    onClose: () => void;
    onFullscreen: () => void;
    onExited?: () => void;
    width?: number; // default 400
    height?: number; // default 204
    initialRight?: number; // default 28
    initialBottom?: number; // default 28
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function CinematicMiniPlayer({
    visible,
    embedded = false,
    title,
    thumbnailUrl,
    currentTimeLabel,
    remainingTimeLabel,
    progress,
    isPaused,
    onTogglePlay,
    onExpand,
    onClose,
    onFullscreen,
    onExited,
    width = 400,
    height = 204,
    initialRight = 28,
    initialBottom = 28,
}: CinematicMiniPlayerProps) {
    const [rendered, setRendered] = useState(visible);
    const [leaving, setLeaving] = useState(false);

    const cardRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (embedded) {
            setRendered(visible);
            setLeaving(false);
            return;
        }
        if (visible) {
            setRendered(true);
            setLeaving(false);
            return;
        }
        if (!rendered) return;
        setLeaving(true);
        const timer = window.setTimeout(() => {
            setRendered(false);
            setLeaving(false);
            onExited?.();
        }, 220);
        return () => window.clearTimeout(timer);
    }, [visible, rendered, onExited, embedded]);

    const progressPercent = useMemo(() => `${clamp(progress, 0, 1) * 100}%`, [progress]);

    if (!rendered) return null;

    return (
        <div
            ref={cardRef}
            className={`cinematic-mini-player ${embedded ? 'embedded' : ''} ${leaving ? 'leave' : 'enter'} ${isPaused ? 'paused' : ''}`}
            style={embedded ? undefined : { width, height, right: initialRight, bottom: initialBottom }}
            onClick={onExpand}
            role="button"
            aria-label={`Resume ${title}`}
            tabIndex={0}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onExpand();
                }
            }}
        >
            <div className="mini-video-surface" style={embedded ? undefined : { backgroundImage: `url(${thumbnailUrl})` }}>
                <div className="mini-video-overlay" />

                <div className="mini-title">{title}</div>

                <div className="mini-actions">
                    <button
                        type="button"
                        className="mini-action-btn"
                        onClick={(event) => {
                            event.stopPropagation();
                            onTogglePlay();
                        }}
                        aria-label={isPaused ? 'Play' : 'Pause'}
                    >
                        {isPaused ? <Play size={13} strokeWidth={1.8} /> : <Pause size={13} strokeWidth={1.8} />}
                    </button>
                    <button
                        type="button"
                        className="mini-action-btn"
                        onClick={(event) => {
                            event.stopPropagation();
                            onFullscreen();
                        }}
                        aria-label="Fullscreen"
                    >
                        <Maximize2 size={13} strokeWidth={1.8} />
                    </button>
                    <button
                        type="button"
                        className="mini-action-btn close"
                        onClick={(event) => {
                            event.stopPropagation();
                            onClose();
                        }}
                        aria-label="Close mini player"
                    >
                        <X size={13} strokeWidth={1.8} />
                    </button>
                </div>

                <button
                    type="button"
                    className="mini-center-play"
                    onClick={(event) => {
                        event.stopPropagation();
                        onTogglePlay();
                    }}
                    aria-label={isPaused ? 'Play' : 'Pause'}
                >
                    {isPaused ? <Play size={16} strokeWidth={2} /> : <Pause size={16} strokeWidth={2} />}
                </button>

                <div className="mini-time">{currentTimeLabel}</div>
                {remainingTimeLabel && <div className="mini-remaining">{remainingTimeLabel}</div>}
                <div className="mini-progress-track">
                    <div className="mini-progress-fill" style={{ width: progressPercent }} />
                </div>
            </div>
        </div>
    );
}

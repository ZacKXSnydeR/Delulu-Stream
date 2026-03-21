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
    const [position, setPosition] = useState({ right: initialRight, bottom: initialBottom });
    const [isDragging, setIsDragging] = useState(false);

    const cardRef = useRef<HTMLDivElement | null>(null);
    const dragStart = useRef({ x: 0, y: 0 });
    const origin = useRef({ right: initialRight, bottom: initialBottom });

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

    useEffect(() => {
        if (embedded) return;
        const onMove = (event: MouseEvent) => {
            if (!isDragging) return;
            const dx = event.clientX - dragStart.current.x;
            const dy = event.clientY - dragStart.current.y;
            const maxRight = Math.max(12, window.innerWidth - width - 12);
            const maxBottom = Math.max(12, window.innerHeight - height - 12);
            setPosition({
                right: clamp(origin.current.right - dx, 12, maxRight),
                bottom: clamp(origin.current.bottom - dy, 12, maxBottom),
            });
        };
        const onUp = () => setIsDragging(false);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    }, [isDragging, width, height, embedded]);

    const handleDragStart = (event: React.MouseEvent<HTMLDivElement>) => {
        if (embedded) return;
        if (event.button !== 0) return;
        const target = event.target as HTMLElement;
        if (target.closest('button')) return;
        setIsDragging(true);
        dragStart.current = { x: event.clientX, y: event.clientY };
        origin.current = { ...position };
    };

    const progressPercent = useMemo(() => `${clamp(progress, 0, 1) * 100}%`, [progress]);

    if (!rendered) return null;

    return (
        <div
            ref={cardRef}
            className={`cinematic-mini-player ${embedded ? 'embedded' : ''} ${leaving ? 'leave' : 'enter'} ${isDragging ? 'dragging' : ''} ${isPaused ? 'paused' : ''}`}
            style={embedded ? undefined : { width, height, right: position.right, bottom: position.bottom }}
            onMouseDown={handleDragStart}
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

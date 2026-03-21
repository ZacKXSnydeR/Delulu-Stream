import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { useGesture } from '@use-gesture/react';

interface ImageItem {
    src: string;
    alt: string;
    id?: number;
    type?: 'movie' | 'tv';
}

interface DomeGalleryProps {
    images?: ImageItem[];
    fit?: number;
    fitBasis?: 'auto' | 'min' | 'max' | 'width' | 'height';
    minRadius?: number;
    maxRadius?: number;
    padFactor?: number;
    overlayBlurColor?: string;
    maxVerticalRotationDeg?: number;
    dragSensitivity?: number;
    segments?: number;
    dragDampening?: number;
    imageBorderRadius?: string;
    grayscale?: boolean;
    onImageClick?: (image: ImageItem) => void;
}

const DEFAULTS = {
    maxVerticalRotationDeg: 5,
    dragSensitivity: 20,
    segments: 35
};

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const wrapAngleSigned = (deg: number) => {
    const a = (((deg + 180) % 360) + 360) % 360;
    return a - 180;
};

interface DomeItem {
    x: number;
    y: number;
    sizeX: number;
    sizeY: number;
    src: string;
    alt: string;
    id?: number;
    type?: 'movie' | 'tv';
}

function buildItems(pool: ImageItem[], seg: number): DomeItem[] {
    const xCols = Array.from({ length: seg }, (_, i) => -37 + i * 2);
    const evenYs = [-4, -2, 0, 2, 4];
    const oddYs = [-3, -1, 1, 3, 5];

    const coords = xCols.flatMap((x, c) => {
        const ys = c % 2 === 0 ? evenYs : oddYs;
        return ys.map(y => ({ x, y, sizeX: 2, sizeY: 2 }));
    });

    const totalSlots = coords.length;
    if (pool.length === 0) {
        return coords.map(c => ({ ...c, src: '', alt: '', id: undefined, type: undefined }));
    }

    const normalizedImages = pool.map(image => {
        if (typeof image === 'string') {
            return { src: image, alt: '', id: undefined, type: undefined };
        }
        return { src: image.src || '', alt: image.alt || '', id: image.id, type: image.type };
    });

    const usedImages = Array.from({ length: totalSlots }, (_, i) => normalizedImages[i % normalizedImages.length]);

    for (let i = 1; i < usedImages.length; i++) {
        if (usedImages[i].src === usedImages[i - 1].src) {
            for (let j = i + 1; j < usedImages.length; j++) {
                if (usedImages[j].src !== usedImages[i].src) {
                    const tmp = usedImages[i];
                    usedImages[i] = usedImages[j];
                    usedImages[j] = tmp;
                    break;
                }
            }
        }
    }

    return coords.map((c, i) => ({
        ...c,
        src: usedImages[i].src,
        alt: usedImages[i].alt,
        id: usedImages[i].id,
        type: usedImages[i].type
    }));
}

// Individual poster with loading skeleton
function DomePoster({ src, alt, grayscale }: { src: string; alt: string; grayscale: boolean }) {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);

    return (
        <>
            {/* Skeleton shown while loading */}
            {!loaded && !error && (
                <div className="dome-item-skeleton" />
            )}
            {/* Actual image - pointer-events-none so parent handles clicks */}
            <img
                src={src}
                draggable={false}
                alt={alt}
                className="dome-item-img"
                style={{
                    filter: grayscale ? 'grayscale(1)' : 'none',
                    opacity: loaded ? 1 : 0,
                    transition: 'opacity 0.3s ease',
                    pointerEvents: 'none'
                }}
                onLoad={() => setLoaded(true)}
                onError={() => setError(true)}
            />
        </>
    );
}

export function DomeGallery({
    images = [],
    fit = 0.5,
    fitBasis = 'auto',
    minRadius = 600,
    maxRadius = Infinity,
    padFactor = 0.25,
    overlayBlurColor = '#000000',
    maxVerticalRotationDeg = DEFAULTS.maxVerticalRotationDeg,
    dragSensitivity = DEFAULTS.dragSensitivity,
    segments = DEFAULTS.segments,
    dragDampening = 2,
    imageBorderRadius = '16px',
    grayscale = false,
    onImageClick
}: DomeGalleryProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const mainRef = useRef<HTMLElement>(null);
    const sphereRef = useRef<HTMLDivElement>(null);

    const rotationRef = useRef({ x: 0, y: 0 });
    const startRotRef = useRef({ x: 0, y: 0 });
    const startPosRef = useRef<{ x: number; y: number } | null>(null);
    const draggingRef = useRef(false);
    const movedRef = useRef(false);
    const inertiaRAF = useRef<number | null>(null);
    const pointerTypeRef = useRef('mouse');
    const lastDragEndAt = useRef(0);

    const scrollLockedRef = useRef(false);
    const lockScroll = useCallback(() => {
        if (scrollLockedRef.current) return;
        scrollLockedRef.current = true;
        document.body.classList.add('dg-scroll-lock');
    }, []);
    const unlockScroll = useCallback(() => {
        if (!scrollLockedRef.current) return;
        scrollLockedRef.current = false;
        document.body.classList.remove('dg-scroll-lock');
    }, []);

    const items = useMemo(() => buildItems(images, segments), [images, segments]);

    const applyTransform = (xDeg: number, yDeg: number) => {
        const el = sphereRef.current;
        if (el) {
            el.style.transform = `translateZ(calc(var(--radius) * -1)) rotateX(${xDeg}deg) rotateY(${yDeg}deg)`;
        }
    };

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const ro = new ResizeObserver(entries => {
            const cr = entries[0].contentRect;
            const w = Math.max(1, cr.width),
                h = Math.max(1, cr.height);
            const minDim = Math.min(w, h),
                maxDim = Math.max(w, h),
                aspect = w / h;
            let basis;
            switch (fitBasis) {
                case 'min':
                    basis = minDim;
                    break;
                case 'max':
                    basis = maxDim;
                    break;
                case 'width':
                    basis = w;
                    break;
                case 'height':
                    basis = h;
                    break;
                default:
                    basis = aspect >= 1.3 ? w : minDim;
            }
            let radius = basis * fit;
            const heightGuard = h * 1.35;
            radius = Math.min(radius, heightGuard);
            radius = clamp(radius, minRadius, maxRadius);

            const viewerPad = Math.max(8, Math.round(minDim * padFactor));
            root.style.setProperty('--radius', `${Math.round(radius)}px`);
            root.style.setProperty('--viewer-pad', `${viewerPad}px`);
            root.style.setProperty('--overlay-blur-color', overlayBlurColor);
            root.style.setProperty('--tile-radius', imageBorderRadius);
            root.style.setProperty('--image-filter', grayscale ? 'grayscale(1)' : 'none');
            applyTransform(rotationRef.current.x, rotationRef.current.y);
        });
        ro.observe(root);
        return () => ro.disconnect();
    }, [fit, fitBasis, minRadius, maxRadius, padFactor, overlayBlurColor, grayscale, imageBorderRadius]);

    useEffect(() => {
        applyTransform(rotationRef.current.x, rotationRef.current.y);
    }, []);

    const stopInertia = useCallback(() => {
        if (inertiaRAF.current) {
            cancelAnimationFrame(inertiaRAF.current);
            inertiaRAF.current = null;
        }
    }, []);

    const startInertia = useCallback(
        (vx: number, vy: number) => {
            const MAX_V = 1.2; // Lower max velocity for smoother feel
            let vX = clamp(vx, -MAX_V, MAX_V) * 60; // Reduced initial velocity
            let vY = clamp(vy, -MAX_V, MAX_V) * 60;
            let frames = 0;
            const d = clamp(dragDampening ?? 2, 0, 3);
            // Higher friction multiplier = slower, smoother deceleration
            const frictionMul = 0.97 + 0.01 * d; // Was 0.94, now 0.97 for smoother glide
            const stopThreshold = 0.008; // Lower threshold = longer glide
            const maxFrames = Math.round(200 + 300 * d); // More frames = longer animation

            const step = () => {
                // Apply smooth exponential friction
                vX *= frictionMul;
                vY *= frictionMul;

                if (Math.abs(vX) < stopThreshold && Math.abs(vY) < stopThreshold) {
                    inertiaRAF.current = null;
                    return;
                }
                if (++frames > maxFrames) {
                    inertiaRAF.current = null;
                    return;
                }
                const nextX = clamp(rotationRef.current.x - vY / 200, -maxVerticalRotationDeg, maxVerticalRotationDeg);
                const nextY = wrapAngleSigned(rotationRef.current.y + vX / 200);
                rotationRef.current = { x: nextX, y: nextY };
                applyTransform(nextX, nextY);
                inertiaRAF.current = requestAnimationFrame(step);
            };
            stopInertia();
            inertiaRAF.current = requestAnimationFrame(step);
        },
        [dragDampening, maxVerticalRotationDeg, stopInertia]
    );

    useGesture(
        {
            onDragStart: ({ event }) => {
                stopInertia();

                const pointerEvent = event as PointerEvent;
                pointerTypeRef.current = pointerEvent.pointerType || 'mouse';
                if (pointerTypeRef.current === 'touch') event.preventDefault();
                if (pointerTypeRef.current === 'touch') lockScroll();
                draggingRef.current = true;
                movedRef.current = false;
                startRotRef.current = { ...rotationRef.current };
                startPosRef.current = { x: pointerEvent.clientX, y: pointerEvent.clientY };
            },
            onDrag: ({ event, last, velocity: velArr = [0, 0], direction: dirArr = [0, 0], movement }) => {
                if (!draggingRef.current || !startPosRef.current) return;

                const pointerEvent = event as PointerEvent;
                if (pointerTypeRef.current === 'touch') event.preventDefault();

                const dxTotal = pointerEvent.clientX - startPosRef.current.x;
                const dyTotal = pointerEvent.clientY - startPosRef.current.y;

                if (!movedRef.current) {
                    const dist2 = dxTotal * dxTotal + dyTotal * dyTotal;
                    if (dist2 > 16) movedRef.current = true;
                }

                const nextX = clamp(
                    startRotRef.current.x - dyTotal / dragSensitivity,
                    -maxVerticalRotationDeg,
                    maxVerticalRotationDeg
                );
                const nextY = startRotRef.current.y + dxTotal / dragSensitivity;

                const cur = rotationRef.current;
                if (cur.x !== nextX || cur.y !== nextY) {
                    rotationRef.current = { x: nextX, y: nextY };
                    applyTransform(nextX, nextY);
                }

                if (last) {
                    draggingRef.current = false;
                    let isTap = false;

                    if (startPosRef.current) {
                        const dx = pointerEvent.clientX - startPosRef.current.x;
                        const dy = pointerEvent.clientY - startPosRef.current.y;
                        const dist2 = dx * dx + dy * dy;
                        const TAP_THRESH_PX = pointerTypeRef.current === 'touch' ? 10 : 6;
                        if (dist2 <= TAP_THRESH_PX * TAP_THRESH_PX) {
                            isTap = true;
                        }
                    }

                    let [vMagX, vMagY] = velArr;
                    const [dirX, dirY] = dirArr;
                    let vx = vMagX * dirX;
                    let vy = vMagY * dirY;

                    if (!isTap && Math.abs(vx) < 0.001 && Math.abs(vy) < 0.001 && Array.isArray(movement)) {
                        const [mx, my] = movement;
                        vx = (mx / dragSensitivity) * 0.02;
                        vy = (my / dragSensitivity) * 0.02;
                    }

                    if (!isTap && (Math.abs(vx) > 0.005 || Math.abs(vy) > 0.005)) {
                        startInertia(vx, vy);
                    }
                    startPosRef.current = null;

                    if (movedRef.current) lastDragEndAt.current = performance.now();
                    movedRef.current = false;
                    if (pointerTypeRef.current === 'touch') unlockScroll();
                }
            }
        },
        { target: mainRef, eventOptions: { passive: false } }
    );

    useEffect(() => {
        return () => {
            document.body.classList.remove('dg-scroll-lock');
        };
    }, []);

    const handlePosterClick = useCallback((item: DomeItem) => {
        if (onImageClick && item.id && item.type) {
            onImageClick({ src: item.src, alt: item.alt, id: item.id, type: item.type });
        }
    }, [onImageClick]);

    return (
        <div
            ref={rootRef}
            className="dome-gallery-root"
            style={{
                ['--segments-x' as string]: segments,
                ['--segments-y' as string]: segments,
                ['--overlay-blur-color' as string]: overlayBlurColor,
                ['--tile-radius' as string]: imageBorderRadius,
                ['--image-filter' as string]: grayscale ? 'grayscale(1)' : 'none'
            }}
        >
            <main
                ref={mainRef}
                className="dome-gallery-main"
                style={{ touchAction: 'none', WebkitUserSelect: 'none' }}
            >
                <div className="dome-stage">
                    <div ref={sphereRef} className="dome-sphere">
                        {items.map((it, i) => (
                            <div
                                key={`${it.x},${it.y},${i}`}
                                className="dome-item"
                                style={{
                                    ['--offset-x' as string]: it.x,
                                    ['--offset-y' as string]: it.y,
                                    ['--item-size-x' as string]: it.sizeX,
                                    ['--item-size-y' as string]: it.sizeY
                                }}
                            >
                                <div
                                    className="dome-item-image"
                                    role="button"
                                    tabIndex={0}
                                    aria-label={it.alt || 'Open image'}
                                    onClick={() => {
                                        if (draggingRef.current) return;
                                        if (movedRef.current) return;
                                        if (performance.now() - lastDragEndAt.current < 80) return;
                                        handlePosterClick(it);
                                    }}
                                    onPointerUp={e => {
                                        if (e.pointerType !== 'touch') return;
                                        if (draggingRef.current) return;
                                        if (movedRef.current) return;
                                        if (performance.now() - lastDragEndAt.current < 80) return;
                                        handlePosterClick(it);
                                    }}
                                >
                                    <DomePoster src={it.src} alt={it.alt} grayscale={grayscale} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Edge blur overlays */}
                <div className="dome-overlay dome-overlay-radial" />
                <div className="dome-overlay dome-overlay-blur" />
                <div className="dome-overlay dome-overlay-top" />
                <div className="dome-overlay dome-overlay-bottom" />
            </main>
        </div>
    );
}


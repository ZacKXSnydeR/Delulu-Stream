import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    type TMDBContent,
    getBackdropUrl,
    getPosterUrl,
    getTitle,
    getReleaseYear,
    getMediaType,
    prefetchDetailsBundle,
} from '../../services/tmdb';
import { useAddons } from '../../context/AddonContext';
import './HeroCarousel.css';

interface HeroCarouselProps {
    items: TMDBContent[];
    autoPlayInterval?: number;
}

interface HeroCarouselCacheState {
    signature: string;
    currentIndex: number;
    typedTitle: string;
    typedOverview: string;
    showMeta: boolean;
}

let cachedHeroCarouselState: HeroCarouselCacheState | null = null;

function getHeroBackground(item: TMDBContent): string {
    if (item.backdrop_path) return getBackdropUrl(item.backdrop_path, 'original');
    if (item.poster_path) return getPosterUrl(item.poster_path, 'large');
    return '';
}

export function HeroCarousel({ items, autoPlayInterval = 8000 }: HeroCarouselProps) {
    const itemsSignature = items.map((item) => `${getMediaType(item)}-${item.id}`).join('|');
    const hasValidCache =
        !!cachedHeroCarouselState &&
        cachedHeroCarouselState.signature === itemsSignature &&
        cachedHeroCarouselState.currentIndex >= 0 &&
        cachedHeroCarouselState.currentIndex < items.length;
    const [currentIndex, setCurrentIndex] = useState(hasValidCache ? cachedHeroCarouselState!.currentIndex : 0);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [transitionFromIndex, setTransitionFromIndex] = useState<number | null>(null);
    const [transitionToIndex, setTransitionToIndex] = useState<number | null>(null);
    const [transitionDirection, setTransitionDirection] = useState<'next' | 'prev'>('next');

    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const titleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const overviewIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const typingCompleteRef = useRef(true);
    const typingUnlockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const typingDeadlineRef = useRef(0);

    const navigate = useNavigate();

    // Addon awareness — shows "Play Now" only when an addon is active
    const { hasAddon } = useAddons();

    // Swipe gesture state
    const [dragStart, setDragStart] = useState<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const activeIndex = isTransitioning && transitionToIndex !== null ? transitionToIndex : currentIndex;
    const activeItem = items[activeIndex];
    const activeMediaType = activeItem ? getMediaType(activeItem) : null;
    const activeRatingNumber = Number(activeItem?.vote_average);
    const activeRatingText = Number.isFinite(activeRatingNumber) ? activeRatingNumber.toFixed(1) : 'N/A';

    // Typewriter text state
    const [typedTitle, setTypedTitle] = useState(hasValidCache ? cachedHeroCarouselState!.typedTitle : '');
    const [typedOverview, setTypedOverview] = useState(hasValidCache ? cachedHeroCarouselState!.typedOverview : '');
    const [showMeta, setShowMeta] = useState(hasValidCache ? cachedHeroCarouselState!.showMeta : false);

    const TRANSITION_MS = 1000;
    const TITLE_TYPE_MS = 42;
    const OVERVIEW_TYPE_MS = 18;

    useEffect(() => {
        if (!activeItem || items.length === 0) return;

        prefetchDetailsBundle(getMediaType(activeItem), activeItem.id);

        const nextIndex = (activeIndex + 1) % items.length;
        const nextItem = items[nextIndex];
        if (nextItem) {
            prefetchDetailsBundle(getMediaType(nextItem), nextItem.id);
        }
    }, [activeIndex, activeItem, items]);

    useEffect(() => {
        if (!items.length) return;
        cachedHeroCarouselState = {
            signature: itemsSignature,
            currentIndex,
            typedTitle,
            typedOverview,
            showMeta,
        };
    }, [items.length, itemsSignature, currentIndex, typedTitle, typedOverview, showMeta]);

    // ── Auto-advance ──────────────────────────────────────────────
    useEffect(() => {
        if (items.length <= 1) return;

        intervalRef.current = setInterval(() => {
            if (isTransitioning) return;
            if (!typingCompleteRef.current && Date.now() < typingDeadlineRef.current) return;
            handleNext();
        }, autoPlayInterval);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [currentIndex, items.length, autoPlayInterval, isTransitioning]);

    // ── Global cleanup on unmount ─────────────────────────────────
    useEffect(() => {
        return () => {
            if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
            if (transitionTimeoutRef.current) { clearTimeout(transitionTimeoutRef.current); transitionTimeoutRef.current = null; }
            if (titleIntervalRef.current) { clearInterval(titleIntervalRef.current); titleIntervalRef.current = null; }
            if (overviewIntervalRef.current) { clearInterval(overviewIntervalRef.current); overviewIntervalRef.current = null; }
            if (revealTimeoutRef.current) { clearTimeout(revealTimeoutRef.current); revealTimeoutRef.current = null; }
            if (typingUnlockTimeoutRef.current) { clearTimeout(typingUnlockTimeoutRef.current); typingUnlockTimeoutRef.current = null; }
        };
    }, []);

    // ── Typewriter effect ─────────────────────────────────────────
    useEffect(() => {
        if (!activeItem) return;

        const fullTitle = getTitle(activeItem);
        const fullOverview = activeItem.overview.length > 200
            ? `${activeItem.overview.substring(0, 200)}...`
            : activeItem.overview;

        const cachedForCurrentItem =
            hasValidCache &&
            cachedHeroCarouselState?.currentIndex === activeIndex &&
            cachedHeroCarouselState?.typedTitle === fullTitle &&
            cachedHeroCarouselState?.typedOverview === fullOverview &&
            cachedHeroCarouselState?.showMeta;

        if (cachedForCurrentItem) {
            typingCompleteRef.current = true;
            setTypedTitle(fullTitle);
            setTypedOverview(fullOverview);
            setShowMeta(true);
            return;
        }

        if (titleIntervalRef.current) clearInterval(titleIntervalRef.current);
        if (overviewIntervalRef.current) clearInterval(overviewIntervalRef.current);
        if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
        if (typingUnlockTimeoutRef.current) clearTimeout(typingUnlockTimeoutRef.current);

        setTypedTitle('');
        setTypedOverview('');
        setShowMeta(false);
        typingCompleteRef.current = false;

        const expectedTitleMs = fullTitle.length * TITLE_TYPE_MS;
        const expectedOverviewMs = Math.ceil(fullOverview.length / 2) * OVERVIEW_TYPE_MS;
        const expectedTotalMs = expectedTitleMs + 120 + expectedOverviewMs + 300;
        const maxBlockMs = Math.max(2200, Math.min(expectedTotalMs, 5600));
        typingDeadlineRef.current = Date.now() + maxBlockMs;
        typingUnlockTimeoutRef.current = setTimeout(() => {
            typingCompleteRef.current = true;
            typingUnlockTimeoutRef.current = null;
        }, maxBlockMs);

        let titleCursor = 0;
        titleIntervalRef.current = setInterval(() => {
            titleCursor += 1;
            setTypedTitle(fullTitle.slice(0, titleCursor));

            if (titleCursor >= fullTitle.length) {
                if (titleIntervalRef.current) { clearInterval(titleIntervalRef.current); titleIntervalRef.current = null; }
                setShowMeta(true);

                revealTimeoutRef.current = setTimeout(() => {
                    let overviewCursor = 0;
                    overviewIntervalRef.current = setInterval(() => {
                        overviewCursor += 2;
                        setTypedOverview(fullOverview.slice(0, overviewCursor));

                        if (overviewCursor >= fullOverview.length) {
                            if (overviewIntervalRef.current) { clearInterval(overviewIntervalRef.current); overviewIntervalRef.current = null; }
                            typingCompleteRef.current = true;
                            if (typingUnlockTimeoutRef.current) { clearTimeout(typingUnlockTimeoutRef.current); typingUnlockTimeoutRef.current = null; }
                        }
                    }, OVERVIEW_TYPE_MS);
                }, 120);
            }
        }, TITLE_TYPE_MS);

        return () => {
            if (titleIntervalRef.current) clearInterval(titleIntervalRef.current);
            if (overviewIntervalRef.current) clearInterval(overviewIntervalRef.current);
            if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
            if (typingUnlockTimeoutRef.current) clearTimeout(typingUnlockTimeoutRef.current);
        };
    }, [activeIndex, activeItem]);

    // ── Slide transition ──────────────────────────────────────────
    const startSlideTransition = (direction: 'next' | 'prev') => {
        if (isTransitioning || items.length <= 1) return;

        const fromIndex = currentIndex;
        const toIndex =
            direction === 'next'
                ? (currentIndex + 1) % items.length
                : (currentIndex - 1 + items.length) % items.length;

        setTransitionDirection(direction);
        setTransitionFromIndex(fromIndex);
        setTransitionToIndex(toIndex);
        setIsTransitioning(true);

        transitionTimeoutRef.current = setTimeout(() => {
            setCurrentIndex(toIndex);
            setTransitionFromIndex(null);
            setTransitionToIndex(null);
            setIsTransitioning(false);
            transitionTimeoutRef.current = null;
        }, TRANSITION_MS);
    };

    const handleNext = () => startSlideTransition('next');
    const handlePrev = () => startSlideTransition('prev');

    // ── Swipe / drag handlers ─────────────────────────────────────
    const handleDragStart = (clientX: number) => {
        setDragStart(clientX);
        setIsDragging(true);
        if (intervalRef.current) clearInterval(intervalRef.current);
    };

    const handleDragEnd = (clientX: number) => {
        if (dragStart === null) return;
        const diff = dragStart - clientX;
        if (Math.abs(diff) > 50) {
            diff > 0 ? handleNext() : handlePrev();
        }
        setDragStart(null);
        setIsDragging(false);
    };

    const handleMouseDown = (e: React.MouseEvent) => handleDragStart(e.clientX);
    const handleMouseUp = (e: React.MouseEvent) => handleDragEnd(e.clientX);
    const handleMouseLeave = () => {
        if (isDragging && dragStart !== null) { setDragStart(null); setIsDragging(false); }
    };
    const handleTouchStart = (e: React.TouchEvent) => handleDragStart(e.touches[0].clientX);
    const handleTouchEnd = (e: React.TouchEvent) => {
        if (e.changedTouches.length > 0) handleDragEnd(e.changedTouches[0].clientX);
    };

    const handlePlayClick = () => navigate(`/details/${getMediaType(activeItem)}/${activeItem.id}`);
    const handleMoreInfoClick = () => navigate(`/details/${getMediaType(activeItem)}/${activeItem.id}`);

    if (!activeItem) return null;

    return (
        <div
            className={`hero-carousel ${isDragging ? 'hero-carousel-dragging' : ''}`}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {/* ── Backdrop images (same slide logic, same class names) ── */}
            {!isTransitioning && (
                <div
                    key={`hero-backdrop-static-${currentIndex}`}
                    className="hero-backdrop hero-backdrop-static"
                    style={{ backgroundImage: `url(${getHeroBackground(activeItem)})` }}
                />
            )}

            {isTransitioning && transitionFromIndex !== null && transitionToIndex !== null && (
                <>
                    <div
                        key={`hero-backdrop-exit-${transitionFromIndex}`}
                        className={`hero-backdrop hero-backdrop-slide hero-backdrop-exit hero-backdrop-${transitionDirection}`}
                        style={{ backgroundImage: `url(${getHeroBackground(items[transitionFromIndex])})` }}
                    />
                    <div
                        key={`hero-backdrop-enter-${transitionToIndex}`}
                        className={`hero-backdrop hero-backdrop-slide hero-backdrop-enter hero-backdrop-${transitionDirection}`}
                        style={{ backgroundImage: `url(${getHeroBackground(items[transitionToIndex])})` }}
                    />
                </>
            )}

            {/* ── Gradient overlays ── */}
            <div className="hero-gradient" />
            <div className="hero-gradient-bottom" />

            {/* ── Content ── */}
            <div className="hero-content">
                <div className="hero-eyebrow">
                    <span className="hero-eyebrow-text">
                        Featured {activeMediaType === 'movie' ? 'Movie' : 'Series'}
                    </span>
                    <span className="hero-eyebrow-line" />
                </div>

                <h1 className="hero-title">{typedTitle}</h1>

                <div className={`hero-meta hero-text-reveal ${showMeta ? 'is-visible' : ''}`}>
                    <span className="hero-rating">
                        <span className="hero-rating-star">*</span>
                        {activeRatingText}
                    </span>
                    <span className="hero-meta-dot" />
                    <span className="hero-year">{getReleaseYear(activeItem)}</span>
                    <span className="hero-meta-dot" />
                    <span className="hero-type">
                        {activeMediaType === 'movie' ? 'MOVIE' : 'SERIES'}
                    </span>
                </div>

                <p className="hero-overview">{typedOverview}</p>

                <div className="hero-buttons">
                    {hasAddon && (
                        <button className="hero-btn-primary" onClick={handlePlayClick}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                            <span>Play Now</span>
                        </button>
                    )}
                    <button className="hero-btn-ghost" onClick={handleMoreInfoClick}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 8v4M12 16h.01" />
                        </svg>
                        More Info
                    </button>
                </div>
            </div>

            {/* ── Dot navigation ── */}
            {items.length > 1 && (
                <div className="hero-dots">
                    {items.map((_, i) => (
                        <button
                            key={i}
                            className={`hero-dot ${i === activeIndex ? 'hero-dot-active' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (i !== currentIndex && !isTransitioning) {
                                    const dir = i > currentIndex ? 'next' : 'prev';
                                    setTransitionDirection(dir);
                                    setTransitionFromIndex(currentIndex);
                                    setTransitionToIndex(i);
                                    setIsTransitioning(true);
                                    transitionTimeoutRef.current = setTimeout(() => {
                                        setCurrentIndex(i);
                                        setTransitionFromIndex(null);
                                        setTransitionToIndex(null);
                                        setIsTransitioning(false);
                                    }, TRANSITION_MS);
                                }
                            }}
                            aria-label={`Go to slide ${i + 1}`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}



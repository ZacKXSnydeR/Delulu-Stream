import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    type TMDBContent,
    getBackdropUrl,
    getTitle,
    getReleaseYear,
    getMediaType,
} from '../../services/tmdb';
import './HeroCarousel.css';

interface HeroCarouselProps {
    items: TMDBContent[];
    autoPlayInterval?: number;
}

export function HeroCarousel({ items, autoPlayInterval = 8000 }: HeroCarouselProps) {
    const [currentIndex, setCurrentIndex] = useState(0);
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

    // Swipe gesture state
    const [dragStart, setDragStart] = useState<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const activeIndex = isTransitioning && transitionToIndex !== null ? transitionToIndex : currentIndex;
    const activeItem = items[activeIndex];
    const activeMediaType = activeItem ? getMediaType(activeItem) : null;

    // Typewriter text state
    const [typedTitle, setTypedTitle] = useState('');
    const [typedOverview, setTypedOverview] = useState('');
    const [showMeta, setShowMeta] = useState(false);

    const TRANSITION_MS = 1000;
    const TITLE_TYPE_MS = 42;
    const OVERVIEW_TYPE_MS = 18;

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

    // Global cleanup on unmount only. Do not tie this to transition state.
    useEffect(() => {
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            if (transitionTimeoutRef.current) {
                clearTimeout(transitionTimeoutRef.current);
                transitionTimeoutRef.current = null;
            }
            if (titleIntervalRef.current) {
                clearInterval(titleIntervalRef.current);
                titleIntervalRef.current = null;
            }
            if (overviewIntervalRef.current) {
                clearInterval(overviewIntervalRef.current);
                overviewIntervalRef.current = null;
            }
            if (revealTimeoutRef.current) {
                clearTimeout(revealTimeoutRef.current);
                revealTimeoutRef.current = null;
            }
            if (typingUnlockTimeoutRef.current) {
                clearTimeout(typingUnlockTimeoutRef.current);
                typingUnlockTimeoutRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!activeItem) return;

        if (titleIntervalRef.current) clearInterval(titleIntervalRef.current);
        if (overviewIntervalRef.current) clearInterval(overviewIntervalRef.current);
        if (revealTimeoutRef.current) clearTimeout(revealTimeoutRef.current);
        if (typingUnlockTimeoutRef.current) clearTimeout(typingUnlockTimeoutRef.current);

        const fullTitle = getTitle(activeItem);
        const fullOverview = activeItem.overview.length > 200
            ? `${activeItem.overview.substring(0, 200)}...`
            : activeItem.overview;

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
                if (titleIntervalRef.current) {
                    clearInterval(titleIntervalRef.current);
                    titleIntervalRef.current = null;
                }
                setShowMeta(true);

                revealTimeoutRef.current = setTimeout(() => {
                    let overviewCursor = 0;
                    overviewIntervalRef.current = setInterval(() => {
                        overviewCursor += 2;
                        setTypedOverview(fullOverview.slice(0, overviewCursor));

                        if (overviewCursor >= fullOverview.length) {
                            if (overviewIntervalRef.current) {
                                clearInterval(overviewIntervalRef.current);
                                overviewIntervalRef.current = null;
                            }
                            typingCompleteRef.current = true;
                            if (typingUnlockTimeoutRef.current) {
                                clearTimeout(typingUnlockTimeoutRef.current);
                                typingUnlockTimeoutRef.current = null;
                            }
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

    const handleNext = () => {
        startSlideTransition('next');
    };

    const handlePrev = () => {
        startSlideTransition('prev');
    };

    // Swipe/Drag handlers
    const handleDragStart = (clientX: number) => {
        setDragStart(clientX);
        setIsDragging(true);
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }
    };

    const handleDragEnd = (clientX: number) => {
        if (dragStart === null) return;

        const diff = dragStart - clientX;
        const threshold = 50; // Minimum swipe distance

        if (Math.abs(diff) > threshold) {
            if (diff > 0) {
                handleNext(); // Swipe left -> next
            } else {
                handlePrev(); // Swipe right -> previous
            }
        }

        setDragStart(null);
        setIsDragging(false);
    };

    // Mouse events
    const handleMouseDown = (e: React.MouseEvent) => {
        handleDragStart(e.clientX);
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        handleDragEnd(e.clientX);
    };

    const handleMouseLeave = () => {
        if (isDragging && dragStart !== null) {
            setDragStart(null);
            setIsDragging(false);
        }
    };

    // Touch events
    const handleTouchStart = (e: React.TouchEvent) => {
        handleDragStart(e.touches[0].clientX);
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (e.changedTouches.length > 0) {
            handleDragEnd(e.changedTouches[0].clientX);
        }
    };

    const handlePlayClick = () => {
        const mediaType = getMediaType(activeItem);
        navigate(`/details/${mediaType}/${activeItem.id}`);
    };

    const handleMoreInfoClick = () => {
        const mediaType = getMediaType(activeItem);
        navigate(`/details/${mediaType}/${activeItem.id}`);
    };

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
            {!isTransitioning && (
                <div
                    key={`hero-backdrop-static-${currentIndex}`}
                    className="hero-backdrop hero-backdrop-static"
                    style={{
                        backgroundImage: `url(${getBackdropUrl(activeItem.backdrop_path, 'original')})`,
                    }}
                />
            )}

            {isTransitioning && transitionFromIndex !== null && transitionToIndex !== null && (
                <>
                    <div
                        key={`hero-backdrop-exit-${transitionFromIndex}`}
                        className={`hero-backdrop hero-backdrop-slide hero-backdrop-exit hero-backdrop-${transitionDirection}`}
                        style={{
                            backgroundImage: `url(${getBackdropUrl(items[transitionFromIndex].backdrop_path, 'original')})`,
                        }}
                    />
                    <div
                        key={`hero-backdrop-enter-${transitionToIndex}`}
                        className={`hero-backdrop hero-backdrop-slide hero-backdrop-enter hero-backdrop-${transitionDirection}`}
                        style={{
                            backgroundImage: `url(${getBackdropUrl(items[transitionToIndex].backdrop_path, 'original')})`,
                        }}
                    />
                </>
            )}

            <div className="hero-gradient" />
            <div className="hero-content">
                <span className="hero-tag">
                    Featured {activeMediaType === 'movie' ? 'Movie' : 'Series'}
                </span>

                <h1 className="hero-title">
                    {typedTitle}
                </h1>

                <div className={`hero-meta hero-text-reveal ${showMeta ? 'is-visible' : ''}`}>
                    <span className="hero-rating">
                        <span className="hero-rating-star">★</span>
                        {activeItem.vote_average.toFixed(1)}% Match
                    </span>
                    <span className="hero-year">{getReleaseYear(activeItem)}</span>
                    <span className="hero-type">
                        {activeMediaType === 'movie' ? 'MOVIE' : 'TV SERIES'}
                    </span>
                </div>

                <p className="hero-overview">{typedOverview}</p>

                <div className="hero-buttons">
                    <button className="btn btn-primary btn-lg hero-play-btn" onClick={handlePlayClick}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                        Play Now
                    </button>
                    <button className="btn btn-secondary btn-lg hero-more-info-btn" onClick={handleMoreInfoClick}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 16v-4M12 8h.01" />
                        </svg>
                        More Info
                    </button>
                </div>
            </div>
        </div>
    );
}

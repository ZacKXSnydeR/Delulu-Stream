import { useState, useEffect, useMemo, useCallback, useRef, type CSSProperties, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    discoverMovies,
    getBackdropUrl,
    getMovieDetails,
    getPosterUrl,
    type TMDBMovie,
} from '../services/tmdb';
import './Movies.css';

interface MovieMoodRow {
    key: string;
    label: string;
    reason: string;
    matcher: (movie: TMDBMovie) => boolean;
}

interface CuratedMovieRow {
    key: string;
    label: string;
    reason: string;
    movies: TMDBMovie[];
}

const MOVIE_MOODS: MovieMoodRow[] = [
    {
        key: 'midnight-tension',
        label: 'Midnight Tension',
        reason: 'Pulse-heavy stories for late hours.',
        matcher: (movie) => movie.genre_ids.includes(53) || movie.genre_ids.includes(80),
    },
    {
        key: 'soft-but-dangerous',
        label: 'Soft but Dangerous',
        reason: 'Quiet surfaces with hidden stakes.',
        matcher: (movie) => movie.genre_ids.includes(18) || movie.genre_ids.includes(9648),
    },
    {
        key: 'lonely-nights',
        label: 'Lonely Nights',
        reason: 'Emotion-led films with atmospheric weight.',
        matcher: (movie) => movie.genre_ids.includes(10749) || movie.genre_ids.includes(36),
    },
    {
        key: 'psychological-descent',
        label: 'Psychological Descent',
        reason: 'Mind games, obsession, and collapse.',
        matcher: (movie) => movie.genre_ids.includes(27) || movie.genre_ids.includes(9648),
    },
];

const DEFAULT_TONE = '138, 90, 72';
const POSTERS_PER_ROW = 6;

function dedupeMovies(items: TMDBMovie[]): TMDBMovie[] {
    return Array.from(new Map(items.map((movie) => [movie.id, movie])).values());
}

// Module-level cache persists across navigation
let cachedMovies: TMDBMovie[] = [];
let cachedPage = 0;
let cachedTotalPages = 0;
let cachedFeaturedIndex = 0;
let cachedRuntimes: Record<number, number> = {};
let cachedScrollY = 0;

export function Movies() {
    const navigate = useNavigate();
    const [movies, setMovies] = useState<TMDBMovie[]>(cachedMovies);
    const [page, setPage] = useState(cachedPage);
    const [totalPages, setTotalPages] = useState(cachedTotalPages);
    const [featuredIndex, setFeaturedIndex] = useState(cachedFeaturedIndex);
    const [isLoading, setIsLoading] = useState(cachedMovies.length === 0);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [runtimeById, setRuntimeById] = useState<Record<number, number>>(cachedRuntimes);
    const [toneRgb, setToneRgb] = useState(DEFAULT_TONE);
    const [loadError, setLoadError] = useState('');
    const [hoverPreviewMovie, setHoverPreviewMovie] = useState<TMDBMovie | null>(null);
    const [hoverPreviewPos, setHoverPreviewPos] = useState<{ x: number; y: number; placement: 'above' | 'below' }>({
        x: 0,
        y: 0,
        placement: 'above',
    });
    const requestedRuntimeIds = useRef<Set<number>>(new Set());
    const isFetchingRef = useRef(false);
    const loadMoreTriggerRef = useRef<HTMLDivElement | null>(null);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const hasMore = totalPages > 0 && page < totalPages;

    useEffect(() => { cachedMovies = movies; }, [movies]);
    useEffect(() => { cachedPage = page; }, [page]);
    useEffect(() => { cachedTotalPages = totalPages; }, [totalPages]);
    useEffect(() => { cachedFeaturedIndex = featuredIndex; }, [featuredIndex]);
    useEffect(() => { cachedRuntimes = runtimeById; }, [runtimeById]);

    useEffect(() => {
        if (cachedScrollY > 0) requestAnimationFrame(() => window.scrollTo(0, cachedScrollY));
        return () => { cachedScrollY = window.scrollY; };
    }, []);

    const fetchMovies = useCallback(async (pageNum: number, append: boolean) => {
        if (isFetchingRef.current) return;

        isFetchingRef.current = true;
        setLoadError('');
        if (append) setIsLoadingMore(true);
        else setIsLoading(true);

        try {
            const response = await discoverMovies({
                page: pageNum,
                sort_by: 'popularity.desc',
            });

            setMovies((prev) => (append ? dedupeMovies([...prev, ...response.results]) : dedupeMovies(response.results)));
            setPage(response.page);
            setTotalPages(response.total_pages);
        } catch (error) {
            console.error('Error fetching movies:', error);
            setLoadError('Could not load more movies. Scroll to retry or use the retry button.');
        } finally {
            setIsLoading(false);
            setIsLoadingMore(false);
            isFetchingRef.current = false;
        }
    }, []);

    useEffect(() => {
        if (cachedMovies.length > 0) return;
        fetchMovies(1, false);
    }, [fetchMovies]);

    const loadMoreMovies = useCallback(() => {
        if (isLoading || isLoadingMore || !hasMore || isFetchingRef.current) return;
        fetchMovies(page + 1, true);
    }, [fetchMovies, hasMore, isLoading, isLoadingMore, page]);

    useEffect(() => {
        const trigger = loadMoreTriggerRef.current;
        if (!trigger || isLoading || isLoadingMore || !hasMore) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    observer.disconnect();
                    loadMoreMovies();
                }
            },
            {
                root: null,
                // Load only when user actually reaches the sentinel near bottom
                rootMargin: '0px 0px 80px 0px',
                threshold: 0.15,
            }
        );

        observer.observe(trigger);
        return () => observer.disconnect();
    }, [hasMore, isLoading, isLoadingMore, loadMoreMovies]);

    const featuredCandidates = useMemo(
        () => movies.filter((movie) => movie.backdrop_path || movie.poster_path),
        [movies]
    );

    const featuredMovie = useMemo(() => {
        if (!featuredCandidates.length) return null;
        return featuredCandidates[featuredIndex % featuredCandidates.length];
    }, [featuredCandidates, featuredIndex]);

    const moodRows = useMemo<CuratedMovieRow[]>(() => {
        const used = new Set<number>();
        return MOVIE_MOODS.map((mood) => {
            const matched = movies.filter((movie) => movie.poster_path && !used.has(movie.id) && mood.matcher(movie));
            const fallback = movies.filter((movie) => movie.poster_path && !used.has(movie.id) && !matched.some((m) => m.id === movie.id));
            const picks = dedupeMovies([...matched, ...fallback]).slice(0, POSTERS_PER_ROW);
            picks.forEach((p) => used.add(p.id));

            return {
                key: mood.key,
                label: mood.label,
                reason: mood.reason,
                movies: picks,
            };
        }).filter((row) => row.movies.length > 0);
    }, [movies]);

    const discoverItems = useMemo(() => {
        const curatedIds = new Set<number>();
        moodRows.forEach((row) => row.movies.forEach((movie) => curatedIds.add(movie.id)));
        const withoutCurated = movies.filter((movie) => movie.poster_path && !curatedIds.has(movie.id));
        if (withoutCurated.length) return withoutCurated;
        return movies.filter((movie) => movie.poster_path);
    }, [movies, moodRows]);

    useEffect(() => {
        if (!featuredMovie) return;

        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.src = getBackdropUrl(featuredMovie.backdrop_path || featuredMovie.poster_path, 'small');

        image.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            canvas.width = 32;
            canvas.height = 32;
            ctx.drawImage(image, 0, 0, 32, 32);

            const data = ctx.getImageData(0, 0, 32, 32).data;
            let r = 0;
            let g = 0;
            let b = 0;
            const pixelCount = data.length / 4;

            for (let i = 0; i < data.length; i += 4) {
                r += data[i];
                g += data[i + 1];
                b += data[i + 2];
            }

            const tonedR = Math.max(40, Math.min(190, Math.round(r / pixelCount)));
            const tonedG = Math.max(30, Math.min(150, Math.round(g / pixelCount)));
            const tonedB = Math.max(35, Math.min(170, Math.round(b / pixelCount)));
            setToneRgb(`${tonedR}, ${tonedG}, ${tonedB}`);
        };

        image.onerror = () => setToneRgb(DEFAULT_TONE);
    }, [featuredMovie]);

    useEffect(() => {
        const ids = new Set<number>();
        if (featuredMovie) ids.add(featuredMovie.id);
        moodRows.forEach((row) => row.movies.forEach((movie) => ids.add(movie.id)));

        const unresolved = [...ids]
            .filter((id) => runtimeById[id] === undefined && !requestedRuntimeIds.current.has(id))
            .slice(0, 20);
        if (!unresolved.length) return;

        unresolved.forEach((id) => requestedRuntimeIds.current.add(id));
        Promise.allSettled(unresolved.map((id) => getMovieDetails(id))).then((results) => {
            const updates: Record<number, number> = {};
            results.forEach((result, index) => {
                if (result.status === 'fulfilled' && result.value.runtime) {
                    updates[unresolved[index]] = result.value.runtime;
                }
            });
            if (Object.keys(updates).length) setRuntimeById((prev) => ({ ...prev, ...updates }));
        });
    }, [featuredMovie, moodRows, runtimeById]);

    const pageStyle = {
        '--feature-rgb': toneRgb,
    } as CSSProperties;

    const [displayedIndex, setDisplayedIndex] = useState(featuredIndex);
    const [displayedInfoIndex, setDisplayedInfoIndex] = useState(featuredIndex);
    const [overlayBackdrop, setOverlayBackdrop] = useState<string | null>(null);
    const [isCanvasSliding, setIsCanvasSliding] = useState(false);
    const [textAnimKey, setTextAnimKey] = useState(0);
    const swipeDragX = useRef<number | null>(null);
    const swipeDidSwipe = useRef(false);

    useEffect(() => {
        if (displayedIndex === featuredIndex) return;
        let cancelled = false;
        const nextMovie = featuredCandidates[featuredIndex % featuredCandidates.length];
        if (!nextMovie) return;

        setIsCanvasSliding(false);
        const preload = new Image();
        const nextBackdrop = getBackdropUrl(nextMovie.backdrop_path || nextMovie.poster_path, 'large');
        preload.src = nextBackdrop;

        const commit = () => {
            if (cancelled) return;
            setDisplayedInfoIndex(featuredIndex);
            setTextAnimKey((prev) => prev + 1);
            setOverlayBackdrop(nextBackdrop);
            // Force an initial paint with overlay off-canvas, then animate in.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (!cancelled) setIsCanvasSliding(true);
                });
            });
            setTimeout(() => {
                if (cancelled) return;
                setDisplayedIndex(featuredIndex);
                setOverlayBackdrop(null);
                setIsCanvasSliding(false);
            }, 760);
        };

        preload.onload = commit;
        preload.onerror = commit;

        return () => {
            cancelled = true;
        };
    }, [featuredIndex, displayedIndex, featuredCandidates]);

    const displayedMovie = featuredCandidates[displayedIndex] || featuredCandidates[0];
    const displayedInfoMovie = featuredCandidates[displayedInfoIndex] || displayedMovie;

    const nextFeature = () => {
        if (!featuredCandidates.length) return;
        setFeaturedIndex((prev) => (prev + 1) % featuredCandidates.length);
    };

    const prevFeature = () => {
        if (!featuredCandidates.length) return;
        setFeaturedIndex((prev) => (prev - 1 + featuredCandidates.length) % featuredCandidates.length);
    };

    const onCanvasDown = (clientX: number) => { swipeDragX.current = clientX; swipeDidSwipe.current = false; };
    const onCanvasUp = (clientX: number) => {
        if (swipeDragX.current === null) return;
        const diff = swipeDragX.current - clientX;
        if (Math.abs(diff) > 48) { swipeDidSwipe.current = true; diff > 0 ? nextFeature() : prevFeature(); }
        swipeDragX.current = null;
    };
    const onCanvasUpRef = useRef(onCanvasUp);
    onCanvasUpRef.current = onCanvasUp;

    // Window-level mouseup so dragging outside the canvas still registers
    useEffect(() => {
        const handler = (e: globalThis.MouseEvent) => onCanvasUpRef.current(e.clientX);
        window.addEventListener('mouseup', handler);
        return () => window.removeEventListener('mouseup', handler);
    }, []);

    useEffect(() => {
        if (featuredCandidates.length < 2) return;
        const timer = setInterval(() => {
            setFeaturedIndex((prev) => (prev + 1) % featuredCandidates.length);
        }, 6000);
        return () => clearInterval(timer);
    }, [featuredCandidates.length]);

    const openDetails = (movieId: number) => {
        navigate(`/details/movie/${movieId}`);
    };

    const getMoodLine = (movie: TMDBMovie) => {
        if (movie.vote_average >= 7.8) return 'Slow-burn brilliance with surgical tension.';
        if (movie.vote_average >= 7.0) return 'Curated for late hours and sharp instincts.';
        return 'A quiet current with teeth beneath the surface.';
    };

    const getOverviewSnippet = (movie: TMDBMovie) => {
        const text = movie.overview?.trim();
        if (!text) return 'A carefully selected film from tonight\'s cinematic lineup.';

        const maxLength = 240;
        if (text.length <= maxLength) return text;

        const clipped = text.slice(0, maxLength);
        const lastSentence = Math.max(clipped.lastIndexOf('.'), clipped.lastIndexOf('!'), clipped.lastIndexOf('?'));
        if (lastSentence > 120) return clipped.slice(0, lastSentence + 1);

        const lastSpace = clipped.lastIndexOf(' ');
        return `${clipped.slice(0, lastSpace > 0 ? lastSpace : maxLength)}...`;
    };

    const getRuntime = (movie: TMDBMovie) => {
        const runtime = runtimeById[movie.id];
        return runtime ? `${runtime} min` : 'Runtime loading';
    };

    const getPreviewOverview = (movie: TMDBMovie) => {
        const text = movie.overview?.trim();
        if (!text) return 'No synopsis available.';
        if (text.length <= 180) return text;
        return `${text.slice(0, 177)}...`;
    };

    const clearHoverTimer = () => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
    };

    const handleDiscoverCardEnter = (movie: TMDBMovie, event: MouseEvent<HTMLButtonElement>) => {
        clearHoverTimer();
        const rect = event.currentTarget.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const popupWidth = Math.min(360, viewportWidth - 32);
        const popupHalf = popupWidth / 2;
        const horizontalPadding = 16;
        const estimatedPopupHeight = 196;
        const centeredX = rect.left + rect.width / 2;
        const x = Math.min(
            Math.max(centeredX, horizontalPadding + popupHalf),
            viewportWidth - horizontalPadding - popupHalf
        );
        const canShowAbove = rect.top - estimatedPopupHeight - 24 > 0;
        const placement: 'above' | 'below' = canShowAbove ? 'above' : 'below';
        const y = placement === 'above'
            ? Math.max(rect.top - 10, estimatedPopupHeight + 20)
            : Math.min(rect.bottom + 10, viewportHeight - estimatedPopupHeight - 24);

        hoverTimerRef.current = setTimeout(() => {
            setHoverPreviewPos({ x, y, placement });
            setHoverPreviewMovie(movie);
        }, 1000);
    };

    const handleDiscoverCardLeave = () => {
        clearHoverTimer();
        setHoverPreviewMovie(null);
    };

    useEffect(() => {
        const hidePreview = () => setHoverPreviewMovie(null);
        window.addEventListener('scroll', hidePreview, { passive: true });
        return () => {
            window.removeEventListener('scroll', hidePreview);
            clearHoverTimer();
        };
    }, []);

    if (isLoading) {
        return (
            <div className="movies-page page movies-cinema-loading">
                <div className="movies-cinema-loading-bar" />
                <div className="movies-cinema-loading-canvas" />
                <div className="movies-cinema-loading-row" />
                <div className="movies-cinema-loading-row" />
            </div>
        );
    }

    return (
        <div className="movies-page page movies-cinema" style={pageStyle}>
            <div className="movies-cinema-bg" aria-hidden="true" />
            <div className="movies-cinema-grain" aria-hidden="true" />

            <header className="movies-cinema-header">
                <span className="movies-cinema-header-tag">Curated Cinema</span>
                <p className="movies-cinema-header-note">One strong film at a time.</p>
            </header>

            {displayedMovie && displayedInfoMovie && (
                <section className="movies-cinema-featured">
                    <div className="movies-cinema-featured-info movies-cinema-featured-info-typing" key={`movie-feature-info-${displayedInfoMovie.id}-${textAnimKey}`}>
                        <p className="movies-cinema-kicker">Featured Discovery</p>
                        <h1>{displayedInfoMovie.title}</h1>
                        <p className="movies-cinema-mood">{getMoodLine(displayedInfoMovie)}</p>
                        <p className="movies-cinema-overview">{getOverviewSnippet(displayedInfoMovie)}</p>
                        <div className="movies-cinema-featured-meta">
                            <span>{new Date(displayedInfoMovie.release_date).getFullYear()}</span>
                            <span>{displayedInfoMovie.vote_average.toFixed(1)} rating</span>
                            <span>{getRuntime(displayedInfoMovie)}</span>
                        </div>
                        <div className="movies-cinema-featured-actions">
                            <button
                                className="movies-cinema-btn movies-cinema-btn-primary"
                                onClick={() => openDetails(displayedInfoMovie.id)}
                            >
                                Open Details
                            </button>
                            <button
                                className="movies-cinema-btn movies-cinema-btn-ghost"
                                onClick={nextFeature}
                            >
                                Next Feature
                            </button>
                        </div>
                    </div>

                    <button
                        className="movies-cinema-featured-canvas"
                        onClick={() => { if (!swipeDidSwipe.current) openDetails(displayedInfoMovie.id); swipeDidSwipe.current = false; }}
                        onMouseDown={(e) => onCanvasDown(e.clientX)}
                        onTouchStart={(e) => onCanvasDown(e.touches[0].clientX)}
                        onTouchEnd={(e) => { if (e.changedTouches.length > 0) onCanvasUp(e.changedTouches[0].clientX); }}
                        aria-label={`Open ${displayedInfoMovie.title}`}
                    >
                        <img
                            className="movies-cinema-featured-image-base"
                            src={getBackdropUrl(displayedMovie.backdrop_path || displayedMovie.poster_path, 'large')}
                            alt={displayedMovie.title}
                        />
                        {overlayBackdrop && (
                            <img
                                className={`movies-cinema-featured-image-overlay ${isCanvasSliding ? 'is-sliding' : ''}`}
                                src={overlayBackdrop}
                                alt=""
                                aria-hidden="true"
                            />
                        )}
                    </button>
                </section>
            )}

            <section className="movies-cinema-rows">
                {moodRows.map((row, rowIndex) => (
                    <article
                        className={`movies-cinema-row ${rowIndex === 0 ? 'movies-cinema-row-first' : ''}`}
                        key={row.key}
                    >
                        <h2>{row.label}</h2>
                        <p>{row.reason}</p>
                        <div className="movies-cinema-strip">
                            {row.movies.map((movie) => (
                                <button
                                    key={movie.id}
                                    className="movies-cinema-poster"
                                    onClick={() => openDetails(movie.id)}
                                    aria-label={`Open ${movie.title}`}
                                >
                                    <img
                                        src={getPosterUrl(movie.poster_path, 'medium')}
                                        alt={movie.title}
                                        loading="lazy"
                                    />
                                    <div className="movies-cinema-poster-meta">
                                        <strong>{movie.title}</strong>
                                        <span>{getRuntime(movie)}</span>
                                        <span>{row.label}</span>
                                        <span>{row.reason}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </article>
                ))}
            </section>

            <section className="movies-cinema-discover">
                <h2>Discover More</h2>
                <div className="movies-cinema-discover-grid">
                    {discoverItems.map((movie) => (
                        <button
                            key={movie.id}
                            className="movies-cinema-discover-card"
                            onClick={() => openDetails(movie.id)}
                            onMouseEnter={(e) => handleDiscoverCardEnter(movie, e)}
                            onMouseLeave={handleDiscoverCardLeave}
                            aria-label={`Open ${movie.title}`}
                        >
                            <img
                                src={getPosterUrl(movie.poster_path, 'medium')}
                                alt={movie.title}
                                loading="lazy"
                            />
                        </button>
                    ))}
                </div>

                <div ref={loadMoreTriggerRef} className="movies-cinema-scroll-trigger" />

                <div className="movies-cinema-loading-slot">
                    {isLoadingMore && (
                        <div className="movies-cinema-loading-more" role="status" aria-live="polite">
                            <span>Loading more movies...</span>
                        </div>
                    )}
                </div>

                {loadError && !isLoadingMore && hasMore && (
                    <div className="movies-cinema-load-error">
                        <span>{loadError}</span>
                        <button type="button" onClick={loadMoreMovies}>Retry</button>
                    </div>
                )}

                {!hasMore && movies.length > 0 && (
                    <p className="movies-cinema-endcap">End of curated movie catalog for now.</p>
                )}
            </section>

            {hoverPreviewMovie && (
                <div
                    className={`movies-cinema-hover-preview ${hoverPreviewPos.placement === 'below' ? 'is-below' : ''}`}
                    style={{ left: hoverPreviewPos.x, top: hoverPreviewPos.y }}
                    role="tooltip"
                >
                    <h3>{hoverPreviewMovie.title}</h3>
                    <p className="movies-cinema-hover-meta">
                        <span>{hoverPreviewMovie.release_date ? new Date(hoverPreviewMovie.release_date).getFullYear() : 'N/A'}</span>
                        <span>{hoverPreviewMovie.vote_average.toFixed(1)} rating</span>
                        <span>{getRuntime(hoverPreviewMovie)}</span>
                    </p>
                    <p>{getPreviewOverview(hoverPreviewMovie)}</p>
                </div>
            )}
        </div>
    );
}

import { useState, useEffect, useMemo, useCallback, useRef, type CSSProperties, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    discoverTVShows,
    getBackdropUrl,
    getPosterUrl,
    getTVShowDetails,
    type TMDBTVShow,
} from '../services/tmdb';
import './Movies.css';
import './TVShows.css';

interface ShowMoodRow {
    key: string;
    label: string;
    reason: string;
    matcher: (show: TMDBTVShow) => boolean;
}

interface CuratedShowRow {
    key: string;
    label: string;
    reason: string;
    shows: TMDBTVShow[];
}

const SHOW_MOODS: ShowMoodRow[] = [
    {
        key: 'slow-burn-worlds',
        label: 'Slow Burn Worlds',
        reason: 'Expansive stories that unfold with patience.',
        matcher: (show) => show.genre_ids.includes(18) || show.genre_ids.includes(10765),
    },
    {
        key: 'midnight-obsession',
        label: 'Midnight Obsession',
        reason: 'Unstable minds, secrets, and sleepless binges.',
        matcher: (show) => show.genre_ids.includes(9648) || show.genre_ids.includes(80),
    },
    {
        key: 'quiet-calamity',
        label: 'Quiet Calamity',
        reason: 'Emotion-first narratives with a dangerous undertow.',
        matcher: (show) => show.genre_ids.includes(10749) || show.genre_ids.includes(18),
    },
    {
        key: 'edge-of-reality',
        label: 'Edge of Reality',
        reason: 'Speculative worlds with psychological pressure.',
        matcher: (show) => show.genre_ids.includes(10765) || show.genre_ids.includes(10759),
    },
];

const DEFAULT_TONE = '82, 103, 138';
const POSTERS_PER_ROW = 6;

function dedupeShows(items: TMDBTVShow[]): TMDBTVShow[] {
    return Array.from(new Map(items.map((show) => [show.id, show])).values());
}

// Module-level cache — persists across mounts (navigation)
let cachedShows: TMDBTVShow[] = [];
let cachedPage = 0;
let cachedTotalPages = 0;
let cachedFeaturedIndex = 0;
let cachedRuntimes: Record<number, number> = {};
let cachedScrollY = 0;

export function TVShows() {
    const navigate = useNavigate();
    const [shows, setShows] = useState<TMDBTVShow[]>(cachedShows);
    const [page, setPage] = useState(cachedPage);
    const [totalPages, setTotalPages] = useState(cachedTotalPages);
    const [featuredIndex, setFeaturedIndex] = useState(cachedFeaturedIndex);
    const [isLoading, setIsLoading] = useState(cachedShows.length === 0);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [runtimeById, setRuntimeById] = useState<Record<number, number>>(cachedRuntimes);
    const [toneRgb, setToneRgb] = useState(DEFAULT_TONE);
    const [loadError, setLoadError] = useState('');
    const [hoverPreviewShow, setHoverPreviewShow] = useState<TMDBTVShow | null>(null);
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

    // Sync state to module-level cache on changes
    useEffect(() => { cachedShows = shows; }, [shows]);
    useEffect(() => { cachedPage = page; }, [page]);
    useEffect(() => { cachedTotalPages = totalPages; }, [totalPages]);
    useEffect(() => { cachedFeaturedIndex = featuredIndex; }, [featuredIndex]);
    useEffect(() => { cachedRuntimes = runtimeById; }, [runtimeById]);

    // Restore scroll position on mount, save on unmount
    useEffect(() => {
        if (cachedScrollY > 0) {
            requestAnimationFrame(() => window.scrollTo(0, cachedScrollY));
        }
        return () => { cachedScrollY = window.scrollY; };
    }, []);

    const fetchShows = useCallback(async (pageNum: number, append: boolean) => {
        if (isFetchingRef.current) {
            return;
        }

        isFetchingRef.current = true;
        setLoadError('');
        if (append) {
            setIsLoadingMore(true);
        } else {
            setIsLoading(true);
        }

        try {
            const response = await discoverTVShows({
                page: pageNum,
                sort_by: 'popularity.desc',
            });

            setShows((prev) => (append ? dedupeShows([...prev, ...response.results]) : dedupeShows(response.results)));
            setPage(response.page);
            setTotalPages(response.total_pages);
        } catch (error) {
            console.error('Error fetching TV shows:', error);
            setLoadError('Could not load more series. Scroll to retry or use the retry button.');
        } finally {
            setIsLoading(false);
            setIsLoadingMore(false);
            isFetchingRef.current = false;
        }
    }, []);

    useEffect(() => {
        // Skip initial fetch if we already have cached data
        if (cachedShows.length > 0) return;
        fetchShows(1, false);
    }, [fetchShows]);

    const loadMoreShows = useCallback(() => {
        if (isLoading || isLoadingMore || !hasMore || isFetchingRef.current) {
            return;
        }
        fetchShows(page + 1, true);
    }, [fetchShows, hasMore, isLoading, isLoadingMore, page]);

    useEffect(() => {
        const trigger = loadMoreTriggerRef.current;
        if (!trigger || isLoading || isLoadingMore || !hasMore) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    observer.disconnect();
                    loadMoreShows();
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
    }, [hasMore, isLoading, isLoadingMore, loadMoreShows]);

    const featuredCandidates = useMemo(
        () => shows.filter((show) => show.backdrop_path || show.poster_path),
        [shows]
    );

    const featuredShow = useMemo(() => {
        if (!featuredCandidates.length) {
            return null;
        }
        return featuredCandidates[featuredIndex % featuredCandidates.length];
    }, [featuredCandidates, featuredIndex]);

    const moodRows = useMemo<CuratedShowRow[]>(() => {
        const used = new Set<number>();
        return SHOW_MOODS.map((mood) => {
            const matched = shows.filter((show) => show.poster_path && !used.has(show.id) && mood.matcher(show));
            const fallback = shows.filter((show) => show.poster_path && !used.has(show.id) && !matched.some((s) => s.id === show.id));
            const picks = dedupeShows([...matched, ...fallback]).slice(0, POSTERS_PER_ROW);
            picks.forEach((p) => used.add(p.id));

            return {
                key: mood.key,
                label: mood.label,
                reason: mood.reason,
                shows: picks,
            };
        }).filter((row) => row.shows.length > 0);
    }, [shows]);

    const discoverItems = useMemo(() => {
        const curatedIds = new Set<number>();
        moodRows.forEach((row) => row.shows.forEach((show) => curatedIds.add(show.id)));
        const withoutCurated = shows.filter((show) => show.poster_path && !curatedIds.has(show.id));
        if (withoutCurated.length) return withoutCurated;
        return shows.filter((show) => show.poster_path);
    }, [shows, moodRows]);

    useEffect(() => {
        if (!featuredShow) {
            return;
        }

        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.src = getBackdropUrl(featuredShow.backdrop_path || featuredShow.poster_path, 'small');

        image.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                return;
            }

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

            const tonedR = Math.max(40, Math.min(170, Math.round(r / pixelCount)));
            const tonedG = Math.max(45, Math.min(170, Math.round(g / pixelCount)));
            const tonedB = Math.max(60, Math.min(190, Math.round(b / pixelCount)));
            setToneRgb(`${tonedR}, ${tonedG}, ${tonedB}`);
        };

        image.onerror = () => {
            setToneRgb(DEFAULT_TONE);
        };
    }, [featuredShow]);

    useEffect(() => {
        const ids = new Set<number>();
        if (featuredShow) {
            ids.add(featuredShow.id);
        }

        moodRows.forEach((row) => {
            row.shows.forEach((show) => ids.add(show.id));
        });

        const unresolved = [...ids]
            .filter((id) => runtimeById[id] === undefined && !requestedRuntimeIds.current.has(id))
            .slice(0, 20);
        if (!unresolved.length) {
            return;
        }

        unresolved.forEach((id) => requestedRuntimeIds.current.add(id));
        Promise.allSettled(unresolved.map((id) => getTVShowDetails(id))).then((results) => {
            const updates: Record<number, number> = {};
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    const runtime = result.value.episode_run_time?.[0];
                    if (runtime) {
                        updates[unresolved[index]] = runtime;
                    }
                }
            });

            if (Object.keys(updates).length) {
                setRuntimeById((prev) => ({ ...prev, ...updates }));
            }
        });
    }, [featuredShow, moodRows, runtimeById]);

    const pageStyle = {
        '--feature-rgb': toneRgb,
    } as CSSProperties;

    // Smooth crossfade: displayedIndex is what's currently visible
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
        const nextShow = featuredCandidates[featuredIndex % featuredCandidates.length];
        if (!nextShow) return;

        setIsCanvasSliding(false);
        const preload = new Image();
        const nextBackdrop = getBackdropUrl(nextShow.backdrop_path || nextShow.poster_path, 'large');
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

    const displayedShow = featuredCandidates[displayedIndex] || featuredCandidates[0];
    const displayedInfoShow = featuredCandidates[displayedInfoIndex] || displayedShow;

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

    // Auto-rotate featured show every 6 seconds
    useEffect(() => {
        if (featuredCandidates.length < 2) return;
        const timer = setInterval(() => {
            setFeaturedIndex((prev) => (prev + 1) % featuredCandidates.length);
        }, 6000);
        return () => clearInterval(timer);
    }, [featuredCandidates.length]);

    const openDetails = (showId: number) => {
        navigate(`/details/tv/${showId}`);
    };

    const getTitle = (show: TMDBTVShow) => show.name;

    const getMoodLine = (show: TMDBTVShow) => {
        if (show.vote_average >= 7.8) return 'Layered episodic storytelling with sharp intent.';
        if (show.vote_average >= 7.0) return 'Built for long nights and one-more-episode momentum.';
        return 'Subtle arcs with tension held just under the surface.';
    };

    const getOverviewSnippet = (show: TMDBTVShow) => {
        const text = show.overview?.trim();
        if (!text) {
            return 'A carefully selected series from tonight\'s cinematic queue.';
        }

        const maxLength = 240;
        if (text.length <= maxLength) {
            return text;
        }

        const clipped = text.slice(0, maxLength);
        const lastSentence = Math.max(clipped.lastIndexOf('.'), clipped.lastIndexOf('!'), clipped.lastIndexOf('?'));
        if (lastSentence > 120) {
            return clipped.slice(0, lastSentence + 1);
        }

        const lastSpace = clipped.lastIndexOf(' ');
        return `${clipped.slice(0, lastSpace > 0 ? lastSpace : maxLength)}...`;
    };

    const getRuntime = (show: TMDBTVShow) => {
        const runtime = runtimeById[show.id];
        return runtime ? `${runtime} min/ep` : 'Episode runtime loading';
    };

    const getPreviewOverview = (show: TMDBTVShow) => {
        const text = show.overview?.trim();
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

    const handleDiscoverCardEnter = (show: TMDBTVShow, event: MouseEvent<HTMLButtonElement>) => {
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
            setHoverPreviewShow(show);
        }, 1000);
    };

    const handleDiscoverCardLeave = () => {
        clearHoverTimer();
        setHoverPreviewShow(null);
    };

    useEffect(() => {
        const hidePreview = () => setHoverPreviewShow(null);
        window.addEventListener('scroll', hidePreview, { passive: true });
        return () => {
            window.removeEventListener('scroll', hidePreview);
            clearHoverTimer();
        };
    }, []);

    if (isLoading) {
        return (
            <div className="tvshows-page page movies-cinema-loading tv-cinema-loading">
                <div className="movies-cinema-loading-bar" />
                <div className="movies-cinema-loading-canvas" />
                <div className="movies-cinema-loading-row" />
                <div className="movies-cinema-loading-row" />
            </div>
        );
    }

    return (
        <div className="tvshows-page page movies-cinema tv-cinema" style={pageStyle}>
            <div className="movies-cinema-bg" aria-hidden="true" />
            <div className="movies-cinema-grain" aria-hidden="true" />

            <header className="movies-cinema-header">
                <span className="movies-cinema-header-tag">Series Curation</span>
                <p className="movies-cinema-header-note">Binge-worthy, mood-first television.</p>
            </header>

            {displayedShow && displayedInfoShow && (
                <section className="movies-cinema-featured">
                    <div className="movies-cinema-featured-info movies-cinema-featured-info-typing" key={`tv-feature-info-${displayedInfoShow.id}-${textAnimKey}`}>
                        <p className="movies-cinema-kicker">Featured Series</p>
                        <h1>{getTitle(displayedInfoShow)}</h1>
                        <p className="movies-cinema-mood">{getMoodLine(displayedInfoShow)}</p>
                        <p className="movies-cinema-overview">{getOverviewSnippet(displayedInfoShow)}</p>
                        <div className="movies-cinema-featured-meta">
                            <span>{new Date(displayedInfoShow.first_air_date).getFullYear()}</span>
                            <span>{displayedInfoShow.vote_average.toFixed(1)} rating</span>
                            <span>{getRuntime(displayedInfoShow)}</span>
                        </div>
                        <div className="movies-cinema-featured-actions">
                            <button
                                className="movies-cinema-btn movies-cinema-btn-primary"
                                onClick={() => openDetails(displayedInfoShow.id)}
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
                        onClick={() => { if (!swipeDidSwipe.current) openDetails(displayedInfoShow.id); swipeDidSwipe.current = false; }}
                        onMouseDown={(e) => onCanvasDown(e.clientX)}
                        onTouchStart={(e) => onCanvasDown(e.touches[0].clientX)}
                        onTouchEnd={(e) => { if (e.changedTouches.length > 0) onCanvasUp(e.changedTouches[0].clientX); }}
                        aria-label={`Open ${getTitle(displayedInfoShow)}`}
                    >
                        <img
                            className="movies-cinema-featured-image-base"
                            src={getBackdropUrl(displayedShow.backdrop_path || displayedShow.poster_path, 'large')}
                            alt={getTitle(displayedShow)}
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
                            {row.shows.map((show) => (
                                <button
                                    key={show.id}
                                    className="movies-cinema-poster"
                                    onClick={() => openDetails(show.id)}
                                    aria-label={`Open ${getTitle(show)}`}
                                >
                                    <img
                                        src={getPosterUrl(show.poster_path, 'medium')}
                                        alt={getTitle(show)}
                                        loading="lazy"
                                    />
                                    <div className="movies-cinema-poster-meta">
                                        <strong>{getTitle(show)}</strong>
                                        <span>{getRuntime(show)}</span>
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
                    {discoverItems.map((show) => (
                        <button
                            key={show.id}
                            className="movies-cinema-discover-card"
                            onClick={() => openDetails(show.id)}
                            onMouseEnter={(e) => handleDiscoverCardEnter(show, e)}
                            onMouseLeave={handleDiscoverCardLeave}
                            aria-label={`Open ${getTitle(show)}`}
                        >
                            <img
                                src={getPosterUrl(show.poster_path, 'medium')}
                                alt={getTitle(show)}
                                loading="lazy"
                            />
                        </button>
                    ))}
                </div>

                <div ref={loadMoreTriggerRef} className="movies-cinema-scroll-trigger" />

                <div className="movies-cinema-loading-slot">
                    {isLoadingMore && (
                        <div className="movies-cinema-loading-more" role="status" aria-live="polite">
                            <span>Loading more series...</span>
                        </div>
                    )}
                </div>

                {loadError && !isLoadingMore && hasMore && (
                    <div className="movies-cinema-load-error">
                        <span>{loadError}</span>
                        <button type="button" onClick={loadMoreShows}>Retry</button>
                    </div>
                )}

                {!hasMore && shows.length > 0 && (
                    <p className="movies-cinema-endcap">End of curated series catalog for now.</p>
                )}
            </section>

            {hoverPreviewShow && (
                <div
                    className={`movies-cinema-hover-preview ${hoverPreviewPos.placement === 'below' ? 'is-below' : ''}`}
                    style={{ left: hoverPreviewPos.x, top: hoverPreviewPos.y }}
                    role="tooltip"
                >
                    <h3>{getTitle(hoverPreviewShow)}</h3>
                    <p className="movies-cinema-hover-meta">
                        <span>{hoverPreviewShow.first_air_date ? new Date(hoverPreviewShow.first_air_date).getFullYear() : 'N/A'}</span>
                        <span>{hoverPreviewShow.vote_average.toFixed(1)} rating</span>
                        <span>{getRuntime(hoverPreviewShow)}</span>
                    </p>
                    <p>{getPreviewOverview(hoverPreviewShow)}</p>
                </div>
            )}
        </div>
    );
}

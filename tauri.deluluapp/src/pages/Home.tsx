import { useState, useEffect, useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { usePlayer } from '../context/PlayerContext';
import { HeroCarousel } from '../components/content/HeroCarousel';
import { ContentRow } from '../components/content/ContentRow';
import { Footer } from '../components/layout/Footer';
import { SkeletonHero, SkeletonRow } from '../components/skeleton/Skeleton';
import {
    getTrending,
    getPopularMovies,
    getPopularTVShows,
    getTopRatedMovies,
    getMovieDetails,
    getTVShowDetails,
    getSeasonDetails,
    getPosterUrl,
    getBackdropUrl,
    getTitle,
    getMediaType,
    getReleaseYear,
    type TMDBContent,
    type TMDBMovie,
    type TMDBTVShow,
} from '../services/tmdb';
import { watchService, type WatchHistoryItem } from '../services/watchHistory';
import './Home.css';

interface ContinueWatchingEntry {
    history: WatchHistoryItem;
    content: TMDBContent;
    /** If the last episode was completed, this points to the next episode to watch */
    nextEpisode?: {
        seasonNumber: number;
        episodeNumber: number;
        name: string;
    };
}

function toMovieContent(details: Awaited<ReturnType<typeof getMovieDetails>>): TMDBMovie {
    return {
        id: details.id,
        title: details.title || 'Unknown',
        original_title: details.title || 'Unknown',
        overview: details.overview || '',
        poster_path: details.poster_path,
        backdrop_path: details.backdrop_path,
        release_date: details.release_date || '',
        vote_average: details.vote_average || 0,
        vote_count: details.vote_count || 0,
        popularity: 0,
        genre_ids: details.genres?.map((g) => g.id) || [],
        adult: false,
        media_type: 'movie',
    };
}

function toTVContent(details: Awaited<ReturnType<typeof getTVShowDetails>>): TMDBTVShow {
    return {
        id: details.id,
        name: details.name || 'Unknown',
        original_name: details.name || 'Unknown',
        overview: details.overview || '',
        poster_path: details.poster_path,
        backdrop_path: details.backdrop_path,
        first_air_date: details.first_air_date || '',
        vote_average: details.vote_average || 0,
        vote_count: details.vote_count || 0,
        popularity: 0,
        genre_ids: details.genres?.map((g) => g.id) || [],
        media_type: 'tv',
    };
}

// Module-level cache — persists across mounts (navigation)
let cachedHero: TMDBContent[] = [];
let cachedTrending: TMDBContent[] = [];
let cachedPopularMovies: TMDBMovie[] = [];
let cachedPopularTVShows: TMDBTVShow[] = [];
let cachedTopRated: TMDBMovie[] = [];
let cachedScrollY = 0;

export function Home() {
    const navigate = useNavigate();
    const { playMedia } = usePlayer();
    const [heroItems, setHeroItems] = useState<TMDBContent[]>(cachedHero);
    const [trending, setTrending] = useState<TMDBContent[]>(cachedTrending);
    const [popularMovies, setPopularMovies] = useState<TMDBMovie[]>(cachedPopularMovies);
    const [popularTVShows, setPopularTVShows] = useState<TMDBTVShow[]>(cachedPopularTVShows);
    const [topRatedMovies, setTopRatedMovies] = useState<TMDBMovie[]>(cachedTopRated);
    const [continueWatching, setContinueWatching] = useState<ContinueWatchingEntry[]>([]);
    const [isLoading, setIsLoading] = useState(cachedTrending.length === 0);

    const scrollRef = useRef<HTMLDivElement>(null);
    const [showLeftArrow, setShowLeftArrow] = useState(false);
    const [showRightArrow, setShowRightArrow] = useState(true);
    const topThreeTrending = trending.slice(0, 3);

    const handleScroll = () => {
        if (!scrollRef.current) return;
        const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
        setShowLeftArrow(scrollLeft > 20);
        setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 20);
    };

    const scroll = (direction: 'left' | 'right') => {
        if (!scrollRef.current) return;
        const container = scrollRef.current;
        const scrollAmount = container.clientWidth * 0.8;
        const target = direction === 'left'
            ? container.scrollLeft - scrollAmount
            : container.scrollLeft + scrollAmount;
        const start = container.scrollLeft;
        const distance = target - start;
        const duration = 500;
        let startTime: number | null = null;

        const ease = (t: number) => t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;

        const step = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;
            const progress = Math.min(elapsed / duration, 1);
            container.scrollLeft = start + distance * ease(progress);
            if (progress < 1) requestAnimationFrame(step);
        };

        requestAnimationFrame(step);
    };

    // Sync to module-level cache
    useEffect(() => { cachedHero = heroItems; }, [heroItems]);
    useEffect(() => { cachedTrending = trending; }, [trending]);
    useEffect(() => { cachedPopularMovies = popularMovies; }, [popularMovies]);
    useEffect(() => { cachedPopularTVShows = popularTVShows; }, [popularTVShows]);
    useEffect(() => { cachedTopRated = topRatedMovies; }, [topRatedMovies]);

    // Restore scroll position on mount, save on unmount
    useEffect(() => {
        if (cachedScrollY > 0) {
            requestAnimationFrame(() => window.scrollTo(0, cachedScrollY));
        }
        return () => { cachedScrollY = window.scrollY; };
    }, []);

    const fetchContinueWatching = useCallback(async () => {
        console.log('[Home] Fetching continue watching...');
        try {
            const historyItems = await watchService.getContinueWatching(12);
            console.log('[Home] Raw history items:', historyItems);

            if (!historyItems.length) {
                console.log('[Home] No history items found');
                setContinueWatching([]);
                return;
            }

            const resolved = await Promise.allSettled(
                historyItems.map(async (history): Promise<ContinueWatchingEntry | null> => {
                    if (history.media_type === 'movie') {
                        const details = await getMovieDetails(history.tmdb_id);
                        return { history, content: toMovieContent(details) };
                    }

                    const details = await getTVShowDetails(history.tmdb_id);
                    const entry: ContinueWatchingEntry = { history, content: toTVContent(details) };

                    // If this TV episode was completed, resolve the NEXT episode
                    if (history.is_completed && history.media_type === 'tv') {
                        const curSeason = history.season_number ?? 1;
                        const curEpisode = history.episode_number ?? 1;

                        try {
                            // Try next episode in same season
                            const seasonData = await getSeasonDetails(history.tmdb_id, curSeason);
                            const nextEpInSeason = seasonData.episodes.find(
                                (ep) => ep.episode_number === curEpisode + 1
                            );

                            if (nextEpInSeason) {
                                entry.nextEpisode = {
                                    seasonNumber: curSeason,
                                    episodeNumber: nextEpInSeason.episode_number,
                                    name: nextEpInSeason.name,
                                };
                            } else {
                                // Try first episode of next season
                                const seasons = details.seasons
                                    ?.filter((s) => s.season_number > 0) // skip specials
                                    .sort((a, b) => a.season_number - b.season_number);

                                const nextSeason = seasons?.find((s) => s.season_number > curSeason);
                                if (nextSeason) {
                                    const nextSeasonData = await getSeasonDetails(
                                        history.tmdb_id,
                                        nextSeason.season_number
                                    );
                                    const firstEp = nextSeasonData.episodes[0];
                                    if (firstEp) {
                                        entry.nextEpisode = {
                                            seasonNumber: nextSeason.season_number,
                                            episodeNumber: firstEp.episode_number,
                                            name: firstEp.name,
                                        };
                                    }
                                }
                                // No next season means show is fully watched — skip this entry
                                if (!entry.nextEpisode) return null;
                            }
                        } catch {
                            // TMDB lookup failed — still show as continue watching without next-ep info
                            console.error('[Home] Failed to resolve next episode for', history.tmdb_id);
                        }
                    }

                    return entry;
                })
            );

            const entries = resolved
                .filter((r): r is PromiseFulfilledResult<ContinueWatchingEntry | null> => r.status === 'fulfilled')
                .map((r) => r.value)
                .filter((entry): entry is ContinueWatchingEntry => entry !== null);

            console.log('[Home] Resolved continue watching entries:', entries);
            setContinueWatching(entries);
        } catch (error) {
            console.error('[Home] Error fetching continue watching:', error);
            setContinueWatching([]);
        }
    }, []);

    useEffect(() => {
        // If we have cached data, skip network calls for main content
        if (cachedTrending.length > 0) {
            setIsLoading(false);
            fetchContinueWatching().catch(console.error);
            return;
        }

        // Fire all fetches independently — each section appears as soon as its data lands
        getTrending('all', 'week').then(data => {
            setHeroItems(data.slice(0, 5));
            setTrending(data);
            setIsLoading(false); // Unblock as soon as hero/trending is ready
        }).catch((err) => {
            console.error('[Home] Failed to load trending:', err);
            setIsLoading(false);
        });

        getPopularMovies().then(data => {
            setPopularMovies(data.results);
        }).catch(console.error);

        getPopularTVShows().then(data => {
            setPopularTVShows(data.results);
        }).catch(console.error);

        getTopRatedMovies().then(data => {
            setTopRatedMovies(data.results);
        }).catch(console.error);

        fetchContinueWatching().catch(console.error);
    }, [fetchContinueWatching]);

    useEffect(() => {
        const onFocus = () => {
            fetchContinueWatching().catch(console.error);
        };

        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onFocus);
        return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onFocus);
        };
    }, [fetchContinueWatching]);

    const handleResume = (entry: ContinueWatchingEntry) => {
        const { history, content, nextEpisode } = entry;
        const poster = content.poster_path || '';
        const showName = 'name' in content ? content.name : 'TV Show';

        if (history.media_type === 'movie') {
            const movieTitle = 'title' in content ? content.title : 'Movie';
            playMedia({
                mediaType: 'movie',
                tmdbId: history.tmdb_id,
                title: movieTitle,
                posterPath: poster,
                initialTime: history.current_time,
            });
            return;
        }

        // If this entry has a resolved next episode (completed last ep), play that
        if (nextEpisode) {
            const nextTitle = `${showName} - S${nextEpisode.seasonNumber}E${nextEpisode.episodeNumber}: ${nextEpisode.name}`;
            playMedia({
                mediaType: 'tv',
                tmdbId: history.tmdb_id,
                season: nextEpisode.seasonNumber,
                episode: nextEpisode.episodeNumber,
                title: nextTitle,
                posterPath: poster,
                initialTime: 0,
            });
            return;
        }

        // Otherwise resume where the user left off
        const tvTitle = `${showName} - S${history.season_number || 1}E${history.episode_number || 1}`;
        playMedia({
            mediaType: 'tv',
            tmdbId: history.tmdb_id,
            season: history.season_number || 1,
            episode: history.episode_number || 1,
            title: tvTitle,
            posterPath: poster,
            initialTime: history.current_time,
        });
    };

    const handleDelete = async (e: React.MouseEvent, entry: ContinueWatchingEntry) => {
        e.preventDefault();
        e.stopPropagation();

        await watchService.removeRecord({
            tmdbId: entry.history.tmdb_id,
            mediaType: entry.history.media_type,
            seasonNumber: entry.history.season_number || undefined,
            episodeNumber: entry.history.episode_number || undefined
        });

        // Trigger a fresh fetch so the UI updates
        fetchContinueWatching();
    };

    const formatRemaining = (history: WatchHistoryItem) => {
        const remainingSeconds = Math.max(0, (history.total_duration || 0) - (history.current_time || 0));
        const minutes = Math.max(1, Math.ceil(remainingSeconds / 60));
        return `${minutes}m left`;
    };

    const getProgressPercent = (history: WatchHistoryItem) => {
        if (!history.total_duration || history.total_duration <= 0) return 0;
        return Math.min(100, Math.max(0, (history.current_time / history.total_duration) * 100));
    };

    if (isLoading) {
        return (
            <div className="home-page">
                <SkeletonHero />
                <div className="home-content">
                    <SkeletonRow />
                    <SkeletonRow />
                    <SkeletonRow />
                </div>
            </div>
        );
    }

    return (
        <div className="home-page">
            <HeroCarousel items={heroItems} />
            <div className="home-content">
                {topThreeTrending.length > 0 && (
                    <section className="content-row top3-row">
                        <div className="content-row-header">
                            <h2 className="content-row-title">Today's Top 3</h2>
                        </div>
                        <div className="top3-grid">
                            {topThreeTrending.map((item, index) => {
                                const mediaType = getMediaType(item);
                                const title = getTitle(item);
                                const backdrop = getBackdropUrl(item.backdrop_path || item.poster_path, 'large');
                                return (
                                    <button
                                        key={`${mediaType}-${item.id}`}
                                        className="top3-card"
                                        onClick={() => navigate(`/details/${mediaType}/${item.id}`)}
                                        aria-label={`Open ${title}`}
                                    >
                                        <span className="top3-rank-bg" aria-hidden="true">{index + 1}</span>

                                        <div className="top3-media">
                                            <img className="top3-poster" src={backdrop} alt={title} loading="lazy" />
                                            <div className="top3-overlay" />
                                            <div className="top3-meta">
                                                <h3 className="top3-title">{title}</h3>
                                                <span className="top3-subtitle">{mediaType.toUpperCase()} • {getReleaseYear(item)}</span>
                                            </div>
                                            <span className="top3-chip">Top Pick</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                )}

                {continueWatching.length > 0 && (
                    <section className="content-row continue-watching-row">
                        <div className="content-row-header">
                            <h2 className="content-row-title">
                                Continue Watching
                            </h2>
                            <div className="content-row-nav">
                                <button
                                    className={`content-row-nav-btn ${!showLeftArrow ? 'disabled' : ''}`}
                                    onClick={() => scroll('left')}
                                    disabled={!showLeftArrow}
                                    aria-label="Scroll left"
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M15 18l-6-6 6-6" />
                                    </svg>
                                </button>
                                <button
                                    className={`content-row-nav-btn ${!showRightArrow ? 'disabled' : ''}`}
                                    onClick={() => scroll('right')}
                                    disabled={!showRightArrow}
                                    aria-label="Scroll right"
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M9 18l6-6-6-6" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <div
                            ref={scrollRef}
                            className="content-row-items"
                            onScroll={handleScroll}
                        >
                            {continueWatching.map((entry) => {
                                const hasNextEp = !!entry.nextEpisode;
                                const progress = hasNextEp ? 100 : getProgressPercent(entry.history);
                                const percentLabel = hasNextEp ? 'Next' : `${Math.round(progress)}%`;
                                const isTV = entry.history.media_type === 'tv';
                                return (
                                    <div
                                        key={`${entry.history.media_type}-${entry.history.tmdb_id}`}
                                        className="continue-watching-item"
                                        onClick={() => handleResume(entry)}
                                        role="button"
                                        tabIndex={0}
                                        onKeyDown={(e) => e.key === 'Enter' && handleResume(entry)}
                                    >
                                        <img
                                            src={getPosterUrl(entry.content.poster_path, 'medium')}
                                            alt={'title' in entry.content ? entry.content.title : entry.content.name}
                                            loading="lazy"
                                        />
                                        <button
                                            className="continue-watching-item-remove"
                                            onClick={(e) => handleDelete(e, entry)}
                                            aria-label="Remove from continue watching"
                                        >
                                            <X size={16} strokeWidth={2.5} />
                                        </button>
                                        <div className="continue-watching-overlay">
                                            <span className="continue-watching-title">
                                                {'title' in entry.content ? entry.content.title : entry.content.name}
                                            </span>
                                            <span className="continue-watching-meta">
                                                {isTV
                                                    ? (entry.nextEpisode
                                                        ? `Watch S${entry.nextEpisode.seasonNumber}E${entry.nextEpisode.episodeNumber}`
                                                        : `Continue S${entry.history.season_number || 1}E${entry.history.episode_number || 1}`)
                                                    : formatRemaining(entry.history)}
                                            </span>
                                        </div>
                                        <span className="continue-watching-percent">{percentLabel}</span>
                                        <div className="continue-watching-progress">
                                            <div
                                                className="continue-watching-progress-fill"
                                                style={{ width: `${progress}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                <ContentRow
                    title="Trending Now"
                    items={trending}
                />
                <ContentRow
                    title="Popular Movies"
                    items={popularMovies}
                />
                <ContentRow
                    title="Popular TV Shows"
                    items={popularTVShows}
                />
                <ContentRow
                    title="Top Rated Movies"
                    items={topRatedMovies}
                />
            </div>
            <Footer />
        </div>
    );
}

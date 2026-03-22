import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
    nextEpisode?: {
        seasonNumber: number;
        episodeNumber: number;
        name: string;
    };
}

const HOME_CACHE_KEY = 'delulu_home_cache_v1';

interface PersistedHomeCache {
    hero: TMDBContent[];
    trending: TMDBContent[];
    popularMovies: TMDBMovie[];
    popularTVShows: TMDBTVShow[];
    topRated: TMDBMovie[];
}

function readPersistedHomeCache(): PersistedHomeCache | null {
    try {
        const raw = sessionStorage.getItem(HOME_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<PersistedHomeCache>;
        if (!Array.isArray(parsed.trending) || parsed.trending.length === 0) return null;
        return {
            hero: Array.isArray(parsed.hero) ? parsed.hero : [],
            trending: parsed.trending as TMDBContent[],
            popularMovies: Array.isArray(parsed.popularMovies) ? (parsed.popularMovies as TMDBMovie[]) : [],
            popularTVShows: Array.isArray(parsed.popularTVShows) ? (parsed.popularTVShows as TMDBTVShow[]) : [],
            topRated: Array.isArray(parsed.topRated) ? (parsed.topRated as TMDBMovie[]) : [],
        };
    } catch {
        return null;
    }
}

function persistHomeCache(cache: PersistedHomeCache) {
    try {
        sessionStorage.setItem(HOME_CACHE_KEY, JSON.stringify(cache));
    } catch {
        // ignore storage errors
    }
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
let cachedContinueWatching: ContinueWatchingEntry[] = [];
let cachedScrollY = 0;

const persistedCache = readPersistedHomeCache();
if (persistedCache) {
    if (cachedHero.length === 0) cachedHero = persistedCache.hero;
    if (cachedTrending.length === 0) cachedTrending = persistedCache.trending;
    if (cachedPopularMovies.length === 0) cachedPopularMovies = persistedCache.popularMovies;
    if (cachedPopularTVShows.length === 0) cachedPopularTVShows = persistedCache.popularTVShows;
    if (cachedTopRated.length === 0) cachedTopRated = persistedCache.topRated;
}

export function Home() {
    const navigate = useNavigate();
    const { playMedia } = usePlayer();
    const [heroItems, setHeroItems] = useState<TMDBContent[]>(cachedHero);
    const [trending, setTrending] = useState<TMDBContent[]>(cachedTrending);
    const [popularMovies, setPopularMovies] = useState<TMDBMovie[]>(cachedPopularMovies);
    const [popularTVShows, setPopularTVShows] = useState<TMDBTVShow[]>(cachedPopularTVShows);
    const [topRatedMovies, setTopRatedMovies] = useState<TMDBMovie[]>(cachedTopRated);
    const [continueWatching, setContinueWatching] = useState<ContinueWatchingEntry[]>(cachedContinueWatching);
    const [isLoading, setIsLoading] = useState(cachedTrending.length === 0);

    const scrollRef = useRef<HTMLDivElement>(null);
    const [showLeftArrow, setShowLeftArrow] = useState(false);
    const [showRightArrow, setShowRightArrow] = useState(true);
    const [showContinueWatchingNav, setShowContinueWatchingNav] = useState(false);
    const topThreeTrending = trending.slice(0, 3);
    const moodChips = ['Midnight Tension', 'Slow Burn', 'Cerebral', 'Pulse-Heavy', 'Lonely Nights', 'Cathartic'];
    const [selectedMood, setSelectedMood] = useState(moodChips[0]);
    const moodGrid = useMemo(() => {
        const merged: TMDBContent[] = [...trending, ...popularMovies, ...popularTVShows, ...topRatedMovies];
        const unique = new Map<string, TMDBContent>();
        for (const item of merged) {
            const key = `${getMediaType(item)}-${item.id}`;
            if (!unique.has(key)) unique.set(key, item);
        }

        const moodProfiles: Record<string, { genres: number[]; words: string[] }> = {
            'Midnight Tension': { genres: [53, 9648, 27, 80], words: ['night', 'dark', 'danger', 'chase', 'crime', 'killer'] },
            'Slow Burn': { genres: [18, 10749, 36], words: ['journey', 'quiet', 'family', 'memory', 'drama', 'life'] },
            'Cerebral': { genres: [878, 9648, 99], words: ['mind', 'future', 'space', 'science', 'mystery', 'theory'] },
            'Pulse-Heavy': { genres: [28, 12, 10759], words: ['battle', 'war', 'survival', 'mission', 'fight', 'revenge'] },
            'Lonely Nights': { genres: [18, 10751, 35], words: ['lonely', 'lost', 'alone', 'heart', 'friendship', 'city'] },
            'Cathartic': { genres: [18, 14, 10770], words: ['healing', 'hope', 'redemption', 'dream', 'spirit', 'home'] },
        };

        const profile = moodProfiles[selectedMood] ?? moodProfiles['Midnight Tension'];
        const scored = Array.from(unique.values())
            .map((item) => {
                const title = getTitle(item).toLowerCase();
                const overview = (item.overview || '').toLowerCase();
                const text = `${title} ${overview}`;
                const genreScore = (item.genre_ids || []).reduce((sum, g) => sum + (profile.genres.includes(g) ? 2 : 0), 0);
                const wordScore = profile.words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
                const popularityBoost = Math.min(2, Math.max(0, (item.vote_average || 0) / 5));
                return { item, score: genreScore + wordScore + popularityBoost };
            })
            .sort((a, b) => b.score - a.score)
            .map((entry) => entry.item);

        const withPoster = scored.filter((item) => !!item.poster_path);
        const pool = withPoster.length >= 4 ? withPoster : scored;
        return pool.slice(0, 4);
    }, [trending, popularMovies, popularTVShows, topRatedMovies, selectedMood]);

    const updateContinueWatchingNavState = useCallback(() => {
        if (!scrollRef.current) return;
        const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
        const hasOverflow = scrollWidth - clientWidth > 8;
        setShowContinueWatchingNav(hasOverflow);
        setShowLeftArrow(hasOverflow && scrollLeft > 20);
        setShowRightArrow(hasOverflow && scrollLeft < scrollWidth - clientWidth - 20);
    }, []);

    const handleScroll = () => {
        updateContinueWatchingNavState();
    };

    const scroll = (direction: 'left' | 'right') => {
        if (!scrollRef.current) return;
        const container = scrollRef.current;
        const scrollAmount = container.clientWidth * 0.8;
        const target =
            direction === 'left'
                ? container.scrollLeft - scrollAmount
                : container.scrollLeft + scrollAmount;
        const start = container.scrollLeft;
        const distance = target - start;
        const duration = 500;
        let startTime: number | null = null;

        const ease = (t: number) =>
            t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

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
    useEffect(() => { cachedContinueWatching = continueWatching; }, [continueWatching]);
    useEffect(() => {
        if (trending.length === 0) return;
        persistHomeCache({
            hero: heroItems,
            trending,
            popularMovies,
            popularTVShows,
            topRated: topRatedMovies,
        });
    }, [heroItems, trending, popularMovies, popularTVShows, topRatedMovies]);

    // Restore scroll position on mount, save on unmount
    useEffect(() => {
        if (cachedScrollY > 0) {
            requestAnimationFrame(() => window.scrollTo(0, cachedScrollY));
        }
        return () => { cachedScrollY = window.scrollY; };
    }, []);

    const fetchContinueWatching = useCallback(async () => {
        try {
            const historyItems = await watchService.getContinueWatching(12);
            if (!historyItems.length) { setContinueWatching([]); return; }

            const resolved = await Promise.allSettled(
                historyItems.map(async (history): Promise<ContinueWatchingEntry | null> => {
                    if (history.media_type === 'movie') {
                        const details = await getMovieDetails(history.tmdb_id);
                        return { history, content: toMovieContent(details) };
                    }

                    const details = await getTVShowDetails(history.tmdb_id);
                    const entry: ContinueWatchingEntry = { history, content: toTVContent(details) };

                    if (history.is_completed && history.media_type === 'tv') {
                        const curSeason = history.season_number ?? 1;
                        const curEpisode = history.episode_number ?? 1;

                        try {
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
                                const seasons = details.seasons
                                    ?.filter((s) => s.season_number > 0)
                                    .sort((a, b) => a.season_number - b.season_number);
                                const nextSeason = seasons?.find((s) => s.season_number > curSeason);
                                if (nextSeason) {
                                    const nextSeasonData = await getSeasonDetails(history.tmdb_id, nextSeason.season_number);
                                    const firstEp = nextSeasonData.episodes[0];
                                    if (firstEp) {
                                        entry.nextEpisode = {
                                            seasonNumber: nextSeason.season_number,
                                            episodeNumber: firstEp.episode_number,
                                            name: firstEp.name,
                                        };
                                    }
                                }
                                if (!entry.nextEpisode) return null;
                            }
                        } catch {
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

            setContinueWatching(entries);
        } catch (error) {
            console.error('[Home] Error fetching continue watching:', error);
            setContinueWatching([]);
        }
    }, []);

    useEffect(() => {
        if (cachedTrending.length > 0) {
            setIsLoading(false);
            fetchContinueWatching().catch(console.error);
            return;
        }

        getTrending('all', 'week').then((data) => {
            setHeroItems(data.slice(0, 5));
            setTrending(data);
            setIsLoading(false);
        }).catch((err) => {
            console.error('[Home] Failed to load trending:', err);
            setIsLoading(false);
        });

        getPopularMovies().then((data) => setPopularMovies(data.results)).catch(console.error);
        getPopularTVShows().then((data) => setPopularTVShows(data.results)).catch(console.error);
        getTopRatedMovies().then((data) => setTopRatedMovies(data.results)).catch(console.error);
        fetchContinueWatching().catch(console.error);
    }, [fetchContinueWatching]);

    useEffect(() => {
        const onFocus = () => {
            if (document.visibilityState !== 'visible') return;
            fetchContinueWatching().catch(console.error);
        };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onFocus);
        return () => {
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onFocus);
        };
    }, [fetchContinueWatching]);

    useEffect(() => {
        const runUpdate = () => updateContinueWatchingNavState();
        const raf = requestAnimationFrame(runUpdate);
        window.addEventListener('resize', runUpdate);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', runUpdate);
        };
    }, [continueWatching, updateContinueWatchingNavState]);

    const handleResume = (entry: ContinueWatchingEntry) => {
        const { history, content, nextEpisode } = entry;
        const poster = content.poster_path || '';
        const showName = 'name' in content ? content.name : 'TV Show';

        if (history.media_type === 'movie') {
            const movieTitle = 'title' in content ? content.title : 'Movie';
            playMedia({ mediaType: 'movie', tmdbId: history.tmdb_id, title: movieTitle, posterPath: poster, initialTime: history.current_time });
            return;
        }

        if (nextEpisode) {
            const nextTitle = `${showName} - S${nextEpisode.seasonNumber}E${nextEpisode.episodeNumber}: ${nextEpisode.name}`;
            playMedia({ mediaType: 'tv', tmdbId: history.tmdb_id, season: nextEpisode.seasonNumber, episode: nextEpisode.episodeNumber, title: nextTitle, posterPath: poster, initialTime: 0 });
            return;
        }

        const tvTitle = `${showName} - S${history.season_number || 1}E${history.episode_number || 1}`;
        playMedia({ mediaType: 'tv', tmdbId: history.tmdb_id, season: history.season_number || 1, episode: history.episode_number || 1, title: tvTitle, posterPath: poster, initialTime: history.current_time });
    };

    const handleDelete = async (e: React.MouseEvent, entry: ContinueWatchingEntry) => {
        e.preventDefault();
        e.stopPropagation();
        await watchService.removeRecord({
            tmdbId: entry.history.tmdb_id,
            mediaType: entry.history.media_type,
            seasonNumber: entry.history.season_number || undefined,
            episodeNumber: entry.history.episode_number || undefined,
        });
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

                {/* ── Continue Watching ── */}
                {continueWatching.length > 0 && (
                    <section className="home-section continue-watching-section">
                        <div className="home-section-header">
                            <div className="home-section-label">Resume</div>
                            <h2 className="home-section-title">Continue Watching</h2>
                            <div className="home-section-rule" />
                        </div>
                        {showContinueWatchingNav && (
                            <div className="content-row-header-nav">
                                <button
                                    className={`content-row-nav-btn ${!showLeftArrow ? 'disabled' : ''}`}
                                    onClick={() => scroll('left')}
                                    disabled={!showLeftArrow}
                                    aria-label="Scroll left"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M15 18l-6-6 6-6" />
                                    </svg>
                                </button>
                                <button
                                    className={`content-row-nav-btn ${!showRightArrow ? 'disabled' : ''}`}
                                    onClick={() => scroll('right')}
                                    disabled={!showRightArrow}
                                    aria-label="Scroll right"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M9 18l6-6-6-6" />
                                    </svg>
                                </button>
                            </div>
                        )}
                        <div
                            ref={scrollRef}
                            className="content-row-items continue-watching-row"
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
                                            <X size={14} strokeWidth={2.5} />
                                        </button>
                                        <div className="continue-watching-overlay">
                                            <span className="continue-watching-title">
                                                {'title' in entry.content ? entry.content.title : entry.content.name}
                                            </span>
                                            <span className="continue-watching-meta">
                                                {isTV
                                                    ? entry.nextEpisode
                                                        ? `Watch S${entry.nextEpisode.seasonNumber}E${entry.nextEpisode.episodeNumber}`
                                                        : `Continue S${entry.history.season_number || 1}E${entry.history.episode_number || 1}`
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

                {/* ── What's Burning (Top 3) ── */}
                {topThreeTrending.length > 0 && (
                    <section className="home-section top3-section">
                        <div className="home-section-header">
                            <div className="home-section-label">Right Now</div>
                            <h2 className="home-section-title">What's Burning</h2>
                            <div className="home-section-rule" />
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
                                                <span className="top3-subtitle">
                                                    {mediaType.toUpperCase()} · {getReleaseYear(item)}
                                                </span>
                                            </div>
                                            <span className="top3-chip">Top Pick</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* ── Trending Now ── */}
                <section className="home-section">
                    <div className="home-section-header">
                        <div className="home-section-label">Trending</div>
                        <h2 className="home-section-title">Trending Now</h2>
                        <div className="home-section-rule" />
                    </div>
                    <ContentRow title="" items={trending} />
                </section>

                {moodGrid.length > 0 && (
                    <section className="home-section mood-section">
                        <div className="home-section-header">
                            <div className="home-section-label">Browse by Mood</div>
                            <h2 className="home-section-title">How Are You Feeling?</h2>
                            <div className="home-section-rule" />
                        </div>

                        <div className="mood-chip-row">
                            {moodChips.map((chip) => (
                                <button
                                    key={chip}
                                    type="button"
                                    className={`mood-chip ${chip === selectedMood ? 'active' : ''}`}
                                    onClick={() => setSelectedMood(chip)}
                                    aria-pressed={chip === selectedMood}
                                >
                                    {chip}
                                </button>
                            ))}
                        </div>

                        <div className="mood-editorial-grid">
                            {moodGrid.map((item, index) => {
                                const mediaType = getMediaType(item);
                                const year = getReleaseYear(item);
                                const title = getTitle(item);
                                const rating = Number.isFinite(item.vote_average) ? item.vote_average.toFixed(1) : 'N/A';
                                return (
                                    <button
                                        key={`mood-${mediaType}-${item.id}`}
                                        type="button"
                                        className="mood-editorial-item"
                                        onClick={() => navigate(`/details/${mediaType}/${item.id}`)}
                                    >
                                        <span className="mood-item-rank">{index + 1}</span>
                                        <img
                                            className="mood-item-poster"
                                            src={getPosterUrl(item.poster_path, 'medium')}
                                            alt={title}
                                            loading="lazy"
                                        />
                                        <span className="mood-item-info">
                                            <span className="mood-item-title">{title}</span>
                                            <span className="mood-item-meta">
                                                {mediaType.toUpperCase()} · {year} · ★ {rating}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* ── Popular Movies ── */}
                <section className="home-section">
                    <div className="home-section-header">
                        <div className="home-section-label">Cinema</div>
                        <h2 className="home-section-title">Popular Movies</h2>
                        <div className="home-section-rule" />
                    </div>
                    <ContentRow title="" items={popularMovies} />
                </section>

                {/* ── Popular TV Shows ── */}
                <section className="home-section">
                    <div className="home-section-header">
                        <div className="home-section-label">Television</div>
                        <h2 className="home-section-title">Popular TV Shows</h2>
                        <div className="home-section-rule" />
                    </div>
                    <ContentRow title="" items={popularTVShows} />
                </section>

                {/* ── Top Rated ── */}
                <section className="home-section">
                    <div className="home-section-header">
                        <div className="home-section-label">Acclaimed</div>
                        <h2 className="home-section-title">Top Rated Movies</h2>
                        <div className="home-section-rule" />
                    </div>
                    <ContentRow title="" items={topRatedMovies} />
                </section>

            </div>

            <Footer />
        </div>
    );
}

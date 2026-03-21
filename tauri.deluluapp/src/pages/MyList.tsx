import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Play, Trash2 } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { watchService, type WatchHistoryItem } from '../services/watchHistory';
import {
    getMovieDetails,
    getTVShowDetails,
    getSeasonDetails,
    getPosterUrl,
    type TMDBContent,
    type TMDBMovie,
    type TMDBTVShow,
} from '../services/tmdb';
import { useUserListsSafe } from '../context/UserListsContext';
import './MyList.css';

type TabKey = 'continue' | 'watchlist' | 'favorites';

interface ContinueItem {
    history: WatchHistoryItem;
    content: TMDBContent;
    /** If the last episode was completed, this points to the next episode to watch */
    nextEpisode?: {
        seasonNumber: number;
        episodeNumber: number;
        name: string;
    };
}

function getProgressPercent(history: WatchHistoryItem): number {
    if (!history.total_duration || history.total_duration <= 0) return 0;
    return Math.min(100, Math.max(0, (history.current_time / history.total_duration) * 100));
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

export function MyList() {
    const navigate = useNavigate();
    const { playMedia } = usePlayer();
    const [searchParams, setSearchParams] = useSearchParams();
    const userLists = useUserListsSafe();

    const requestedTab = (searchParams.get('tab') || 'continue') as TabKey;
    const initialTab: TabKey = ['continue', 'watchlist', 'favorites'].includes(requestedTab)
        ? requestedTab
        : 'continue';

    const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
    const [isLoadingContinue, setIsLoadingContinue] = useState(true);
    const [continueItems, setContinueItems] = useState<ContinueItem[]>([]);
    const [isClearing, setIsClearing] = useState(false);

    const setTab = (tab: TabKey) => {
        setActiveTab(tab);
        setSearchParams({ tab });
    };

    const loadContinueWatching = async () => {
        setIsLoadingContinue(true);
        try {
            const historyItems = await watchService.getContinueWatching(80);
            const resolved = await Promise.allSettled(
                historyItems.map(async (history): Promise<ContinueItem | null> => {
                    if (history.media_type === 'movie') {
                        const details = await getMovieDetails(history.tmdb_id);
                        return { history, content: toMovieContent(details) };
                    }

                    const details = await getTVShowDetails(history.tmdb_id);
                    const entry: ContinueItem = { history, content: toTVContent(details) };

                    // If this TV episode was completed, resolve the NEXT episode
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
                            console.error('[MyList] Failed to resolve next episode for', history.tmdb_id);
                        }
                    }

                    return entry;
                })
            );

            const parsed = resolved
                .filter((r): r is PromiseFulfilledResult<ContinueItem | null> => r.status === 'fulfilled')
                .map((r) => r.value)
                .filter((entry): entry is ContinueItem => entry !== null);

            setContinueItems(parsed);
        } catch (error) {
            console.error('Failed loading continue watching:', error);
            setContinueItems([]);
        } finally {
            setIsLoadingContinue(false);
        }
    };

    useEffect(() => {
        loadContinueWatching().catch(console.error);
        const onFocus = () => loadContinueWatching().catch(console.error);
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, []);

    useEffect(() => {
        const tab = (searchParams.get('tab') || 'continue') as TabKey;
        if (['continue', 'watchlist', 'favorites'].includes(tab)) {
            setActiveTab(tab);
        }
    }, [searchParams]);

    const sortedContinueItems = useMemo(
        () =>
            [...continueItems].sort(
                (a, b) =>
                    new Date(b.history.last_watched_at).getTime() -
                    new Date(a.history.last_watched_at).getTime()
            ),
        [continueItems]
    );

    const watchlistItems = userLists?.lists.watchlist || [];
    const favoriteItems = userLists?.lists.favorites || [];

    const resumeItem = (entry: ContinueItem) => {
        const { history, content, nextEpisode } = entry;
        const posterPath = content.poster_path || '';
        const showName = 'name' in content ? content.name : 'TV Show';

        if (history.media_type === 'movie') {
            const movieTitle = 'title' in content ? content.title : 'Movie';
            playMedia({
                mediaType: 'movie',
                tmdbId: history.tmdb_id,
                title: movieTitle,
                posterPath,
                initialTime: history.current_time,
            });
            return;
        }

        // If this entry has a resolved next episode, play that
        if (nextEpisode) {
            const nextTitle = `${showName} - S${nextEpisode.seasonNumber}E${nextEpisode.episodeNumber}: ${nextEpisode.name}`;
            playMedia({
                mediaType: 'tv',
                tmdbId: history.tmdb_id,
                season: nextEpisode.seasonNumber,
                episode: nextEpisode.episodeNumber,
                title: nextTitle,
                posterPath,
                initialTime: 0,
            });
            return;
        }

        const season = history.season_number || 1;
        const episode = history.episode_number || 1;
        const tvTitle = `${showName} - S${season}E${episode}`;
        playMedia({
            mediaType: 'tv',
            tmdbId: history.tmdb_id,
            season,
            episode,
            title: tvTitle,
            posterPath,
            initialTime: history.current_time,
        });
    };

    const removeContinueItem = async (entry: ContinueItem) => {
        await watchService.removeRecord({
            tmdbId: entry.history.tmdb_id,
            mediaType: entry.history.media_type,
            seasonNumber: entry.history.season_number ?? undefined,
            episodeNumber: entry.history.episode_number ?? undefined,
        });
        setContinueItems((prev) =>
            prev.filter((p) => {
                const sameBase =
                    p.history.tmdb_id === entry.history.tmdb_id &&
                    p.history.media_type === entry.history.media_type;
                if (entry.history.media_type === 'tv') {
                    return !sameBase;
                }
                const sameSeason = (p.history.season_number ?? null) === (entry.history.season_number ?? null);
                const sameEpisode = (p.history.episode_number ?? null) === (entry.history.episode_number ?? null);
                return !(sameBase && sameSeason && sameEpisode);
            })
        );
    };

    const clearAllContinue = async () => {
        setIsClearing(true);
        await watchService.clearHistory();
        setContinueItems([]);
        setIsClearing(false);
    };

    const removeSavedItem = async (id: number, type: 'movie' | 'tv', tab: 'watchlist' | 'favorites') => {
        if (!userLists) return;
        if (tab === 'watchlist') {
            await userLists.removeFromWatchlist(id, type);
        } else {
            await userLists.removeFromFavorites(id, type);
        }
    };

    const formatContinueMeta = (entry: ContinueItem) => {
        const { history, nextEpisode } = entry;
        const progress = getProgressPercent(history);

        if (history.media_type === 'tv') {
            if (nextEpisode) {
                return `Watch S${nextEpisode.seasonNumber}E${nextEpisode.episodeNumber}: ${nextEpisode.name}`;
            }
            const multiEpisode = (history.episodes_in_progress || 1) > 1
                ? ` • ${history.episodes_in_progress} eps in progress`
                : '';
            return `S${history.season_number || 1}E${history.episode_number || 1} • ${Math.round(progress)}%${multiEpisode}`;
        }
        const remainingSeconds = Math.max(0, (history.total_duration || 0) - (history.current_time || 0));
        const remainingMinutes = Math.max(1, Math.ceil(remainingSeconds / 60));
        return `${remainingMinutes}m left • ${Math.round(progress)}%`;
    };

    const renderContinue = () => {
        if (isLoadingContinue) {
            return (
                <div className="mylist-loading">
                    <Loader2 size={44} className="spin" />
                    <p>Loading continue watching...</p>
                </div>
            );
        }

        if (!sortedContinueItems.length) {
            return (
                <div className="mylist-empty">
                    <div className="mylist-empty-icon">🎬</div>
                    <h2>No active watch sessions</h2>
                    <p>Start something and your progress will appear here automatically.</p>
                    <button className="btn btn-primary btn-lg" onClick={() => navigate('/')}>
                        Explore Home
                    </button>
                </div>
            );
        }

        return (
            <div className="mylist-continue-container">
                <div className="mylist-continue-grid">
                    {sortedContinueItems.map((entry) => {
                        const title = 'title' in entry.content ? entry.content.title : entry.content.name;
                        const hasNextEp = !!entry.nextEpisode;
                        const progress = hasNextEp ? 100 : getProgressPercent(entry.history);
                        const key = entry.history.media_type === 'tv'
                            ? `tv-${entry.history.tmdb_id}`
                            : `movie-${entry.history.tmdb_id}`;
                        const bgImage = entry.content.backdrop_path || entry.content.poster_path;
                        return (
                            <article
                                key={key}
                                className="mylist-continue-card"
                                onClick={() => resumeItem(entry)}
                            >
                                <img className="mylist-continue-bg" src={getPosterUrl(bgImage, 'large')} alt={title} />
                                <div className="mylist-continue-overlay" />

                                <button className="mylist-continue-remove" onClick={(e) => { e.stopPropagation(); removeContinueItem(entry); }}>
                                    <Trash2 size={16} />
                                </button>

                                <div className="mylist-continue-content">
                                    <div className="mylist-continue-info">
                                        <h3 className="mylist-continue-title">{title}</h3>
                                        <p className="mylist-continue-meta">{formatContinueMeta(entry)}</p>
                                    </div>
                                    <button className="mylist-continue-play" onClick={(e) => { e.stopPropagation(); resumeItem(entry); }}>
                                        <Play size={16} fill="currentColor" />
                                        <span>{hasNextEp ? 'Watch Next' : 'Continue Watching'}</span>
                                    </button>
                                </div>

                                <div className="mylist-continue-progress-track">
                                    <div className="mylist-continue-progress-fill" style={{ transform: `scaleX(${progress / 100})` }} />
                                </div>
                            </article>
                        );
                    })}
                </div>
            </div>
        );
    };

    const renderSaved = (tab: 'watchlist' | 'favorites') => {
        if (!userLists) return null;

        const list = tab === 'watchlist' ? watchlistItems : favoriteItems;
        if (!list.length) {
            return (
                <div className="mylist-empty">
                    <div className="mylist-empty-icon">{tab === 'watchlist' ? '📭' : '💔'}</div>
                    <h2>{tab === 'watchlist' ? 'Watchlist is empty' : 'No liked titles yet'}</h2>
                    <p>
                        {tab === 'watchlist'
                            ? 'Add titles using the My List button from details pages.'
                            : 'Tap the heart button on details pages to like a title.'}
                    </p>
                    <button className="btn btn-primary btn-lg" onClick={() => navigate('/')}>
                        Browse Content
                    </button>
                </div>
            );
        }

        return (
            <div className="mylist-grid">
                {list.map((item) => (
                    <article key={`${item.type}-${item.id}`} className="mylist-card">
                        <div className="mylist-card-poster" onClick={() => navigate(`/details/${item.type}/${item.id}`)}>
                            <img src={getPosterUrl(item.posterPath, 'medium')} alt={item.title} />
                            <div className="mylist-card-overlay" />
                            <button className="mylist-card-play-btn">
                                <Play size={20} fill="currentColor" />
                            </button>
                            <button
                                className="mylist-card-remove-btn"
                                onClick={(e) => { e.stopPropagation(); removeSavedItem(item.id, item.type, tab); }}
                            >
                                <Trash2 size={18} />
                            </button>
                            <div className="mylist-card-info">
                                <h3 className="mylist-card-title">{item.title}</h3>
                                <p className="mylist-card-meta">
                                    {item.type === 'movie' ? 'Movie' : 'TV Show'}
                                </p>
                            </div>
                        </div>
                    </article>
                ))}
            </div>
        );
    };

    return (
        <div className="mylist-page page">
            <div className="mylist-header">
                <div className="mylist-header-title-area">
                    <h1 className="mylist-title">My List</h1>
                    <p className="mylist-subtitle">Your playback progress and saved library.</p>
                </div>

                <div className="mylist-header-controls">
                    <div className="mylist-segmented-control">
                        <button className={`mylist-segment ${activeTab === 'continue' ? 'active' : ''}`} onClick={() => setTab('continue')}>
                            Continue
                            {continueItems.length > 0 && <span className="mylist-badge">{continueItems.length}</span>}
                        </button>
                        <button className={`mylist-segment ${activeTab === 'watchlist' ? 'active' : ''}`} onClick={() => setTab('watchlist')}>
                            Watchlist
                            {watchlistItems.length > 0 && <span className="mylist-badge">{watchlistItems.length}</span>}
                        </button>
                        <button className={`mylist-segment ${activeTab === 'favorites' ? 'active' : ''}`} onClick={() => setTab('favorites')}>
                            Favorites
                            {favoriteItems.length > 0 && <span className="mylist-badge">{favoriteItems.length}</span>}
                        </button>
                    </div>

                    {activeTab === 'continue' && continueItems.length > 0 && (
                        <button className="mylist-clear-btn" onClick={clearAllContinue} disabled={isClearing}>
                            {isClearing ? 'Clearing...' : 'Clear History'}
                        </button>
                    )}
                </div>
            </div>

            <div className="mylist-content">
                {activeTab === 'continue' && renderContinue()}
                {activeTab === 'watchlist' && renderSaved('watchlist')}
                {activeTab === 'favorites' && renderSaved('favorites')}
            </div>
        </div>
    );
}

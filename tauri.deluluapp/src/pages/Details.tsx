import { useState, useEffect, useRef, useCallback, type SyntheticEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { open } from '@tauri-apps/plugin-shell';
import { SkeletonDetail } from '../components/skeleton/Skeleton';
import { SeasonEpisodeSelector } from '../components/content/SeasonEpisodeSelector';
import { useUserListsSafe } from '../context/UserListsContext';
import {
    getMovieDetails,
    getMovieReleaseDates,
    getTVShowDetails,
    getCredits,
    getTrailer,
    getPosterUrl,
    getBackdropUrl,
    getProfileUrl,
    type TMDBContentDetails,
    type TMDBTVShowDetails,
    type TMDBCastMember,
    type TMDBSeason,
    type TMDBVideo,
} from '../services/tmdb';
import { watchService } from '../services/watchHistory';
import { usePlayer } from '../context/PlayerContext';

import './Details.css';

type ResumeTarget = {
    initialTime: number;
    seasonNumber?: number;
    episodeNumber?: number;
};

function parseYyyyMmDdToLocalMidnight(dateStr?: string): number | null {
    if (!dateStr) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    const ts = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
    return Number.isNaN(ts) ? null : ts;
}

function isMovieStatusUnreleased(status?: string): boolean {
    if (!status) return false;
    const s = status.trim().toLowerCase();
    return s === 'rumored' || s === 'planned' || s === 'in production' || s === 'post production';
}

function parseAnyDateToMs(dateStr?: string): number | null {
    if (!dateStr) return null;
    const t = Date.parse(dateStr);
    if (!Number.isNaN(t)) return t;
    return parseYyyyMmDdToLocalMidnight(dateStr);
}

function pickPreferredMovieReleaseMs(
    data: Awaited<ReturnType<typeof getMovieReleaseDates>> | null
): number | null {
    if (!data?.results?.length) return null;

    const preferredTypes = new Set([3, 4]); // theatrical + digital
    const findEarliest = (countryCode?: string): number | null => {
        const groups = countryCode
            ? data.results.filter((r) => r.iso_3166_1 === countryCode)
            : data.results;

        const candidates: number[] = [];
        for (const group of groups) {
            for (const rd of group.release_dates || []) {
                if (!rd.release_date) continue;
                if (!preferredTypes.has(rd.type)) continue;
                const ts = parseAnyDateToMs(rd.release_date);
                if (ts !== null) candidates.push(ts);
            }
        }

        if (!candidates.length) return null;
        return Math.min(...candidates);
    };

    // Prefer US schedule for deterministic UX; fallback to global.
    return findEarliest('US') ?? findEarliest();
}

export function Details() {
    const { mediaType, id } = useParams<{ mediaType: string; id: string }>();
    const location = useLocation();
    const navigate = useNavigate();
    const userLists = useUserListsSafe();
    const { playMedia, playerState } = usePlayer();

    const navState = location.state as
        | {
            source?: string;
            mediaType?: 'movie' | 'tv';
            tmdbId?: number;
            season?: number;
            episode?: number;
        }
        | undefined;

    const stateMatchesCurrentTv =
        mediaType === 'tv' &&
        !!id &&
        navState?.mediaType === 'tv' &&
        navState?.tmdbId === parseInt(id, 10);

    const initialSeasonFromState = stateMatchesCurrentTv ? navState?.season : undefined;
    const initialEpisodeFromState = stateMatchesCurrentTv ? navState?.episode : undefined;

    const [details, setDetails] = useState<TMDBContentDetails | TMDBTVShowDetails | null>(null);
    const [seasons, setSeasons] = useState<TMDBSeason[]>([]);
    const [cast, setCast] = useState<TMDBCastMember[]>([]);
    const [trailer, setTrailer] = useState<TMDBVideo | null>(null);
    const [preferredMovieReleaseMs, setPreferredMovieReleaseMs] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [resumeTarget, setResumeTarget] = useState<ResumeTarget | null>(null);
    const [showBackToTop, setShowBackToTop] = useState(false);
    const pageRef = useRef<HTMLDivElement | null>(null);


    useEffect(() => {
        const fetchDetails = async () => {
            if (!id || !mediaType) return;

            try {
                setIsLoading(true);
                const [contentDetails, credits, movieReleaseDates] = await Promise.all([
                    mediaType === 'movie'
                        ? getMovieDetails(parseInt(id))
                        : getTVShowDetails(parseInt(id)),
                    getCredits(mediaType as 'movie' | 'tv', parseInt(id)),
                    mediaType === 'movie'
                        ? getMovieReleaseDates(parseInt(id)).catch(() => null)
                        : Promise.resolve(null),
                ]);

                setDetails(contentDetails);
                setCast(credits.cast.slice(0, 10));
                setPreferredMovieReleaseMs(pickPreferredMovieReleaseMs(movieReleaseDates));

                const trailerData = await getTrailer(parseInt(id), mediaType as 'movie' | 'tv');
                setTrailer(trailerData);

                // Extract seasons for TV shows
                if (mediaType === 'tv' && 'seasons' in contentDetails) {
                    setSeasons((contentDetails as TMDBTVShowDetails).seasons || []);
                }
            } catch (error) {
                console.error('Error fetching details:', error);
                setPreferredMovieReleaseMs(null);
            } finally {
                setIsLoading(false);
            }
        };

        fetchDetails();
    }, [id, mediaType]);

    useEffect(() => {
        const resolveResumeTarget = async () => {
            if (!id || !mediaType) {
                setResumeTarget(null);
                return;
            }

            const tmdbId = parseInt(id, 10);

            try {
                if (mediaType === 'movie') {
                    const movieProgress = await watchService.getProgress({
                        tmdbId,
                        mediaType: 'movie',
                    });
                    if (movieProgress && movieProgress.current_time > 10) {
                        setResumeTarget({
                            initialTime: movieProgress.current_time,
                        });
                        return;
                    }

                    setResumeTarget(null);
                    return;
                }

                const continueItems = await watchService.getContinueWatching(200);
                const latestTv = continueItems.find(
                    (item) => item.media_type === 'tv' && item.tmdb_id === tmdbId
                );

                if (latestTv && latestTv.current_time > 10) {
                    setResumeTarget({
                        initialTime: latestTv.current_time,
                        seasonNumber: latestTv.season_number && latestTv.season_number > 0 ? latestTv.season_number : 1,
                        episodeNumber: latestTv.episode_number && latestTv.episode_number > 0 ? latestTv.episode_number : 1,
                    });
                    return;
                }

                setResumeTarget(null);
            } catch {
                setResumeTarget(null);
            }
        };

        resolveResumeTarget().catch(() => setResumeTarget(null));
    }, [id, mediaType]);


    useEffect(() => {
        const handleScroll = () => setShowBackToTop(window.scrollY > 400);
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const scrollToTop = useCallback(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const currentTmdbId = id ? parseInt(id, 10) : null;
    const releaseDate = details?.release_date || details?.first_air_date;
    const releaseTimestamp = parseYyyyMmDdToLocalMidnight(releaseDate);
    const now = new Date();
    const todayLocalMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const effectiveReleaseMs = mediaType === 'movie' && preferredMovieReleaseMs !== null
        ? preferredMovieReleaseMs
        : releaseTimestamp;
    const isFutureByDate =
        effectiveReleaseMs !== null &&
        effectiveReleaseMs > todayLocalMidnight;
    const isNotReleasedYet =
        isFutureByDate ||
        (mediaType === 'movie' && isMovieStatusUnreleased(details?.status));

    const isCurrentPlaying =
        !!currentTmdbId &&
        playerState.viewState !== 'hidden' &&
        playerState.media?.tmdbId === currentTmdbId &&
        playerState.media?.mediaType === mediaType;

    const primaryCtaLabel = isNotReleasedYet
        ? 'Not Released Yet'
        : isCurrentPlaying
        ? 'Playing'
        : resumeTarget
            ? 'Continue'
            : 'Play';

    // Primary play action - uses VidLink streaming
    const handlePlay = async () => {
        if (!id || !mediaType || !details) return;
        if (isNotReleasedYet) return;

        const title = details.title || details.name || 'Video';
        const poster = details.poster_path || '';
        const genre = details.genres?.slice(0, 3).map((g) => g.name).join(', ') || '';
        const tmdbId = parseInt(id, 10);

        if (isCurrentPlaying) return;

        if (mediaType === 'tv' && resumeTarget && resumeTarget.seasonNumber && resumeTarget.episodeNumber) {
            const episodeTitle = `${title} - S${resumeTarget.seasonNumber}E${resumeTarget.episodeNumber}`;
            playMedia({
                mediaType: 'tv',
                tmdbId,
                season: resumeTarget.seasonNumber,
                episode: resumeTarget.episodeNumber,
                title: episodeTitle,
                posterPath: poster,
                genre,
                initialTime: resumeTarget.initialTime,
            });
            return;
        }

        playMedia({
            mediaType: mediaType as 'movie' | 'tv',
            tmdbId,
            title,
            posterPath: poster,
            genre,
            initialTime: resumeTarget?.initialTime || 0,
        });
    };


    const handleToggleWatchlist = () => {
        if (!userLists || !details || !mediaType) return;

        const title = details.title || details.name || 'Unknown';
        userLists.toggleWatchlistItem({
            id: parseInt(id!),
            type: mediaType as 'movie' | 'tv',
            title,
            posterPath: details.poster_path,
        });
    };

    const handleToggleFavorites = () => {
        if (!userLists || !details || !mediaType) return;

        const title = details.title || details.name || 'Unknown';
        userLists.toggleFavoritesItem({
            id: parseInt(id!),
            type: mediaType as 'movie' | 'tv',
            title,
            posterPath: details.poster_path,
        });
    };


    const handleOpenTrailerInBrowser = () => {
        if (!trailer) return;
        const youtubeUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
        open(youtubeUrl).catch(() => window.open(youtubeUrl, '_blank'));
    };

    const handleBack = (e?: SyntheticEvent) => {
        e?.preventDefault();
        e?.stopPropagation();
        if (window.history.length > 1) {
            navigate(-1);
            return;
        }
        navigate('/');
    };
    // Check if current content is in lists
    const isInWatchlist = userLists && mediaType ?
        userLists.isInWatchlist(parseInt(id!), mediaType as 'movie' | 'tv') : false;
    const isInFavorites = userLists && mediaType ?
        userLists.isInFavorites(parseInt(id!), mediaType as 'movie' | 'tv') : false;

    if (isLoading || !details) {
        return (
            <div className="details-page page">
                <SkeletonDetail />
            </div>
        );
    }

    const title = details.title || details.name || 'Unknown';
    const year = releaseDate ? new Date(releaseDate).getFullYear() : 'N/A';
    const runtime = details.runtime || (details.episode_run_time?.[0] ?? 0);

    return (
        <div className="details-page" ref={pageRef}>
            <button
                className="details-back-btn"
                onPointerDown={handleBack}
                onClick={handleBack}
                aria-label="Go back"
                title="Back"
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                </svg>
            </button>
            {/* Backdrop */}
            <div
                className="details-backdrop"
                style={{
                    backgroundImage: `url(${getBackdropUrl(details.backdrop_path, 'original')})`,
                }}
            />
            <div className="details-backdrop-gradient" />

            {/* Content */}
            <div className="details-content">
                {/* Poster */}
                <div className="details-poster-wrapper">
                    <img
                        src={getPosterUrl(details.poster_path, 'large')}
                        alt={title}
                        className="details-poster"
                    />
                </div>

                {/* Info */}
                <div className="details-info">
                    <h1 className="details-title">{title}</h1>

                    <div className="details-meta">
                        <span className="details-rating">
                            <span className="details-rating-star">★</span>
                            {details.vote_average.toFixed(1)}
                        </span>
                        <span className="details-year">📅 {year}</span>
                        {runtime > 0 && (
                            <span className="details-runtime">⏱ {runtime} min</span>
                        )}
                        {details.number_of_seasons && (
                            <span className="details-seasons">{details.number_of_seasons} Seasons</span>
                        )}
                    </div>

                    {/* Genres */}
                    <div className="details-genres">
                        {details.genres.map((genre) => (
                            <span key={genre.id} className="tag">
                                {genre.name}
                            </span>
                        ))}
                    </div>

                    {/* Tagline */}
                    {details.tagline && (
                        <p className="details-tagline">"{details.tagline}"</p>
                    )}

                    {/* Overview */}
                    <p className="details-overview">{details.overview}</p>

                    {/* Action Buttons */}
                    <div className="details-actions">
                        <button
                            className="btn btn-primary btn-lg"
                            onClick={handlePlay}
                            disabled={isNotReleasedYet}
                            title={isNotReleasedYet ? `Releases on ${releaseDate}` : undefined}
                        >
                            {primaryCtaLabel}
                        </button>

                        <button
                            className="btn btn-ghost btn-lg"
                            onClick={handleOpenTrailerInBrowser}
                            disabled={!trailer}
                            title={trailer ? 'Watch Trailer' : 'No trailer available'}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                            Trailer
                        </button>

                        <button
                            className={`btn btn-ghost btn-lg ${isInWatchlist ? 'btn-active' : ''}`}
                            onClick={handleToggleWatchlist}
                        >
                            {isInWatchlist ? (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                                </svg>
                            ) : (
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 5v14M5 12h14" />
                                </svg>
                            )}
                            {isInWatchlist ? 'In Watchlist' : 'Watch List'}
                        </button>
                        <button
                            className={`btn btn-icon btn-ghost ${isInFavorites ? 'btn-active' : ''}`}
                            onClick={handleToggleFavorites}
                        >
                            <svg
                                width="20"
                                height="20"
                                viewBox="0 0 24 24"
                                fill={isInFavorites ? '#e50914' : 'none'}
                                stroke={isInFavorites ? '#e50914' : 'currentColor'}
                                strokeWidth="2"
                            >
                                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                            </svg>
                        </button>
                    </div>

                    {/* Cast */}
                    {cast.length > 0 && (
                        <div className="details-cast">
                            <h2 className="details-cast-title">Cast</h2>
                            <div className="details-cast-list">
                                {cast.map((member) => (
                                    <div key={member.id} className="details-cast-member">
                                        {member.profile_path ? (
                                            <img
                                                src={getProfileUrl(member.profile_path, 'medium')}
                                                alt={member.name}
                                                className="details-cast-photo"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                    const placeholder = (e.target as HTMLImageElement).nextElementSibling;
                                                    if (placeholder) placeholder.classList.remove('hidden');
                                                }}
                                            />
                                        ) : null}
                                        <div className={`details-cast-placeholder ${member.profile_path ? 'hidden' : ''}`}>
                                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                                <circle cx="12" cy="8" r="4" />
                                                <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
                                            </svg>
                                        </div>
                                        <span className="details-cast-name">{member.name}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Seasons & Episodes for TV Shows */}
                    {mediaType === 'tv' && seasons.length > 0 && id && (
                        <SeasonEpisodeSelector
                            tvId={parseInt(id)}
                            seasons={seasons}
                            showName={(details as any)?.name || 'TV Show'}
                            posterPath={details?.poster_path || undefined}
                            initialSeason={initialSeasonFromState}
                            initialEpisode={initialEpisodeFromState}
                            onEpisodeSelect={async (seasonNum, episodeNum, episodeName) => {
                                if (isNotReleasedYet) return;
                                const showName = (details as TMDBTVShowDetails)?.name || 'TV Show';
                                const episodeTitle = episodeName
                                    ? `${showName} - S${seasonNum}E${episodeNum}: ${episodeName}`
                                    : `${showName} - S${seasonNum}E${episodeNum}`;
                                const posterPath = details?.poster_path || '';
                                const genre = details.genres?.slice(0, 3).map((g) => g.name).join(', ') || '';
                                const tmdbId = parseInt(id, 10);

                                let resumeTime = 0;
                                try {
                                    const existingProgress = await watchService.getProgress({
                                        tmdbId,
                                        mediaType: 'tv',
                                        seasonNumber: seasonNum,
                                        episodeNumber: episodeNum,
                                    });
                                    resumeTime = existingProgress?.current_time || 0;
                                } catch {
                                    resumeTime = 0;
                                }

                                playMedia({ mediaType: 'tv', tmdbId, season: seasonNum, episode: episodeNum, title: episodeTitle, posterPath, genre, initialTime: resumeTime });
                            }}
                        />
                    )}
                </div>
            </div>
            {/* Back to Top - TV shows only */}
            {mediaType === "tv" && showBackToTop && (
                <button
                    className="back-to-top-btn"
                    onClick={scrollToTop}
                    aria-label="Back to top"
                    title="Back to top"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 15l-6-6-6 6" />
                    </svg>
                </button>
            )}
        </div>
    );
}




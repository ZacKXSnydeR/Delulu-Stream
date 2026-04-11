import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAddons } from '../../context/AddonContext';
import {
    getSeasonDetails,
    getStillUrl,
    type TMDBSeason,
    type TMDBEpisode,
    type TMDBSeasonDetails,
} from '../../services/tmdb';

import './SeasonEpisodeSelector.css';
import { SeasonDropdown } from './SeasonDropdown';

interface SeasonEpisodeSelectorProps {
    tvId: number;
    seasons: TMDBSeason[];
    showName?: string;
    posterPath?: string;
    onEpisodeSelect?: (seasonNumber: number, episodeNumber: number, episodeName?: string) => void;
    initialSeason?: number;
    initialEpisode?: number;
}

export function SeasonEpisodeSelector({
    tvId,
    seasons,
    showName: _showName,
    posterPath: _posterPath,
    onEpisodeSelect,
    initialSeason,
    initialEpisode,
}: SeasonEpisodeSelectorProps) {
    const { hasAddon } = useAddons();
    const navigate = useNavigate();
    // Filter out seasons with 0 episodes and sort by season number
    const validSeasons = seasons
        .filter((s) => s.episode_count > 0)
        .sort((a, b) => a.season_number - b.season_number);

    // Default to first non-special season, or first season
    const defaultSeason = validSeasons.find((s) => s.season_number > 0) || validSeasons[0];
    // Restore persisted season or use initial/default
    const getPersistedSeason = (): number => {
        if (initialSeason !== undefined) return initialSeason;
        try {
            const saved = sessionStorage.getItem(`delulu-season-${tvId}`);
            if (saved) return parseInt(saved, 10);
        } catch { /* ignore */ }
        return defaultSeason?.season_number ?? 1;
    };

    const getPersistedEpisode = (): number | null => {
        if (initialEpisode !== undefined) return initialEpisode;
        try {
            const saved = sessionStorage.getItem(`delulu-episode-${tvId}`);
            if (saved) return parseInt(saved, 10);
        } catch { /* ignore */ }
        return null;
    };

    const [selectedSeason, setSelectedSeason] = useState<number>(getPersistedSeason());
    const [selectedEpisode, setSelectedEpisode] = useState<number | null>(getPersistedEpisode());
    const [episodes, setEpisodes] = useState<TMDBEpisode[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const selectedEpisodeRef = useRef<HTMLDivElement>(null);
    const hasScrolledRef = useRef(false);

    // Cache for fetched seasons
    const [episodeCache] = useState<Map<number, TMDBEpisode[]>>(new Map());

    // Fetch episodes for selected season
    const fetchEpisodes = useCallback(async (seasonNumber: number) => {
        // Check cache first
        if (episodeCache.has(seasonNumber)) {
            setEpisodes(episodeCache.get(seasonNumber)!);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const seasonData: TMDBSeasonDetails = await getSeasonDetails(tvId, seasonNumber);
            const sortedEpisodes = seasonData.episodes.sort(
                (a, b) => a.episode_number - b.episode_number
            );
            episodeCache.set(seasonNumber, sortedEpisodes);
            setEpisodes(sortedEpisodes);
        } catch (err) {
            setError('Failed to load episodes');
            console.error('Error fetching episodes:', err);
        } finally {
            setIsLoading(false);
        }
    }, [tvId, episodeCache]);

    // Load episodes when season changes
    useEffect(() => {
        if (selectedSeason !== undefined) {
            fetchEpisodes(selectedSeason);
        }
    }, [selectedSeason, fetchEpisodes]);

    // Lenis-style smooth scroll to element
    const smoothScrollTo = useCallback((element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        const targetY = window.scrollY + rect.top - (window.innerHeight / 2) + (rect.height / 2);
        const startY = window.scrollY;
        const distance = targetY - startY;
        const duration = 1200; // ms
        let startTime: number | null = null;

        // Ease-out expo for Lenis-like feel
        const easeOutExpo = (t: number) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

        const step = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = easeOutExpo(progress);

            window.scrollTo(0, startY + distance * eased);

            if (progress < 1) {
                requestAnimationFrame(step);
            }
        };

        requestAnimationFrame(step);
    }, []);

    // Auto-scroll to selected episode after episodes load
    useEffect(() => {
        if (!isLoading && episodes.length > 0 && selectedEpisode !== null && !hasScrolledRef.current) {
            hasScrolledRef.current = true;
            setTimeout(() => {
                if (selectedEpisodeRef.current) {
                    smoothScrollTo(selectedEpisodeRef.current);
                }
            }, 400);
        }
    }, [isLoading, episodes, selectedEpisode, smoothScrollTo]);

    // Handle season selection
    const handleSeasonSelect = (seasonNumber: number) => {
        setSelectedSeason(seasonNumber);
        setSelectedEpisode(null); // reset episode on season change
        try {
            sessionStorage.setItem(`delulu-season-${tvId}`, String(seasonNumber));
            sessionStorage.removeItem(`delulu-episode-${tvId}`);
        } catch { /* ignore */ }
    };

    // Handle episode click
    const handleEpisodeClick = (episode: TMDBEpisode) => {
        // Guard: no add-on installed — do nothing, UI already signals this
        if (!hasAddon) return;

        const isUnreleased = !!episode.air_date && new Date(`${episode.air_date}T00:00:00Z`).getTime() > Date.now();
        if (isUnreleased) return;

        setSelectedEpisode(episode.episode_number);
        try {
            sessionStorage.setItem(`delulu-season-${tvId}`, String(selectedSeason));
            sessionStorage.setItem(`delulu-episode-${tvId}`, String(episode.episode_number));
        } catch { /* ignore */ }
        if (onEpisodeSelect) {
            onEpisodeSelect(selectedSeason, episode.episode_number, episode.name);
        }
    };


    // Format runtime
    const formatRuntime = (minutes: number | null): string => {
        if (!minutes) return '—';
        if (minutes < 60) return `${minutes}m`;
        const hrs = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
    };

    // Get season display name
    const getSeasonName = (season: TMDBSeason): string => {
        if (season.season_number === 0) return 'Specials';
        return season.name || `Season ${season.season_number}`;
    };

    const currentSeason = validSeasons.find((s) => s.season_number === selectedSeason);

    if (validSeasons.length === 0) {
        return null;
    }

    return (
        <div className="season-episode-selector">
            <SeasonDropdown
                seasons={validSeasons}
                selectedSeason={selectedSeason}
                onSeasonSelect={handleSeasonSelect}
            />

            {/* No Add-on Banner */}
            {!hasAddon && (
                <div className="episodes-no-addon-banner">
                    <div className="episodes-no-addon-icon">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="7" width="20" height="14" rx="2" />
                            <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                            <line x1="12" y1="12" x2="12" y2="16" />
                            <line x1="12" y1="11" x2="12.01" y2="11" />
                        </svg>
                    </div>
                    <div className="episodes-no-addon-text">
                        <strong>No streaming add-on installed</strong>
                        <span>Episodes are visible for browsing. Install a community add-on to enable playback.</span>
                    </div>
                    <button
                        className="episodes-no-addon-cta"
                        onClick={() => navigate('/settings')}
                    >
                        Get Add-ons
                    </button>
                </div>
            )}

            {/* Episodes List */}
            <div className="episodes-list">
                {isLoading && (
                    <div className="episodes-loading">
                        <div className="episodes-spinner" />
                        <span>Loading episodes...</span>
                    </div>
                )}

                {error && (
                    <div className="episodes-error">
                        <span>{error}</span>
                        <button onClick={() => fetchEpisodes(selectedSeason)}>Retry</button>
                    </div>
                )}

                {!isLoading && !error && episodes.length === 0 && (
                    <div className="episodes-empty">No episodes available</div>
                )}

                {!isLoading &&
                    !error &&
                    episodes.map((episode) => {
                        const isUnreleased = !!episode.air_date && new Date(`${episode.air_date}T00:00:00Z`).getTime() > Date.now();
                        const isAddonLocked = !hasAddon;
                        return (
                        <div
                            key={episode.id}
                            ref={selectedEpisode === episode.episode_number ? selectedEpisodeRef : null}
                            className={`episode-card ${
                                selectedEpisode === episode.episode_number && hasAddon ? 'episode-card--selected' : ''
                            } ${
                                isUnreleased ? 'episode-card--locked' : ''
                            } ${
                                isAddonLocked ? 'episode-card--no-addon' : ''
                            }`}
                            onClick={() => handleEpisodeClick(episode)}
                            aria-disabled={isUnreleased || isAddonLocked}
                            title={
                                isAddonLocked
                                    ? 'Install an add-on from Settings to watch episodes'
                                    : isUnreleased && episode.air_date
                                    ? `Releases on ${episode.air_date}`
                                    : undefined
                            }
                        >
                            {/* Episode Thumbnail */}
                            <div className="episode-thumbnail">
                                <img
                                    src={getStillUrl(episode.still_path)}
                                    alt={episode.name}
                                    loading="lazy"
                                />
                                {hasAddon && !isUnreleased && (
                                    <div className="episode-play-overlay">
                                        <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
                                            <path d="M8 5v14l11-7z" />
                                        </svg>
                                    </div>
                                )}
                                {isAddonLocked && (
                                    <div className="episode-no-addon-badge">
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                        </svg>
                                        <span>No Add-on</span>
                                    </div>
                                )}
                            </div>

                            {/* Episode Info */}
                            <div className="episode-info">
                                <div className="episode-header">
                                    <span className="episode-number">{episode.episode_number}</span>
                                    <h4 className="episode-title">{episode.name}</h4>
                                </div>
                                <div className="episode-meta">
                                    <span className="episode-runtime">
                                        {formatRuntime(episode.runtime)}
                                    </span>
                                    {episode.air_date && (
                                        <span className="episode-date">
                                            {new Date(episode.air_date).toLocaleDateString('en-US', {
                                                month: 'short',
                                                day: 'numeric',
                                                year: 'numeric',
                                            })}
                                        </span>
                                    )}
                                    {isUnreleased && (
                                        <span className="episode-release-state">Not Released Yet</span>
                                    )}
                                </div>
                                {episode.overview && (
                                    <p className="episode-overview">{episode.overview}</p>
                                )}
                            </div>
                        </div>
                        );
                    })}
            </div>
        </div>
    );
}


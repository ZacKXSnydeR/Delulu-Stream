import { useState, useEffect, useCallback, useRef } from 'react';
import {
    getSeasonDetails,
    getStillUrl,
    type TMDBSeason,
    type TMDBEpisode,
    type TMDBSeasonDetails,
} from '../../services/tmdb';

import './SeasonEpisodeSelector.css';

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
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
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

    // Close dropdown on outside click
    useEffect(() => {
        if (!isDropdownOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isDropdownOpen]);

    // Handle season selection
    const handleSeasonSelect = (seasonNumber: number) => {
        setSelectedSeason(seasonNumber);
        setSelectedEpisode(null); // reset episode on season change
        setIsDropdownOpen(false);
        try {
            sessionStorage.setItem(`delulu-season-${tvId}`, String(seasonNumber));
            sessionStorage.removeItem(`delulu-episode-${tvId}`);
        } catch { /* ignore */ }
    };

    // Handle episode click
    const handleEpisodeClick = (episode: TMDBEpisode) => {
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
            {/* Season Dropdown */}
            <div className="season-dropdown-container" ref={dropdownRef}>
                <button
                    className="season-dropdown-trigger"
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                >
                    <span className="season-dropdown-label">
                        {currentSeason ? getSeasonName(currentSeason) : 'Select Season'}
                    </span>
                    <svg
                        className={`season-dropdown-arrow ${isDropdownOpen ? 'open' : ''}`}
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                    >
                        <path d="M7 10l5 5 5-5z" />
                    </svg>
                </button>

                {isDropdownOpen && (
                    <div className="season-dropdown-menu" data-lenis-prevent>
                        <div className="season-dropdown-scroll-content">
                            {validSeasons.map((season, index) => (
                                <button
                                    key={season.id}
                                    style={{ '--stagger-idx': index } as React.CSSProperties}
                                    className={`season-dropdown-item ${season.season_number === selectedSeason ? 'active' : ''
                                        }`}
                                    onClick={() => handleSeasonSelect(season.season_number)}
                                >
                                    <span>{getSeasonName(season)}</span>
                                    <span className="season-episode-count">
                                        {season.episode_count} Episodes
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

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
                        return (
                        <div
                            key={episode.id}
                            ref={selectedEpisode === episode.episode_number ? selectedEpisodeRef : null}
                            className={`episode-card ${selectedEpisode === episode.episode_number ? 'episode-card--selected' : ''} ${isUnreleased ? 'episode-card--locked' : ''}`}
                            onClick={() => handleEpisodeClick(episode)}
                            aria-disabled={isUnreleased}
                            title={isUnreleased && episode.air_date ? `Releases on ${episode.air_date}` : undefined}
                        >
                            {/* Episode Thumbnail */}
                            <div className="episode-thumbnail">
                                <img
                                    src={getStillUrl(episode.still_path)}
                                    alt={episode.name}
                                    loading="lazy"
                                />
                                <div className="episode-play-overlay">
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
                                        <path d="M8 5v14l11-7z" />
                                    </svg>
                                </div>
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

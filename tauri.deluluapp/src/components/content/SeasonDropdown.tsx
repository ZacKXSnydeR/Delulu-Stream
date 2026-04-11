import React, { useState, useRef, useEffect } from 'react';
import { type TMDBSeason } from '../../services/tmdb';
import './SeasonEpisodeSelector.css';

interface SeasonDropdownProps {
    seasons: TMDBSeason[];
    selectedSeason: number;
    onSeasonSelect: (seasonNumber: number) => void;
}

export const SeasonDropdown: React.FC<SeasonDropdownProps> = ({
    seasons,
    selectedSeason,
    onSeasonSelect
}) => {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Filter out seasons with 0 episodes and sort by season number
    const validSeasons = seasons
        .filter((s) => s.episode_count > 0)
        .sort((a, b) => a.season_number - b.season_number);

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

    const getSeasonName = (season: TMDBSeason): string => {
        if (season.season_number === 0) return 'Specials';
        return season.name || `Season ${season.season_number}`;
    };

    const currentSeason = validSeasons.find((s) => s.season_number === selectedSeason);

    if (validSeasons.length === 0) {
        return null;
    }

    return (
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
                                className={`season-dropdown-item ${season.season_number === selectedSeason ? 'active' : ''}`}
                                onClick={() => {
                                    onSeasonSelect(season.season_number);
                                    setIsDropdownOpen(false);
                                }}
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
    );
};

import React from 'react';
import { useUserListsSafe } from '../../context/UserListsContext';

interface WatchlistButtonProps {
    id: number;
    mediaType: 'movie' | 'tv';
    title: string;
    posterPath: string | null;
    className?: string; // allow overrides
}

export const WatchlistButton: React.FC<WatchlistButtonProps> = ({ id, mediaType, title, posterPath, className }) => {
    const userLists = useUserListsSafe();
    
    // Check if userLists is loaded
    const isInWatchlist = userLists?.isInWatchlist(id, mediaType) || false;

    const handleToggleWatchlist = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!userLists) return;
        userLists.toggleWatchlistItem({ id, type: mediaType, title, posterPath });
    };

    const hasCustomClass = !!className;
    
    return (
        <button
            className={hasCustomClass ? `${className} ${isInWatchlist ? 'active' : ''}` : `btn btn-ghost btn-lg ${isInWatchlist ? 'btn-active' : ''}`}
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
    );
};

import React from 'react';
import { useUserListsSafe } from '../../context/UserListsContext';

interface FavoritesButtonProps {
    id: number;
    mediaType: 'movie' | 'tv';
    title: string;
    posterPath: string | null;
    className?: string; // allow overrides
}

export const FavoritesButton: React.FC<FavoritesButtonProps> = ({ id, mediaType, title, posterPath, className }) => {
    const userLists = useUserListsSafe();
    
    // Check if userLists is loaded
    const isInFavorites = userLists?.isInFavorites(id, mediaType) || false;

    const handleToggleFavorites = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!userLists) return;
        userLists.toggleFavoritesItem({ id, type: mediaType, title, posterPath });
    };

    const hasCustomClass = !!className;
    
    return (
        <button
            className={hasCustomClass ? `${className} ${isInFavorites ? 'active' : ''}` : `btn btn-icon btn-ghost ${isInFavorites ? 'btn-active' : ''}`}
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
    );
};

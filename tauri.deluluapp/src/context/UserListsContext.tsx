import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import {
    getUserLists,
    toggleWatchlist,
    toggleFavorites,
    removeFromWatchlist,
    removeFromFavorites,
    isInWatchlist as checkInWatchlist,
    isInFavorites as checkInFavorites,
    type UserLists,
    type SavedContent,
} from '../services/userLists';

interface UserListsContextType {
    lists: UserLists;
    isLoading: boolean;
    toggleWatchlistItem: (content: Omit<SavedContent, 'addedAt'>) => void;
    toggleFavoritesItem: (content: Omit<SavedContent, 'addedAt'>) => void;
    removeFromWatchlist: (id: number, type: 'movie' | 'tv') => void;
    removeFromFavorites: (id: number, type: 'movie' | 'tv') => void;
    isInWatchlist: (id: number, type: 'movie' | 'tv') => boolean;
    isInFavorites: (id: number, type: 'movie' | 'tv') => boolean;
    refreshLists: () => void;
}

const UserListsContext = createContext<UserListsContextType | null>(null);

export function UserListsProvider({ children }: { children: ReactNode }) {
    const [lists, setLists] = useState<UserLists>({ watchlist: [], favorites: [] });
    const [isLoading, setIsLoading] = useState(false);

    // Load lists from localStorage - instant!
    const loadLists = useCallback(() => {
        // Instant load from localStorage
        const userLists = getUserLists('local');
        setLists(userLists);
    }, []);

    // Load on mount
    useEffect(() => {
        setIsLoading(true);
        loadLists();
        setIsLoading(false);
    }, [loadLists]);

    const handleToggleWatchlist = useCallback((content: Omit<SavedContent, 'addedAt'>) => {
        toggleWatchlist('local', content);
        loadLists(); // Refresh state
    }, [loadLists]);

    const handleToggleFavorites = useCallback((content: Omit<SavedContent, 'addedAt'>) => {
        toggleFavorites('local', content);
        loadLists(); // Refresh state
    }, [loadLists]);

    const handleRemoveFromWatchlist = useCallback((id: number, type: 'movie' | 'tv') => {
        removeFromWatchlist('local', id, type);
        loadLists(); // Refresh state
    }, [loadLists]);

    const handleRemoveFromFavorites = useCallback((id: number, type: 'movie' | 'tv') => {
        removeFromFavorites('local', id, type);
        loadLists(); // Refresh state
    }, [loadLists]);

    const handleIsInWatchlist = useCallback((id: number, type: 'movie' | 'tv'): boolean => {
        return checkInWatchlist('local', id, type);
    }, []);

    const handleIsInFavorites = useCallback((id: number, type: 'movie' | 'tv'): boolean => {
        return checkInFavorites('local', id, type);
    }, []);

    const value: UserListsContextType = {
        lists,
        isLoading,
        toggleWatchlistItem: handleToggleWatchlist,
        toggleFavoritesItem: handleToggleFavorites,
        removeFromWatchlist: handleRemoveFromWatchlist,
        removeFromFavorites: handleRemoveFromFavorites,
        isInWatchlist: handleIsInWatchlist,
        isInFavorites: handleIsInFavorites,
        refreshLists: loadLists,
    };

    return (
        <UserListsContext.Provider value={value}>
            {children}
        </UserListsContext.Provider>
    );
}

export function useUserLists(): UserListsContextType {
    const context = useContext(UserListsContext);
    if (!context) {
        throw new Error('useUserLists must be used within a UserListsProvider');
    }
    return context;
}

export function useUserListsSafe(): UserListsContextType | null {
    return useContext(UserListsContext);
}

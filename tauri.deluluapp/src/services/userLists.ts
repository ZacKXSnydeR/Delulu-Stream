/**
 * User Lists Service - LocalStorage based, desktop-local profile.
 * Fast, instant loading with a local user scope.
 */

export interface SavedContent {
    id: number;
    type: 'movie' | 'tv';
    title: string;
    posterPath: string | null;
    addedAt: number;
}

export interface UserLists {
    watchlist: SavedContent[];
    favorites: SavedContent[];
}

// Obfuscated storage key prefix (looks like app config)
const STORAGE_PREFIX = 'dlm_cfg_';
const WATCHLIST_KEY = 'wl_data';
const FAVORITES_KEY = 'fv_data';

// Get storage key for user
const getStorageKey = (uid: string, type: 'watchlist' | 'favorites'): string => {
    const key = type === 'watchlist' ? WATCHLIST_KEY : FAVORITES_KEY;
    // Hash-like key that looks like app config
    return `${STORAGE_PREFIX}${uid.slice(0, 8)}_${key}`;
};

// Encode data to look less like JSON
const encodeData = (data: SavedContent[]): string => {
    try {
        return btoa(JSON.stringify(data));
    } catch {
        return '';
    }
};

// Decode data
const decodeData = (encoded: string): SavedContent[] => {
    try {
        if (!encoded) return [];
        return JSON.parse(atob(encoded));
    } catch {
        return [];
    }
};

// Get user's watchlist
export const getWatchlist = (uid: string): SavedContent[] => {
    const key = getStorageKey(uid, 'watchlist');
    const data = localStorage.getItem(key);
    return data ? decodeData(data) : [];
};

// Get user's favorites
export const getFavorites = (uid: string): SavedContent[] => {
    const key = getStorageKey(uid, 'favorites');
    const data = localStorage.getItem(key);
    return data ? decodeData(data) : [];
};

// Get all user lists
export const getUserLists = (uid: string): UserLists => {
    return {
        watchlist: getWatchlist(uid),
        favorites: getFavorites(uid),
    };
};

// Save watchlist
const saveWatchlist = (uid: string, watchlist: SavedContent[]): void => {
    const key = getStorageKey(uid, 'watchlist');
    localStorage.setItem(key, encodeData(watchlist));
};

// Save favorites
const saveFavorites = (uid: string, favorites: SavedContent[]): void => {
    const key = getStorageKey(uid, 'favorites');
    localStorage.setItem(key, encodeData(favorites));
};

// Add to watchlist
export const addToWatchlist = (uid: string, content: Omit<SavedContent, 'addedAt'>): void => {
    const watchlist = getWatchlist(uid);

    // Check if already exists
    if (watchlist.some(item => item.id === content.id && item.type === content.type)) {
        return;
    }

    const newItem: SavedContent = {
        ...content,
        addedAt: Date.now(),
    };

    watchlist.unshift(newItem); // Add to beginning
    saveWatchlist(uid, watchlist);
};

// Remove from watchlist
export const removeFromWatchlist = (uid: string, id: number, type: 'movie' | 'tv'): void => {
    const watchlist = getWatchlist(uid);
    const filtered = watchlist.filter(item => !(item.id === id && item.type === type));
    saveWatchlist(uid, filtered);
};

// Toggle watchlist
export const toggleWatchlist = (uid: string, content: Omit<SavedContent, 'addedAt'>): boolean => {
    const watchlist = getWatchlist(uid);
    const exists = watchlist.some(item => item.id === content.id && item.type === content.type);

    if (exists) {
        removeFromWatchlist(uid, content.id, content.type);
        return false;
    } else {
        addToWatchlist(uid, content);
        return true;
    }
};

// Add to favorites
export const addToFavorites = (uid: string, content: Omit<SavedContent, 'addedAt'>): void => {
    const favorites = getFavorites(uid);

    // Check if already exists
    if (favorites.some(item => item.id === content.id && item.type === content.type)) {
        return;
    }

    const newItem: SavedContent = {
        ...content,
        addedAt: Date.now(),
    };

    favorites.unshift(newItem); // Add to beginning
    saveFavorites(uid, favorites);
};

// Remove from favorites
export const removeFromFavorites = (uid: string, id: number, type: 'movie' | 'tv'): void => {
    const favorites = getFavorites(uid);
    const filtered = favorites.filter(item => !(item.id === id && item.type === type));
    saveFavorites(uid, filtered);
};

// Toggle favorites
export const toggleFavorites = (uid: string, content: Omit<SavedContent, 'addedAt'>): boolean => {
    const favorites = getFavorites(uid);
    const exists = favorites.some(item => item.id === content.id && item.type === content.type);

    if (exists) {
        removeFromFavorites(uid, content.id, content.type);
        return false;
    } else {
        addToFavorites(uid, content);
        return true;
    }
};

// Check if in watchlist
export const isInWatchlist = (uid: string, id: number, type: 'movie' | 'tv'): boolean => {
    const watchlist = getWatchlist(uid);
    return watchlist.some(item => item.id === id && item.type === type);
};

// Check if in favorites
export const isInFavorites = (uid: string, id: number, type: 'movie' | 'tv'): boolean => {
    const favorites = getFavorites(uid);
    return favorites.some(item => item.id === id && item.type === type);
};

// Clear all user data (for sign out)
export const clearUserData = (uid: string): void => {
    localStorage.removeItem(getStorageKey(uid, 'watchlist'));
    localStorage.removeItem(getStorageKey(uid, 'favorites'));
};

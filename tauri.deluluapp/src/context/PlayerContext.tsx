import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export type PlayerViewState = 'hidden' | 'fullscreen' | 'mini';

export interface PlayerMediaSource {
    mediaType: 'movie' | 'tv';
    tmdbId: number;
    season?: number;
    episode?: number;
    title: string;
    posterPath?: string;
    genre?: string;
    initialTime?: number;
    returnRoute?: string;
}

export interface PlayerState {
    viewState: PlayerViewState;
    media: PlayerMediaSource | null;
}

interface PlayerContextType {
    playerState: PlayerState;
    playMedia: (media: PlayerMediaSource) => void;
    minimizePlayer: () => void;
    maximizePlayer: () => void;
    closePlayer: () => void;
}

const PlayerContext = createContext<PlayerContextType | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
    const [playerState, setPlayerState] = useState<PlayerState>({
        viewState: 'hidden',
        media: null,
    });

    const playMedia = (media: PlayerMediaSource) => {
        const fallbackReturnRoute = typeof window !== 'undefined'
            ? `${window.location.pathname}${window.location.search}`
            : undefined;

        setPlayerState({
            viewState: 'fullscreen',
            media: {
                ...media,
                returnRoute: media.returnRoute ?? fallbackReturnRoute,
            },
        });
    };

    const minimizePlayer = () => {
        setPlayerState((prev) => ({
            ...prev,
            viewState: prev.media ? 'mini' : 'hidden',
        }));
    };

    const maximizePlayer = () => {
        setPlayerState((prev) => ({
            ...prev,
            viewState: prev.media ? 'fullscreen' : 'hidden',
        }));
    };

    const closePlayer = () => {
        setPlayerState({ viewState: 'hidden', media: null });
    };

    return (
        <PlayerContext.Provider value={{ playerState, playMedia, minimizePlayer, maximizePlayer, closePlayer }}>
            {children}
        </PlayerContext.Provider>
    );
}

export function usePlayer() {
    const context = useContext(PlayerContext);
    if (!context) throw new Error('usePlayer must be used within PlayerProvider');
    return context;
}

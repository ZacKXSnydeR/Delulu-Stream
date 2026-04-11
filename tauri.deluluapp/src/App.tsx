import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { PlayerProvider } from './context/PlayerContext';
import { UserListsProvider } from './context/UserListsContext';
import { UserProfileProvider } from './context/UserProfileContext';
import { AddonProvider } from './context/AddonContext';
import { Navbar } from './components/layout/Navbar';
import { SearchModal } from './components/layout/SearchModal';
import { UserDropdown } from './components/layout/UserDropdown';
import { GlobalPlayer } from './pages/GlobalPlayer';
import { Home } from './pages/Home';
import { Movies } from './pages/Movies';
import { TVShows } from './pages/TVShows';
import { Search } from './pages/Search';
import { Details } from './pages/Details';
import { Random } from './pages/Random';
import { MyList } from './pages/MyList';
import { Settings } from './pages/Settings';
import { watchService } from './services/watchHistory';
import { getMovieStream, getTVStream } from './services/streamAdapter';
import { bootstrapAddonManager } from './addon_manager/manager';

import { useLenis } from './hooks/useLenis';
import { initDatabase } from './services/database';

import './styles/index.css';

// Main app content - GlobalPlayer lives outside Routes so it never unmounts
function AppContent() {
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    // Track real browser-level fullscreen (document.fullscreenElement)
    // Navbar should only hide when the video is actually in browser fullscreen,
    // NOT when the player viewState is 'fullscreen' (which is just the app's in-window full view)
    const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);

    const syncFullscreen = useCallback(() => {
        setIsBrowserFullscreen(!!document.fullscreenElement);
    }, []);

    useEffect(() => {
        document.addEventListener('fullscreenchange', syncFullscreen);
        document.addEventListener('webkitfullscreenchange', syncFullscreen);
        syncFullscreen();
        return () => {
            document.removeEventListener('fullscreenchange', syncFullscreen);
            document.removeEventListener('webkitfullscreenchange', syncFullscreen);
        };
    }, [syncFullscreen]);


    // Offline detection
    useEffect(() => {
        const goOffline = () => setIsOffline(true);
        const goOnline = () => setIsOffline(false);
        window.addEventListener('offline', goOffline);
        window.addEventListener('online', goOnline);
        return () => {
            window.removeEventListener('offline', goOffline);
            window.removeEventListener('online', goOnline);
        };
    }, []);

    // Initialize Lenis smooth scrolling
    useLenis();

    // Initialize database, bootstrap addons, and warm continue-watching streams
    useEffect(() => {
        let cancelled = false;
        const prepare = async () => {
            try {
                await initDatabase();
                await bootstrapAddonManager();
                
                // Initialize Discord Rich Presence
                invoke('presence_init', { appId: '1481365650696831162' })
                    .catch((err) => console.log('[Discord] Init error:', err));


                // Stream URL Warmup
                try {
                    const continueItems = await watchService.getContinueWatching();
                    const top5 = continueItems.slice(0, 5);

                    for (let i = 0; i < top5.length; i += 2) {
                        if (cancelled) break;
                        const batch = top5.slice(i, i + 2);
                        await Promise.all(batch.map(async (item) => {
                            try {
                                if (item.media_type === 'movie') {
                                    await getMovieStream(item.tmdb_id);
                                } else {
                                    await getTVStream(
                                        item.tmdb_id,
                                        item.season_number ?? 1,
                                        item.episode_number ?? 1
                                    );
                                }
                                console.log(`[Warmup] Pre-resolved: ${item.tmdb_id} (${item.media_type})`);
                            } catch (e) {
                                console.warn(`[Warmup] Failed for ${item.tmdb_id}:`, e);
                            }
                        }));
                    }
                } catch (e) {
                    console.warn('[Warmup] Could not load continue watching:', e);
                }

            } catch (err) {
                if (!cancelled) console.error('[Engine] Preparation failed:', err);
            }
        };
        prepare().catch(console.error);
        return () => { cancelled = true; };
    }, []);

    const handleSearchClick = () => {
        setIsSearchOpen(true);
        setIsUserDropdownOpen(false);
    };

    const handleUserClick = () => {
        setIsUserDropdownOpen((prev) => !prev);
        setIsSearchOpen(false);
    };

    return (
        <>
            {!isBrowserFullscreen && (
                <Navbar onSearchClick={handleSearchClick} onUserClick={handleUserClick} />
            )}

            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/movies" element={<Movies />} />
                <Route path="/tv-shows" element={<TVShows />} />
                <Route path="/search" element={<Search />} />
                <Route path="/details/:mediaType/:id" element={<Details />} />
                <Route path="/random" element={<Random />} />
                <Route path="/continue-watching" element={<MyList />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>

            {!isBrowserFullscreen && isSearchOpen && (
                <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
            )}

            {!isBrowserFullscreen && isUserDropdownOpen && (
                <UserDropdown isOpen={isUserDropdownOpen} onClose={() => setIsUserDropdownOpen(false)} />
            )}

            {/* Global single-instance player - never unmounts, persists across all page navigations */}
            <GlobalPlayer />

            {/* Offline popup */}
            {isOffline && (
                <div className="offline-popup">
                    <div className="offline-popup-inner">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="1" y1="1" x2="23" y2="23" />
                            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
                            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
                            <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
                            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
                            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                            <line x1="12" y1="20" x2="12.01" y2="20" />
                        </svg>
                        <span>No internet connection</span>
                    </div>
                </div>
            )}
        </>
    );
}

function App() {
    return (
        <BrowserRouter>
            <UserProfileProvider>
                <UserListsProvider>
                    <AddonProvider>
                        <PlayerProvider>
                            <AppContent />
                        </PlayerProvider>
                    </AddonProvider>
                </UserListsProvider>
            </UserProfileProvider>
        </BrowserRouter>
    );
}

export default App;


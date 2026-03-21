import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './TitleBar.css';

interface TitleBarProps {
    minimal?: boolean;
}

export function TitleBar({ minimal = false }: TitleBarProps) {
    const [isMaximized, setIsMaximized] = useState(false);
    const location = useLocation();
    const appWindow = getCurrentWindow();

    useEffect(() => {
        const checkMaximized = async () => {
            try {
                const maximized = await appWindow.isMaximized();
                setIsMaximized(maximized);
            } catch (err) {
                console.error('Error checking maximized state:', err);
            }
        };
        checkMaximized();

        // Listen for window resize to update maximized state
        const unlisten = appWindow.onResized(async () => {
            try {
                const maximized = await appWindow.isMaximized();
                setIsMaximized(maximized);
            } catch (err) {
                console.error('Error checking maximized on resize:', err);
            }
        });

        return () => {
            unlisten.then(fn => fn());
        };
    }, [appWindow]);

    // Force Chromium to re-evaluate the custom draggable region when exiting fullscreen
    const [dragRepaint, setDragRepaint] = useState(false);
    useEffect(() => {
        const handleFullscreenChange = () => {
            if (!document.fullscreenElement) {
                // Toggle a dummy state to force a re-render of the drag region div
                setDragRepaint(prev => !prev);
            }
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const handleMinimize = async () => {
        try {
            await appWindow.minimize();
        } catch (err) {
            console.error('Minimize error:', err);
        }
    };

    const handleMaximize = async () => {
        try {
            await appWindow.toggleMaximize();
            const maximized = await appWindow.isMaximized();
            setIsMaximized(maximized);
        } catch (err) {
            console.error('Maximize error:', err);
        }
    };

    const handleClose = async () => {
        try {
            await appWindow.close();
        } catch (err) {
            console.error('Close error:', err);
        }
    };

    const isActive = (path: string) => location.pathname === path;

    return (
        <div className={`titlebar ${minimal ? 'titlebar-minimal' : ''}`} data-tauri-drag-region>
            {/* Logo */}
            <div className="titlebar-logo">
                <span className="titlebar-brand">DELULU</span>
            </div>

            {/* Navigation links - only show if not minimal */}
            {!minimal && (
                <nav className="titlebar-nav">
                    <Link to="/" className={`titlebar-link ${isActive('/') ? 'active' : ''}`}>Home</Link>
                    <Link to="/movies" className={`titlebar-link ${isActive('/movies') ? 'active' : ''}`}>Movies</Link>
                    <Link to="/tv-shows" className={`titlebar-link ${isActive('/tv-shows') ? 'active' : ''}`}>TV Shows</Link>
                    <Link to="/random" className={`titlebar-link ${isActive('/random') ? 'active' : ''}`}>Random</Link>
                    <Link to="/my-list" className={`titlebar-link ${isActive('/my-list') ? 'active' : ''}`}>My List</Link>
                </nav>
            )}

            {/* Draggable area */}
            <div className={`titlebar-drag ${dragRepaint ? 'repaint' : ''}`} data-tauri-drag-region />

            {/* Right side - icons and controls */}
            {!minimal && (
                <div className="titlebar-icons">
                    <Link to="/search" className="titlebar-icon" aria-label="Search">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="11" cy="11" r="8" />
                            <path d="M21 21l-4.35-4.35" />
                        </svg>
                    </Link>
                    <Link to="/settings" className="titlebar-icon" aria-label="Profile">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                        </svg>
                    </Link>
                </div>
            )}

            <div className="titlebar-controls">
                <button
                    className="titlebar-btn titlebar-btn-minimize"
                    onClick={handleMinimize}
                    aria-label="Minimize"
                >
                    <svg width="12" height="12" viewBox="0 0 12 12">
                        <rect y="5" width="12" height="2" fill="currentColor" />
                    </svg>
                </button>
                <button
                    className="titlebar-btn titlebar-btn-maximize"
                    onClick={handleMaximize}
                    aria-label={isMaximized ? 'Restore' : 'Maximize'}
                >
                    {isMaximized ? (
                        <svg width="12" height="12" viewBox="0 0 12 12">
                            <path
                                d="M3 1h8v8h-2v2H1V3h2V1zm6 2H4v5h5V3z"
                                fill="currentColor"
                            />
                        </svg>
                    ) : (
                        <svg width="12" height="12" viewBox="0 0 12 12">
                            <rect
                                x="1"
                                y="1"
                                width="10"
                                height="10"
                                stroke="currentColor"
                                strokeWidth="2"
                                fill="none"
                            />
                        </svg>
                    )}
                </button>
                <button
                    className="titlebar-btn titlebar-btn-close"
                    onClick={handleClose}
                    aria-label="Close"
                >
                    <svg width="12" height="12" viewBox="0 0 12 12">
                        <path
                            d="M1 1l10 10M11 1L1 11"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                        />
                    </svg>
                </button>
            </div>
        </div>
    );
}

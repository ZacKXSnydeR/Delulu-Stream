import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './Navbar.css';

const navItems = [
    { path: '/', label: 'Home' },
    { path: '/movies', label: 'Movies' },
    { path: '/tv-shows', label: 'TV Shows' },
    { path: '/random', label: 'Random' },
    { path: '/continue-watching', label: 'My List' },
];

interface NavbarProps {
    onSearchClick?: () => void;
    onUserClick?: () => void;
}

export function Navbar({ onSearchClick, onUserClick }: NavbarProps) {
    const location = useLocation();
    const [scrollState, setScrollState] = useState<'top' | 'scrolled' | 'deep'>('top');
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            const y = window.scrollY;
            if (y <= 10) {
                setScrollState('top');
            } else if (y <= 120) {
                setScrollState('scrolled');
            } else {
                setScrollState('deep');
            }
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll(); // Initial check
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        const appWindow = getCurrentWindow();
        const checkMaximized = async () => {
            try {
                const maximized = await appWindow.isMaximized();
                setIsMaximized(maximized);
            } catch { /* ignore */ }
        };
        checkMaximized();

        const unlisten = appWindow.onResized(async () => {
            try {
                const maximized = await appWindow.isMaximized();
                setIsMaximized(maximized);
            } catch { /* ignore */ }
        });
        return () => { unlisten.then(fn => fn()); };
    }, []);

    const handleMinimize = async () => {
        try { await getCurrentWindow().minimize(); } catch { /* ignore */ }
    };

    const handleMaximize = async () => {
        try {
            const appWindow = getCurrentWindow();
            await appWindow.toggleMaximize();
            const maximized = await appWindow.isMaximized();
            setIsMaximized(maximized);
        } catch { /* ignore */ }
    };

    const handleClose = async () => {
        try { await getCurrentWindow().close(); } catch { /* ignore */ }
    };

    return (
        <nav className={`navbar ${scrollState !== 'top' ? `navbar-${scrollState}` : ''}`}>
            {/* Drag region for window movement */}
            <div className="navbar-drag-region" data-tauri-drag-region />

            {/* Left - Logo */}
            <div className="navbar-left">
                <Link to="/" className="navbar-logo">
                    DELULU
                </Link>
            </div>

            {/* Center - Menu */}
            <ul className="navbar-menu">
                {navItems.map((item) => (
                    <li key={item.path}>
                        <Link
                            to={item.path}
                            className={`navbar-link ${location.pathname === item.path ? 'navbar-link-active' : ''}`}
                        >
                            {item.label}
                        </Link>
                    </li>
                ))}
            </ul>

            {/* Right - Icons & Window Controls */}
            <div className="navbar-right">
                <button
                    className="navbar-icon-btn"
                    onClick={onSearchClick}
                    aria-label="Search"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <path d="M21 21l-4.35-4.35" />
                    </svg>
                </button>
                <button
                    className="navbar-icon-btn"
                    onClick={onUserClick}
                    aria-label="User menu"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                    </svg>
                </button>

                {/* Window Controls */}
                <div className="navbar-window-controls">
                    <button
                        className="navbar-window-btn"
                        onClick={handleMinimize}
                        aria-label="Minimize"
                    >
                        <svg width="10" height="10" viewBox="0 0 10 10">
                            <rect y="4" width="10" height="1.5" fill="currentColor" />
                        </svg>
                    </button>
                    <button
                        className="navbar-window-btn"
                        onClick={handleMaximize}
                        aria-label={isMaximized ? 'Restore' : 'Maximize'}
                    >
                        {isMaximized ? (
                            <svg width="10" height="10" viewBox="0 0 10 10">
                                <path d="M2 0h8v8h-2v2H0V2h2V0zm6 1.5H3v5h5v-5z" fill="currentColor" />
                            </svg>
                        ) : (
                            <svg width="10" height="10" viewBox="0 0 10 10">
                                <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" fill="none" />
                            </svg>
                        )}
                    </button>
                    <button
                        className="navbar-window-btn navbar-window-btn-close"
                        onClick={handleClose}
                        aria-label="Close"
                    >
                        <svg width="10" height="10" viewBox="0 0 10 10">
                            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                    </button>
                </div>
            </div>
        </nav>
    );
}

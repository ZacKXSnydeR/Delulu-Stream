import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './PlayerChromeBar.css';

export function PlayerChromeBar() {
    const appWindow = getCurrentWindow();
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        let active = true;
        const sync = async () => {
            try {
                const maximized = await appWindow.isMaximized();
                if (active) setIsMaximized(maximized);
            } catch {
                // ignore in non-tauri contexts
            }
        };

        sync();
        const unlisten = appWindow.onResized(sync);

        return () => {
            active = false;
            unlisten.then((fn) => fn()).catch(() => {});
        };
    }, [appWindow]);

    const handleMinimize = async () => {
        try {
            await appWindow.minimize();
        } catch {
            // ignore in non-tauri contexts
        }
    };

    const handleMaximize = async () => {
        try {
            await appWindow.toggleMaximize();
            setIsMaximized(await appWindow.isMaximized());
        } catch {
            // ignore in non-tauri contexts
        }
    };

    const handleClose = async () => {
        try {
            await appWindow.close();
        } catch {
            // ignore in non-tauri contexts
        }
    };

    return (
        <div className="player-chrome-bar" data-tauri-drag-region>
            <div className="player-chrome-brand-wrap">
                <span className="player-chrome-brand">DELULU</span>
            </div>

            <div className="player-chrome-drag" data-tauri-drag-region />

            <div className="player-chrome-controls">
                <button className="player-chrome-btn" onClick={handleMinimize} aria-label="Minimize">
                    <svg width="12" height="12" viewBox="0 0 12 12">
                        <rect y="5" width="12" height="2" fill="currentColor" />
                    </svg>
                </button>
                <button className="player-chrome-btn" onClick={handleMaximize} aria-label={isMaximized ? 'Restore' : 'Maximize'}>
                    {isMaximized ? (
                        <svg width="12" height="12" viewBox="0 0 12 12">
                            <path d="M3 1h8v8h-2v2H1V3h2V1zm6 2H4v5h5V3z" fill="currentColor" />
                        </svg>
                    ) : (
                        <svg width="12" height="12" viewBox="0 0 12 12">
                            <rect x="1" y="1" width="10" height="10" stroke="currentColor" strokeWidth="2" fill="none" />
                        </svg>
                    )}
                </button>
                <button className="player-chrome-btn player-chrome-btn-close" onClick={handleClose} aria-label="Close">
                    <svg width="12" height="12" viewBox="0 0 12 12">
                        <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                </button>
            </div>
        </div>
    );
}

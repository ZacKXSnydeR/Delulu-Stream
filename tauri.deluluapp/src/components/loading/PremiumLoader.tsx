/**
 * Premium Stream Loader - Full Page Design
 * 
 * Matches the app's details page style:
 * - Full backdrop background
 * - Title & metadata on left
 * - Glass card on right showing loading status
 */

import { useEffect, useState } from 'react';
import './PremiumLoader.css';

interface PremiumLoaderProps {
    posterUrl?: string;
    backdropUrl?: string;
    title?: string;
    year?: string;
    quality?: string;
    onCancel?: () => void;
}

// Rotating status messages
const STATUS_MESSAGES = [
    "Preparing your experience",
    "Setting up the stream",
    "Optimizing quality",
    "Almost ready",
    "Just a moment",
];

export function PremiumLoader({
    posterUrl,
    backdropUrl,
    title = 'Loading...',
    year,
    quality,
    onCancel,
}: PremiumLoaderProps) {
    const [messageIndex, setMessageIndex] = useState(0);
    const [isFading, setIsFading] = useState(false);

    // Use backdrop or poster as background
    const bgImage = backdropUrl || posterUrl;

    // Rotate messages smoothly
    useEffect(() => {
        const interval = setInterval(() => {
            setIsFading(true);

            setTimeout(() => {
                setMessageIndex((prev) => (prev + 1) % STATUS_MESSAGES.length);
                setIsFading(false);
            }, 400);
        }, 2500);

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="premium-loader">
            {/* Full backdrop background */}
            {bgImage && (
                <div
                    className="premium-loader-backdrop"
                    style={{ backgroundImage: `url(${bgImage})` }}
                />
            )}

            {/* Gradient overlays */}
            <div className="premium-loader-gradient-left" />
            <div className="premium-loader-gradient-bottom" />

            {/* Main content */}
            <div className="premium-loader-layout">
                {/* Left side - Title & metadata */}
                <div className="premium-loader-left">
                    <h1 className="premium-loader-title">{title}</h1>

                    {/* Metadata row */}
                    {(year || quality) && (
                        <div className="premium-loader-meta">
                            {year && <span>{year}</span>}
                            {year && quality && <span className="meta-dot">•</span>}
                            {quality && <span>{quality}</span>}
                        </div>
                    )}

                    {/* Cancel button */}
                    {onCancel && (
                        <button className="premium-loader-cancel" onClick={onCancel}>
                            Cancel
                        </button>
                    )}
                </div>

                {/* Right side - Loading card */}
                <div className="premium-loader-card">
                    <div className="loader-card-header">
                        <span className="loader-card-label">LOADING STREAM</span>
                    </div>

                    <div className="loader-card-content">
                        <p className="loader-card-text">
                            We're preparing your stream. This uses high-quality encoding for the best viewing experience.
                        </p>

                        {/* Status with spinner */}
                        <div className="loader-card-status">
                            <div className="loader-spinner">
                                <svg viewBox="0 0 50 50">
                                    <circle cx="25" cy="25" r="20" fill="none" stroke="url(#spinnerGrad)" strokeWidth="3" strokeLinecap="round" />
                                    <defs>
                                        <linearGradient id="spinnerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                            <stop offset="0%" stopColor="#a855f7" />
                                            <stop offset="100%" stopColor="#6366f1" />
                                        </linearGradient>
                                    </defs>
                                </svg>
                            </div>
                            <p className={`loader-status-text ${isFading ? 'fade' : ''}`}>
                                {STATUS_MESSAGES[messageIndex]}
                            </p>
                        </div>

                        {/* Progress dots */}
                        <div className="loader-card-dots">
                            <span className="dot"></span>
                            <span className="dot"></span>
                            <span className="dot"></span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

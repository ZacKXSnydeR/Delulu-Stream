import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    type TMDBContent,
    getPosterUrl,
    getTitle,
    getReleaseYear,
    getMediaType,
} from '../../services/tmdb';
import { getCachedImageUrl, cacheImage, isImageCached } from '../../services/imageCache';
import { useUserListsSafe } from '../../context/UserListsContext';
import './ContentCard.css';

interface ContentCardProps {
    content: TMDBContent;
    showTitle?: boolean;
    size?: 'small' | 'medium' | 'large';
}

export function ContentCard({ content, showTitle = false, size = 'medium' }: ContentCardProps) {
    const navigate = useNavigate();
    const userLists = useUserListsSafe();
    const posterSize = size === 'small' ? 'small' : size === 'large' ? 'large' : 'medium';
    const originalUrl = getPosterUrl(content.poster_path, posterSize);
    const alreadyCached = isImageCached(originalUrl);
    const mediaType = getMediaType(content);

    const [imgSrc, setImgSrc] = useState(getCachedImageUrl(originalUrl));
    const [isLoaded, setIsLoaded] = useState(alreadyCached);
    const [isHovered, setIsHovered] = useState(false);
    const cacheTriggered = useRef(false);

    const inWatchlist = userLists?.isInWatchlist(content.id, mediaType) ?? false;
    const inFavorites = userLists?.isInFavorites(content.id, mediaType) ?? false;

    // When the native <img> loads, cache the blob for next time
    useEffect(() => {
        if (alreadyCached || cacheTriggered.current) return;
        cacheTriggered.current = true;
        cacheImage(originalUrl).then((blobUrl) => {
            setImgSrc(blobUrl);
        });
    }, [originalUrl, alreadyCached]);

    const handleClick = () => {
        navigate(`/details/${mediaType}/${content.id}`);
    };

    const handleWatchlist = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!userLists) return;
        userLists.toggleWatchlistItem({
            id: content.id,
            type: mediaType,
            title: getTitle(content),
            posterPath: content.poster_path ?? null,
        });
    };

    const handleFavorites = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!userLists) return;
        userLists.toggleFavoritesItem({
            id: content.id,
            type: mediaType,
            title: getTitle(content),
            posterPath: content.poster_path ?? null,
        });
    };

    return (
        <div
            className={`content-card content-card-${size}`}
            onClick={handleClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div className="content-card-image-wrapper">
                {!isLoaded && <div className="skeleton skeleton-card" />}
                <img
                    src={imgSrc}
                    alt={getTitle(content)}
                    className={`content-card-image ${isLoaded ? 'loaded' : ''}`}
                    loading="lazy"
                    onLoad={() => setIsLoaded(true)}
                />
                {/* Action buttons — top-right, outside overlay */}
                <div className="card-actions">
                    <button
                        className={`card-action-btn ${inWatchlist ? 'active-watchlist' : ''}`}
                        onClick={handleWatchlist}
                        title={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                        </svg>
                    </button>
                    <button
                        className={`card-action-btn ${inFavorites ? 'active-favorites' : ''}`}
                        onClick={handleFavorites}
                        title={inFavorites ? 'Remove from Favorites' : 'Add to Favorites'}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                        </svg>
                    </button>
                </div>
                <div className={`content-card-overlay ${isHovered ? 'visible' : ''}`}>
                    <div className="content-card-play">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    </div>
                    <div className="content-card-info">
                        <span className="content-card-rating">
                            ★ {content.vote_average.toFixed(1)}
                        </span>
                        <span className="content-card-year">{getReleaseYear(content)}</span>
                    </div>
                </div>
            </div>
            {showTitle && (
                <h3 className="content-card-title">{getTitle(content)}</h3>
            )}
        </div>
    );
}


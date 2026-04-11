import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Shuffle, Loader2, Play, X, Bookmark, Heart } from 'lucide-react';
import { DomeGallery } from '../components/content/DomeGallery';
import '../components/content/DomeGallery.css';
import { useUserListsSafe } from '../context/UserListsContext';
import { useAddons } from '../context/AddonContext';
import { discoveryService, type MediaImage } from '../services/discoveryService';
import {
    getMovieDetails,
    getTVShowDetails,
    type TMDBContentDetails,
} from '../services/tmdb';
import './Random.css';

interface SelectedMedia {
    id: number;
    type: 'movie' | 'tv';
    posterSrc: string;
    details?: TMDBContentDetails;
    isLoading: boolean;
}

export function Random() {
    const navigate = useNavigate();
    const { hasAddon } = useAddons();
    const [images, setImages] = useState<MediaImage[]>(discoveryService.getRandomMediaSync());
    const [isLoading, setIsLoading] = useState(images.length === 0);
    const [shuffleKey, setShuffleKey] = useState(0);
    const [selectedMedia, setSelectedMedia] = useState<SelectedMedia | null>(null);

    const loadMedia = async (forceRefresh = false) => {
        setIsLoading(true);
        try {
            const media = await discoveryService.fetchRandomMedia(forceRefresh);
            setImages(media);
        } catch (error) {
            console.error('Failed to fetch random media:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (images.length === 0) {
            loadMedia();
        }
    }, []);

    const handleReshuffle = () => {
        setShuffleKey(prev => prev + 1);
        loadMedia(true);
        setSelectedMedia(null);
    };

    const handleImageClick = async (image: { src: string; alt: string; id?: number; type?: 'movie' | 'tv' }) => {
        if (!image.id || !image.type) return;

        setSelectedMedia({
            id: image.id,
            type: image.type,
            posterSrc: image.src,
            isLoading: true
        });

        try {
            const details = image.type === 'movie'
                ? await getMovieDetails(image.id)
                : await getTVShowDetails(image.id);

            setSelectedMedia(prev => prev ? { ...prev, details, isLoading: false } : null);
        } catch (error) {
            console.error('Failed to fetch details:', error);
            setSelectedMedia(prev => prev ? { ...prev, isLoading: false } : null);
        }
    };

    const handleCloseDetails = () => {
        setSelectedMedia(null);
    };

    const handlePlay = () => {
        if (!selectedMedia?.details) return;
        navigate(`/details/${selectedMedia.type}/${selectedMedia.id}`);
    };

    const userLists = useUserListsSafe();
    const isWatchlistActive = selectedMedia && userLists
        ? userLists.isInWatchlist(selectedMedia.id, selectedMedia.type)
        : false;
    const isFavoriteActive = selectedMedia && userLists
        ? userLists.isInFavorites(selectedMedia.id, selectedMedia.type)
        : false;

    const toggleWatchlist = () => {
        if (!selectedMedia || !details || !userLists) return;
        userLists.toggleWatchlistItem({
            id: selectedMedia.id,
            type: selectedMedia.type,
            title: title || 'Untitled',
            posterPath: details.poster_path ?? null,
        });
    };

    const toggleFavorites = () => {
        if (!selectedMedia || !details || !userLists) return;
        userLists.toggleFavoritesItem({
            id: selectedMedia.id,
            type: selectedMedia.type,
            title: title || 'Untitled',
            posterPath: details.poster_path ?? null,
        });
    };

    const galleryImages = useMemo(() =>
        images.map(img => ({ src: img.src, alt: img.alt, id: img.id, type: img.type })),
        [images]
    );

    const details = selectedMedia?.details;
    const isMovie = selectedMedia?.type === 'movie';
    const title = details ? (details.title || details.name) : '';
    const year = details ? new Date(details.release_date || details.first_air_date || '').getFullYear() : '';
    const runtime = isMovie && details ? details.runtime : null;
    const tvRuntime = !isMovie && details?.episode_run_time?.length
        ? details.episode_run_time[0]
        : null;
    const durationMinutes = runtime || tvRuntime || null;
    const rating = details ? details.vote_average.toFixed(1) : '';
    const genres = details?.genres?.slice(0, 3) || [];
    const overview = details?.overview || '';

    return (
        <div className="random-page">
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="random-header"
            >
                <div className="random-header-island">
                    <button className="random-btn random-btn-ghost" onClick={() => navigate(-1)}>
                        <ArrowLeft size={18} />
                        <span>Back</span>
                    </button>

                    <h1 className="random-title">Random Discovery</h1>

                    <button
                        className="random-btn random-btn-ghost"
                        onClick={handleReshuffle}
                        disabled={isLoading}
                    >
                        {isLoading ? <Loader2 size={18} className="spin" /> : <Shuffle size={18} />}
                        <span>Shuffle</span>
                    </button>
                </div>
            </motion.div>

            {/* Loading */}
            {isLoading && images.length === 0 && (
                <div className="random-loading">
                    <Loader2 size={48} className="spin" />
                    <p>Loading random movies & shows...</p>
                </div>
            )}

            {/* Dome Gallery */}
            {images.length > 0 && (
                <DomeGallery
                    key={shuffleKey}
                    images={galleryImages}
                    dragDampening={5}
                    grayscale={false}
                    maxVerticalRotationDeg={0}
                    overlayBlurColor="#000000"
                    imageBorderRadius="16px"
                    fit={0.65}
                    onImageClick={handleImageClick}
                />
            )}

            {/* Details Modal */}
            <AnimatePresence>
                {selectedMedia && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.4 }}
                            onClick={handleCloseDetails}
                            className="random-modal-backdrop"
                        />

                        <motion.div
                            initial={{ opacity: 0, scale: 0.5 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.8 }}
                            transition={{ type: 'spring', damping: 30, stiffness: 350 }}
                            className="random-modal-container"
                        >
                            <motion.div
                                initial={{ y: 30 }}
                                animate={{ y: 0 }}
                                exit={{ y: 20 }}
                                className="random-modal"
                            >
                                {/* Close button */}
                                <motion.button
                                    initial={{ opacity: 0, scale: 0.5 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: 0.2 }}
                                    onClick={handleCloseDetails}
                                    className="random-modal-close"
                                >
                                    <X size={12} />
                                </motion.button>

                                <div className="random-modal-content">
                                    {/* Poster */}
                                    <motion.div
                                        className="random-modal-poster"
                                        initial={{ opacity: 0, x: -30 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: 0.1 }}
                                    >
                                        <motion.img
                                            src={selectedMedia.posterSrc}
                                            alt="Poster"
                                            initial={{ scale: 1.1, opacity: 0 }}
                                            animate={{ scale: 1, opacity: 1 }}
                                            transition={{ duration: 0.5 }}
                                        />
                                        <div className="random-modal-poster-gradient" />
                                    </motion.div>

                                    {/* Details */}
                                    {selectedMedia.isLoading ? (
                                        <motion.div
                                            className="random-modal-details"
                                            initial={{ opacity: 0, x: 30 }}
                                            animate={{ opacity: 1, x: 0 }}
                                        >
                                            <div className="random-skeleton random-skeleton-badge" />
                                            <div className="random-skeleton random-skeleton-title" />
                                            <div className="random-skeleton-row">
                                                <div className="random-skeleton random-skeleton-meta" />
                                                <div className="random-skeleton random-skeleton-meta" />
                                            </div>
                                            <div className="random-skeleton random-skeleton-text" />
                                            <div className="random-skeleton random-skeleton-text" />
                                        </motion.div>
                                    ) : details ? (
                                        <motion.div
                                            className="random-modal-details"
                                            initial={{ opacity: 0, x: 30 }}
                                            animate={{ opacity: 1, x: 0 }}
                                        >
                                            <span className="random-modal-type">
                                                {isMovie ? 'MOVIE' : 'TV SERIES'}
                                            </span>

                                            <h2 className="random-modal-title">{title}</h2>

                                            <div className="random-modal-meta">
                                                <span className="random-meta-value">{rating}</span>
                                                <span className="random-meta-dot" />
                                                {year && (
                                                    <>
                                                        <span className="random-meta-text">{year}</span>
                                                        <span className="random-meta-dot" />
                                                    </>
                                                )}
                                                {durationMinutes && (
                                                    <span className="random-meta-text">{durationMinutes} min</span>
                                                )}
                                            </div>

                                            {genres.length > 0 && (
                                                <div className="random-modal-genres">
                                                    {genres.map(genre => (
                                                        <span key={genre.id} className="random-genre-tag">
                                                            {genre.name}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="random-modal-divider" />

                                            {overview && (
                                                <p className="random-modal-overview">{overview}</p>
                                            )}

                                            <div className="random-modal-actions">
                                                {hasAddon && (
                                                    <button className="random-btn random-btn-primary" onClick={handlePlay}>
                                                        <Play size={18} />
                                                        Watch Now
                                                    </button>
                                                )}
                                                <button
                                                    className={`random-btn random-btn-secondary ${isWatchlistActive ? 'active' : ''}`}
                                                    onClick={toggleWatchlist}
                                                >
                                                    <Bookmark size={18} className="random-watchlist-icon" />
                                                    {isWatchlistActive ? 'IN WATCHLIST' : 'WATCHLIST'}
                                                </button>
                                                <button
                                                    className={`random-btn random-btn-icon ${isFavoriteActive ? 'active' : ''}`}
                                                    onClick={toggleFavorites}
                                                >
                                                    <Heart size={18} className="random-favorite-icon" />
                                                </button>
                                            </div>
                                        </motion.div>
                                    ) : (
                                        <div className="random-modal-details random-modal-error">
                                            Failed to load details
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}


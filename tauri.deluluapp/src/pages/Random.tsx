import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Shuffle, Loader2, Play, Star, Calendar, Clock, X, Bookmark, Plus } from 'lucide-react';
import { DomeGallery } from '../components/content/DomeGallery';
import '../components/content/DomeGallery.css';
import {
    getTrending,
    getPopularMovies,
    getPopularTVShows,
    getMovieDetails,
    getTVShowDetails,
    getPosterUrl,
    type TMDBContent,
    type TMDBMovie,
    type TMDBTVShow,
    type TMDBContentDetails,
} from '../services/tmdb';
import './Random.css';

interface MediaImage {
    src: string;
    alt: string;
    id: number;
    type: 'movie' | 'tv';
}

interface SelectedMedia {
    id: number;
    type: 'movie' | 'tv';
    posterSrc: string;
    details?: TMDBContentDetails;
    isLoading: boolean;
}

// Fisher-Yates shuffle
function shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// Remove duplicates
function removeDuplicates(images: MediaImage[]): MediaImage[] {
    const seen = new Set<string>();
    return images.filter(img => {
        const key = `${img.type}-${img.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function Random() {
    const navigate = useNavigate();
    const [images, setImages] = useState<MediaImage[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [shuffleKey, setShuffleKey] = useState(0);
    const [selectedMedia, setSelectedMedia] = useState<SelectedMedia | null>(null);

    const fetchRandomMedia = async () => {
        setIsLoading(true);
        try {
            const randomPages = Array.from({ length: 5 }, () => Math.floor(Math.random() * 20) + 1);

            const [
                trendingAll,
                ...pageResults
            ] = await Promise.all([
                getTrending('all', 'week'),
                ...randomPages.map(page => getPopularMovies(page)),
                ...randomPages.map(page => getPopularTVShows(page)),
            ]);

            const allMedia: MediaImage[] = [];

            // Add trending
            trendingAll.forEach((item: TMDBContent) => {
                const posterPath = 'poster_path' in item ? item.poster_path : null;
                if (posterPath) {
                    const isMovie = 'title' in item;
                    allMedia.push({
                        src: getPosterUrl(posterPath, 'large'),
                        alt: isMovie ? (item as { title: string }).title : (item as { name: string }).name,
                        id: item.id,
                        type: isMovie ? 'movie' : 'tv',
                    });
                }
            });

            // Add movies from random pages
            pageResults.slice(0, 5).forEach((response) => {
                response.results.forEach((item) => {
                    const movie = item as TMDBMovie;
                    if (movie.poster_path) {
                        allMedia.push({
                            src: getPosterUrl(movie.poster_path, 'large'),
                            alt: movie.title || 'Movie',
                            id: movie.id,
                            type: 'movie',
                        });
                    }
                });
            });

            // Add TV shows from random pages
            pageResults.slice(5).forEach((response) => {
                response.results.forEach((item) => {
                    const show = item as TMDBTVShow;
                    if (show.poster_path) {
                        allMedia.push({
                            src: getPosterUrl(show.poster_path, 'large'),
                            alt: show.name || 'TV Show',
                            id: show.id,
                            type: 'tv',
                        });
                    }
                });
            });

            const uniqueMedia = removeDuplicates(allMedia);
            const shuffledMedia = shuffleArray(uniqueMedia);

            setImages(shuffledMedia);
        } catch (error) {
            console.error('Failed to fetch random media:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchRandomMedia();
    }, []);

    const handleReshuffle = () => {
        setShuffleKey(prev => prev + 1);
        setImages(prev => shuffleArray([...prev]));
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

    const galleryImages = useMemo(() =>
        images.map(img => ({ src: img.src, alt: img.alt, id: img.id, type: img.type })),
        [images]
    );

    const details = selectedMedia?.details;
    const isMovie = selectedMedia?.type === 'movie';
    const title = details ? (details.title || details.name) : '';
    const year = details ? new Date(details.release_date || details.first_air_date || '').getFullYear() : '';
    const runtime = isMovie && details ? details.runtime : null;
    const rating = details ? Math.round(details.vote_average * 10) : 0;
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
                                    <X size={20} />
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
                                                {isMovie ? '🎬 MOVIE' : '📺 TV SERIES'}
                                            </span>

                                            <h2 className="random-modal-title">{title}</h2>

                                            <div className="random-modal-meta">
                                                <div className="random-meta-badge random-meta-rating">
                                                    <Star size={16} />
                                                    <span>{rating}%</span>
                                                </div>
                                                {year && (
                                                    <div className="random-meta-badge">
                                                        <Calendar size={16} />
                                                        <span>{year}</span>
                                                    </div>
                                                )}
                                                {runtime && (
                                                    <div className="random-meta-badge">
                                                        <Clock size={16} />
                                                        <span>{runtime} min</span>
                                                    </div>
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

                                            {overview && (
                                                <p className="random-modal-overview">{overview}</p>
                                            )}

                                            <div className="random-modal-actions">
                                                <button className="random-btn random-btn-primary" onClick={handlePlay}>
                                                    <Play size={18} />
                                                    Watch Now
                                                </button>
                                                <button className="random-btn random-btn-secondary">
                                                    <Bookmark size={18} />
                                                    Watchlist
                                                </button>
                                                <button className="random-btn random-btn-icon">
                                                    <Plus size={18} />
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

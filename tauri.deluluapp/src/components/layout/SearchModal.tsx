import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchMultiHumanized, getTrending, type TMDBContent, getTitle, getPosterUrl, getMediaType } from '../../services/tmdb';
import Lenis from 'lenis';
import { globalLenis } from '../../hooks/useLenis';
import './SearchModal.css';

interface SearchModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface RecentSearch {
    id: number;
    title: string;
    mediaType: 'movie' | 'tv';
    posterPath: string | null;
}

const RECENT_SEARCHES_KEY = 'delulu_recent_searches';
const MAX_RECENT_SEARCHES = 10;

function getRecentSearches(): RecentSearch[] {
    try {
        const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
}

function saveRecentSearch(item: TMDBContent) {
    try {
        const recent = getRecentSearches();
        const newItem: RecentSearch = {
            id: item.id,
            title: getTitle(item),
            mediaType: getMediaType(item) as 'movie' | 'tv',
            posterPath: item.poster_path,
        };

        // Remove if already exists
        const filtered = recent.filter(r => !(r.id === item.id && r.mediaType === newItem.mediaType));

        // Add to front
        filtered.unshift(newItem);

        // Keep only max
        const trimmed = filtered.slice(0, MAX_RECENT_SEARCHES);

        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(trimmed));
    } catch {
        // Ignore storage errors
    }
}

function clearRecentSearches() {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
}

export function SearchModal({ isOpen, onClose }: SearchModalProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<TMDBContent[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
    const [trendingMovies, setTrendingMovies] = useState<TMDBContent[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const modalLenisRef = useRef<any>(null); // Type 'any' to avoid strict circular types with dynamic import
    const navigate = useNavigate();

    // Handle background scroll locking and Modal smooth scroll init
    useEffect(() => {
        let rafId: number | undefined;
        let wheelBlocker: ((e: WheelEvent) => void) | undefined;

        const initModalLenis = () => {
            if (!scrollContainerRef.current) return;

            const wrapper = scrollContainerRef.current;
            const content = wrapper.firstElementChild as HTMLElement;
            if (!content) return;

            // Block wheel events from bubbling to window (where globalLenis listens)
            wheelBlocker = (e: WheelEvent) => e.stopPropagation();
            wrapper.addEventListener('wheel', wheelBlocker, { passive: false });

            modalLenisRef.current = new Lenis({
                wrapper,
                content,
                eventsTarget: wrapper,
                duration: 1.2,
                easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
                touchMultiplier: 2,
                infinite: false,
            });

            function raf(time: number) {
                modalLenisRef.current?.raf(time);
                rafId = requestAnimationFrame(raf);
            }
            rafId = requestAnimationFrame(raf);
        };

        const cleanup = () => {
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = undefined;
            }
            if (wheelBlocker && scrollContainerRef.current) {
                scrollContainerRef.current.removeEventListener('wheel', wheelBlocker);
                wheelBlocker = undefined;
            }
            if (modalLenisRef.current) {
                modalLenisRef.current.destroy();
                modalLenisRef.current = null;
            }
        };

        if (isOpen) {
            if (globalLenis) globalLenis.stop();
            document.body.style.overflow = 'hidden';

            // Defer slightly so React has painted the DOM
            const timeout = setTimeout(() => initModalLenis(), 50);

            setRecentSearches(getRecentSearches());
            inputRef.current?.focus();

            getTrending('movie', 'day').then(data => {
                setTrendingMovies(data.slice(0, 5));
            }).catch(console.error);

            return () => {
                clearTimeout(timeout);
                cleanup();
                if (globalLenis) globalLenis.start();
                document.body.style.overflow = '';
            };
        } else {
            cleanup();
            if (globalLenis) globalLenis.start();
            document.body.style.overflow = '';
        }
    }, [isOpen]);

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    useEffect(() => {
        const searchTimeout = setTimeout(async () => {
            if (query.trim().length < 2) {
                setResults([]);
                return;
            }

            setIsLoading(true);
            try {
                const data = await searchMultiHumanized(query, 1);
                // Filter to only movies and TV shows
                const filtered = data.results.filter(
                    (item) => item.media_type === 'movie' || item.media_type === 'tv'
                );
                setResults(filtered.slice(0, 8));
            } catch (error) {
                console.error('Search error:', error);
            } finally {
                setIsLoading(false);
            }
        }, 300);

        return () => clearTimeout(searchTimeout);
    }, [query]);

    const handleSubmitSearch = async (rawQuery: string) => {
        const trimmed = rawQuery.trim();
        if (!trimmed) return;

        // Save one representative result so Enter-based searches also appear in recent history.
        // Prefer already-fetched modal results; fallback to one fresh lookup.
        let historyItem: TMDBContent | null = results[0] ?? null;
        if (!historyItem) {
            try {
                const data = await searchMultiHumanized(trimmed, 1);
                const filtered = data.results.filter(
                    (item) => item.media_type === 'movie' || item.media_type === 'tv'
                );
                historyItem = filtered[0] ?? null;
            } catch {
                historyItem = null;
            }
        }

        if (historyItem) {
            saveRecentSearch(historyItem);
        }

        navigate(`/search?q=${encodeURIComponent(trimmed)}`);
        onClose();
        setQuery('');
        setResults([]);
    };

    const handleResultClick = (item: TMDBContent) => {
        saveRecentSearch(item);
        const mediaType = getMediaType(item);
        navigate(`/details/${mediaType}/${item.id}`);
        onClose();
        setQuery('');
        setResults([]);
    };

    const handleRecentClick = (item: RecentSearch) => {
        navigate(`/details/${item.mediaType}/${item.id}`);
        onClose();
        setQuery('');
    };

    const handleTrendingClick = (item: TMDBContent) => {
        saveRecentSearch(item);
        navigate(`/details/movie/${item.id}`);
        onClose();
        setQuery('');
    };

    const handleClearRecent = () => {
        clearRecentSearches();
        setRecentSearches([]);
    };

    const handleSuggestionClick = (suggestion: string) => {
        setQuery(suggestion);
    };

    if (!isOpen) return null;

    const showDefaultContent = query.trim().length < 2 && !isLoading;
    const showIdleState = showDefaultContent && recentSearches.length === 0 && trendingMovies.length === 0;

    return (
        <div className="search-modal-overlay" onClick={onClose}>
            <div className="search-modal" onClick={(e) => e.stopPropagation()}>
                <div className="search-input-wrapper">
                    <svg className="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" />
                        <path d="M21 21l-4.35-4.35" />
                    </svg>
                    <input
                        ref={inputRef}
                        type="text"
                        className="search-input"
                        placeholder="Search movies, TV shows, actors…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && query.trim()) {
                                e.preventDefault();
                                handleSubmitSearch(query);
                            }
                        }}
                    />
                    <button className="search-close-btn" onClick={onClose}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="search-modal-scroll-container" ref={scrollContainerRef}>
                    <div className="search-modal-scroll-content">
                        {isLoading && (
                            <div className="search-loading">
                                <div className="search-spinner"></div>
                            </div>
                        )}

                        {!isLoading && results.length > 0 && (
                            <div className="search-results">
                                {results.map((item) => (
                                    <div
                                        key={`${item.id}-${getMediaType(item)}`}
                                        className="search-result-item"
                                        onClick={() => handleResultClick(item)}
                                    >
                                        <img
                                            src={getPosterUrl(item.poster_path, 'small')}
                                            alt={getTitle(item)}
                                            className="search-result-poster"
                                        />
                                        <div className="search-result-info">
                                            <h4 className="search-result-title">{getTitle(item)}</h4>
                                            <span className="search-result-type">
                                                {getMediaType(item) === 'movie' ? 'Movie' : 'TV Show'}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {!isLoading && query.length >= 2 && results.length === 0 && (
                            <div className="search-no-results">
                                No results found for "{query}"
                            </div>
                        )}

                        {/* Recent Searches & Trending Section */}
                        {showDefaultContent && (
                            <div className="search-default-content">
                                {/* Recent Searches */}
                                {recentSearches.length > 0 && (
                                    <div className="search-section">
                                        <div className="search-section-header">
                                            <h3 className="search-section-title">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <circle cx="12" cy="12" r="10" />
                                                    <path d="M12 6v6l4 2" />
                                                </svg>
                                                Recent Searches
                                            </h3>
                                            <button className="search-clear-btn" onClick={handleClearRecent}>
                                                Clear
                                            </button>
                                        </div>
                                        <div className="search-recent-list">
                                            {recentSearches.map((item) => (
                                                <div
                                                    key={`recent-${item.id}-${item.mediaType}`}
                                                    className="search-recent-item"
                                                    onClick={() => handleRecentClick(item)}
                                                >
                                                    <img
                                                        src={getPosterUrl(item.posterPath, 'small')}
                                                        alt={item.title}
                                                        className="search-recent-poster"
                                                    />
                                                    <div className="search-recent-info">
                                                        <span className="search-recent-title">{item.title}</span>
                                                        <span className="search-recent-type">
                                                            {item.mediaType === 'movie' ? 'Movie' : 'TV Show'}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Trending Movies */}
                                {trendingMovies.length > 0 && (
                                    <div className="search-section">
                                        <div className="search-section-header">
                                            <h3 className="search-section-title">
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                                                </svg>
                                                Trending Now
                                            </h3>
                                        </div>
                                        <div className="search-trending-grid">
                                            {trendingMovies.map((item) => (
                                                <div
                                                    key={`trending-${item.id}`}
                                                    className="search-trending-item"
                                                    onClick={() => handleTrendingClick(item)}
                                                >
                                                    <div className="search-trending-poster-wrapper">
                                                        <img
                                                            src={getPosterUrl(item.poster_path, 'small')}
                                                            alt={getTitle(item)}
                                                            className="search-trending-poster"
                                                        />
                                                    </div>
                                                    <span className="search-trending-title">{getTitle(item)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Idle State - Editorial Suggestions */}
                                {showIdleState && (
                                    <div className="search-idle-state search-idle-shimmer">
                                        <p className="search-idle-text">Try searching:</p>
                                        <div className="search-idle-suggestions">
                                            {['Interstellar', 'Breaking Bad', 'The Dark Knight', 'Stranger Things', 'Inception'].map((suggestion) => (
                                                <span
                                                    key={suggestion}
                                                    className="search-idle-suggestion"
                                                    onClick={() => handleSuggestionClick(suggestion)}
                                                >
                                                    {suggestion}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div >
    );
}

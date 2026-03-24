import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchMulti, searchMultiHumanized, getTrending, type TMDBContent, getTitle, getPosterUrl, getBackdropUrl, getMediaType } from '../../services/tmdb';
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
        const filtered = recent.filter(r => !(r.id === item.id && r.mediaType === newItem.mediaType));
        filtered.unshift(newItem);
        const trimmed = filtered.slice(0, MAX_RECENT_SEARCHES);
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(trimmed));
    } catch {
        // ignore
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
    const modalLenisRef = useRef<any>(null);
    const navigate = useNavigate();

    // Algolia-first via searchMultiHumanized; if anything fails, TMDB direct fallback
    const runSmartSearch = async (term: string) => {
        try {
            return await searchMultiHumanized(term, 1);
        } catch (primaryError) {
            console.warn('[SearchModal] Primary search failed, falling back to TMDB:', primaryError);
            return await searchMulti(term, 1);
        }
    };

    // ── Scroll lock + Lenis init (same logic as original) ──
    useEffect(() => {
        let rafId: number | undefined;
        let wheelBlocker: ((e: WheelEvent) => void) | undefined;

        const initModalLenis = () => {
            if (!scrollContainerRef.current) return;
            const wrapper = scrollContainerRef.current;
            const content = wrapper.firstElementChild as HTMLElement;
            if (!content) return;

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
            if (rafId) { cancelAnimationFrame(rafId); rafId = undefined; }
            if (wheelBlocker && scrollContainerRef.current) {
                scrollContainerRef.current.removeEventListener('wheel', wheelBlocker);
                wheelBlocker = undefined;
            }
            if (modalLenisRef.current) { modalLenisRef.current.destroy(); modalLenisRef.current = null; }
        };

        if (isOpen) {
            if (globalLenis) globalLenis.stop();
            document.body.style.overflow = 'hidden';
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

    // ── Escape key (same) ──
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [onClose]);

    // ── Debounced search (same) ──
    useEffect(() => {
        const searchTimeout = setTimeout(async () => {
            if (query.trim().length < 2) { setResults([]); return; }
            setIsLoading(true);
            try {
                const data = await runSmartSearch(query);
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

    // ── Handlers (same) ──
    const handleSubmitSearch = async (rawQuery: string) => {
        const trimmed = rawQuery.trim();
        if (!trimmed) return;
        let historyItem: TMDBContent | null = results[0] ?? null;
        if (!historyItem) {
            try {
                const data = await runSmartSearch(trimmed);
                const filtered = data.results.filter(
                    (item) => item.media_type === 'movie' || item.media_type === 'tv'
                );
                historyItem = filtered[0] ?? null;
            } catch { historyItem = null; }
        }
        if (historyItem) saveRecentSearch(historyItem);
        navigate(`/search?q=${encodeURIComponent(trimmed)}`);
        onClose();
        setQuery('');
        setResults([]);
    };

    const handleResultClick = (item: TMDBContent) => {
        saveRecentSearch(item);
        navigate(`/details/${getMediaType(item)}/${item.id}`);
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

    const handleSuggestionClick = (suggestion: string) => setQuery(suggestion);

    if (!isOpen) return null;

    const showDefaultContent = query.trim().length < 2 && !isLoading;
    const showIdleState = showDefaultContent && recentSearches.length === 0 && trendingMovies.length === 0;
    const getFeaturedImage = (item: TMDBContent) =>
        getBackdropUrl(item.backdrop_path || item.poster_path, 'large');

    return (
        <div className="sm-overlay" onClick={onClose}>
            <div className="sm-modal" onClick={(e) => e.stopPropagation()}>

                {/* ── Search bar ── */}
                <div className="sm-bar">
                    <div className="sm-bar-left">
                        <svg className="sm-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                            <circle cx="11" cy="11" r="7" />
                            <path d="M16.5 16.5L21 21" />
                        </svg>
                        <input
                            ref={inputRef}
                            type="text"
                            className="sm-input"
                            placeholder="What are you in the mood for?"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && query.trim()) {
                                    e.preventDefault();
                                    handleSubmitSearch(query);
                                }
                            }}
                        />
                    </div>
                    <div className="sm-bar-right">
                        <button className="sm-close" onClick={onClose}>
                            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M1 1l10 10M11 1L1 11" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* ── Scrollable body ── */}
                <div className="sm-scroll-container" ref={scrollContainerRef}>
                    <div className="sm-scroll-content">

                        {/* Loading */}
                        {isLoading && (
                            <div className="sm-loading">
                                <div className="sm-spinner" />
                            </div>
                        )}

                        {/* Results */}
                        {!isLoading && results.length > 0 && (
                            <div className="sm-results">
                                {results.map((item) => (
                                    <div
                                        key={`${item.id}-${getMediaType(item)}`}
                                        className="sm-result-item"
                                        onClick={() => handleResultClick(item)}
                                    >
                                        <img
                                            src={getPosterUrl(item.poster_path, 'small')}
                                            alt={getTitle(item)}
                                            className="sm-result-poster"
                                        />
                                        <div className="sm-result-info">
                                            <span className="sm-result-title">{getTitle(item)}</span>
                                            <span className="sm-result-type">
                                                {getMediaType(item) === 'movie' ? 'Movie' : 'TV Show'}
                                            </span>
                                        </div>
                                        <svg className="sm-result-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                                            <path d="M9 18l6-6-6-6" />
                                        </svg>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* No results */}
                        {!isLoading && query.length >= 2 && results.length === 0 && (
                            <div className="sm-no-results">
                                No results for <em>"{query}"</em>
                            </div>
                        )}

                        {/* Default content */}
                        {showDefaultContent && (
                            <div className="sm-default">

                                {/* Two-column layout: trending left, recent right */}
                                <div className="sm-two-col">

                                    {/* Left — Trending */}
                                    {trendingMovies.length > 0 && (
                                        <div className="sm-col-left">
                                            <div className="sm-section-label">Trending Now</div>

                                            {/* Featured — first item tall */}
                                            <div
                                                className="sm-featured"
                                                onClick={() => handleTrendingClick(trendingMovies[0])}
                                            >
                                                <img
                                                    src={getFeaturedImage(trendingMovies[0])}
                                                    alt={getTitle(trendingMovies[0])}
                                                    className="sm-featured-img"
                                                />
                                                <div className="sm-featured-overlay" />
                                                <div className="sm-featured-rank">1</div>
                                                <div className="sm-featured-info">
                                                    <span className="sm-featured-title">{getTitle(trendingMovies[0])}</span>
                                                    <div className="sm-featured-meta">
                                                        <span className="sm-featured-star">★</span>
                                                        <span>{trendingMovies[0].vote_average.toFixed(1)}</span>
                                                    </div>
                                                </div>
                                                <div className="sm-featured-bar" />
                                            </div>

                                            {/* Small grid — remaining */}
                                            <div className="sm-small-grid">
                                                {trendingMovies.slice(1).map((item, i) => (
                                                    <div
                                                        key={item.id}
                                                        className="sm-small-card"
                                                        onClick={() => handleTrendingClick(item)}
                                                    >
                                                        <img
                                                            src={getPosterUrl(item.poster_path, 'small')}
                                                            alt={getTitle(item)}
                                                            className="sm-small-img"
                                                        />
                                                        <div className="sm-small-overlay" />
                                                        <span className="sm-small-rank">{i + 2}</span>
                                                        <span className="sm-small-title">{getTitle(item)}</span>
                                                        <div className="sm-card-line" />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Right — Recent + Moods */}
                                    <div className="sm-col-right">

                                        {/* Recent searches */}
                                        {recentSearches.length > 0 && (
                                            <div className="sm-right-section">
                                                <div className="sm-right-header">
                                                    <span className="sm-section-label">Recent</span>
                                                    <button className="sm-clear-btn" onClick={handleClearRecent}>Clear</button>
                                                </div>
                                                <div className="sm-recent-grid">
                                                    {recentSearches.slice(0, 8).map((item) => (
                                                        <button
                                                            key={`recent-${item.id}-${item.mediaType}`}
                                                            className="sm-recent-poster-card"
                                                            onClick={() => handleRecentClick(item)}
                                                            type="button"
                                                            aria-label={item.title}
                                                            title={item.title}
                                                        >
                                                            <img
                                                                src={getPosterUrl(item.posterPath, 'small')}
                                                                alt={item.title}
                                                                className="sm-recent-poster"
                                                            />
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Idle state suggestions */}
                                        {showIdleState && (
                                            <div className="sm-right-section">
                                                <span className="sm-section-label">Try Searching</span>
                                                <div className="sm-suggestions">
                                                    {['Interstellar', 'Breaking Bad', 'The Dark Knight', 'Stranger Things', 'Inception'].map((s) => (
                                                        <span
                                                            key={s}
                                                            className="sm-suggestion"
                                                            onClick={() => handleSuggestionClick(s)}
                                                        >
                                                            {s}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* ── Footer ── */}
                <div className="sm-footer-credit-only">Powered by TMDB</div>
            </div>
        </div>
    );
}


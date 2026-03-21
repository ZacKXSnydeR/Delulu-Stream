import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
    searchMultiHumanized,
    rankSearchResults,
    getPosterUrl,
    getTitle,
    getMediaType,
    getReleaseYear,
    type TMDBContent,
} from '../services/tmdb';
import './Search.css';

type SearchResultItem = TMDBContent & { media_type: 'movie' | 'tv' };

export function Search() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const query = searchParams.get('q') || '';
    
    const [results, setResults] = useState<SearchResultItem[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [totalResults, setTotalResults] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    const observerTarget = useRef<HTMLDivElement>(null);

    const dedupeResults = (items: SearchResultItem[]): SearchResultItem[] => {
        const unique = new Map<string, SearchResultItem>();
        for (const item of items) {
            unique.set(`${getMediaType(item)}-${item.id}`, item);
        }
        return Array.from(unique.values());
    };

    const fetchResults = useCallback(async (searchQuery: string, pageNum: number, append: boolean) => {
        if (!searchQuery.trim()) return;
        
        if (pageNum === 1) setIsLoading(true);
        else setIsLoadingMore(true);
        
        setError(null);
        
        try {
            const data = await searchMultiHumanized(searchQuery, pageNum);
            
            // Filter to only movies and TV shows
            const filteredResults = data.results.filter(
                (item) => item.media_type === 'movie' || item.media_type === 'tv'
            ) as SearchResultItem[];
            
            setResults(prev => {
                if (!append) return filteredResults;
                const merged = dedupeResults([...prev, ...filteredResults]);
                return rankSearchResults(merged, searchQuery);
            });
            setTotalPages(data.total_pages);
            setTotalResults(data.total_results);
        } catch (err) {
            console.error('Search page error:', err);
            setError('Failed to load search results. Please try again.');
        } finally {
            setIsLoading(false);
            setIsLoadingMore(false);
        }
    }, []);

    // Initial search when query changes
    useEffect(() => {
        setResults([]);
        setPage(1);
        if (query) {
            fetchResults(query, 1, false);
        }
    }, [query, fetchResults]);

    // Infinite scroll observer
    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && !isLoading && !isLoadingMore && page < totalPages) {
                    const nextPage = page + 1;
                    setPage(nextPage);
                    fetchResults(query, nextPage, true);
                }
            },
            { threshold: 0.1 }
        );

        if (observerTarget.current) {
            observer.observe(observerTarget.current);
        }

        return () => observer.disconnect();
    }, [isLoading, isLoadingMore, page, totalPages, query, fetchResults]);

    const handleItemClick = (item: TMDBContent) => {
        const mediaType = getMediaType(item);
        navigate(`/details/${mediaType}/${item.id}`);
    };

    return (
        <div className="search-page page">
            <div className="search-container">
                <header className="search-header">
                    <h1 className="search-title">
                        {query ? `Results for "${query}"` : 'Search'}
                    </h1>
                    {totalResults > 0 && (
                        <p className="search-count">{totalResults} titles found</p>
                    )}
                </header>

                {isLoading && page === 1 ? (
                    <div className="search-page-loading">
                        <div className="search-spinner"></div>
                    </div>
                ) : error ? (
                    <div className="search-error">
                        <p>{error}</p>
                        <button onClick={() => fetchResults(query, 1, false)}>Retry</button>
                    </div>
                ) : results.length > 0 ? (
                    <>
                        <div className="search-grid">
                            {results.map((item) => (
                                <div 
                                    key={`${item.id}-${getMediaType(item)}`}
                                    className="search-card"
                                    onClick={() => handleItemClick(item)}
                                >
                                    <div className="search-card-poster-wrapper">
                                        <img 
                                            src={getPosterUrl(item.poster_path, 'medium')} 
                                            alt={getTitle(item)} 
                                            className="search-card-poster"
                                            loading="lazy"
                                        />
                                        <div className="search-card-overlay">
                                            <div className="search-card-play-btn">
                                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                                                    <path d="M8 5v14l11-7z" />
                                                </svg>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="search-card-info">
                                        <h3 className="search-card-title">{getTitle(item)}</h3>
                                        <div className="search-card-meta">
                                            <span>{getReleaseYear(item)}</span>
                                            <span className="search-card-type">
                                                {getMediaType(item) === 'movie' ? 'Movie' : 'TV Show'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        
                        <div ref={observerTarget} className="search-scroll-trigger">
                            {isLoadingMore && <div className="search-spinner"></div>}
                        </div>
                    </>
                ) : !isLoading && query ? (
                    <div className="search-empty">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" />
                            <path d="M21 21l-4.35-4.35" />
                        </svg>
                        <h2>No results found</h2>
                        <p>We couldn't find any movies or TV shows matching "{query}".</p>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

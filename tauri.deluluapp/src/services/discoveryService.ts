import {
    getTrending,
    getPopularMovies,
    getPopularTVShows,
    getPosterUrl,
    type TMDBContent,
    type TMDBMovie,
    type TMDBTVShow,
} from './tmdb';

export interface MediaImage {
    src: string;
    alt: string;
    id: number;
    type: 'movie' | 'tv';
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

let cachedRandomMedia: MediaImage[] = [];
let isFetching = false;
let fetchPromise: Promise<MediaImage[]> | null = null;

export const discoveryService = {
    async fetchRandomMedia(forceRefresh = false): Promise<MediaImage[]> {
        if (!forceRefresh && cachedRandomMedia.length > 0) {
            return cachedRandomMedia;
        }

        if (isFetching && fetchPromise) {
            return fetchPromise;
        }

        isFetching = true;
        fetchPromise = (async () => {
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
                    const posterPath = item.poster_path;
                    if (posterPath) {
                        const isMovie = 'title' in item;
                        allMedia.push({
                            src: getPosterUrl(posterPath, 'large'),
                            alt: isMovie ? (item as any).title : (item as any).name,
                            id: item.id,
                            type: isMovie ? 'movie' : 'tv',
                        });
                    }
                });

                // Add movies from random pages
                pageResults.slice(0, 5).forEach((response) => {
                    response.results.forEach((item: any) => {
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
                    response.results.forEach((item: any) => {
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
                cachedRandomMedia = shuffleArray(uniqueMedia);
                return cachedRandomMedia;
            } catch (error) {
                console.error('[DiscoveryService] Failed to fetch random media:', error);
                return [];
            } finally {
                isFetching = false;
                fetchPromise = null;
            }
        })();

        return fetchPromise;
    },

    getRandomMediaSync(): MediaImage[] {
        return cachedRandomMedia;
    },

    prefetch() {
        if (cachedRandomMedia.length === 0 && !isFetching) {
            console.log('[DiscoveryService] Prefetching random media...');
            this.fetchRandomMedia().catch(() => {});
        }
    }
};

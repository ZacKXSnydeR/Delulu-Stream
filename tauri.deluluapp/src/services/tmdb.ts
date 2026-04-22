// TMDb API Service Layer
import { invoke } from '@tauri-apps/api/core';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

// Image size configurations
export const ImageSizes = {
    poster: {
        small: 'w185',
        medium: 'w342',
        large: 'w500',
        original: 'original',
    },
    backdrop: {
        small: 'w300',
        medium: 'w780',
        large: 'w1280',
        original: 'original',
    },
    profile: {
        small: 'w45',
        medium: 'w185',
        large: 'h632',
        original: 'original',
    },
};

// Types
export interface TMDBMovie {
    id: number;
    title: string;
    original_title: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    release_date: string;
    vote_average: number;
    vote_count: number;
    popularity: number;
    genre_ids: number[];
    adult: boolean;
    media_type?: 'movie';
}

export interface TMDBTVShow {
    id: number;
    name: string;
    original_name: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    first_air_date: string;
    vote_average: number;
    vote_count: number;
    popularity: number;
    genre_ids: number[];
    media_type?: 'tv';
}

export type TMDBContent = TMDBMovie | TMDBTVShow;

export interface TMDBGenre {
    id: number;
    name: string;
}

export interface TMDBCastMember {
    id: number;
    name: string;
    character: string;
    profile_path: string | null;
    order: number;
}

export interface TMDBContentDetails {
    id: number;
    title?: string;
    name?: string;
    overview: string;
    poster_path: string | null;
    backdrop_path: string | null;
    release_date?: string;
    first_air_date?: string;
    vote_average: number;
    vote_count: number;
    genres: TMDBGenre[];
    runtime?: number;
    episode_run_time?: number[];
    number_of_seasons?: number;
    number_of_episodes?: number;
    tagline: string;
    status: string;
}

export interface TMDBCredits {
    cast: TMDBCastMember[];
}

// Season in TV series details
export interface TMDBSeason {
    id: number;
    season_number: number;
    name: string;
    episode_count: number;
    poster_path: string | null;
    air_date: string | null;
    overview: string;
}

// Episode in season details
export interface TMDBEpisode {
    id: number;
    episode_number: number;
    name: string;
    overview: string;
    still_path: string | null;
    runtime: number | null;
    air_date: string | null;
    vote_average: number;
}

// Season details response (with episodes)
export interface TMDBSeasonDetails {
    id: number;
    season_number: number;
    name: string;
    overview: string;
    poster_path: string | null;
    episodes: TMDBEpisode[];
}

// Extended TV show details with seasons
export interface TMDBTVShowDetails extends TMDBContentDetails {
    seasons: TMDBSeason[];
}

export interface TMDBMovieReleaseDateEntry {
    certification: string;
    descriptors: string[];
    iso_639_1: string;
    note: string;
    release_date: string;
    type: number;
}

export interface TMDBMovieReleaseDateResult {
    iso_3166_1: string;
    release_dates: TMDBMovieReleaseDateEntry[];
}

export interface TMDBMovieReleaseDatesResponse {
    id: number;
    results: TMDBMovieReleaseDateResult[];
}

export interface TMDBResponse<T> {
    page: number;
    results: T[];
    total_pages: number;
    total_results: number;
}

// Utility functions
export function getImageUrl(
    path: string | null,
    size: string = 'original'
): string {
    if (!path) return '/placeholder-poster.jpg';
    return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function getPosterUrl(path: string | null, size: keyof typeof ImageSizes.poster = 'medium'): string {
    return getImageUrl(path, ImageSizes.poster[size]);
}

export function getBackdropUrl(path: string | null, size: keyof typeof ImageSizes.backdrop = 'large'): string {
    return getImageUrl(path, ImageSizes.backdrop[size]);
}

export function getProfileUrl(path: string | null, size: keyof typeof ImageSizes.profile = 'medium'): string {
    return getImageUrl(path, ImageSizes.profile[size]);
}

export function getTitle(content: TMDBContent): string {
    return 'title' in content ? content.title : content.name;
}

export function getReleaseYear(content: TMDBContent): string {
    const date = 'release_date' in content ? content.release_date : content.first_air_date;
    return date ? new Date(date).getFullYear().toString() : 'N/A';
}

export function getMediaType(content: TMDBContent): 'movie' | 'tv' {
    if (content.media_type) return content.media_type;
    return 'title' in content ? 'movie' : 'tv';
}

// ==========================================
// In-memory TTL cache for TMDB API responses
// ==========================================
interface CacheEntry<T = unknown> {
    data: T;
    timestamp: number;
}

const TTL_LIST = 10 * 60 * 1000;   // 10 min for list endpoints
const TTL_DETAIL = 30 * 60 * 1000; // 30 min for detail endpoints

const responseCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<unknown>>();

function getCacheTTL(endpoint: string): number {
    // Detail endpoints have longer TTL
    if (/^\/(movie|tv)\/\d+/.test(endpoint)) return TTL_DETAIL;
    return TTL_LIST;
}

/** Clear all cached TMDB responses */
export function clearTMDBCache(): void {
    responseCache.clear();
    inFlightRequests.clear();
    console.log('[TMDB Cache] Cleared all cached responses');
}

// API Functions
async function fetchTMDB<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const cacheKey = `${endpoint}?${new URLSearchParams(params).toString()}`;
    const ttl = getCacheTTL(endpoint);

    // 1. Check cache
    const cached = responseCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < ttl) {
        return cached.data as T;
    }

    // 2. In-flight deduplication — if same request is already in progress, wait for it
    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) {
        return inFlight as Promise<T>;
    }

    // 3. Make the request
    const promise = (async () => {
        const data = await invoke<T>('tmdb_proxy_request', {
            endpoint,
            params,
        });

        // Store in cache
        responseCache.set(cacheKey, { data, timestamp: Date.now() });

        return data;
    })();

    // Track in-flight
    inFlightRequests.set(cacheKey, promise);
    promise.finally(() => inFlightRequests.delete(cacheKey));

    return promise as Promise<T>;
}

// Get trending content
export async function getTrending(
    mediaType: 'all' | 'movie' | 'tv' = 'all',
    timeWindow: 'day' | 'week' = 'week'
): Promise<TMDBContent[]> {
    const response = await fetchTMDB<TMDBResponse<TMDBContent>>(
        `/trending/${mediaType}/${timeWindow}`
    );
    return response.results;
}

// Get popular movies
export async function getPopularMovies(page: number = 1): Promise<TMDBResponse<TMDBMovie>> {
    return fetchTMDB<TMDBResponse<TMDBMovie>>('/movie/popular', { page: page.toString() });
}

// Get popular TV shows
export async function getPopularTVShows(page: number = 1): Promise<TMDBResponse<TMDBTVShow>> {
    return fetchTMDB<TMDBResponse<TMDBTVShow>>('/tv/popular', { page: page.toString() });
}

// Get top rated movies
export async function getTopRatedMovies(page: number = 1): Promise<TMDBResponse<TMDBMovie>> {
    return fetchTMDB<TMDBResponse<TMDBMovie>>('/movie/top_rated', { page: page.toString() });
}

// Get top rated TV shows
export async function getTopRatedTVShows(page: number = 1): Promise<TMDBResponse<TMDBTVShow>> {
    return fetchTMDB<TMDBResponse<TMDBTVShow>>('/tv/top_rated', { page: page.toString() });
}

// Get movie details
export async function getMovieDetails(id: number): Promise<TMDBContentDetails> {
    return fetchTMDB<TMDBContentDetails>(`/movie/${id}`);
}

export async function getMovieReleaseDates(id: number): Promise<TMDBMovieReleaseDatesResponse> {
    return fetchTMDB<TMDBMovieReleaseDatesResponse>(`/movie/${id}/release_dates`);
}

// Get TV show details (with seasons)
export async function getTVShowDetails(id: number): Promise<TMDBTVShowDetails> {
    return fetchTMDB<TMDBTVShowDetails>(`/tv/${id}`);
}

// Get season details with episodes
export async function getSeasonDetails(
    tvId: number,
    seasonNumber: number
): Promise<TMDBSeasonDetails> {
    return fetchTMDB<TMDBSeasonDetails>(`/tv/${tvId}/season/${seasonNumber}`);
}

// Get still (episode thumbnail) URL
export function getStillUrl(path: string | null, size: 'small' | 'medium' | 'large' = 'medium'): string {
    if (!path) return '/placeholder-episode.jpg';
    const sizeMap = { small: 'w185', medium: 'w300', large: 'w500' };
    return `${TMDB_IMAGE_BASE}/${sizeMap[size]}${path}`;
}

// Get content credits (cast)
export async function getCredits(
    mediaType: 'movie' | 'tv',
    id: number
): Promise<TMDBCredits> {
    return fetchTMDB<TMDBCredits>(`/${mediaType}/${id}/credits`);
}

// Search content
export async function searchContent(
    query: string,
    page: number = 1
): Promise<TMDBResponse<TMDBContent>> {
    return fetchTMDB<TMDBResponse<TMDBContent>>('/search/multi', {
        query,
        page: page.toString(),
        include_adult: 'false',
    });
}

// Get genres
export async function getMovieGenres(): Promise<TMDBGenre[]> {
    const response = await fetchTMDB<{ genres: TMDBGenre[] }>('/genre/movie/list');
    return response.genres;
}

export async function getTVGenres(): Promise<TMDBGenre[]> {
    const response = await fetchTMDB<{ genres: TMDBGenre[] }>('/genre/tv/list');
    return response.genres;
}

// Get discover movies with filters
export async function discoverMovies(
    params: {
        page?: number;
        with_genres?: string;
        sort_by?: string;
        year?: number;
    } = {}
): Promise<TMDBResponse<TMDBMovie>> {
    const queryParams: Record<string, string> = {};
    if (params.page) queryParams.page = params.page.toString();
    if (params.with_genres) queryParams.with_genres = params.with_genres;
    if (params.sort_by) queryParams.sort_by = params.sort_by;
    if (params.year) queryParams.primary_release_year = params.year.toString();

    return fetchTMDB<TMDBResponse<TMDBMovie>>('/discover/movie', queryParams);
}

// Get discover TV shows with filters
export async function discoverTVShows(
    params: {
        page?: number;
        with_genres?: string;
        sort_by?: string;
        year?: number;
    } = {}
): Promise<TMDBResponse<TMDBTVShow>> {
    const queryParams: Record<string, string> = {};
    if (params.page) queryParams.page = params.page.toString();
    if (params.with_genres) queryParams.with_genres = params.with_genres;
    if (params.sort_by) queryParams.sort_by = params.sort_by;
    if (params.year) queryParams.first_air_date_year = params.year.toString();

    return fetchTMDB<TMDBResponse<TMDBTVShow>>('/discover/tv', queryParams);
}

// Get random content
export async function getRandomContent(): Promise<TMDBContent> {
    const randomPage = Math.floor(Math.random() * 100) + 1;
    const mediaType = Math.random() > 0.5 ? 'movie' : 'tv';

    const response = mediaType === 'movie'
        ? await getPopularMovies(randomPage)
        : await getPopularTVShows(randomPage);

    const randomIndex = Math.floor(Math.random() * response.results.length);
    return response.results[randomIndex];
}

// Search multi (alias for searchContent) - returns content with media_type
export async function searchMulti(
    query: string,
    page: number = 1
): Promise<TMDBResponse<TMDBContent & { media_type: 'movie' | 'tv' | 'person' }>> {
    return fetchTMDB<TMDBResponse<TMDBContent & { media_type: 'movie' | 'tv' | 'person' }>>('/search/multi', {
        query,
        page: page.toString(),
        include_adult: 'false',
    });
}

type TMDBSearchMedia = TMDBContent & { media_type: 'movie' | 'tv' | 'person' };

function normalizeSearchText(input: string, keepSpaces = true): string {
    const lowered = input
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    if (keepSpaces) {
        return lowered
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    return lowered.replace(/[^a-z0-9]/g, '');
}

function buildSearchQueryVariants(query: string): string[] {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const variants = new Set<string>([trimmed]);

    const separated = trimmed
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (separated && separated !== trimmed) {
        variants.add(separated);
    }

    const compactNoSpace = normalizeSearchText(trimmed, false);
    if (/\s/.test(trimmed) && compactNoSpace.length >= 3) {
        variants.add(compactNoSpace);
    }

    const compact = normalizeSearchText(trimmed, false);
    const hasNoSpaces = !/\s/.test(trimmed);
    if (hasNoSpaces && compact.length >= 6) {
        const suffixes = ['man', 'woman', 'girl', 'boy', 'world', 'land', 'house', 'night', 'day', 'war', 'love', 'fire', 'blood', 'heart'];
        for (const suffix of suffixes) {
            if (compact.endsWith(suffix) && compact.length > suffix.length + 2) {
                const splitAt = compact.length - suffix.length;
                variants.add(`${compact.slice(0, splitAt)} ${compact.slice(splitAt)}`);
                break;
            }
        }
    }

    return Array.from(variants).slice(0, 3);
}

interface AlgoliaHit {
    objectID: string;
    id?: number;
    tmdb_id?: number;
    media_type?: 'movie' | 'tv' | 'person';
    title?: string;
    name?: string;
    original_title?: string;
    original_name?: string;
    overview?: string;
    poster_path?: string | null;
    backdrop_path?: string | null;
    release_date?: string;
    first_air_date?: string;
    popularity?: number;
    vote_average?: number;
    vote_count?: number;
    genre_ids?: number[];
    adult?: boolean;
}

interface AlgoliaSearchResponse {
    hits: AlgoliaHit[];
    nbPages: number;
    nbHits: number;
}

function hasAlgoliaConfig(): boolean {
    return true;
}

async function queryAlgoliaIndex(query: string, page: number): Promise<AlgoliaSearchResponse> {
    return invoke<AlgoliaSearchResponse>('algolia_search', {
        query,
        page,
    });
}

function mapAlgoliaHitToTMDBSearchMedia(hit: AlgoliaHit): TMDBSearchMedia | null {
    const mediaType = hit.media_type;
    const id = hit.tmdb_id ?? hit.id;
    if (!id || (mediaType !== 'movie' && mediaType !== 'tv')) return null;

    if (mediaType === 'movie') {
        return {
            id,
            title: hit.title || hit.original_title || '',
            original_title: hit.original_title || hit.title || '',
            overview: hit.overview || '',
            poster_path: hit.poster_path ?? null,
            backdrop_path: hit.backdrop_path ?? null,
            release_date: hit.release_date || '',
            vote_average: hit.vote_average ?? 0,
            vote_count: hit.vote_count ?? 0,
            popularity: hit.popularity ?? 0,
            genre_ids: hit.genre_ids ?? [],
            adult: hit.adult ?? false,
            media_type: 'movie',
        };
    }

    return {
        id,
        name: hit.name || hit.original_name || '',
        original_name: hit.original_name || hit.name || '',
        overview: hit.overview || '',
        poster_path: hit.poster_path ?? null,
        backdrop_path: hit.backdrop_path ?? null,
        first_air_date: hit.first_air_date || '',
        vote_average: hit.vote_average ?? 0,
        vote_count: hit.vote_count ?? 0,
        popularity: hit.popularity ?? 0,
        genre_ids: hit.genre_ids ?? [],
        media_type: 'tv',
    };
}

function getSearchTitles(item: TMDBSearchMedia): string[] {
    if ('title' in item) {
        return [item.title, item.original_title].filter(Boolean);
    }
    if ('name' in item) {
        return [item.name, item.original_name].filter(Boolean);
    }
    return [];
}

function damerauLevenshtein(a: string, b: string): number {
    const alen = a.length;
    const blen = b.length;
    if (alen === 0) return blen;
    if (blen === 0) return alen;

    const dp: number[][] = Array.from({ length: alen + 1 }, () => Array(blen + 1).fill(0));
    for (let i = 0; i <= alen; i += 1) dp[i][0] = i;
    for (let j = 0; j <= blen; j += 1) dp[0][j] = j;

    for (let i = 1; i <= alen; i += 1) {
        for (let j = 1; j <= blen; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,      // deletion
                dp[i][j - 1] + 1,      // insertion
                dp[i - 1][j - 1] + cost // substitution
            );

            if (
                i > 1 &&
                j > 1 &&
                a[i - 1] === b[j - 2] &&
                a[i - 2] === b[j - 1]
            ) {
                dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1); // transposition
            }
        }
    }

    return dp[alen][blen];
}

function scoreSearchItem(item: TMDBSearchMedia, query: string): number {
    const normalizedQuery = normalizeSearchText(query, true);
    const compactQuery = normalizeSearchText(query, false);
    if (!compactQuery) return 0;

    const queryTokens = normalizedQuery.split(' ').filter(Boolean);
    const titles = getSearchTitles(item);

    let bestTitleScore = 0;
    for (const title of titles) {
        const normalizedTitle = normalizeSearchText(title, true);
        const compactTitle = normalizeSearchText(title, false);
        const titleTokens = normalizedTitle.split(' ').filter(Boolean);
        const overlapCount = queryTokens.filter((token) => titleTokens.includes(token)).length;

        let score = 0;
        if (compactTitle === compactQuery) score += 2000;
        else if (compactTitle.startsWith(compactQuery)) score += 1300;
        else if (compactTitle.includes(compactQuery)) score += 950;

        if (normalizedTitle === normalizedQuery) score += 480;
        else if (normalizedTitle.startsWith(normalizedQuery)) score += 340;
        else if (normalizedTitle.includes(normalizedQuery)) score += 230;

        if (queryTokens.length > 0) {
            score += Math.round((overlapCount / queryTokens.length) * 320);
        }

        // Typo tolerance boost (Damerau-Levenshtein: insertion/deletion/substitution/transposition)
        const maxLen = Math.max(compactQuery.length, compactTitle.length);
        if (maxLen > 0) {
            const distance = damerauLevenshtein(compactQuery, compactTitle);
            const similarity = 1 - distance / maxLen;
            if (distance <= 2) {
                score += 380 - distance * 95;
            } else if (similarity >= 0.74) {
                score += Math.round(similarity * 210);
            }
        }

        bestTitleScore = Math.max(bestTitleScore, score);
    }

    const popularityBoost = Math.min(item.popularity || 0, 120);
    const voteBoost = Math.min((item.vote_count || 0) / 80, 40);
    const posterPenalty = item.poster_path ? 0 : -90;

    return bestTitleScore + popularityBoost + voteBoost + posterPenalty;
}

export function rankSearchResults<T extends TMDBSearchMedia>(items: T[], query: string): T[] {
    return [...items]
        .sort((a, b) => {
            const scoreDiff = scoreSearchItem(b, query) - scoreSearchItem(a, query);
            if (scoreDiff !== 0) return scoreDiff;
            return (b.popularity || 0) - (a.popularity || 0);
        });
}

export async function searchMultiHumanized(
    query: string,
    page: number = 1
): Promise<TMDBResponse<TMDBSearchMedia>> {
    const variants = buildSearchQueryVariants(query);
    const primaryQuery = variants[0] || query;

    if (hasAlgoliaConfig()) {
        try {
            if (page > 1) {
                const algoliaPage = await queryAlgoliaIndex(primaryQuery, page);
                const mapped = algoliaPage.hits
                    .map(mapAlgoliaHitToTMDBSearchMedia)
                    .filter((item): item is TMDBSearchMedia => item !== null);
                return {
                    page,
                    total_pages: algoliaPage.nbPages,
                    total_results: algoliaPage.nbHits,
                    results: rankSearchResults(mapped, query),
                };
            }

            const algoliaResponses = await Promise.all(
                variants.map((variant) => queryAlgoliaIndex(variant, 1))
            );

            const dedupedAlgolia = new Map<string, TMDBSearchMedia>();
            for (const response of algoliaResponses) {
                for (const hit of response.hits) {
                    const mapped = mapAlgoliaHitToTMDBSearchMedia(hit);
                    if (!mapped) continue;
                    dedupedAlgolia.set(`${mapped.media_type}-${mapped.id}`, mapped);
                }
            }

            const rankedAlgolia = rankSearchResults(Array.from(dedupedAlgolia.values()), query);
            const primaryAlgolia = algoliaResponses[0];

            if (rankedAlgolia.length > 0) {
                return {
                    page: 1,
                    total_pages: primaryAlgolia.nbPages,
                    total_results: Math.max(primaryAlgolia.nbHits, rankedAlgolia.length),
                    results: rankedAlgolia,
                };
            }
        } catch (error) {
            console.warn('[Search] Algolia search failed, falling back to TMDB:', error);
        }
    }

    if (page > 1) {
        const response = await searchMulti(primaryQuery, page);
        return {
            ...response,
            results: rankSearchResults(response.results, query),
        };
    }

    const requests: Array<Promise<TMDBResponse<TMDBSearchMedia>>> = [
        searchMulti(primaryQuery, 1),
        searchMulti(primaryQuery, 2),
        searchMulti(primaryQuery, 3),
    ];

    for (const variant of variants.slice(1)) {
        requests.push(searchMulti(variant, 1));
    }

    const responses = await Promise.all(requests);
    const primary = responses[0];

    const deduped = new Map<string, TMDBSearchMedia>();
    for (const response of responses) {
        for (const item of response.results) {
            deduped.set(`${item.media_type}-${item.id}`, item);
        }
    }

    const ranked = rankSearchResults(Array.from(deduped.values()), query);

    return {
        page: 1,
        total_pages: primary.total_pages,
        total_results: Math.max(primary.total_results, ranked.length),
        results: ranked,
    };
}

// Video/Trailer types
export interface TMDBVideo {
    id: string;
    key: string;      // YouTube video key
    name: string;
    site: string;     // "YouTube", "Vimeo", etc.
    type: string;     // "Trailer", "Teaser", "Featurette", etc.
    official: boolean;
    published_at: string;
}

interface TMDBVideosResponse {
    id: number;
    results: TMDBVideo[];
}

// Get videos (trailers, teasers, etc.) for a movie or TV show
export async function getVideos(
    id: number,
    type: 'movie' | 'tv'
): Promise<TMDBVideo[]> {
    const endpoint = type === 'movie' ? `/movie/${id}/videos` : `/tv/${id}/videos`;
    const response = await fetchTMDB<TMDBVideosResponse>(endpoint);
    return response.results || [];
}

// Get the best trailer for a movie or TV show
export async function getTrailer(
    id: number,
    type: 'movie' | 'tv'
): Promise<TMDBVideo | null> {
    const videos = await getVideos(id, type);

    // Filter for YouTube videos only
    const youtubeVideos = videos.filter(v => v.site === 'YouTube');

    // Priority: Official Trailer > Trailer > Teaser > any video
    const officialTrailer = youtubeVideos.find(v => v.type === 'Trailer' && v.official);
    if (officialTrailer) return officialTrailer;

    const trailer = youtubeVideos.find(v => v.type === 'Trailer');
    if (trailer) return trailer;

    const teaser = youtubeVideos.find(v => v.type === 'Teaser');
    if (teaser) return teaser;

    // Return first YouTube video if no trailer found
    return youtubeVideos[0] || null;
}

const detailPrefetchTimestamps = new Map<string, number>();
const DETAIL_PREFETCH_COOLDOWN_MS = 3 * 60 * 1000;

/**
 * Warm the TMDB in-memory cache for the Details route before navigation.
 * This is intentionally fire-and-forget to avoid blocking UI interactions.
 */
export function prefetchDetailsBundle(type: 'movie' | 'tv', id: number): void {
    const key = `${type}-${id}`;
    const now = Date.now();
    const lastPrefetch = detailPrefetchTimestamps.get(key);

    if (lastPrefetch && now - lastPrefetch < DETAIL_PREFETCH_COOLDOWN_MS) {
        return;
    }

    detailPrefetchTimestamps.set(key, now);

    if (type === 'movie') {
        void Promise.all([
            getMovieDetails(id),
            getCredits('movie', id),
            getTrailer(id, 'movie'),
            getMovieReleaseDates(id),
        ]).catch(() => {
            // Silent failure: prefetch is opportunistic only.
        });
        return;
    }

    void Promise.all([
        getTVShowDetails(id),
        getCredits('tv', id),
        getTrailer(id, 'tv'),
    ])
        .then(([showDetails]) => {
            const firstPlayableSeason = showDetails.seasons
                ?.filter((season) => season.episode_count > 0)
                .sort((a, b) => a.season_number - b.season_number)[0];

            if (firstPlayableSeason) {
                void getSeasonDetails(id, firstPlayableSeason.season_number).catch(() => {
                    // Silent failure: prefetch is opportunistic only.
                });
            }
        })
        .catch(() => {
            // Silent failure: prefetch is opportunistic only.
        });
}


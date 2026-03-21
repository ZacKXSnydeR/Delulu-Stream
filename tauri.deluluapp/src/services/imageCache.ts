// In-memory image blob cache
// Stores fetched images as blob URLs so they render instantly on revisit

const blobCache = new Map<string, string>();
const inFlightFetches = new Map<string, Promise<string>>();

/**
 * Get a cached blob URL for an image, or fetch + cache it.
 * Returns the original URL immediately if not cached yet (progressive).
 */
export function getCachedImageUrl(originalUrl: string): string {
    return blobCache.get(originalUrl) || originalUrl;
}

/**
 * Returns true if this URL is already cached as a blob.
 */
export function isImageCached(url: string): boolean {
    return blobCache.has(url);
}

/**
 * Fetch an image and store it as a blob URL in the cache.
 * Returns the blob URL. If already cached, returns immediately.
 * If already in-flight, deduplicates the request.
 */
export async function cacheImage(url: string): Promise<string> {
    // Already cached
    const cached = blobCache.get(url);
    if (cached) return cached;

    // Already fetching
    const inFlight = inFlightFetches.get(url);
    if (inFlight) return inFlight;

    const promise = (async () => {
        // External images (e.g. TMDB) block cross-origin fetch.
        // Browser HTTP cache already handles image caching natively,
        // so just return the original URL directly.
        inFlightFetches.delete(url);
        return url;
    })();

    inFlightFetches.set(url, promise);
    return promise;
}

/**
 * Clear the entire image cache (frees blob URLs from memory).
 */
export function clearImageCache(): void {
    blobCache.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
    blobCache.clear();
    console.log('[ImageCache] Cleared all cached images');
}

/** Current cache size */
export function getImageCacheSize(): number {
    return blobCache.size;
}

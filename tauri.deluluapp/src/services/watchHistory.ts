// Watch history and progress tracking service
import { getDatabase } from './database';

export interface WatchRecord {
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    seasonNumber?: number;
    episodeNumber?: number;
    currentTime: number;
    totalDuration: number;
}

export interface WatchHistoryItem {
    id: number;
    user_id: string;
    tmdb_id: number;
    media_type: 'movie' | 'tv';
    season_number: number | null;
    episode_number: number | null;
    current_time: number;
    total_duration: number;
    progress_percentage: number;
    episodes_in_progress?: number;
    is_completed: boolean;
    last_watched_at: string;
    created_at: string;
}

class WatchHistoryService {
    private updateQueue = new Map<string, WatchRecord>();
    private syncInterval: number | null = null;
    private readonly SYNC_INTERVAL_MS = 5000;
    private readonly COMPLETION_THRESHOLD = 0.95;
    private readonly CONTINUE_WATCHING_MIN_SECONDS = 8 * 60;
    private isSyncing = false;

    constructor() {
        this.startAutoSync();
    }

    /**
     * Start automatic background sync to database
     */
    private startAutoSync() {
        if (this.syncInterval) return;

        this.syncInterval = setInterval(() => {
            this.syncToDatabase().catch(err => {
                console.error('[WatchHistory] Auto-sync failed:', err);
            });
        }, this.SYNC_INTERVAL_MS);

        console.log('[WatchHistory] Auto-sync started');
    }

    /**
     * Stop automatic sync (cleanup)
     */
    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            console.log('[WatchHistory] Auto-sync stopped');
        }
    }

    /**
     * Add progress update to queue (debounced)
     * @param record Watch record to update
     */
    updateProgress(record: WatchRecord) {
        const key = this.getRecordKey(record);
        this.updateQueue.set(key, record);
    }

    /**
     * Immediately sync all queued updates to database
     */
    async syncToDatabase(): Promise<void> {
        if (this.updateQueue.size === 0 || this.isSyncing) return;
        this.isSyncing = true;

        const db = await getDatabase();
        const records = Array.from(this.updateQueue.entries());

        console.log(`[WatchHistory] Syncing ${records.length} record(s)`);

        try {
            for (const [key, r] of records) {
                try {
                    // Guard: skip records with invalid data
                    if (!r.totalDuration || r.totalDuration <= 0 || isNaN(r.currentTime)) {
                        this.updateQueue.delete(key);
                        continue;
                    }

                    const isCompleted = r.currentTime / r.totalDuration >= this.COMPLETION_THRESHOLD;
                    // Use -1 sentinel for null season/episode to avoid SQLite NULL comparison issues
                    const seasonVal = r.seasonNumber ?? -1;
                    const episodeVal = r.episodeNumber ?? -1;

                    await db.execute(`
                        INSERT INTO watch_history (
                            user_id, tmdb_id, media_type, season_number, episode_number,
                            current_time, total_duration, is_completed, last_watched_at
                        ) VALUES (
                            'local_user', $1, $2, $3, $4, $5, $6, $7, datetime('now')
                        )
                        ON CONFLICT(user_id, tmdb_id, media_type, season_number, episode_number)
                        DO UPDATE SET
                            current_time = $5,
                            total_duration = $6,
                            is_completed = $7,
                            last_watched_at = datetime('now')
                    `, [
                        r.tmdbId,
                        r.mediaType,
                        seasonVal,
                        episodeVal,
                        Math.round(r.currentTime),
                        Math.round(r.totalDuration),
                        isCompleted ? 1 : 0
                    ]);

                    this.updateQueue.delete(key);
                } catch (err) {
                    console.error(`[WatchHistory] Failed to sync record ${key}:`, err);
                    // Remove broken record to prevent repeated failures
                    this.updateQueue.delete(key);
                }
            }
            console.log('[WatchHistory] Sync completed');
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Immediately save progress (for use on component unmount / navigation)
     * Bypasses the queue entirely for guaranteed save
     */
    async immediateSave(record: WatchRecord): Promise<void> {
        if (!record.totalDuration || record.totalDuration <= 0 || isNaN(record.currentTime)) return;

        try {
            const db = await getDatabase();
            const isCompleted = record.currentTime / record.totalDuration >= this.COMPLETION_THRESHOLD;
            const seasonVal = record.seasonNumber ?? -1;
            const episodeVal = record.episodeNumber ?? -1;

            await db.execute(`
                INSERT INTO watch_history (
                    user_id, tmdb_id, media_type, season_number, episode_number,
                    current_time, total_duration, is_completed, last_watched_at
                ) VALUES (
                    'local_user', $1, $2, $3, $4, $5, $6, $7, datetime('now')
                )
                ON CONFLICT(user_id, tmdb_id, media_type, season_number, episode_number)
                DO UPDATE SET
                    current_time = $5,
                    total_duration = $6,
                    is_completed = $7,
                    last_watched_at = datetime('now')
            `, [
                record.tmdbId,
                record.mediaType,
                seasonVal,
                episodeVal,
                Math.round(record.currentTime),
                Math.round(record.totalDuration),
                isCompleted ? 1 : 0
            ]);

            // Also remove from queue if present
            const key = this.getRecordKey(record);
            this.updateQueue.delete(key);

            console.log('[WatchHistory] Immediate save done:', record.tmdbId);
        } catch (error) {
            console.error('[WatchHistory] Immediate save failed:', error);
        }
    }

    /**
     * Get continue watching list (unfinished content)
     * @param limit Maximum number of items to return
     */
    async getContinueWatching(limit = 20): Promise<WatchHistoryItem[]> {
        const db = await getDatabase();

        try {
            // Fetch BOTH incomplete records AND recently-completed TV episodes.
            // Completed TV episodes become "Watch Next Episode" cards.
            const rows = await db.select<WatchHistoryItem[]>(`
                SELECT 
                    *,
                    ROUND(
                        CASE
                            WHEN total_duration > 0 THEN (current_time * 100.0 / total_duration)
                            ELSE 0
                        END,
                        1
                    ) as progress_percentage
                FROM watch_history
                WHERE user_id = 'local_user'
                  AND current_time > $1
                  AND (
                      is_completed = 0
                      OR (is_completed = 1 AND media_type = 'tv')
                  )
                ORDER BY last_watched_at DESC
            `, [this.CONTINUE_WATCHING_MIN_SECONDS]);

            const grouped = new Map<string, WatchHistoryItem>();
            const tvEpisodeCounts = new Map<number, number>();

            for (const row of rows) {
                if (row.media_type === 'tv' && !row.is_completed) {
                    tvEpisodeCounts.set(row.tmdb_id, (tvEpisodeCounts.get(row.tmdb_id) || 0) + 1);
                }

                // For TV: group by show ID (latest episode wins since ordered by last_watched_at DESC)
                // For movies: unique per movie
                const sn = row.season_number && row.season_number > 0 ? row.season_number : 0;
                const en = row.episode_number && row.episode_number > 0 ? row.episode_number : 0;
                const key = row.media_type === 'tv'
                    ? `tv-${row.tmdb_id}`
                    : `movie-${row.tmdb_id}-${sn}-${en}`;

                if (!grouped.has(key)) {
                    grouped.set(key, {
                        ...row,
                        progress_percentage: Math.min(100, Math.max(0, row.progress_percentage || 0)),
                    });
                }
            }

            const results = Array.from(grouped.values())
                // Hard guard: never show items below continue threshold
                .filter(item => (item.current_time || 0) >= this.CONTINUE_WATCHING_MIN_SECONDS)
                // Filter out completed movies (only completed TV episodes should pass through)
                .filter(item => !(item.is_completed && item.media_type === 'movie'))
                .map((item) => ({
                    ...item,
                    episodes_in_progress: item.media_type === 'tv' ? (tvEpisodeCounts.get(item.tmdb_id) || 1) : undefined,
                }))
                .sort(
                    (a, b) =>
                        new Date(b.last_watched_at).getTime() - new Date(a.last_watched_at).getTime()
                )
                .slice(0, limit);

            console.log(`[WatchHistory] Fetched ${results.length} grouped continue watching item(s)`);
            return results;
        } catch (error) {
            console.error('[WatchHistory] Failed to fetch continue watching:', error);
            return [];
        }
    }

    /**
     * Get progress for specific content
     * @param record Partial watch record to query
     */
    async getProgress(record: Partial<WatchRecord>): Promise<WatchHistoryItem | null> {
        const db = await getDatabase();
        const seasonVal = record.seasonNumber ?? -1;
        const episodeVal = record.episodeNumber ?? -1;

        try {
            const results = await db.select<WatchHistoryItem[]>(`
                SELECT 
                    *,
                    ROUND(
                        CASE
                            WHEN total_duration > 0 THEN (current_time * 100.0 / total_duration)
                            ELSE 0
                        END,
                        1
                    ) as progress_percentage
                FROM watch_history
                WHERE user_id = 'local_user'
                  AND tmdb_id = $1
                  AND media_type = $2
                  AND COALESCE(season_number, -1) = $3
                  AND COALESCE(episode_number, -1) = $4
            `, [
                record.tmdbId,
                record.mediaType,
                seasonVal,
                episodeVal
            ]);

            return results[0] || null;
        } catch (error) {
            console.error('[WatchHistory] Failed to fetch progress:', error);
            return null;
        }
    }

    /**
     * Mark content as completed
     * @param record Partial watch record to mark as completed
     */
    async markCompleted(record: Partial<WatchRecord>): Promise<void> {
        const db = await getDatabase();
        const seasonVal = record.seasonNumber ?? -1;
        const episodeVal = record.episodeNumber ?? -1;

        try {
            await db.execute(`
                UPDATE watch_history
                SET is_completed = 1, last_watched_at = datetime('now')
                WHERE user_id = 'local_user'
                  AND tmdb_id = $1
                  AND media_type = $2
                  AND COALESCE(season_number, -1) = $3
                  AND COALESCE(episode_number, -1) = $4
            `, [
                record.tmdbId,
                record.mediaType || 'movie',
                seasonVal,
                episodeVal
            ]);

            console.log('[WatchHistory] Marked as completed:', record.tmdbId);
        } catch (error) {
            console.error('[WatchHistory] Failed to mark completed:', error);
        }
    }

    /**
     * Get recently watched content (including completed)
     * @param limit Maximum number of items to return
     */
    async getRecentlyWatched(limit = 50): Promise<WatchHistoryItem[]> {
        const db = await getDatabase();

        try {
            const results = await db.select<WatchHistoryItem[]>(`
                SELECT 
                    *,
                    ROUND(
                        CASE
                            WHEN total_duration > 0 THEN (current_time * 100.0 / total_duration)
                            ELSE 0
                        END,
                        1
                    ) as progress_percentage
                FROM watch_history
                WHERE user_id = 'local_user'
                ORDER BY last_watched_at DESC
                LIMIT $1
            `, [limit]);

            return results;
        } catch (error) {
            console.error('[WatchHistory] Failed to fetch recently watched:', error);
            return [];
        }
    }

    /**
     * Clear all watch history
     */
    async clearHistory(): Promise<void> {
        const db = await getDatabase();

        try {
            await db.execute(`DELETE FROM watch_history WHERE user_id = 'local_user'`);
            console.log('[WatchHistory] History cleared');
        } catch (error) {
            console.error('[WatchHistory] Failed to clear history:', error);
        }
    }

    /**
     * Remove a specific continue-watching record
     */
    async removeRecord(record: Partial<WatchRecord>): Promise<void> {
        if (!record.tmdbId || !record.mediaType) return;
        const db = await getDatabase();

        try {
            if (record.mediaType === 'tv') {
                await db.execute(`
                    DELETE FROM watch_history
                    WHERE user_id = 'local_user'
                      AND tmdb_id = $1
                      AND media_type = 'tv'
                `, [record.tmdbId]);
                return;
            }

            await db.execute(`
                    DELETE FROM watch_history
                    WHERE user_id = 'local_user'
                      AND tmdb_id = $1
                      AND media_type = $2
                      AND COALESCE(season_number, -1) = $3
                      AND COALESCE(episode_number, -1) = $4
                `, [
                record.tmdbId,
                record.mediaType,
                record.seasonNumber ?? -1,
                record.episodeNumber ?? -1
            ]);
        } catch (error) {
            console.error('[WatchHistory] Failed to remove record:', error);
        }
    }

    /**
     * Generate unique key for watch record
     */
    private getRecordKey(r: WatchRecord): string {
        return `${r.tmdbId}_${r.mediaType}_${r.seasonNumber || 0}_${r.episodeNumber || 0}`;
    }
}

// Export singleton instance
export const watchService = new WatchHistoryService();

// Database initialization and management for watch history
import Database from '@tauri-apps/plugin-sql';

let db: Database | null = null;

/**
 * Initialize SQLite database and create tables
 * Called on app startup
 */
export async function initDatabase(): Promise<Database> {
    if (db) return db;

    console.log('[Database] Initializing SQLite database...');

    try {
        // Load database (creates if doesn't exist)
        db = await Database.load('sqlite:delulu.db');

        // Create watch_history table with indexes
        await db.execute(`
            CREATE TABLE IF NOT EXISTS watch_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL DEFAULT 'local_user',
                
                -- Content identification
                tmdb_id INTEGER NOT NULL,
                media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
                season_number INTEGER,
                episode_number INTEGER,
                
                -- Progress tracking
                current_time REAL NOT NULL DEFAULT 0,
                total_duration REAL NOT NULL,
                
                -- Status
                is_completed BOOLEAN DEFAULT 0,
                last_watched_at TEXT DEFAULT CURRENT_TIMESTAMP,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                
                -- Unique constraint per content per user
                UNIQUE(user_id, tmdb_id, media_type, season_number, episode_number)
            )
        `);

        // Create index for recent watch queries
        await db.execute(`
            CREATE INDEX IF NOT EXISTS idx_watch_history_recent 
            ON watch_history(user_id, last_watched_at DESC)
        `);

        // Create index for incomplete content
        await db.execute(`
            CREATE INDEX IF NOT EXISTS idx_watch_history_incomplete 
            ON watch_history(user_id, is_completed, last_watched_at DESC)
            WHERE is_completed = 0
        `);

        // App settings table
        await db.execute(`
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `);

        console.log('[Database] Database initialized successfully');
        return db;
    } catch (error) {
        console.error('[Database] Failed to initialize:', error);
        throw error;
    }
}

/**
 * Get database instance (initializes if needed)
 */
export async function getDatabase(): Promise<Database> {
    if (!db) {
        return await initDatabase();
    }
    return db;
}

/**
 * Close database connection
 */
export async function closeDatabase(): Promise<void> {
    if (db) {
        await db.close();
        db = null;
        console.log('[Database] Database closed');
    }
}

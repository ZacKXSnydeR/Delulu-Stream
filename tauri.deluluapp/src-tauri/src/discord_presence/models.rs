use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PresenceData {
    pub title: String,                // e.g. "Young Sherlock"
    // pub details: String,           // e.g. "S1E1" — merged with title or state if needed, Discord limits to 2 text rows
    pub state: String,                // e.g. "S1E1 • 03:22 elapsed" or "Paused at 03:22"
    pub large_image: Option<String>,  // Asset key from Discord dashboard
    pub small_image: Option<String>,  // Asset key
    pub start_timestamp: Option<i64>, // For elapsed time timer (Unix timestamp in seconds)
}

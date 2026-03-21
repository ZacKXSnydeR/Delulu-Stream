use std::fs;
use std::path::Path;

fn inject_env_from_file(path: &Path, keys: &[&str]) {
    let Ok(raw) = fs::read_to_string(path) else {
        return;
    };

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };

        let key = key.trim();
        if !keys.contains(&key) {
            continue;
        }

        let value = value.trim().trim_matches('"').trim_matches('\'');
        if value.is_empty() {
            // Never overwrite already-set build env values with empty placeholders.
            continue;
        }
        println!("cargo:rustc-env={}={}", key, value);
    }
}

fn main() {
    // Prefer local, git-ignored env first.
    inject_env_from_file(
        Path::new("../.env.local"),
        &[
            "TMDB_READ_TOKEN",
            "ALGOLIA_APP_ID",
            "ALGOLIA_SEARCH_KEY",
            "ALGOLIA_INDEX_NAME",
        ],
    );

    // Embed critical runtime keys at build-time as a fallback for packaged app.
    inject_env_from_file(
        Path::new("../.env"),
        &[
            "TMDB_READ_TOKEN",
            "ALGOLIA_APP_ID",
            "ALGOLIA_SEARCH_KEY",
            "ALGOLIA_INDEX_NAME",
        ],
    );

    tauri_build::build()
}

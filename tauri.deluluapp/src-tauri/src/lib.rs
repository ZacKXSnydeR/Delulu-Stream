use tauri::Manager;
use std::sync::atomic::Ordering;
use std::collections::HashMap;
use std::env;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

mod proxy;
mod discord_presence;

use tauri_plugin_shell::ShellExt;

const TMDB_BASE_URL: &str = "https://api.themoviedb.org/3";

fn get_embedded_env(key: &str) -> Option<&'static str> {
    match key {
        "TMDB_READ_TOKEN" => option_env!("TMDB_READ_TOKEN"),
        "ALGOLIA_APP_ID" => option_env!("ALGOLIA_APP_ID"),
        "ALGOLIA_SEARCH_KEY" => option_env!("ALGOLIA_SEARCH_KEY"),
        "ALGOLIA_INDEX_NAME" => option_env!("ALGOLIA_INDEX_NAME"),
        _ => None,
    }
}

fn get_env_required(key: &str) -> Result<String, String> {
    match env::var(key) {
        Ok(v) if !v.trim().is_empty() => Ok(v),
        _ => {
            if let Some(v) = get_embedded_env(key) {
                if !v.trim().is_empty() {
                    return Ok(v.to_string());
                }
            }
            Err(format!("Missing required env var: {}", key))
        }
    }
}

fn load_env_from_known_paths(app: &tauri::AppHandle) {
    let mut candidates: Vec<PathBuf> = vec![
        PathBuf::from(".env.local"),
        PathBuf::from(".env"),
        PathBuf::from("../.env.local"),
        PathBuf::from("../.env"),
    ];

    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join(".env.local"));
            candidates.push(exe_dir.join(".env"));
            candidates.push(exe_dir.join("../.env.local"));
            candidates.push(exe_dir.join("../.env"));
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(".env.local"));
        candidates.push(resource_dir.join(".env"));
    }

    for path in candidates {
        if path.exists() {
            if dotenvy::from_path_override(&path).is_ok() {
                println!("[ENV] Loaded from {}", path.display());
                return;
            }
        }
    }

    println!("[ENV] No .env file loaded from known runtime paths");
}

#[tauri::command]
async fn get_proxy_port(state: tauri::State<'_, proxy::ProxyState>) -> Result<u16, String> {
    for _ in 0..50 {
        let port = state.port.load(Ordering::SeqCst);
        if port != 0 {
            return Ok(port);
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Err("HLS proxy failed to start".to_string())
}

#[tauri::command]
async fn set_proxy_headers(
    state: tauri::State<'_, proxy::ProxyState>,
    referer: Option<String>,
    origin: Option<String>,
    user_agent: Option<String>,
    extra_headers: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let mut headers = state.headers.write().await;
    headers.referer = referer;
    headers.origin = origin;
    headers.user_agent = user_agent;
    headers.extra_headers = extra_headers.unwrap_or_default();
    println!(
        "[HLS Proxy] Headers set: referer={:?}, origin={:?}, extra={}",
        headers.referer, headers.origin, headers.extra_headers.len()
    );
    Ok(())
}

#[tauri::command]
async fn clear_proxy_cache(state: tauri::State<'_, proxy::ProxyState>) -> Result<(), String> {
    state.clear_cache().await;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtractProviderArgs {
    media_type: String,
    tmdb_id: u32,
    season: Option<u32>,
    episode: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractProviderResult {
    success: bool,
    stream_url: Option<String>,
    headers: Option<serde_json::Value>,
    subtitles: Option<serde_json::Value>,
    error: Option<String>,
}

#[tauri::command]
async fn extract_provider_stream(
    app: tauri::AppHandle,
    args: ExtractProviderArgs,
) -> Result<ExtractProviderResult, String> {
    let media_type = args.media_type.to_lowercase();
    if media_type != "movie" && media_type != "tv" && media_type != "anime" {
        return Err("mediaType must be 'movie', 'tv', or 'anime'".to_string());
    }

    let mut cmd_args = vec![media_type, "-i".to_string(), args.tmdb_id.to_string()];

    if args.media_type == "tv" || args.media_type == "anime" {
        if let Some(s) = args.season {
            cmd_args.push("-s".to_string());
            cmd_args.push(s.to_string());
        }
        if let Some(e) = args.episode {
            cmd_args.push("-e".to_string());
            cmd_args.push(e.to_string());
        }
    }
    
    cmd_args.push("--json".to_string());

    // PRODUCTION FIX: Resolve bypass.js using Tauri's robust resource resolver.
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bypass_path = resource_dir.join("bypass/bypass.js");
        if bypass_path.exists() {
            let mut path_str = bypass_path.to_string_lossy().into_owned();
            
            // CRITICAL: Windows `canonicalize` and Tauri's path resolver often return UNC paths
            // starting with `\\?\`. The Node.js module loader has a known, fatal bug where it parses 
            // `\\?\C:\...` as just `C:\`, checks if `C:\` is a directory, and crashes with EISDIR.
            // We must manually strip this prefix before passing it to the Node bypass script.
            if path_str.starts_with(r#"\\?\"#) {
                path_str = path_str[4..].to_string();
            }
            
            cmd_args.push("--bypass-path".to_string());
            cmd_args.push(path_str);
        } else {
            let err_msg = format!("FATAL ERROR: bypass.js not found in bundled resources! Expected at: {:?}", bypass_path);
            println!("[gods_EYE Backend] {}", err_msg);
            return Err(err_msg);
        }
    } else {
        let err_msg = "FATAL ERROR: Failed to resolve Tauri resource directory! Runtime environment may be compromised.".to_string();
        println!("[gods_EYE Backend] {}", err_msg);
        return Err(err_msg);
    }

    println!("[gods_EYE Backend] Spawning sidecar with args: {:?}", cmd_args);
    let sidecar_command = match app.shell().sidecar("gods_EYE") {
        Ok(c) => c,
        Err(e) => {
            let err = format!("Failed to create sidecar command: {}", e);
            println!("[gods_EYE Backend] Error: {}", err);
            return Err(err);
        }
    };

    let output = match sidecar_command.args(&cmd_args).output().await {
        Ok(o) => o,
        Err(e) => {
            let err = format!("Failed to execute sidecar: {}", e);
            println!("[gods_EYE Backend] Error: {}", err);
            return Err(err);
        }
    };

    println!("[gods_EYE Backend] Output status: {:?}", output.status);
    let raw_json = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    
    if !stderr.is_empty() {
        println!("[gods_EYE Backend] STDERR:\n{}", stderr);
    }

    if output.status.success() || !raw_json.is_empty() {
        // Strip out CLI preamble text and colors to just get the JSON object
        let json_start = raw_json.find('{');
        let json_end = raw_json.rfind('}');
        
        if let (Some(start), Some(end)) = (json_start, json_end) {
            if end > start {
                let clean_json = &raw_json[start..end + 1];

                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(clean_json) {
                    // Check for {"error": "..."} in the output first
                    if let Some(err_val) = parsed.get("error").and_then(|v| v.as_str()) {
                        return Ok(ExtractProviderResult {
                            success: false,
                            stream_url: None,
                            headers: None,
                            subtitles: None,
                            error: Some(err_val.to_string()),
                        });
                    }

                    // gods_EYE json output format has `streams` and `subtitles` array
                    let stream_url = parsed.get("streams")
                        .and_then(|streams| streams.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|first| first.get("url"))
                        .and_then(|url| url.as_str())
                        .map(|s| s.to_string());

                    let headers = parsed.get("streams")
                        .and_then(|streams| streams.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|first| first.get("headers"))
                        .cloned();

                    let subtitles = parsed.get("subtitles").cloned();

                    let success = stream_url.is_some();
                    if success {
                        println!("[gods_EYE Backend] Extraction successful! Stream URL found.");
                    } else {
                        println!("[gods_EYE Backend] Extraction failed! No stream URL in JSON. Raw output: {}", raw_json);
                    }

                    return Ok(ExtractProviderResult {
                        success,
                        stream_url,
                        headers,
                        subtitles,
                        error: if success { None } else { Some("Stream not available on this provider".to_string()) }
                    });
                } else {
                    println!("[gods_EYE Backend] Failed to parse JSON object in: {}", clean_json);
                }
            }
        }
    }

    let error_msg = if !stderr.is_empty() {
        format!("Extraction failed: {}", stderr)
    } else {
        format!("Extraction failed with status: {:?}", output.status)
    };
    
    Err(error_msg)
}

#[tauri::command]
async fn prepare_extractor_engine() -> Result<String, String> {
    Ok("ready".to_string())
}

#[tauri::command]
async fn tmdb_proxy_request(
    endpoint: String,
    params: Option<HashMap<String, String>>,
) -> Result<serde_json::Value, String> {
    if !endpoint.starts_with('/') {
        return Err("Invalid TMDB endpoint".to_string());
    }

    let token = get_env_required("TMDB_READ_TOKEN")?;
    let mut url = url::Url::parse(&format!("{}{}", TMDB_BASE_URL, endpoint))
        .map_err(|e| format!("Invalid TMDB url: {}", e))?;

    if let Some(params) = params {
        for (k, v) in params {
            url.query_pairs_mut().append_pair(&k, &v);
        }
    }

    let client = rquest::Client::new();
    let resp = client
        .get(url.as_str())
        .header("Authorization", format!("Bearer {}", token))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("TMDB request failed: {}", e))?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("TMDB response read failed: {}", e))?;
    if !status.is_success() {
        return Err(format!("TMDB API Error: {} {}", status.as_u16(), body));
    }

    serde_json::from_str(&body).map_err(|e| format!("TMDB JSON parse error: {}", e))
}

#[tauri::command]
async fn algolia_search(query: String, page: u32) -> Result<serde_json::Value, String> {
    let app_id = get_env_required("ALGOLIA_APP_ID")?;
    let search_key = get_env_required("ALGOLIA_SEARCH_KEY")?;
    let index_name = match env::var("ALGOLIA_INDEX_NAME") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => "delulu_content".to_string(),
    };

    let endpoint = format!(
        "https://{}-dsn.algolia.net/1/indexes/{}/query",
        app_id,
        urlencoding::encode(&index_name)
    );

    let body = serde_json::json!({
        "query": query,
        "page": page.saturating_sub(1),
        "hitsPerPage": 20,
        "typoTolerance": true,
        "attributesToRetrieve": [
            "id",
            "tmdb_id",
            "media_type",
            "title",
            "name",
            "original_title",
            "original_name",
            "overview",
            "poster_path",
            "backdrop_path",
            "release_date",
            "first_air_date",
            "popularity",
            "vote_average",
            "vote_count",
            "genre_ids",
            "adult"
        ]
    });

    let client = rquest::Client::new();
    let resp = client
        .post(endpoint)
        .header("Content-Type", "application/json")
        .header("X-Algolia-Application-Id", app_id)
        .header("X-Algolia-API-Key", search_key)
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("Algolia request failed: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Algolia response read failed: {}", e))?;
    if !status.is_success() {
        return Err(format!("Algolia search failed: {} {}", status.as_u16(), text));
    }

    serde_json::from_str(&text).map_err(|e| format!("Algolia JSON parse error: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::from_filename("../.env");
    let _ = dotenvy::from_filename(".env");
    let _ = dotenvy::dotenv();

    let proxy_state = proxy::ProxyState::new();
    let proxy_state_clone = proxy_state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .manage(proxy_state)
        .manage(discord_presence::DiscordState::new())

        .invoke_handler(tauri::generate_handler![
            get_proxy_port,
            set_proxy_headers,
            clear_proxy_cache,
            extract_provider_stream,
            prepare_extractor_engine,
            tmdb_proxy_request,
            algolia_search,
            discord_presence::presence_init,
            discord_presence::presence_update,
            discord_presence::presence_clear,
        ])
        .setup(move |app| {
            load_env_from_known_paths(app.handle());

            let window = app.get_webview_window("main").unwrap();

            #[cfg(target_os = "windows")]
            {
                let _ = window.set_shadow(true);
            }

            // Open devtools only in debug builds
            #[cfg(debug_assertions)]
            {
                window.open_devtools();
            }

            tauri::async_runtime::spawn(async move {
                proxy::start_proxy(proxy_state_clone).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

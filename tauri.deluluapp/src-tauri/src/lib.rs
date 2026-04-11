use std::collections::HashMap;
use std::env;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use tauri::Manager;

mod addon_runtime;
mod discord_presence;
mod proxy;
mod stremio_addon_runtime;

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

pub(crate) fn get_env_required(key: &str) -> Result<String, String> {
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
        if path.exists() && dotenvy::from_path_override(&path).is_ok() {
            println!("[ENV] Loaded from {}", path.display());
            return;
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
        headers.referer,
        headers.origin,
        headers.extra_headers.len()
    );
    Ok(())
}

#[tauri::command]
async fn clear_proxy_cache(state: tauri::State<'_, proxy::ProxyState>) -> Result<(), String> {
    state.clear_cache().await;
    Ok(())
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
    let body = resp
        .text()
        .await
        .map_err(|e| format!("TMDB response read failed: {}", e))?;
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
        "hitsPerPage": 20
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
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Algolia response read failed: {}", e))?;
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
            addon_runtime::addon_fetch_catalog,
            addon_runtime::addon_install_from_manifest_url,
            addon_runtime::addon_install_from_manifest_json,
            addon_runtime::addon_list_installed,
            addon_runtime::addon_set_active,
            addon_runtime::addon_remove,
            addon_runtime::addon_check_updates,
            addon_runtime::addon_health_check_active,
            addon_runtime::addon_health_check_by_id,
            addon_runtime::addon_resolve_stream,
            addon_runtime::addon_get_active_header_defaults,
            addon_runtime::addon_stremio_fetch_manifest,
            addon_runtime::addon_stremio_request_resource,
            stremio_addon_runtime::stremio_addon_list,
            stremio_addon_runtime::stremio_addon_get_curated_catalog,
            stremio_addon_runtime::stremio_addon_install_from_manifest_url,
            stremio_addon_runtime::stremio_addon_set_enabled,
            stremio_addon_runtime::stremio_addon_remove,
            stremio_addon_runtime::stremio_addon_health_check_by_id,
            stremio_addon_runtime::stremio_addon_fetch_resource,
            stremio_addon_runtime::stremio_addon_aggregate_streams,
            stremio_addon_runtime::stremio_addon_aggregate_streams_tmdb,
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

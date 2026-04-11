use base64::Engine as _;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

const ADDON_STATE_FILE: &str = "addon_manager/state.json";
const ADDON_BIN_DIR: &str = "addon_manager/addons";
const DEFAULT_CATALOG_URL: &str = "https://raw.githubusercontent.com/ZacKXSnydeR/Delulu-EmbeGator-Addon/main/catalog.json";
const DEFAULT_REQUEST_TIMEOUT_MS: u64 = 30_000;

// Replace this with your real publisher key pair id+pubkey.
const OFFICIAL_PUBLISHER_KEYS: &[(&str, &str)] = &[
    // public key as 32-byte hex string
    ("delulu-official-v1", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonHeaderDefaults {
    pub default_origin: Option<String>,
    pub default_referer: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonPlatformAsset {
    pub download_url: String,
    pub sha256: String,
    pub binary_name: String,
    pub entry_command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAddonManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub protocol_version: String,
    pub publisher: String,
    pub public_key_id: String,
    pub signature: String,
    pub platform_assets: BTreeMap<String, AddonPlatformAsset>,
    pub capabilities: Vec<String>,
    pub header_defaults: Option<AddonHeaderDefaults>,
    pub min_app_version: Option<String>,
    pub release_notes_url: Option<String>,
    pub homepage_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonInstallRecord {
    pub manifest: RemoteAddonManifest,
    pub install_state: String, // downloading|verifying|ready|failed
    pub install_path: String,
    pub binary_path: String,
    pub manifest_url: Option<String>,
    pub installed_at: u64,
    pub updated_at: u64,
    pub last_health_ok: Option<bool>,
    pub last_health_latency_ms: Option<u64>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AddonStateStore {
    pub active_addon_id: Option<String>,
    pub addons: Vec<AddonInstallRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAddonEntry {
    pub id: String,
    pub name: String,
    pub manifest_url: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogResponse {
    pub source_url: String,
    pub addons: Vec<CatalogAddonEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveStreamRequest {
    pub media_type: String,
    pub tmdb_id: u32,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    pub preferred_language: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveStreamResult {
    pub success: bool,
    pub stream_url: Option<String>,
    pub headers: Option<Value>,
    pub subtitles: Option<Value>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub addon_id: Option<String>,
    pub addon_name: Option<String>,
}

fn now_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn app_data_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {e}"))?;
    }
    Ok(())
}

fn state_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app_data_path(app)?.join(ADDON_STATE_FILE);
    ensure_parent(&path)?;
    Ok(path)
}

fn addons_root_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app_data_path(app)?.join(ADDON_BIN_DIR);
    std::fs::create_dir_all(&path).map_err(|e| format!("Failed to create addon root dir: {e}"))?;
    Ok(path)
}

fn read_store(app: &tauri::AppHandle) -> Result<AddonStateStore, String> {
    let path = state_file_path(app)?;
    if !path.exists() {
        return Ok(AddonStateStore::default());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("Failed to read addon state: {e}"))?;
    serde_json::from_str::<AddonStateStore>(&raw).map_err(|e| format!("Invalid addon state JSON: {e}"))
}

fn write_store(app: &tauri::AppHandle, store: &AddonStateStore) -> Result<(), String> {
    let path = state_file_path(app)?;
    let data = serde_json::to_string_pretty(store).map_err(|e| format!("State serialize error: {e}"))?;
    std::fs::write(path, data).map_err(|e| format!("Failed to write addon state: {e}"))
}

fn get_platform_key() -> String {
    let arch = if cfg!(target_arch = "x86_64") {
        "x64"
    } else if cfg!(target_arch = "x86") {
        "x86"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "unknown"
    };
    format!("windows-{arch}")
}

fn strict_https(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| "Invalid URL".to_string())?;
    if parsed.scheme() != "https" {
        return Err("Only https URLs are allowed".to_string());
    }
    Ok(())
}

fn validate_stremio_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| "Invalid URL".to_string())?;
    match parsed.scheme() {
        "https" => Ok(()),
        "http" => {
            let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
            if host == "127.0.0.1" || host == "localhost" {
                Ok(())
            } else {
                Err("Only https URLs are allowed (http is only allowed for localhost)".to_string())
            }
        }
        _ => Err("Unsupported URL scheme".to_string()),
    }
}

fn canonical_manifest_payload(manifest: &RemoteAddonManifest) -> Result<Vec<u8>, String> {
    let mut root = BTreeMap::new();
    root.insert("id", json!(manifest.id));
    root.insert("name", json!(manifest.name));
    root.insert("version", json!(manifest.version));
    root.insert("protocolVersion", json!(manifest.protocol_version));
    root.insert("publisher", json!(manifest.publisher));
    root.insert("publicKeyId", json!(manifest.public_key_id));
    root.insert("platformAssets", json!(manifest.platform_assets));
    root.insert("capabilities", json!(manifest.capabilities));
    root.insert("headerDefaults", json!(manifest.header_defaults));
    root.insert("minAppVersion", json!(manifest.min_app_version));
    root.insert("releaseNotesUrl", json!(manifest.release_notes_url));
    root.insert("homepageUrl", json!(manifest.homepage_url));
    serde_json::to_vec(&root).map_err(|e| format!("Canonical manifest encode failed: {e}"))
}

fn get_pinned_public_key(public_key_id: &str) -> Option<String> {
    if let Ok(from_env) = std::env::var(format!("ADDON_PUBKEY_{public_key_id}")) {
        if !from_env.trim().is_empty() {
            return Some(from_env.trim().to_string());
        }
    }
    OFFICIAL_PUBLISHER_KEYS
        .iter()
        .find(|(id, _)| *id == public_key_id)
        .map(|(_, key)| key.to_string())
}

fn verify_manifest_signature(manifest: &RemoteAddonManifest) -> Result<(), String> {
    let allow_unsigned = std::env::var("DELULU_ADDON_DEV_ALLOW_UNSIGNED")
        .map(|v| {
            let lower = v.to_ascii_lowercase();
            lower == "1" || lower == "true" || lower == "yes" || lower == "on"
        })
        .unwrap_or(false);
    if allow_unsigned {
        println!(
            "[AddonRuntime] WARNING: signature verification bypassed (DELULU_ADDON_DEV_ALLOW_UNSIGNED is enabled)"
        );
        return Ok(());
    }

    let pubkey_hex = get_pinned_public_key(&manifest.public_key_id)
        .ok_or_else(|| format!("Unknown publisher key id: {}", manifest.public_key_id))?;

    let pubkey_bytes = hex::decode(pubkey_hex).map_err(|_| "Invalid pinned public key format".to_string())?;
    if pubkey_bytes.len() != 32 {
        return Err("Pinned public key must be 32 bytes".to_string());
    }
    let verifying_key = VerifyingKey::from_bytes(
        pubkey_bytes
            .as_slice()
            .try_into()
            .map_err(|_| "Invalid public key length".to_string())?,
    )
    .map_err(|e| format!("Invalid public key bytes: {e}"))?;

    let payload = canonical_manifest_payload(manifest)?;
    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(manifest.signature.as_bytes())
        .map_err(|_| "Manifest signature must be base64".to_string())?;
    let signature = Signature::from_slice(&sig_bytes).map_err(|_| "Invalid signature bytes".to_string())?;
    verifying_key
        .verify(&payload, &signature)
        .map_err(|_| "Manifest signature verification failed".to_string())
}

fn verify_sha256(path: &Path, expected_hex: &str) -> Result<(), String> {
    let data = std::fs::read(path).map_err(|e| format!("Failed to read downloaded file: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(data);
    let got = hex::encode(hasher.finalize());
    if got.eq_ignore_ascii_case(expected_hex.trim()) {
        Ok(())
    } else {
        Err(format!("Checksum mismatch: expected {expected_hex}, got {got}"))
    }
}

async fn fetch_json<T: for<'de> Deserialize<'de>>(url: &str) -> Result<T, String> {
    strict_https(url)?;
    let client = rquest::Client::new();
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} while fetching {url}", resp.status().as_u16()));
    }
    let body = resp.text().await.map_err(|e| format!("Failed to read response: {e}"))?;
    serde_json::from_str::<T>(&body).map_err(|e| format!("Invalid JSON: {e}"))
}

async fn fetch_json_stremio<T: for<'de> Deserialize<'de>>(url: &str) -> Result<T, String> {
    validate_stremio_url(url)?;
    let client = rquest::Client::new();
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} while fetching {url}", resp.status().as_u16()));
    }
    let body = resp.text().await.map_err(|e| format!("Failed to read response: {e}"))?;
    serde_json::from_str::<T>(&body).map_err(|e| format!("Invalid JSON: {e}"))
}

async fn download_to_file(url: &str, target_file: &Path) -> Result<(), String> {
    strict_https(url)?;
    ensure_parent(target_file)?;
    let client = rquest::Client::new();
    let mut current_url = url.to_string();
    let max_redirects = 8;

    for _ in 0..=max_redirects {
        let resp = client
            .get(&current_url)
            .send()
            .await
            .map_err(|e| format!("Download failed: {e}"))?;

        if resp.status().is_redirection() {
            let location = resp
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| format!("Redirect without location header for {current_url}"))?;
            let next = if location.starts_with("http://") || location.starts_with("https://") {
                location.to_string()
            } else {
                let base = url::Url::parse(&current_url)
                    .map_err(|e| format!("Invalid redirect base URL: {e}"))?;
                base.join(location)
                    .map_err(|e| format!("Invalid redirect location: {e}"))?
                    .to_string()
            };
            strict_https(&next)?;
            current_url = next;
            continue;
        }

        if !resp.status().is_success() {
            return Err(format!(
                "Download HTTP {} for {}",
                resp.status().as_u16(),
                current_url
            ));
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Failed to read downloaded bytes: {e}"))?;
        return std::fs::write(target_file, bytes)
            .map_err(|e| format!("Failed to write addon binary: {e}"));
    }

    Err(format!("Too many redirects while downloading {url}"))
}

fn normalize_binary_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("binaryName cannot be empty".to_string());
    }
    if trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("binaryName contains invalid path characters".to_string());
    }
    Ok(trimmed.to_string())
}

fn parse_entry_command(entry: &str) -> Vec<String> {
    entry
        .split_whitespace()
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string())
        .collect()
}

async fn run_addon_rpc(
    app: &tauri::AppHandle,
    binary_path: &Path,
    entry_command: &str,
    method: &str,
    params: Value,
    timeout_ms: u64,
) -> Result<Value, String> {
    let mut args = parse_entry_command(entry_command);
    if args.is_empty() {
        args.push("rpc".to_string());
    }

    let mut command = Command::new(binary_path);
    command
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Some(bypass_path) = resolve_runtime_bypass_script_path(app) {
        command.env("EMBEGATOR_BYPASS_PATH", bypass_path);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start addon process: {e}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Addon process stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Addon process stdout unavailable".to_string())?;
    let stderr = child.stderr.take();

    let req_id = now_ts();
    let request = json!({
        "id": req_id,
        "jsonrpc": "2.0",
        "protocolVersion": "1.0",
        "method": method,
        "params": params
    });
    let req_line = serde_json::to_string(&request).map_err(|e| format!("Request encode failed: {e}"))?;
    stdin
        .write_all(format!("{req_line}\n").as_bytes())
        .await
        .map_err(|e| format!("Failed writing RPC request: {e}"))?;
    stdin.shutdown().await.map_err(|e| format!("Failed closing RPC stdin: {e}"))?;

    let read_stdout = async move {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            let read = reader
                .read_line(&mut line)
                .await
                .map_err(|e| format!("Failed reading addon stdout: {e}"))?;
            if read == 0 {
                break;
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
                let is_match = value
                    .get("id")
                    .and_then(|v| v.as_u64())
                    .map(|id| id == req_id)
                    .unwrap_or(false);
                if is_match {
                    return Ok(value);
                }
            }
        }
        Err("No valid RPC response from addon".to_string())
    };

    let result = tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), read_stdout)
        .await
        .map_err(|_| "Addon RPC timeout".to_string())??;

    if let Some(mut err_reader) = stderr {
        let mut stderr_buf = String::new();
        let _ = tokio::io::AsyncReadExt::read_to_string(&mut err_reader, &mut stderr_buf).await;
        if !stderr_buf.trim().is_empty() {
            println!("[AddonRuntime] STDERR: {}", stderr_buf);
        }
    }

    let _ = child.kill().await;
    Ok(result)
}

fn resolve_runtime_bypass_script_path(app: &tauri::AppHandle) -> Option<String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("bypass/bypass.js"));
    }
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("bypass/bypass.js"));
            candidates.push(exe_dir.join("../bypass/bypass.js"));
            candidates.push(exe_dir.join("../../src-tauri/bypass/bypass.js"));
        }
    }
    candidates.push(PathBuf::from("bypass/bypass.js"));
    candidates.push(PathBuf::from("../bypass/bypass.js"));
    candidates.push(PathBuf::from("src-tauri/bypass/bypass.js"));

    for path in candidates {
        if path.exists() {
            let mut s = path.to_string_lossy().to_string();
            if s.starts_with(r#"\\?\"#) {
                s = s[4..].to_string();
            }
            return Some(s);
        }
    }
    None
}

fn update_store_record(store: &mut AddonStateStore, record: AddonInstallRecord) {
    if let Some(idx) = store
        .addons
        .iter()
        .position(|r| r.manifest.id == record.manifest.id)
    {
        store.addons[idx] = record;
    } else {
        store.addons.push(record);
    }
}

fn active_record_mut<'a>(store: &'a mut AddonStateStore) -> Option<&'a mut AddonInstallRecord> {
    let active_id = store.active_addon_id.clone()?;
    store
        .addons
        .iter_mut()
        .find(|a| a.manifest.id == active_id && a.install_state == "ready")
}

async fn install_manifest_internal(
    app: &tauri::AppHandle,
    manifest: RemoteAddonManifest,
    source_url: Option<String>,
    auto_activate: bool,
) -> Result<AddonInstallRecord, String> {
    verify_manifest_signature(&manifest)?;

    let existing_store = read_store(app)?;
    if let Some(existing) = existing_store
        .addons
        .iter()
        .find(|r| r.manifest.id == manifest.id && r.manifest.version == manifest.version && r.install_state == "ready")
    {
        if Path::new(&existing.binary_path).exists() {
            let mut store = existing_store.clone();
            if auto_activate || store.active_addon_id.is_none() {
                store.active_addon_id = Some(manifest.id.clone());
                write_store(app, &store)?;
            }
            return Ok(existing.clone());
        }
    }

    let platform = get_platform_key();
    let asset = manifest
        .platform_assets
        .get(&platform)
        .ok_or_else(|| format!("Addon does not provide asset for platform {platform}"))?;
    strict_https(&asset.download_url)?;
    let bin_name = normalize_binary_name(&asset.binary_name)?;

    let addons_root = addons_root_path(app)?;
    let install_dir = addons_root.join(&manifest.id).join(&manifest.version);
    let tmp_dir = addons_root.join(".tmp").join(format!("{}-{}", manifest.id, now_ts()));
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("Failed creating temp dir: {e}"))?;
    std::fs::create_dir_all(&install_dir).map_err(|e| format!("Failed creating install dir: {e}"))?;

    let tmp_file = tmp_dir.join(&bin_name);
    download_to_file(&asset.download_url, &tmp_file).await?;
    verify_sha256(&tmp_file, &asset.sha256)?;

    let final_bin_path = install_dir.join(&bin_name);
    if final_bin_path.exists() {
        std::fs::remove_file(&final_bin_path)
            .map_err(|e| format!("Failed replacing existing addon binary: {e}"))?;
    }
    std::fs::rename(&tmp_file, &final_bin_path).map_err(|e| format!("Failed atomically moving addon binary: {e}"))?;
    let _ = std::fs::remove_dir_all(&tmp_dir);

    let now = now_ts();
    let record = AddonInstallRecord {
        manifest: manifest.clone(),
        install_state: "ready".to_string(),
        install_path: install_dir.to_string_lossy().to_string(),
        binary_path: final_bin_path.to_string_lossy().to_string(),
        manifest_url: source_url,
        installed_at: now,
        updated_at: now,
        last_health_ok: None,
        last_health_latency_ms: None,
        last_error: None,
    };

    let mut store = read_store(app)?;
    update_store_record(&mut store, record.clone());
    if auto_activate || store.active_addon_id.is_none() {
        store.active_addon_id = Some(manifest.id.clone());
    }
    write_store(app, &store)?;
    Ok(record)
}

#[tauri::command]
pub async fn addon_fetch_catalog(url: Option<String>) -> Result<CatalogResponse, String> {
    let source = url.unwrap_or_else(|| {
        std::env::var("DELULU_ADDON_CATALOG_URL").unwrap_or_else(|_| DEFAULT_CATALOG_URL.to_string())
    });
    let addons = fetch_json::<Vec<CatalogAddonEntry>>(&source).await?;
    Ok(CatalogResponse {
        source_url: source,
        addons,
    })
}

#[tauri::command]
pub async fn addon_install_from_manifest_url(
    app: tauri::AppHandle,
    manifest_url: String,
    auto_activate: Option<bool>,
) -> Result<AddonInstallRecord, String> {
    let manifest = fetch_json::<RemoteAddonManifest>(&manifest_url).await?;
    install_manifest_internal(&app, manifest, Some(manifest_url), auto_activate.unwrap_or(true)).await
}

#[tauri::command]
pub async fn addon_install_from_manifest_json(
    app: tauri::AppHandle,
    manifest_json: String,
    source_url: Option<String>,
    auto_activate: Option<bool>,
) -> Result<AddonInstallRecord, String> {
    let manifest: RemoteAddonManifest =
        serde_json::from_str(&manifest_json).map_err(|e| format!("Invalid manifest JSON: {e}"))?;
    install_manifest_internal(&app, manifest, source_url, auto_activate.unwrap_or(true)).await
}

#[tauri::command]
pub fn addon_list_installed(app: tauri::AppHandle) -> Result<AddonStateStore, String> {
    read_store(&app)
}

#[tauri::command]
pub fn addon_set_active(app: tauri::AppHandle, addon_id: String) -> Result<AddonStateStore, String> {
    let mut store = read_store(&app)?;
    if !store
        .addons
        .iter()
        .any(|a| a.manifest.id == addon_id && a.install_state == "ready")
    {
        return Err("Addon not found or not ready".to_string());
    }
    store.active_addon_id = Some(addon_id);
    write_store(&app, &store)?;
    Ok(store)
}

#[tauri::command]
pub fn addon_remove(app: tauri::AppHandle, addon_id: String) -> Result<AddonStateStore, String> {
    let mut store = read_store(&app)?;
    let before = store.addons.len();
    let removed_paths: Vec<String> = store
        .addons
        .iter()
        .filter(|a| a.manifest.id == addon_id)
        .map(|a| a.install_path.clone())
        .collect();
    store.addons.retain(|a| a.manifest.id != addon_id);
    if before == store.addons.len() {
        return Ok(store);
    }
    if store.active_addon_id.as_deref() == Some(addon_id.as_str()) {
        store.active_addon_id = store
            .addons
            .iter()
            .find(|a| a.install_state == "ready")
            .map(|a| a.manifest.id.clone());
    }
    write_store(&app, &store)?;
    for p in removed_paths {
        let _ = std::fs::remove_dir_all(p);
    }
    Ok(store)
}

#[tauri::command]
pub async fn addon_check_updates(
    app: tauri::AppHandle,
    addon_id: Option<String>,
) -> Result<Vec<Value>, String> {
    let store = read_store(&app)?;
    let mut out = Vec::new();
    for record in store.addons.iter() {
        if let Some(ref wanted) = addon_id {
            if record.manifest.id != *wanted {
                continue;
            }
        }
        if let Some(url) = &record.manifest_url {
            if let Ok(remote_manifest) = fetch_json::<RemoteAddonManifest>(url).await {
                let has_update = remote_manifest.version != record.manifest.version;
                out.push(json!({
                    "addonId": record.manifest.id,
                    "currentVersion": record.manifest.version,
                    "latestVersion": remote_manifest.version,
                    "hasUpdate": has_update,
                    "manifestUrl": url,
                }));
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn addon_health_check_active(app: tauri::AppHandle) -> Result<Value, String> {
    let mut store = read_store(&app)?;
    let record = active_record_mut(&mut store).ok_or_else(|| "No active addon available".to_string())?;
    let start = now_ts();
    let timeout_ms = 8_000;
    let rpc = run_addon_rpc(
        &app,
        Path::new(&record.binary_path),
        record
            .manifest
            .platform_assets
            .get(&get_platform_key())
            .map(|a| a.entry_command.as_str())
            .unwrap_or("rpc"),
        "healthCheck",
        json!({}),
        timeout_ms,
    )
    .await;
    match rpc {
        Ok(resp) => {
            let latency = now_ts().saturating_sub(start);
            record.last_health_ok = Some(true);
            record.last_health_latency_ms = Some(latency);
            record.last_error = None;
            let _ = write_store(&app, &store);
            Ok(json!({
                "ok": true,
                "latencyMs": latency,
                "response": resp
            }))
        }
        Err(err) => {
            record.last_health_ok = Some(false);
            record.last_health_latency_ms = None;
            record.last_error = Some(err.clone());
            let _ = write_store(&app, &store);
            Ok(json!({
                "ok": false,
                "error": err
            }))
        }
    }
}

#[tauri::command]
pub async fn addon_health_check_by_id(app: tauri::AppHandle, addon_id: String) -> Result<Value, String> {
    let mut store = read_store(&app)?;
    let idx = store
        .addons
        .iter()
        .position(|a| a.manifest.id == addon_id && a.install_state == "ready")
        .ok_or_else(|| format!("Addon not found or not ready: {addon_id}"))?;

    let snapshot = store.addons[idx].clone();
    let start = now_ts();
    let timeout_ms = 8_000;
    let rpc = run_addon_rpc(
        &app,
        Path::new(&snapshot.binary_path),
        snapshot
            .manifest
            .platform_assets
            .get(&get_platform_key())
            .map(|a| a.entry_command.as_str())
            .unwrap_or("rpc"),
        "healthCheck",
        json!({}),
        timeout_ms,
    )
    .await;

    match rpc {
        Ok(resp) => {
            let latency = now_ts().saturating_sub(start);
            let record = &mut store.addons[idx];
            record.last_health_ok = Some(true);
            record.last_health_latency_ms = Some(latency);
            record.last_error = None;
            let _ = write_store(&app, &store);
            Ok(json!({
                "ok": true,
                "latencyMs": latency,
                "response": resp,
                "addonId": snapshot.manifest.id,
                "addonName": snapshot.manifest.name
            }))
        }
        Err(err) => {
            let record = &mut store.addons[idx];
            record.last_health_ok = Some(false);
            record.last_health_latency_ms = None;
            record.last_error = Some(err.clone());
            let _ = write_store(&app, &store);
            Ok(json!({
                "ok": false,
                "error": err,
                "addonId": snapshot.manifest.id,
                "addonName": snapshot.manifest.name
            }))
        }
    }
}

#[tauri::command]
pub async fn addon_resolve_stream(
    app: tauri::AppHandle,
    request: ResolveStreamRequest,
) -> Result<ResolveStreamResult, String> {
    let mut store = read_store(&app)?;
    let platform_key = get_platform_key();
    let active_id = store
        .active_addon_id
        .clone()
        .ok_or_else(|| "No active addon installed".to_string())?;
    let active_idx = store
        .addons
        .iter()
        .position(|a| a.manifest.id == active_id && a.install_state == "ready")
        .ok_or_else(|| "No active addon installed".to_string())?;
    let active_snapshot = store.addons[active_idx].clone();
    let asset = active_snapshot
        .manifest
        .platform_assets
        .get(&platform_key)
        .ok_or_else(|| format!("Active addon is missing {platform_key} asset"))?
        .clone();
    let binary_path = active_snapshot.binary_path.clone();
    let addon_id = active_snapshot.manifest.id.clone();
    let addon_name = active_snapshot.manifest.name.clone();

    let timeout_ms = request.timeout_ms.unwrap_or(DEFAULT_REQUEST_TIMEOUT_MS);
    let params = json!({
        "mediaType": request.media_type,
        "tmdbId": request.tmdb_id,
        "season": request.season,
        "episode": request.episode,
        "preferredLanguage": request.preferred_language,
        "timeoutMs": timeout_ms
    });

    let rpc_result = run_addon_rpc(
        &app,
        Path::new(&binary_path),
        &asset.entry_command,
        "resolveStream",
        params,
        timeout_ms + 5_000,
    )
    .await;

    match rpc_result {
        Ok(v) => {
            let result_node = v.get("result").cloned().unwrap_or_else(|| json!({}));
            let success = result_node
                .get("success")
                .and_then(|x| x.as_bool())
                .unwrap_or(false);
            let response = ResolveStreamResult {
                success,
                stream_url: result_node.get("streamUrl").and_then(|x| x.as_str()).map(|s| s.to_string()),
                headers: result_node.get("headers").cloned(),
                subtitles: result_node.get("subtitles").cloned(),
                error_code: result_node.get("errorCode").and_then(|x| x.as_str()).map(|s| s.to_string()),
                error_message: result_node.get("errorMessage").and_then(|x| x.as_str()).map(|s| s.to_string()),
                addon_id: Some(addon_id.clone()),
                addon_name: Some(addon_name.clone()),
            };
            let active = &mut store.addons[active_idx];
            if !response.success {
                active.last_error = response
                    .error_message
                    .clone()
                    .or_else(|| Some("Addon returned no playable stream".to_string()));
            } else {
                active.last_error = None;
            }
            active.updated_at = now_ts();
            let _ = write_store(&app, &store);
            Ok(response)
        }
        Err(err) => {
            let active = &mut store.addons[active_idx];
            active.last_error = Some(err.clone());
            active.updated_at = now_ts();
            let _ = write_store(&app, &store);
            Ok(ResolveStreamResult {
                success: false,
                stream_url: None,
                headers: None,
                subtitles: None,
                error_code: Some("CRASHED".to_string()),
                error_message: Some(err),
                addon_id: Some(addon_id),
                addon_name: Some(addon_name),
            })
        }
    }
}

#[tauri::command]
pub fn addon_get_active_header_defaults(app: tauri::AppHandle) -> Result<Value, String> {
    let store = read_store(&app)?;
    let active_id = store.active_addon_id.ok_or_else(|| "No active addon".to_string())?;
    let active = store
        .addons
        .iter()
        .find(|a| a.manifest.id == active_id && a.install_state == "ready")
        .ok_or_else(|| "No active addon ready".to_string())?;
    Ok(json!({
        "origin": active.manifest.header_defaults.as_ref().and_then(|h| h.default_origin.clone()),
        "referer": active.manifest.header_defaults.as_ref().and_then(|h| h.default_referer.clone()),
        "userAgent": active.manifest.header_defaults.as_ref().and_then(|h| h.user_agent.clone()),
    }))
}

#[tauri::command]
pub async fn addon_stremio_fetch_manifest(manifest_url: String) -> Result<Value, String> {
    let parsed = url::Url::parse(&manifest_url).map_err(|_| "Invalid manifest URL".to_string())?;
    validate_stremio_url(parsed.as_str())?;
    let manifest: Value = fetch_json_stremio(parsed.as_str()).await?;
    Ok(manifest)
}

#[tauri::command]
pub async fn addon_stremio_request_resource(
    manifest_url: String,
    resource: String,
    media_type: Option<String>,
    media_id: Option<String>,
    extra_query: Option<BTreeMap<String, String>>,
) -> Result<Value, String> {
    let mut manifest = url::Url::parse(&manifest_url).map_err(|_| "Invalid manifest URL".to_string())?;
    validate_stremio_url(manifest.as_str())?;

    let base_str = manifest.as_str();
    let base = if base_str.ends_with("/manifest.json") {
        base_str.trim_end_matches("manifest.json")
    } else if base_str.ends_with("manifest.json") {
        base_str.trim_end_matches("manifest.json")
    } else {
        base_str
    };

    manifest = url::Url::parse(base).map_err(|_| "Invalid manifest base URL".to_string())?;

    let res = resource.trim();
    if res.is_empty() {
        return Err("Resource is required".to_string());
    }
    let path = match (media_type.as_deref(), media_id.as_deref()) {
        (Some(t), Some(id)) => format!("{}/{}/{}.json", res, t.trim(), id.trim()),
        (Some(t), None) => format!("{}/{}.json", res, t.trim()),
        (None, _) => format!("{}.json", res),
    };

    let mut request_url = manifest
        .join(&path)
        .map_err(|e| format!("Failed to build stremio resource URL: {e}"))?;

    if let Some(extra) = extra_query {
        {
            let mut qp = request_url.query_pairs_mut();
            for (k, v) in extra {
                if !k.trim().is_empty() {
                    qp.append_pair(k.trim(), v.trim());
                }
            }
        }
    }

    let payload: Value = fetch_json_stremio(request_url.as_str()).await?;
    Ok(json!({
        "requestUrl": request_url.as_str(),
        "payload": payload
    }))
}

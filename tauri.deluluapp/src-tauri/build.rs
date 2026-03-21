use std::fs;
use std::path::Path;
use std::process::Command;

fn run_cmd(program: &str, args: &[&str]) -> Result<(), String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|e| format!("Failed to execute {}: {}", program, e))?;
    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "{} exited with {:?}. stderr: {}",
        program,
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    ))
}

fn ensure_bundled_node_runtime() -> Result<(), String> {
    let bypass_dir = Path::new("bypass");
    let bundled_node = bypass_dir.join("node.exe");
    if bundled_node.exists() {
        return Ok(());
    }

    fs::create_dir_all(bypass_dir)
        .map_err(|e| format!("Failed to create bypass dir: {}", e))?;

    // 1) Fast path: copy Node from developer machine PATH if available.
    if let Ok(where_out) = Command::new("where").arg("node").output() {
        if where_out.status.success() {
            let where_lines: Vec<String> = String::from_utf8_lossy(&where_out.stdout)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(|line| line.to_string())
                .collect();
            if let Some(first_line) = where_lines
                .iter()
                .find(|line| line.to_ascii_lowercase().ends_with("node.exe"))
                .cloned()
                .or_else(|| where_lines.first().cloned())
            {
                let from = Path::new(&first_line);
                if from.exists() {
                    fs::copy(from, &bundled_node).map_err(|e| {
                        format!(
                            "Failed to copy node.exe from PATH ({} -> {}): {}",
                            from.display(),
                            bundled_node.display(),
                            e
                        )
                    })?;
                    println!(
                        "cargo:warning=Bundled Node runtime from PATH: {}",
                        from.display()
                    );
                    return Ok(());
                }
            }
        }
    }

    // 2) Fallback: download official portable Node runtime.
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_else(|_| "x86_64".to_string());
    let node_dist = if target_arch == "i686" || target_arch == "x86" {
        "win-x86"
    } else {
        "win-x64"
    };
    let node_version = std::env::var("DELULU_NODE_VERSION").unwrap_or_else(|_| "v20.19.0".to_string());
    let zip_name = format!("node-{}-{}.zip", node_version, node_dist);
    let node_url = format!("https://nodejs.org/dist/{}/{}", node_version, zip_name);

    let temp_root = std::env::temp_dir().join("delulu-node-runtime");
    fs::create_dir_all(&temp_root)
        .map_err(|e| format!("Failed to create temp dir {}: {}", temp_root.display(), e))?;
    let zip_path = temp_root.join(&zip_name);
    let extract_root = temp_root.join("extract");
    let extracted_dir = extract_root.join(format!("node-{}-{}", node_version, node_dist));
    let extracted_node = extracted_dir.join("node.exe");

    let download_cmd = format!(
        "Invoke-WebRequest -Uri '{}' -OutFile '{}'",
        node_url,
        zip_path.display()
    );
    run_cmd(
        "powershell",
        &[
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &download_cmd,
        ],
    )?;

    if extract_root.exists() {
        fs::remove_dir_all(&extract_root)
            .map_err(|e| format!("Failed to reset extract dir {}: {}", extract_root.display(), e))?;
    }
    fs::create_dir_all(&extract_root)
        .map_err(|e| format!("Failed to create extract dir {}: {}", extract_root.display(), e))?;

    let extract_cmd = format!(
        "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
        zip_path.display(),
        extract_root.display()
    );
    run_cmd(
        "powershell",
        &[
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &extract_cmd,
        ],
    )?;

    if !extracted_node.exists() {
        return Err(format!(
            "Downloaded Node archive but node.exe was not found at {}",
            extracted_node.display()
        ));
    }

    fs::copy(&extracted_node, &bundled_node).map_err(|e| {
        format!(
            "Failed to copy extracted node.exe ({} -> {}): {}",
            extracted_node.display(),
            bundled_node.display(),
            e
        )
    })?;

    println!(
        "cargo:warning=Bundled Node runtime from download: {} ({})",
        node_version, node_dist
    );
    Ok(())
}

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
    if let Err(err) = ensure_bundled_node_runtime() {
        panic!(
            "Failed to prepare bundled Node runtime for bypass script. Build aborted to prevent broken installer. {}",
            err
        );
    }

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

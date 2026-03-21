# Gods Eye - Vidlink Extractor

```text
  _____           _         ______
 / ____|         | |       |  ____|
| |  __  ___   __| |___    | |__  _   _  ___ 
| | |_ |/ _ \ / _` / __|   |  __|| | | |/ _ \
| |__| | (_) | (_| \__ \   | |___| |_| |  __/
 \_____|\___/ \__,_|___/   |______\__, |\___|
                                   __/ |
                                  |___/ 

  :: Vidlink Direct Extractor ::
```

A blazing fast, native Rust CLI Extractor built to bypass Cloudflare and interact with the Vidlink API directly using headless WebAssembly and `rquest` modern TLS fingerprinting.

## Features
- **Direct Link Extraction**: Effortlessly pulls streaming `.m3u8` links and `.vtt` subtitle tracks for Movies, TV Shows, and Anime.
- **Ultra-Fast Rust Core**: Compiled native bin executable for lightning-fast execution.
- **WASM Bypass**: Intercepts and natively computes Vidlink's proprietary `fu.wasm` encryption using Node.js without the extreme overhead of Playwright or Puppeteer.
- **Advanced TLS Spoofing**: Bypasses Cloudflare bot detection via true Chrome 124 TLS emulation using BoringSSL strings.
- **Clean Output Pipeline**: Easily integrate into other tools via native JSON output arrays (`--json` flag).

---

## 🚀 Getting Started

### Prerequisites
1. **Rust & Cargo** (For compiling the binary)
2. **Node.js** (Required to execute the headless WASM bypass)

### Installation
1. Install the bypass dependencies:
```bash
cd bypass
npm install
cd ..
```

2. Compile the native release binary:
```bash
cargo build --release
```

---

## 💻 Usage

> **Note:** You must run the executable from the **root directory of the project** so the Rust binary can correctly locate the `bypass/` script environment!

You can run the extractor natively to view the links directly in your terminal. Here are the query commands:

### Movies
```bash
gods_EYE movie -i 157336
```

### TV Shows
```bash
gods_EYE tv -i 1402 -s 1 -e 1
```

### Anime
```bash
gods_EYE anime -i 37205 -s 1 -e 1
```

---

## 🛠️ Data Pipeline & Integration (JSON)

If you are a developer looking to integrate Gods Eye into your own tools or media servers, you can append the `--json` (or `-j`) flag to **any** command! 

This will safely strip all UI text entirely and output purely a structured, idiomatic JSON payload that you can easily parse in Python, Node, Go, or any other language backend:

```bash
gods_EYE tv -i 66732 -s 3 -e 4 --json
```

### Example JSON Payload:
```json
{
  "streams": [
    {
      "url": "https://storm.vodvidl.site/...",
      "quality": "Auto",
      "headers": {
        "referer": "https://videostr.net/",
        "origin": "https://videostr.net"
      }
    }
  ],
  "subtitles": [
    {
      "url": "https://cca.megafiles.store/...",
      "language": "English"
    },
    {
      "url": "https://cca.megafiles.store/...",
      "language": "Spanish"
    }
  ]
}
```
```

---

## 🏗️ Tauri Integration (Desktop Apps)

You can easily bundle `gods_EYE` as a **Sidecar** executable within a Tauri desktop application to seamlessly fetch streaming links in the background!

### 1. Bundle the Executable
In your Tauri `tauri.conf.json`, append the compiled `gods_EYE` binary as a sidecar:

```json
"bundle": {
  "externalBin": [
    "binaries/gods_EYE"
  ]
}
```

### 2. Invoke from Tauri (Rust Backend)
Use Tauri's `std::process::Command` or the `tauri::api::process` module to call the extractor stealthily from your backend, passing the `--json` flag to cleanly parse the output into your frontend:

```rust
use std::process::Command;
use serde_json::Value;

#[tauri::command]
async fn fetch_movie_stream(tmdb_id: &str) -> Result<Value, String> {
    // Call the bundled Gods Eye sidecar
    let output = Command::new("gods_EYE") // Adjust path based on Tauri sidecar resolution
        .args(["movie", "-i", tmdb_id, "--json"])
        .output()
        .map_err(|e| format!("Failed to execute extractor: {}", e))?;

    if output.status.success() {
        let raw_json = String::from_utf8_lossy(&output.stdout);
        
        // Parse the stdout directly into a JSON object!
        let parsed: Value = serde_json::from_str(&raw_json)
            .map_err(|e| format!("Parsing error: {}", e))?;
            
        Ok(parsed)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
```

Enjoy your pure, clean streams!

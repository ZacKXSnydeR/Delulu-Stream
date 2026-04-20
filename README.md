<div align="center">
  <img src="tauri.deluluapp/public/tauri.svg" alt="DeluluStream Logo" width="120" />
  <h1>DeluluStream</h1>
  <p><strong>The Convergence of Native Performance and Modular Extensibility</strong></p>
  <p>A high-performance, provider-agnostic media orchestrator built with Rust, Tauri, and React 19.</p>

  <p>
    <a href="#philosophy"><img src="https://img.shields.io/badge/Architecture-Provider--Agnostic-orange?style=flat-square" alt="Architecture" /></a>
    <a href="#technology"><img src="https://img.shields.io/badge/Stack-Rust%20%7C%20React%2019-blue?style=flat-square" alt="Stack" /></a>
    <a href="#protocol"><img src="https://img.shields.io/badge/Protocol-JSON--RPC%20%7C%20Stremio-success?style=flat-square" alt="Protocol" /></a>
    <a href="#license"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License" /></a>
  </p>
</div>

---

## 📸 Interface Showcase

<div align="center">
  <img src="Screenshots/home.png" width="49%" />
  <img src="Screenshots/playerpage.png" width="49%" />
</div>

---

## 🏛️ Architecture & Philosophy

DeluluStream is engineered as a **Modular Middleware Shell**. It follows a strict separation of concerns between the user interface and content logic. The core application is entirely stateless and does not contain any built-in media providers, search indices, or content-sourcing logic.

### 🛡️ Capability-Driven Interface Hydration
The application implements a **Zero-Trust UI Architecture**. Unlike traditional streaming apps, the DeluluStream interface is a "Living Shell":
- **Dynamic Dependency Injection:** Interactive elements—including Play buttons, Source Selectors, and Torrent interfaces—are only injected into the DOM when a user-installed addon broadcasts a matching capability.
- **Provider Neutrality:** In its default state, the application functions purely as a local metadata explorer. It only becomes a media client when the user explicitly bridges it with external protocol providers.

---

## ✨ Engineering Excellence

### 1. Hybrid Native Bridge
DeluluStream serves as a high-speed orchestrator for two distinct modular ecosystems:
- **Binary RPC Protocol:** Executes isolated native binaries via a high-performance **JSON-RPC 2.0** bridge. This allows for complex extraction and resolution logic to run at native speeds without blocking the UI's main thread.
- **Decentralized Manifest Bridge:** Full native support for the Stremio Addon specification, allowing users to leverage a vast, decentralized ecosystem of community-maintained metadata and stream modules.

### 2. High-Performance Network Middleware
To ensure universal interoperability across diverse streaming protocols, DeluluStream features an internal networking stack built with **Rust (Hyper & Tokio)**:
- **Zero-Copy Stream Proxying:** Handles high-throughput video data with near-zero memory overhead by utilizing async byte-streaming directly from source to the video buffer.
- **Protocol Standardization:** An internal routing layer that standardizes remote resources (HLS, MP4, Dash) into a unified internal protocol, ensuring a consistent playback experience regardless of the underlying source.

### 3. Parallel Resolution ("The Race")
The application utilizes an advanced concurrency model for resource discovery:
- **Real-time Source Racing:** Queries all active protocol providers in parallel. The orchestrator immediately initializes playback from the winner (fastest success) while late-arriving sources are dynamically merged into the player's source selector via background event streams.

### 4. Privacy-First Data Persistence
- **Encrypted Local State:** All user data, including watchlist, playback history, and configuration, is persisted in an encrypted local **SQLite** database via the `tauri-plugin-sql` layer. No telemetry or remote synchronization is performed by the core application.

---

## 🏗️ System Overview

```text
DeluluStream Workspace
│
├── tauri.deluluapp/         # The Orchestrator (Vite + React 19 + Tauri)
│   ├── src/addon_manager/   # Bridge logic & Capability-based UI hydration
│   ├── src/services/        # Local metadata & state management
│   └── src-tauri/           # Native Rust Shell (LTO & Size Optimized)
│
├── core-middleware/         # Stateless Networking Stack (Rust)
│   └── src/                 # High-throughput async I/O & resource mapping
│
└── addon-sdk/               # Development toolkit for protocol builders
    ├── binary-rpc-rust/     # Reference JSON-RPC implementation
    └── manifest-spec/       # Capability & Handshake documentation
```

---

## 🧩 Protocol Specifications

External modules extend the shell via **JSON-RPC 2.0** over STDIN/STDOUT.

**Handshake Example:**
```json
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "capabilities": ["stream.resolve", "subtitle.search"]
  }
}
```

Once initialized, the orchestrator dynamically enables the corresponding UI components, allowing the user to interact with the capabilities provided by the module.

---

## 🚀 Deployment

1. **Native Environment:** Ensure Node.js (18+) and Rust (1.75+) are installed.
2. **Setup:**
   ```bash
   npm install
   cp .env.example .env
   ```
3. **Execution:**
   ```bash
   npm run tauri dev  # Development
   npm run build      # Optimized Production Build
   ```

---

## 📄 License & Disclaimer

DeluluStream is released under the **MIT License**. 

**Disclaimer:** DeluluStream is a provider-agnostic framework. It does not provide, host, or curate any media content. All content-related functionality is entirely dependent on external addons provided and maintained by third parties. The developers of DeluluStream are not responsible for any third-party modules or the content accessed through them.

---
<div align="center">
  <i>Developed with precision by the Delulu Team</i>
</div>

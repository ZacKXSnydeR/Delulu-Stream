# Delulu Stream
Delulu Stream is a desktop-first streaming experience built with **Tauri + React + TypeScript**, focused on smooth playback, resilient HLS handling, and a polished media UX.

## Highlights
- Tauri desktop app with custom player chrome and mini-player support
- HLS proxy pipeline with manifest probing and retry logic
- Sidecar extractor integration via `gods_EYE`
- TMDB-backed catalog, details pages, and trailer launch flow
- Algolia-ready search pipeline and indexing script support
- Watch history, list management, and local persistence

## Repository Layout
- `tauri.deluluapp/`: main desktop application (frontend + Tauri backend)
- `gods_EYE/`: extractor sidecar project used by the desktop app
- `sounds/`: shared audio assets

## Tech Stack
- Frontend: React 19, TypeScript, Vite, Framer Motion, hls.js
- Desktop: Tauri v2 (Rust backend)
- Data: TMDB proxying via backend, optional Algolia search index
- Local storage: SQLite (Tauri plugin) + local cache layers

## Prerequisites
- Node.js 20+
- Rust toolchain (`stable`) with Cargo
- Microsoft C++ Build Tools (for Windows builds)

## Environment Setup
Use local-only env files and never commit secrets.

1. In `tauri.deluluapp/`, copy `.env.example` to `.env.local`
2. Fill required keys:
- `TMDB_READ_TOKEN`
- `ALGOLIA_APP_ID`
- `ALGOLIA_SEARCH_KEY`
- `ALGOLIA_INDEX_NAME` (optional default: `delulu_content`)

Note: `.env.local` is git-ignored by design.

## Development
```bash
cd tauri.deluluapp
npm ci
npm run tauri dev
```

## Production Build
### Windows x64 (NSIS)
```bash
cd tauri.deluluapp
npm ci
npm run tauri build -- --target x86_64-pc-windows-msvc --bundles nsis
```

### Windows x64 (MSI)
```bash
cd tauri.deluluapp
npm ci
npm run tauri build -- --target x86_64-pc-windows-msvc --bundles msi
```

## Security and Release Notes
- Keep all runtime secrets in `.env.local` (never in tracked files)
- Do not commit build caches (`target/`, `dist/`) or installer artifacts
- Verify sidecar binaries match your build target architecture before release

## Important Disclaimer
- This is a partially vibe-coded project. Bugs, rough edges, and mistakes can happen.
- Delulu Stream does **not** host or own any video content.
- If a title does not play or content is unavailable, that is usually a provider-side issue.
- If you can add and maintain a new provider, contributions are very welcome.

## License
This project is licensed under the MIT License. See [LICENSE](./LICENSE).

## Screenshots
![Home](./Screenshots/Screenshot%202026-03-21%20152718.png)
![Details](./Screenshots/Screenshot%202026-03-21%20152725.png)
![Player](./Screenshots/Screenshot%202026-03-21%20152737.png)
![Search](./Screenshots/Screenshot%202026-03-21%20152802.png)
![Mini Player](./Screenshots/Screenshot%202026-03-21%20152920.png)
![Settings](./Screenshots/Screenshot%202026-03-21%20153154.png)

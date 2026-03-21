# Delulu Desktop App
Main Tauri application for Delulu Stream.

## Quick Start
```bash
npm ci
npm run tauri dev
```

## Build
```bash
# x64 NSIS
npm run tauri build -- --target x86_64-pc-windows-msvc --bundles nsis

# x64 MSI
npm run tauri build -- --target x86_64-pc-windows-msvc --bundles msi
```

## Required Environment
Create `.env.local` from `.env.example` and provide:
- `TMDB_READ_TOKEN`
- `ALGOLIA_APP_ID`
- `ALGOLIA_SEARCH_KEY`
- `ALGOLIA_INDEX_NAME` (optional)

## Notes
- Secrets must stay in `.env.local` only.
- Build outputs under `src-tauri/target` are not source artifacts.
- Sidecar binaries must match target architecture (x64/x86).

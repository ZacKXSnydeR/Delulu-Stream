export type AddonInstallState = 'downloading' | 'verifying' | 'ready' | 'failed';

export interface AddonHeaderDefaults {
  defaultOrigin?: string;
  defaultReferer?: string;
  userAgent?: string;
}

export interface AddonPlatformAsset {
  downloadUrl: string;
  sha256: string;
  binaryName: string;
  entryCommand: string;
}

export interface RemoteAddonManifest {
  id: string;
  name: string;
  version: string;
  protocolVersion: string;
  publisher: string;
  publicKeyId: string;
  signature: string;
  platformAssets: Record<string, AddonPlatformAsset>;
  capabilities: string[];
  headerDefaults?: AddonHeaderDefaults;
  minAppVersion?: string;
  releaseNotesUrl?: string;
  homepageUrl?: string;
}

export interface AddonInstallRecord {
  manifest: RemoteAddonManifest;
  installState: AddonInstallState;
  installPath: string;
  binaryPath: string;
  manifestUrl?: string;
  installedAt: number;
  updatedAt: number;
  lastHealthOk?: boolean;
  lastHealthLatencyMs?: number;
  lastError?: string;
}

export interface AddonStateStore {
  activeAddonId?: string | null;
  addons: AddonInstallRecord[];
}

export interface CatalogAddonEntry {
  id: string;
  name: string;
  manifestUrl: string;
  description?: string;
}

export interface CatalogResponse {
  sourceUrl: string;
  addons: CatalogAddonEntry[];
}

export interface ResolveStreamRequest {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  season?: number;
  episode?: number;
  preferredLanguage?: string;
  timeoutMs?: number;
}

export interface ResolveStreamResponse {
  success: boolean;
  streamUrl?: string;
  headers?: Record<string, string>;
  subtitles?: Array<{ url: string; language?: string }>;
  errorCode?: string;
  errorMessage?: string;
  addonId?: string;
  addonName?: string;
}

export interface AddonHealthStatus {
  ok: boolean;
  latencyMs?: number;
  response?: unknown;
  error?: string;
}

/** Result from a single addon in the parallel race */
export interface AddonStreamSource {
  addonId: string;
  addonName: string;
  success: boolean;
  streamUrl?: string;
  headers?: Record<string, string>;
  subtitles?: Array<{ url: string; language?: string }>;
  /** Multi-audio map: { audioName: { quality: url } } */
  audios?: Record<string, Record<string, string>>;
  /** Embedded proxy port (127.0.0.1:port) */
  proxyPort?: number;
  /** Session ID for the embedded proxy */
  sessionId?: string;
  /** When true, addon handles its own proxying — app should NOT inject CDN headers */
  selfProxy?: boolean;
  errorCode?: string;
  errorMessage?: string;
  latencyMs: number;
}

/** Race result: first winner + all sources for source switching */
export interface RaceStreamResult {
  winner: AddonStreamSource;
  allSources: AddonStreamSource[];
  errors: AddonStreamSource[];
}

export interface AddonVerificationResult {
  ok: boolean;
  error?: string;
}

export interface StremioResourceResponse {
  requestUrl: string;
  payload: unknown;
}

export interface StremioManifestLite {
  id: string;
  version: string;
  name: string;
  description: string;
  resources: unknown[];
  types: string[];
  idPrefixes?: string[];
  catalogs?: unknown;
  behaviorHints?: unknown;
  logo?: string;
  background?: string;
  [key: string]: unknown;
}

export interface StremioInstalledAddon {
  id: string;
  baseUrl: string;
  manifestUrl: string;
  manifest: StremioManifestLite;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
  lastManifestFetchAt: number;
  lastError?: string;
  failCount: number;
  successCount: number;
}

export interface StremioAddonState {
  addons: StremioInstalledAddon[];
}

export interface StremioAddonHealthStatus {
  ok: boolean;
  addonId?: string;
  addonName?: string;
  latencyMs?: number;
  manifestVersion?: string;
  error?: string;
}

export interface StremioCommunityAddonEntry {
  id: string;
  name: string;
  description: string;
  manifestUrl: string;
}

export interface StremioUnifiedStream {
  id: string;
  title: string;
  type: 'torrent' | 'direct' | string;
  infoHash?: string;
  url?: string;
  quality?: string;
  size?: string;
  seeders?: number;
  sourceAddon: string;
  raw: unknown;
}

export interface StremioAggregateResult {
  streams: StremioUnifiedStream[];
  errors: Array<Record<string, unknown>>;
  cacheHit: boolean;
}

export interface StremioTmdbAggregateRequest {
  mediaType: 'movie' | 'series' | 'tv' | string;
  tmdbId: number;
  season?: number;
  episode?: number;
  timeoutMs?: number;
}

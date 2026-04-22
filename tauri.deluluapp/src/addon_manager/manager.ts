import { invoke } from '@tauri-apps/api/core';
import type {
  AddonHealthStatus,
  AddonInstallRecord,
  AddonStateStore,
  CatalogResponse,
  RaceStreamResult,
  ResolveStreamRequest,
  ResolveStreamResponse,
  StremioAddonState,
  StremioAggregateResult,
  StremioAddonHealthStatus,
  StremioCommunityAddonEntry,
  StremioInstalledAddon,
  StremioResourceResponse,
  StremioTmdbAggregateRequest,
} from './types';

let bootstrapped = false;

function normalizeStore(store: AddonStateStore | null | undefined): AddonStateStore {
  if (!store) return { activeAddonId: null, addons: [] };
  return {
    activeAddonId: store.activeAddonId ?? null,
    addons: Array.isArray(store.addons) ? store.addons : [],
  };
}

export async function bootstrapAddonManager(): Promise<AddonStateStore> {
  const store = await listInstalledAddons();
  bootstrapped = true;
  return store;
}

export function isAddonManagerBootstrapped(): boolean {
  return bootstrapped;
}

export async function fetchOfficialCatalog(catalogUrl?: string): Promise<CatalogResponse> {
  return invoke<CatalogResponse>('addon_fetch_catalog', { url: catalogUrl ?? null });
}

export async function installAddonFromManifestUrl(
  manifestUrl: string,
  autoActivate = true,
): Promise<AddonInstallRecord> {
  return invoke<AddonInstallRecord>('addon_install_from_manifest_url', {
    manifestUrl,
    autoActivate,
  });
}

export async function installAddonFromManifestJson(
  manifestJson: string,
  sourceUrl?: string,
  autoActivate = true,
): Promise<AddonInstallRecord> {
  return invoke<AddonInstallRecord>('addon_install_from_manifest_json', {
    manifestJson,
    sourceUrl: sourceUrl ?? null,
    autoActivate,
  });
}

export async function listInstalledAddons(): Promise<AddonStateStore> {
  const store = await invoke<AddonStateStore>('addon_list_installed');
  return normalizeStore(store);
}

export async function setActiveAddonById(id: string): Promise<AddonStateStore> {
  const store = await invoke<AddonStateStore>('addon_set_active', { addonId: id });
  return normalizeStore(store);
}

export async function removeAddonById(id: string): Promise<AddonStateStore> {
  const store = await invoke<AddonStateStore>('addon_remove', { addonId: id });
  return normalizeStore(store);
}

export async function checkAddonUpdates(addonId?: string): Promise<
  Array<{
    addonId: string;
    currentVersion: string;
    latestVersion: string;
    hasUpdate: boolean;
    manifestUrl?: string;
  }>
> {
  return invoke('addon_check_updates', { addonId: addonId ?? null });
}

export async function healthCheckActiveAddon(): Promise<AddonHealthStatus> {
  return invoke<AddonHealthStatus>('addon_health_check_active');
}

export async function healthCheckAddonById(addonId: string): Promise<AddonHealthStatus & { addonId?: string; addonName?: string }> {
  return invoke<AddonHealthStatus & { addonId?: string; addonName?: string }>('addon_health_check_by_id', { addonId });
}

export async function resolveStreamViaAddon(
  req: ResolveStreamRequest,
): Promise<ResolveStreamResponse> {
  return invoke<ResolveStreamResponse>('addon_resolve_stream', { request: req });
}

/** Race ALL installed addons in parallel for the fastest stream.
 *  Returns the winner (first success) immediately; late sources arrive via getRaceSources(). */
export async function resolveStreamRace(
  req: ResolveStreamRequest,
): Promise<RaceStreamResult> {
  return invoke<RaceStreamResult>('addon_resolve_stream_all', { request: req });
}

/** Poll for late-arriving addon sources collected in background after the winner returned.
 *  Call this once after the player starts to merge slower addons into the Sources panel. */
export async function getRaceSources(
  req?: Partial<ResolveStreamRequest>,
): Promise<import('./types').AddonStreamSource[]> {
  return invoke<import('./types').AddonStreamSource[]>('addon_get_race_sources', {
    request: req ?? null,
  });
}

export async function getActiveHeaderDefaults(): Promise<{
  origin?: string;
  referer?: string;
  userAgent?: string;
}> {
  try {
    return await invoke('addon_get_active_header_defaults');
  } catch {
    return {};
  }
}

export async function stremioFetchManifest(manifestUrl: string): Promise<unknown> {
  return invoke('addon_stremio_fetch_manifest', { manifestUrl });
}

export async function stremioRequestResource(input: {
  manifestUrl: string;
  resource: string;
  mediaType?: string;
  mediaId?: string;
  extraQuery?: Record<string, string>;
}): Promise<StremioResourceResponse> {
  if (!input.mediaType || !input.mediaId) {
    throw new Error('mediaType and mediaId are required for Stremio resource request');
  }
  return invoke<StremioResourceResponse>('addon_stremio_request_resource', {
    manifestUrl: input.manifestUrl,
    resource: input.resource,
    mediaType: input.mediaType,
    mediaId: input.mediaId,
    extraQuery: input.extraQuery ?? {},
  });
}

export async function listStremioAddons(): Promise<StremioAddonState> {
  return invoke<StremioAddonState>('stremio_addon_list');
}

export async function listStremioCommunityCatalog(): Promise<StremioCommunityAddonEntry[]> {
  return invoke<StremioCommunityAddonEntry[]>('stremio_addon_get_curated_catalog');
}

export async function installStremioAddon(manifestUrl: string): Promise<StremioInstalledAddon> {
  return invoke<StremioInstalledAddon>('stremio_addon_install_from_manifest_url', { manifestUrl });
}

export async function setStremioAddonEnabled(addonId: string, enabled: boolean): Promise<StremioAddonState> {
  return invoke<StremioAddonState>('stremio_addon_set_enabled', { addonId, enabled });
}

export async function removeStremioAddon(addonId: string): Promise<StremioAddonState> {
  return invoke<StremioAddonState>('stremio_addon_remove', { addonId });
}

export async function healthCheckStremioAddonById(
  addonId: string,
  timeoutMs?: number,
): Promise<StremioAddonHealthStatus> {
  return invoke<StremioAddonHealthStatus>('stremio_addon_health_check_by_id', {
    addonId,
    timeoutMs: timeoutMs ?? null,
  });
}

export async function fetchStremioResource(input: {
  addonId: string;
  resource: string;
  mediaType: string;
  mediaId: string;
  extraQuery?: Record<string, string>;
  timeoutMs?: number;
}): Promise<StremioResourceResponse> {
  return invoke<StremioResourceResponse>('stremio_addon_fetch_resource', {
    addonId: input.addonId,
    resource: input.resource,
    mediaType: input.mediaType,
    mediaId: input.mediaId,
    extraQuery: input.extraQuery ?? {},
    timeoutMs: input.timeoutMs ?? null,
  });
}

export async function aggregateStremioStreams(input: {
  mediaType: string;
  mediaId: string;
  timeoutMs?: number;
}): Promise<StremioAggregateResult> {
  return invoke<StremioAggregateResult>('stremio_addon_aggregate_streams', {
    mediaType: input.mediaType,
    mediaId: input.mediaId,
    timeoutMs: input.timeoutMs ?? null,
  });
}

export async function aggregateStremioStreamsByTmdb(
  request: StremioTmdbAggregateRequest,
): Promise<StremioAggregateResult> {
  return invoke<StremioAggregateResult>('stremio_addon_aggregate_streams_tmdb', {
    request: {
      mediaType: request.mediaType,
      tmdbId: request.tmdbId,
      season: request.season ?? null,
      episode: request.episode ?? null,
      timeoutMs: request.timeoutMs ?? null,
    },
  });
}

export function getActiveAddonRecord(store: AddonStateStore): AddonInstallRecord | null {
  const activeId = store.activeAddonId;
  if (!activeId) return null;
  return store.addons.find((a) => a.manifest.id === activeId && a.installState === 'ready') ?? null;
}

export function hasActiveStreamingAddon(store: AddonStateStore): boolean {
  return Boolean(getActiveAddonRecord(store));
}

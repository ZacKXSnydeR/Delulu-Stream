import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart, Popcorn, HeartHandshake, Star, ChevronLeft } from 'lucide-react';
import { getCacheStats } from '../services/streamCache';
import { clearAllNonPosterCaches } from '../services/cacheManager';
import { getAdvancedErrorLogs, clearAdvancedErrorLogs, type AdvancedErrorLogEntry } from '../services/advancedLogs';
import { useUserProfile } from '../context/UserProfileContext';
import { useAddons } from '../context/AddonContext';
import {
    bootstrapAddonManager,
    checkAddonUpdates,
    fetchOfficialCatalog,
    healthCheckAddonById,
    installAddonFromManifestUrl,
    listInstalledAddons,
    removeAddonById,
    setActiveAddonById,
    installAddonFromManifestJson,
    getActiveAddonRecord,
    installStremioAddon,
    healthCheckStremioAddonById,
    listStremioAddons,
    listStremioCommunityCatalog,
    removeStremioAddon,
    setStremioAddonEnabled,
} from '../addon_manager/manager';
import type {
    AddonInstallRecord,
    AddonStateStore,
    CatalogAddonEntry,
    StremioCommunityAddonEntry,
    StremioInstalledAddon,
} from '../addon_manager/types';
import Silk from '../components/background/Silk';
import './Settings.css';

export function Settings() {
    const navigate = useNavigate();
    const normalizeAddonError = (err: unknown, fallback: string): string => {
        if (err instanceof Error && err.message) return err.message;
        if (typeof err === 'string') return err;
        try {
            return JSON.stringify(err);
        } catch {
            return fallback;
        }
    };

    // Profile context
    const { profile, updateProfile } = useUserProfile();

    // Addon context — used to keep global hasAddon reactive
    const { refreshAddons: refreshAddonContext } = useAddons();

    // Tab state
    type SettingsTab = 'profile' | 'addons' | 'system' | 'about';
    const [activeTab, setActiveTab] = useState<SettingsTab>('profile');

    // Audio setup
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const playSound = (soundPath: string) => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
        const audio = new Audio(soundPath);
        audio.volume = 1.0;
        audioRef.current = audio;
        audio.play().catch(err => console.error("Audio playback failed", err));
    };

    // Profile edit state
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [editName, setEditName] = useState('');
    const [editAvatar, setEditAvatar] = useState('');

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setEditAvatar(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    // Cache stats
    const [cacheStats, setCacheStats] = useState<{ count: number; sizeKB: number } | null>(null);
    const [isClearingCache, setIsClearingCache] = useState(false);
    const [cacheClearMsg, setCacheClearMsg] = useState('');

    // Error Logs
    const [errorLogs, setErrorLogs] = useState<AdvancedErrorLogEntry[]>([]);
    const [activeAddonId, setActiveAddonId] = useState<string>('none');
    const [installedAddons, setInstalledAddons] = useState<AddonInstallRecord[]>([]);
    const [catalogEntries, setCatalogEntries] = useState<CatalogAddonEntry[]>([]);
    const [customManifestUrl, setCustomManifestUrl] = useState('');
    const [addonMsg, setAddonMsg] = useState('');
    const [addonErr, setAddonErr] = useState('');
    const [addonBusy, setAddonBusy] = useState(false);
    const [addonHealthStatus, setAddonHealthStatus] = useState<Record<string, string>>({});
    const addonFileInputRef = useRef<HTMLInputElement | null>(null);
    
    // Installation tracking states
    const [installingUrl, setInstallingUrl] = useState<string | null>(null);
    const [isInstallingFile, setIsInstallingFile] = useState(false);
    const [updatingId, setUpdatingId] = useState<string | null>(null);
    const [addonToRemove, setAddonToRemove] = useState<{ id: string, name: string } | null>(null);
    const [stremioBusy, setStremioBusy] = useState(false);
    const [stremioErr, setStremioErr] = useState('');
    const [stremioMsg, setStremioMsg] = useState('');
    const [stremioInstalled, setStremioInstalled] = useState<StremioInstalledAddon[]>([]);
    const [stremioCatalog, setStremioCatalog] = useState<StremioCommunityAddonEntry[]>([]);
    const [stremioInstallUrl, setStremioInstallUrl] = useState('');
    const [stremioHealthStatus, setStremioHealthStatus] = useState<Record<string, string>>({});
    const [stremioHealthCheckingId, setStremioHealthCheckingId] = useState<string | null>(null);

    const startEditingProfile = () => {
        setEditName(profile.name);
        setEditAvatar(profile.avatarUrl);
        setIsEditingProfile(true);
    };

    const saveProfile = () => {
        updateProfile(editName.trim() || 'Local User', editAvatar.trim());
        setIsEditingProfile(false);
    };

    useEffect(() => {
        const init = async () => {
            await bootstrapAddonManager();
            await Promise.all([loadCacheStats(), refreshAddons(), loadCatalog(), loadStremioCatalog(), refreshStremioAddons()]);
            loadErrorLogs();
        };
        init().catch(console.error);
    }, []);

    const refreshAddons = async () => {
        const store = await listInstalledAddons();
        hydrateAddonState(store);
        // Sync the global AddonContext so hasAddon updates reactively app-wide
        await refreshAddonContext();
    };

    const hydrateAddonState = (store: AddonStateStore) => {
        const active = getActiveAddonRecord(store);
        setActiveAddonId(active?.manifest.id ?? 'none');
        setInstalledAddons(store.addons);
    };

    const loadCatalog = async () => {
        try {
            const catalog = await fetchOfficialCatalog();
            setCatalogEntries(catalog.addons);
        } catch (err) {
            console.warn('[AddonManager] Catalog fetch failed:', err);
            setCatalogEntries([]);
        }
    };

    const refreshStremioAddons = async () => {
        try {
            const state = await listStremioAddons();
            setStremioInstalled(state.addons);
        } catch (err) {
            console.warn('[StremioAddon] list failed:', err);
            setStremioInstalled([]);
        }
    };

    const loadStremioCatalog = async () => {
        try {
            const entries = await listStremioCommunityCatalog();
            setStremioCatalog(entries);
        } catch (err) {
            console.warn('[StremioAddon] catalog failed:', err);
            setStremioCatalog([]);
        }
    };

    const loadErrorLogs = () => {
        setErrorLogs(getAdvancedErrorLogs());
    };

    const clearErrorLogs = () => {
        clearAdvancedErrorLogs();
        setErrorLogs([]);
    };

    const loadCacheStats = async () => {
        const stats = await getCacheStats();
        setCacheStats(stats);
    };

    const handleClearCache = async () => {
        setIsClearingCache(true);
        setCacheClearMsg('');
        try {
            await clearAllNonPosterCaches();
            setCacheClearMsg('All non-poster caches cleared. Refreshing...');
            await loadCacheStats();
            setTimeout(() => window.location.reload(), 600);
        } catch {
            setCacheClearMsg('Failed to clear cache');
        } finally {
            setIsClearingCache(false);
            setTimeout(() => setCacheClearMsg(''), 4000);
        }
    };

    const handleInstallAddonClick = () => {
        addonFileInputRef.current?.click();
    };

    const handleAddonFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        setAddonErr('');
        setAddonMsg('');
        setAddonBusy(true);
        setIsInstallingFile(true);
        try {
            const rawJson = await file.text();
            const installed = await installAddonFromManifestJson(rawJson, undefined, true);
            await refreshAddons();
            setAddonMsg(`Addon installed: ${installed.manifest.name}`);
            setTimeout(() => setAddonMsg(''), 3500);
        } catch (err) {
            setAddonErr(normalizeAddonError(err, 'Failed to install addon'));
            setAddonErr(normalizeAddonError(err, 'Failed to install addon'));
            setTimeout(() => setAddonErr(''), 4500);
        } finally {
            setAddonBusy(false);
            setIsInstallingFile(false);
        }
    };

    const executeRemoveAddon = async () => {
        if (!addonToRemove) return;
        const { id } = addonToRemove;
        setAddonToRemove(null);

        setAddonErr('');
        setAddonMsg('');
        setAddonBusy(true);
        try {
            const store = await removeAddonById(id);
            hydrateAddonState(store);
            setAddonMsg('Addon removed');
            setTimeout(() => setAddonMsg(''), 2800);
        } catch (err) {
            setAddonErr(normalizeAddonError(err, 'Failed to remove addon'));
            setTimeout(() => setAddonErr(''), 4500);
        } finally {
            setAddonBusy(false);
        }
    };

    const handleInstallFromCatalog = async (manifestUrl: string) => {
        setAddonErr('');
        setAddonMsg('');
        setAddonBusy(true);
        setInstallingUrl(manifestUrl);
        try {
            const installed = await installAddonFromManifestUrl(manifestUrl, true);
            await refreshAddons();
            setAddonMsg(`Installed from catalog: ${installed.manifest.name}`);
            setTimeout(() => setAddonMsg(''), 3200);
        } catch (err) {
            setAddonErr(normalizeAddonError(err, 'Catalog install failed'));
            setTimeout(() => setAddonErr(''), 4500);
        } finally {
            setAddonBusy(false);
            setInstallingUrl(null);
        }
    };

    const handleInstallCustomUrl = async () => {
        if (!customManifestUrl.trim()) return;
        await handleInstallFromCatalog(customManifestUrl.trim());
    };

    const handleCheckUpdates = async () => {
        setAddonErr('');
        setAddonMsg('');
        setAddonBusy(true);
        try {
            const updates = await checkAddonUpdates();
            const available = updates.filter((u) => u.hasUpdate);
            if (!available.length) {
                setAddonMsg('All installed addons are up to date');
            } else {
                setAddonMsg(`Update available: ${available.map((u) => `${u.addonId} -> ${u.latestVersion}`).join(', ')}`);
            }
            setTimeout(() => setAddonMsg(''), 4200);
        } catch (err) {
            setAddonErr(normalizeAddonError(err, 'Update check failed'));
            setTimeout(() => setAddonErr(''), 4500);
        } finally {
            setAddonBusy(false);
        }
    };

    const handleUpdateAddon = async (addonId: string, manifestUrl?: string) => {
        if (!manifestUrl) {
            setAddonErr(`No manifest URL stored for ${addonId}`);
            setTimeout(() => setAddonErr(''), 3500);
            return;
        }
        setAddonErr('');
        setAddonMsg('');
        setAddonBusy(true);
        setUpdatingId(addonId);
        try {
            const installed = await installAddonFromManifestUrl(manifestUrl, activeAddonId === addonId);
            await refreshAddons();
            setAddonMsg(`Updated ${installed.manifest.name} to ${installed.manifest.version}`);
            setTimeout(() => setAddonMsg(''), 3500);
        } catch (err) {
            setAddonErr(normalizeAddonError(err, 'Update failed'));
            setAddonErr(normalizeAddonError(err, 'Update failed'));
            setTimeout(() => setAddonErr(''), 4500);
        } finally {
            setAddonBusy(false);
            setUpdatingId(null);
        }
    };

    const handleHealthCheckByAddon = async (addonId: string, addonName: string) => {
        setAddonErr('');
        setAddonBusy(true);
        try {
            const health = await healthCheckAddonById(addonId);
            if (health.ok) {
                setAddonHealthStatus((prev) => ({
                    ...prev,
                    [addonId]: `Healthy (${health.latencyMs ?? 0}ms)`,
                }));
                setAddonMsg(`${addonName} is healthy`);
                setTimeout(() => setAddonMsg(''), 2200);
            } else {
                const errorMsg = health.error ?? 'Unknown error';
                setAddonHealthStatus((prev) => ({
                    ...prev,
                    [addonId]: `Unhealthy: ${errorMsg}`,
                }));
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            setAddonHealthStatus((prev) => ({
                ...prev,
                [addonId]: `Unhealthy: ${errorMsg}`,
            }));
        } finally {
            setAddonBusy(false);
        }
    };

    const handleInstallStremioAddon = async (url: string) => {
        if (!url.trim()) return;
        setStremioBusy(true);
        setStremioErr('');
        setStremioMsg('');
        try {
            const installed = await installStremioAddon(url.trim());
            await refreshStremioAddons();
            setStremioMsg(`Installed Stremio addon: ${installed.manifest.name}`);
            setTimeout(() => setStremioMsg(''), 2800);
        } catch (err) {
            setStremioErr(normalizeAddonError(err, 'Failed to install Stremio addon'));
            setTimeout(() => setStremioErr(''), 4500);
        } finally {
            setStremioBusy(false);
        }
    };

    const handleToggleStremioAddon = async (addonId: string, enabled: boolean) => {
        setStremioBusy(true);
        setStremioErr('');
        setStremioMsg('');
        try {
            const state = await setStremioAddonEnabled(addonId, enabled);
            setStremioInstalled(state.addons);
            setStremioMsg(`Addon ${enabled ? 'enabled' : 'disabled'}`);
            setTimeout(() => setStremioMsg(''), 2200);
        } catch (err) {
            setStremioErr(normalizeAddonError(err, 'Failed to update Stremio addon state'));
            setTimeout(() => setStremioErr(''), 4500);
        } finally {
            setStremioBusy(false);
        }
    };

    const handleRemoveStremioAddon = async (addonId: string) => {
        setStremioBusy(true);
        setStremioErr('');
        setStremioMsg('');
        try {
            const state = await removeStremioAddon(addonId);
            setStremioInstalled(state.addons);
            setStremioMsg('Stremio addon removed');
            setTimeout(() => setStremioMsg(''), 2200);
        } catch (err) {
            setStremioErr(normalizeAddonError(err, 'Failed to remove Stremio addon'));
            setTimeout(() => setStremioErr(''), 4500);
        } finally {
            setStremioBusy(false);
        }
    };

    const handleStremioHealthCheck = async (addonId: string) => {
        setStremioHealthCheckingId(addonId);
        try {
            const health = await healthCheckStremioAddonById(addonId);
            if (health.ok) {
                const latency = health.latencyMs ?? 0;
                setStremioHealthStatus((prev) => ({
                    ...prev,
                    [addonId]: `Healthy (${latency}ms)`,
                }));
            } else {
                setStremioHealthStatus((prev) => ({
                    ...prev,
                    [addonId]: 'Unhealthy',
                }));
            }
        } catch {
            setStremioHealthStatus((prev) => ({
                ...prev,
                [addonId]: 'Unhealthy',
            }));
        } finally {
            setStremioHealthCheckingId(null);
        }
    };

    return (
        <div className="settings-page">
            <Silk speed={3} scale={1.2} color="#1a1a2e" noiseIntensity={1.2} rotation={0} />

            <div className="settings-layout">
                {/* Left Sidebar */}
                <aside className="settings-sidebar">
                    <div className="settings-sidebar-header">
                        <h2>Control Center</h2>
                    </div>
                    <nav className="settings-nav">
                        <button 
                            className={`settings-nav-item ${activeTab === 'profile' ? 'active' : ''}`}
                            onClick={() => setActiveTab('profile')}
                        >
                            Profile Identity
                        </button>
                        <button 
                            className={`settings-nav-item ${activeTab === 'addons' ? 'active' : ''}`}
                            onClick={() => setActiveTab('addons')}
                        >
                            Add-ons
                        </button>
                        <button 
                            className={`settings-nav-item ${activeTab === 'system' ? 'active' : ''}`}
                            onClick={() => setActiveTab('system')}
                        >
                            System Cache
                        </button>
                        <button 
                            className={`settings-nav-item ${activeTab === 'about' ? 'active' : ''}`}
                            onClick={() => setActiveTab('about')}
                        >
                            About Delulu
                        </button>
                    </nav>

                    <div style={{ paddingBottom: '20px', marginTop: 'auto', paddingTop: '24px', display: 'flex', borderTop: '1px solid rgba(255,255,255,0.05)', justifyContent: 'center', width: '100%' }}>
                        <button 
                            className="sidebar-back-btn" 
                            style={{ 
                                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 24px', 
                                color: 'rgba(255,255,255,0.5)', background: 'transparent', border: 'none', 
                                cursor: 'pointer', fontSize: '15px', fontWeight: 500, borderRadius: '8px',
                                transition: 'all 0.2s ease', gap: '8px', margin: '0 auto'
                            }}
                            onClick={() => navigate(-1)}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.color = '#fff';
                                const icon = e.currentTarget.querySelector('svg');
                                if (icon) icon.style.transform = 'translateX(-4px)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = 'rgba(255,255,255,0.5)';
                                const icon = e.currentTarget.querySelector('svg');
                                if (icon) icon.style.transform = 'translateX(0)';
                            }}
                        >
                            <ChevronLeft size={20} style={{ transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)' }} />
                            <span>BACK</span>
                        </button>
                    </div>
                </aside>

                {/* Right Content Area */}
                <main className="settings-content" data-lenis-prevent>
                    <audio ref={audioRef} />
                    {/* PROFILE TAB */}
                    {activeTab === 'profile' && (
                        <div className="settings-tab-pane fade-in">
                            <section className="settings-section">
                                <h3 className="section-title">Profile Identity</h3>
                                <div className="settings-card">
                                    {isEditingProfile ? (
                                        <div className="profile-editor-form">
                                            <input type="text" className="input-field" placeholder="Display Name" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={30} />
                                            <div className="avatar-upload-container" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', marginTop: '10px' }}>
                                                <div className="profile-avatar-ring" style={{ flexShrink: 0 }}>
                                                    <div className="profile-avatar" style={{ width: '48px', height: '48px' }}>
                                                        {editAvatar ? <img src={editAvatar} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: '20px' }}>{editName ? editName.charAt(0).toUpperCase() : 'L'}</span>}
                                                    </div>
                                                </div>
                                                <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} id="avatar-upload" />
                                                <label htmlFor="avatar-upload" className="btn-secondary-subtle" style={{ cursor: 'pointer', flex: 1, textAlign: 'center' }}>Choose Photo</label>
                                            </div>
                                            <div className="profile-editor-actions" style={{ gap: '12px', display: 'flex' }}>
                                                <button className="btn-primary" onClick={saveProfile} style={{ flex: 1 }}>Save Profile</button>
                                                <button className="btn-secondary-subtle" onClick={() => setIsEditingProfile(false)} style={{ flex: 1 }}>Cancel</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="profile-header">
                                                <div className="profile-avatar-ring">
                                                    <div className="profile-avatar">
                                                        {profile.avatarUrl ? <img src={profile.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span>{profile.name.charAt(0).toUpperCase()}</span>}
                                                    </div>
                                                </div>
                                                <div className="profile-info">
                                                    <h4 className="profile-name">{profile.name}</h4>
                                                    <p className="profile-trust">Your watch history and favorites are saved securely on this desktop.</p>
                                                </div>
                                            </div>
                                            <button className="btn-secondary-subtle" onClick={startEditingProfile} style={{ width: '100%' }}>Edit Profile</button>
                                        </>
                                    )}
                                </div>

                            </section>
                        </div>
                    )}

                    {/* ADDONS TAB */}
                    {activeTab === 'addons' && (
                        <div className="settings-tab-pane fade-in">
                            <section className="settings-section">
                                <h3 className="section-title">Binary Add-on Manager</h3>
                                <div className="settings-card" style={{ marginBottom: '32px' }}>
                                    <div className="addon-manager-header">
                                        <button className="btn-primary addon-install-btn" onClick={handleInstallAddonClick} disabled={addonBusy}>
                                            {isInstallingFile ? (
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span className="spinner-small" /> Installing...</span>
                                            ) : 'Install Addon (.json)'}
                                        </button>
                                        <input ref={addonFileInputRef} type="file" accept=".json,application/json" onChange={handleAddonFileSelected} style={{ display: 'none' }} />
                                    </div>
                                    <p className="engine-note" style={{ marginBottom: '6px' }}>Core app has no bundled extractor. Install external addons from official catalog or custom manifest URL.</p>

                                    <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
                                        <button className="btn-secondary-subtle" onClick={handleCheckUpdates} disabled={addonBusy}>Check Updates</button>
                                    </div>

                                    <div style={{ display: 'grid', gap: '10px', marginBottom: '16px' }}>
                                        <input className="input-field" placeholder="Custom manifest URL (https://...)" value={customManifestUrl} onChange={(e) => setCustomManifestUrl(e.target.value)} />
                                        <button className="btn-secondary-subtle" onClick={handleInstallCustomUrl} disabled={addonBusy || !customManifestUrl.trim()}>
                                            {installingUrl === customManifestUrl.trim() ? (
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span className="spinner-small" /> Installing...</span>
                                            ) : 'Install From URL'}
                                        </button>
                                    </div>

                                    {addonMsg && <p className="message-success" style={{ marginBottom: 0 }}>{addonMsg}</p>}
                                    {addonErr && <p className="message-error" style={{ marginBottom: 0 }}>{addonErr}</p>}
                                </div>

                                {catalogEntries.length > 0 && (
                                    <>
                                        <h4 className="section-title" style={{ fontSize: '24px' }}>Addon Catalog</h4>
                                        <p className="engine-note" style={{ marginBottom: '16px' }}>One-click signed addon installs from predefined trusted repository.</p>
                                        <div className="addon-list" style={{ marginBottom: '32px' }}>
                                            {catalogEntries.map((entry) => {
                                                const isInstalled = installedAddons.some(record => record.manifest.id === entry.id);
                                                return (
                                                    <div key={entry.id} className="addon-item">
                                                        <div className="addon-item-meta" style={{ flex: 1, paddingRight: '16px' }}>
                                                            <h4 className="addon-item-name" style={{ fontSize: '16px', marginBottom: '6px' }}>{entry.name}</h4>
                                                            <p className="engine-note" style={{ marginBottom: 0 }}>{entry.description || entry.id}</p>
                                                        </div>
                                                        <div className="addon-item-actions">
                                                            <button className="btn-secondary-subtle" onClick={() => handleInstallFromCatalog(entry.manifestUrl)} disabled={addonBusy || isInstalled}>
                                                                {installingUrl === entry.manifestUrl ? (
                                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span className="spinner-small" /> Installing...</span>
                                                                ) : isInstalled ? 'Installed' : 'Install'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </>
                                )}

                                {installedAddons.length > 0 && (
                                    <>
                                        <h4 className="section-title" style={{ fontSize: '24px' }}>Installed Add-ons</h4>
                                        <div className="addon-list">
                                            {installedAddons.map((record) => {
                                                const addon = record.manifest;
                                                return (
                                                    <div key={addon.id} className="addon-item">
                                                        <div className="addon-item-meta">
                                                        <div className="addon-item-title-row">
                                                            <h4 className="addon-item-name">{addon.name}</h4>
                                                            <span className="version-badge">v{addon.version}</span>
                                                            <span className="version-badge">{record.installState}</span>
                                                        </div>
                                                            <p className="engine-note id-note" style={{ marginTop: '6px' }}>ID: {addon.id}</p>
                                                        <p className="engine-note">Capabilities: {addon.capabilities?.length ? addon.capabilities.join(', ') : 'None'}</p>
                                                        <p className="engine-note">Publisher: {addon.publisher}</p>
                                                        <p className="engine-note">Health: {addonHealthStatus[addon.id] ?? 'Not checked yet'}</p>
                                                        {record.lastError && <p className="message-error" style={{ marginTop: '8px' }}>{record.lastError}</p>}
                                                    </div>
                                                    <div className="addon-item-actions">
                                                        <button
                                                            className="btn-secondary-subtle"
                                                            onClick={() => { void handleHealthCheckByAddon(addon.id, addon.name); }}
                                                            disabled={addonBusy}
                                                        >
                                                            Health
                                                        </button>
                                                        <button className="btn-secondary-subtle" onClick={() => { void handleUpdateAddon(addon.id, record.manifestUrl); }} disabled={addonBusy || !record.manifestUrl}>
                                                            {updatingId === addon.id ? (
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span className="spinner-small" /> Updating...</span>
                                                            ) : 'Update'}
                                                        </button>
                                                            <button className="btn-danger-subtle addon-remove-btn" onClick={() => setAddonToRemove({ id: addon.id, name: addon.name })} disabled={addonBusy}>Remove</button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </>
                                )}
                            </section>

                            <section className="settings-section" style={{ marginTop: '32px' }}>
                                <h3 className="section-title">Stremio HTTP Add-ons</h3>
                                <div className="settings-card">
                                    <p className="engine-note" style={{ marginBottom: '16px' }}>
                                        Separate from Binary Add-ons. This section installs and queries remote HTTP addons that follow the Stremio protocol.
                                    </p>

                                    <h4 className="section-title" style={{ fontSize: '20px', marginBottom: '10px' }}>Stremio Community Add-ons</h4>
                                    <div className="addon-list" style={{ marginBottom: '16px' }}>
                                        {stremioCatalog.map((entry) => {
                                            const installed = stremioInstalled.some((a) => a.id === entry.id);
                                            return (
                                                <div key={entry.id} className="addon-item">
                                                    <div className="addon-item-meta">
                                                        <h4 className="addon-item-name" style={{ fontSize: '16px', marginBottom: '6px' }}>{entry.name}</h4>
                                                        <p className="engine-note">{entry.description}</p>
                                                    </div>
                                                    <div className="addon-item-actions">
                                                        <button
                                                            className="btn-secondary-subtle"
                                                            onClick={() => { void handleInstallStremioAddon(entry.manifestUrl); }}
                                                            disabled={stremioBusy || installed}
                                                        >
                                                            {installed ? 'Installed' : 'Install'}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <h4 className="section-title" style={{ fontSize: '20px', marginBottom: '10px' }}>Install via URL</h4>
                                    <div style={{ display: 'grid', gap: '10px', marginBottom: '16px' }}>
                                        <input
                                            className="input-field"
                                            placeholder="Stremio manifest URL (https://.../manifest.json)"
                                            value={stremioInstallUrl}
                                            onChange={(e) => setStremioInstallUrl(e.target.value)}
                                        />
                                        <button
                                            className="btn-secondary-subtle"
                                            onClick={() => { void handleInstallStremioAddon(stremioInstallUrl); }}
                                            disabled={stremioBusy || !stremioInstallUrl.trim()}
                                        >
                                            Install Stremio Add-on
                                        </button>
                                    </div>

                                    <h4 className="section-title" style={{ fontSize: '20px', marginBottom: '10px' }}>Installed Stremio Add-ons</h4>
                                    <div className="addon-list" style={{ marginBottom: '16px' }}>
                                        {stremioInstalled.length === 0 && <p className="engine-note">No Stremio addons installed yet.</p>}
                                        {stremioInstalled.map((addon) => (
                                            <div key={addon.id} className={`addon-item ${addon.enabled ? 'addon-item-active' : ''}`}>
                                                <div className="addon-item-meta">
                                                    <div className="addon-item-title-row">
                                                        <h4 className="addon-item-name">{addon.manifest.name}</h4>
                                                        <span className="version-badge">v{addon.manifest.version}</span>
                                                        <span className="version-badge">{addon.enabled ? 'enabled' : 'disabled'}</span>
                                                    </div>
                                                    <p className="engine-note">ID: {addon.id}</p>
                                                    <p className="engine-note">Base URL: {addon.baseUrl}</p>
                                                </div>
                                                <div className="addon-item-actions">
                                                    <button
                                                        className="btn-secondary-subtle"
                                                        onClick={() => { void handleStremioHealthCheck(addon.id); }}
                                                        disabled={stremioBusy || stremioHealthCheckingId === addon.id}
                                                    >
                                                        {stremioHealthCheckingId === addon.id ? (
                                                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <span className="spinner-small" /> Checking...
                                                            </span>
                                                        ) : (stremioHealthStatus[addon.id] ?? 'Health')}
                                                    </button>
                                                    <button
                                                        className="btn-secondary-subtle"
                                                        onClick={() => { void handleToggleStremioAddon(addon.id, !addon.enabled); }}
                                                        disabled={stremioBusy}
                                                    >
                                                        {addon.enabled ? 'Disable' : 'Enable'}
                                                    </button>
                                                    <button
                                                        className="btn-danger-subtle addon-remove-btn"
                                                        onClick={() => { void handleRemoveStremioAddon(addon.id); }}
                                                        disabled={stremioBusy}
                                                    >
                                                        Remove
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {stremioMsg && <p className="message-success">{stremioMsg}</p>}
                                    {stremioErr && <p className="message-error">{stremioErr}</p>}
                                </div>
                            </section>
                        </div>
                    )}

                    {/* SYSTEM TAB */}
                    {activeTab === 'system' && (
                        <div className="settings-tab-pane fade-in">
                            <section className="settings-section">
                                <h3 className="section-title">Cache Cleanup</h3>
                                <div className="settings-card">
                                    {cacheStats ? (
                                        <div className="cache-stats-row">
                                            <span className="cache-stat-label">Cached Stream Links</span>
                                            <span className="cache-stat-value">{cacheStats.count}</span>
                                        </div>
                                    ) : (
                                        <p className="engine-note">No cached stream links.</p>
                                    )}
                                    {cacheClearMsg && <p className="message-success" style={{ margin: '14px 0' }}>{cacheClearMsg}</p>}
                                    
                                    <p className="engine-note" style={{ marginBottom: '16px', marginTop: '12px' }}>
                                        Clearing cache removes stored HLS proxy chunks, stream manifests, and resolved links. TMDB images (posters) remain untouched to save bandwidth.
                                    </p>
                                    <button className="btn-danger-subtle" onClick={handleClearCache} disabled={isClearingCache}>
                                        {isClearingCache ? 'Clearing...' : 'Clear Core System Caches'}
                                    </button>
                                </div>
                            </section>

                            <section className="settings-section" style={{ marginTop: '32px' }}>
                                <h3 className="section-title">Advanced Debugging</h3>
                                <div className="settings-card">
                                    <p className="engine-note" style={{ marginBottom: '16px' }}>Player and stream pipeline fetch failures are logged here.</p>

                                    <div className="error-logs-container">
                                        {errorLogs.length === 0 && <div className="empty-logs" style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', fontStyle: 'italic' }}>No advanced logs yet.</div>}
                                        {errorLogs.map((log, idx) => (
                                            <div key={idx} className="error-log-entry">
                                                <div className="log-header">
                                                    <span>[{log.engine}] {log.code ? `(${log.code})` : ''}</span>
                                                    <span>{new Date(log.timestamp).toLocaleString()}</span>
                                                </div>
                                                <div className="log-media">Media: {log.media}</div>
                                                <div className="log-message">Details: {log.message}</div>
                                            </div>
                                        ))}
                                    </div>
                                    <button className="btn-secondary-subtle" onClick={clearErrorLogs} style={{ width: '100%', marginTop: '14px' }}>Clear Error Logs</button>
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === 'about' && (
                        <div className="settings-tab-pane fade-in">
                            <div className="section-header" style={{ marginBottom: '32px' }}>
                                <h2 className="section-title">About Delulu</h2>
                                <p className="engine-note">Version 1.0.0 (Tauri Core)</p>
                            </div>

                            <div className="settings-card" style={{ padding: '48px', display: 'flex', flexDirection: 'column', gap: '40px' }}>
                                
                                {/* Brand Block */}
                                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '32px' }}>
                                    <div>
                                        <h1 style={{ fontFamily: '"Cormorant Garamond", serif', fontSize: '64px', fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 4px 0', color: '#E11D2E', lineHeight: '1' }}>Delulu</h1>
                                        <p style={{ fontSize: '15px', color: 'rgba(255,255,255,0.6)', margin: 0, letterSpacing: '0.01em' }}>Your modern cinematic media center</p>
                                    </div>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <a href="https://github.com/ZacKXSnydeR/Delulu-Stream" target="_blank" rel="noopener noreferrer" onClick={() => playSound('/sounds/rizz.mp3')} className="btn-secondary-subtle" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '8px', textDecoration: 'none', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}>
                                            <Star size={16} style={{ color: '#FBBF24', fill: '#FBBF24' }} />
                                            <span style={{ fontWeight: 500 }}>Star on GitHub</span>
                                        </a>
                                    </div>
                                </div>

                                {/* Support Grid */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '24px' }}>
                                    <div style={{ padding: '24px', background: 'rgba(0,0,0,0.2)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.03)' }}>
                                        <Popcorn size={24} style={{ marginBottom: '16px', color: 'rgba(255,255,255,0.7)' }} />
                                        <h4 style={{ fontSize: '16px', color: '#fff', marginBottom: '8px', fontWeight: 500 }}>Fuel the Development</h4>
                                        <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', lineHeight: '1.5', marginBottom: '24px' }}>Supporting the project helps maintain infrastructure and deliver frequent architectural updates.</p>
                                        <button className="btn-secondary-subtle" onClick={(e) => { e.preventDefault(); playSound('/sounds/oi-oi-oe-oi-a-eye-eye.mp3'); }} style={{ width: '100%', justifyContent: 'center' }}>Buy a Popcorn</button>
                                    </div>

                                    <div style={{ padding: '24px', background: 'rgba(0,0,0,0.2)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.03)' }}>
                                        <HeartHandshake size={24} style={{ marginBottom: '16px', color: 'rgba(255,255,255,0.7)' }} />
                                        <h4 style={{ fontSize: '16px', color: '#fff', marginBottom: '8px', fontWeight: 500 }}>Community Backing</h4>
                                        <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', lineHeight: '1.5', marginBottom: '24px' }}>Join the community effort to ensure Delulu remains completely ad-free, secure, and open-source.</p>
                                        <button className="btn-secondary-subtle" onClick={(e) => { e.preventDefault(); playSound('/sounds/faah.mp3'); }} style={{ width: '100%', justifyContent: 'center' }}>Support Delulu</button>
                                    </div>
                                </div>

                                {/* Legal & Credits Footnote */}
                                <div style={{ paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', lineHeight: '1.6', margin: 0, maxWidth: '800px' }}>
                                        Delulu is a neutral media player and cataloging tool. It does not host, provide, or stream any media content natively. All movie and show metadata is provided by TMDb. Any streaming capabilities are entirely dependent on user-installed, third-party community add-ons. Delulu developers have no affiliation with or control over the content provided by these external add-ons. Delulu does not collect telemetry; all data remains strictly local to your device.
                                    </p>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                                        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>© {new Date().getFullYear()} ZacKXSnydeR</p>
                                        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
                                            Crafted by TenZ <Heart size={10} style={{ color: 'rgba(255,255,255,0.5)', display: 'inline', margin: '0 2px', verticalAlign: 'middle' }} />
                                        </p>
                                    </div>
                                </div>

                            </div>
                        </div>
                    )}
                </main>
            </div>

            {/* Removal Warning Modal */}
            {addonToRemove && (
                <div className="settings-modal-overlay">
                    <div className="settings-modal-content">
                        <h3 className="settings-modal-title">Remove Add-on?</h3>
                        <p className="settings-modal-warning">
                            You are about to remove <strong>{addonToRemove.name}</strong>.
                        </p>
                        <p className="settings-modal-desc">
                            Removing this add-on may result in the loss of streaming capabilities, missing subtitle tracks, and broken playback for content relying on it. 
                            Are you sure you wish to proceed?
                        </p>
                        <div className="settings-modal-actions">
                            <button className="btn-secondary-subtle" onClick={() => setAddonToRemove(null)}>Cancel</button>
                            <button className="btn-primary" style={{ backgroundColor: '#E11D2E', color: '#fff', borderColor: '#E11D2E' }} onClick={() => { void executeRemoveAddon(); }}>Yes, Remove</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

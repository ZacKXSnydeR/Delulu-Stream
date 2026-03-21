import { useState, useEffect } from 'react';
import { getCacheStats } from '../services/streamCache';
import { clearAllNonPosterCaches } from '../services/cacheManager';
import { getAdvancedErrorLogs, clearAdvancedErrorLogs, type AdvancedErrorLogEntry } from '../services/advancedLogs';
import { useUserProfile } from '../context/UserProfileContext';
import Silk from '../components/background/Silk';
import './Settings.css';

export function Settings() {

    // Profile context
    const { profile, updateProfile } = useUserProfile();

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
        loadCacheStats();
        loadErrorLogs();
    }, []);

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


    return (
        <div className="control-center">
            {/* 3D Silk Background */}
            <Silk
                speed={3}
                scale={1.2}
                color="#1a1a2e"
                noiseIntensity={1.2}
                rotation={0}
            />

            <div className="control-center-container">
                <header className="control-header">
                    <h1 className="control-center-title">Control Center</h1>
                    <p className="control-center-subtitle">Manage your local profile, streaming system, and preferences</p>
                </header>

                <div className="control-grid">
                    {/* Left Column - Profile */}
                    <div className="control-column">
                        <section className="control-section">
                            <h2 className="section-title">Profile Identity</h2>

                            <div className="control-card">
                                {isEditingProfile ? (
                                    <div className="profile-editor-form">
                                        <input
                                            type="text"
                                            className="input-field"
                                            placeholder="Display Name"
                                            value={editName}
                                            onChange={(e) => setEditName(e.target.value)}
                                            maxLength={30}
                                        />
                                        <div className="avatar-upload-container" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                                            <div className="profile-avatar-ring" style={{ flexShrink: 0 }}>
                                                <div className="profile-avatar" style={{ width: '48px', height: '48px' }}>
                                                    {editAvatar ? (
                                                        <img src={editAvatar} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    ) : (
                                                        <span style={{ fontSize: '20px' }}>{editName ? editName.charAt(0).toUpperCase() : 'L'}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <input
                                                type="file"
                                                accept="image/*"
                                                onChange={handleImageUpload}
                                                style={{ display: 'none' }}
                                                id="avatar-upload"
                                            />
                                            <label htmlFor="avatar-upload" className="btn-secondary-subtle" style={{ cursor: 'pointer', flex: 1, textAlign: 'center' }}>
                                                Choose Photo
                                            </label>
                                        </div>
                                        <div className="profile-editor-actions" style={{ gap: '12px' }}>
                                            <button
                                                className="btn-primary"
                                                onClick={saveProfile}
                                                style={{ flex: 1 }}
                                            >
                                                Save
                                            </button>
                                            <button
                                                className="btn-secondary-subtle"
                                                onClick={() => setIsEditingProfile(false)}
                                                style={{ flex: 1 }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="profile-header">
                                            <div className="profile-avatar-ring">
                                                <div className="profile-avatar">
                                                    {profile.avatarUrl ? (
                                                        <img src={profile.avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    ) : (
                                                        <span>{profile.name.charAt(0).toUpperCase()}</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="profile-info">
                                                <h3 className="profile-name">{profile.name}</h3>
                                            </div>
                                        </div>
                                        <p className="profile-trust">Your watch history and favorites are saved securely on this desktop.</p>
                                        <button
                                            className="btn-secondary-subtle"
                                            onClick={startEditingProfile}
                                            style={{ width: '100%' }}
                                        >
                                            Edit Profile
                                        </button>
                                    </>
                                )}
                            </div>
                            <div className="control-card profile-disclaimer" style={{ marginTop: '24px', fontSize: '14px', color: 'rgba(255, 255, 255, 0.7)', lineHeight: '1.6', textAlign: 'center', padding: '24px' }}>
                                Delulu streams from external providers and does not host any content itself. Movie and show data is provided by TMDb.<br /><br />
                                Because Delulu relies on external providers, any unavailable content or missing movies/shows are purely a provider-side issue.<br /><br />
                                Delulu does not collect or access any user data. Everything remains secure and local on your device.
                            </div>
                        </section>
                    </div>

                    {/* Right Column - Settings */}
                    <div className="control-column">
                        {/* Streaming Engine */}
                        <section className="control-section">
                            <h2 className="section-title">Streaming Engine</h2>
                            <div className="control-card">
                                <div className="engine-godseye">
                                    <pre className="godseye-ascii">
                                        {`  _____           _   _         ______          
 / ____|         | | ( )       |  ____|         
| |  __  ___   __| | |/ ___    | |__  _   _  ___
| | |_ |/ _ \\ / _\` |   / __|   |  __|| | | |/ _ \\
| |__| | (_) | (_| |   \\__ \\   | |___| |_| |  __/
 \\_____|\\___/ \\__,_|   |___/   |______\\__, |\\___|
                                        __/ |    
                                       |___/     `}
                                    </pre>
                                </div>
                                <p className="engine-note">God's Eye is active and optimized automatically for best performance.</p>
                            </div>
                        </section>

                        {/* Stream Cache */}
                        <section className="control-section">
                            <h2 className="section-title">Cache Cleanup</h2>
                            <div className="control-card">
                                {cacheStats ? (
                                    <div className="cache-stats">
                                        <div className="cache-stat-row">
                                            <span className="cache-stat-label">Cached Stream Links</span>
                                            <span className="cache-stat-value">{cacheStats.count}</span>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="engine-note">No cached stream links.</p>
                                )}
                                {cacheClearMsg && <p className="cache-clear-msg">{cacheClearMsg}</p>}
                                <button
                                    className="btn-danger-subtle"
                                    onClick={handleClearCache}
                                    disabled={isClearingCache}
                                >
                                    {isClearingCache ? 'Clearing...' : 'Clear All Caches (Except Posters)'}
                                </button>
                                <p className="engine-note">Clears stream cache, HLS proxy cache, TMDB response cache, and cache-like local preferences. TMDB poster/image cache is kept.</p>
                            </div>
                        </section>

                        {/* Advanced Logging */}
                        <section className="control-section">
                            <h2 className="section-title">Advanced Debugging</h2>
                            <div className="control-card">
                                <p className="engine-note" style={{ marginBottom: '16px' }}>
                                    Player and stream pipeline debug failures are logged here.
                                </p>

                                <div className="error-logs-container" style={{
                                    maxHeight: '300px',
                                    overflowY: 'auto',
                                    background: 'rgba(0, 0, 0, 0.4)',
                                    borderRadius: '8px',
                                    padding: '12px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '12px',
                                    marginBottom: '16px',
                                    fontFamily: 'monospace',
                                    fontSize: '11px'
                                }}>
                                    {errorLogs.length === 0 && (
                                        <div style={{ color: '#9b9b9b' }}>No advanced logs yet.</div>
                                    )}

                                    {errorLogs.map((log, idx) => (
                                        <div key={idx} style={{
                                            borderBottom: idx === errorLogs.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.1)',
                                            paddingBottom: idx === errorLogs.length - 1 ? 0 : '12px'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888', marginBottom: '4px' }}>
                                                <span>[{log.engine}] {log.code ? `(${log.code})` : ''}</span>
                                                <span>{new Date(log.timestamp).toLocaleString()}</span>
                                            </div>
                                            <div style={{ color: '#00e5ff', marginBottom: '4px' }}>Media: {log.media}</div>
                                            <div style={{ color: '#ff4d4d', wordBreak: 'break-all' }}>Details: {log.message}</div>
                                        </div>
                                    ))}
                                </div>

                                <button
                                    className="btn-secondary-subtle"
                                    onClick={clearErrorLogs}
                                    style={{ width: '100%', fontSize: '13px', padding: '10px' }}
                                >
                                    Clear Error Logs
                                </button>
                            </div>
                        </section>

                    </div>
                </div>
            </div>
        </div>
    );
}

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { type TMDBSeason, type TMDBContentDetails, type TMDBTVShowDetails, getSeasonDetails, type TMDBEpisode, getStillUrl, getPosterUrl, getBackdropUrl } from '../../services/tmdb';
import { usePlayer } from '../../context/PlayerContext';
import { SeasonDropdown } from './SeasonDropdown';
import { WatchlistButton } from './WatchlistButton';
import { FavoritesButton } from './FavoritesButton';
import './TorrentDetailsUI.css';

interface TorrentDetailsUIProps {
    details: TMDBContentDetails | TMDBTVShowDetails;
    mediaType: string;
    seasons?: TMDBSeason[];
    onClose: () => void;
}

interface TorrentResult {
    id: string;
    typeBadge: string;
    addonName: string;
    resolution: string;
    videoInfo: string;
    seeders: number;
    size: string;
    provider: string;
    seasonPack: string;
}

export const TorrentDetailsUI: React.FC<TorrentDetailsUIProps> = ({
    details,
    mediaType,
    seasons,
    onClose
}) => {
    const title = details.title || (details as any).name || 'Unknown';
    const year = (details.release_date || (details as any).first_air_date || '').substring(0, 4);
    const posterUrl = details.poster_path ? getPosterUrl(details.poster_path, 'large') : '';
    const backdropUrl = details.backdrop_path ? getBackdropUrl(details.backdrop_path, 'original') : posterUrl;
    
    const validSeasons = (seasons || []).filter(s => s.episode_count > 0).sort((a, b) => a.season_number - b.season_number);
    const defaultSeason = validSeasons.find((s) => s.season_number > 0) || validSeasons[0];
    
    const [selectedSeason, setSelectedSeason] = useState<number>(defaultSeason?.season_number || 1);
    const [selectedEpisode, setSelectedEpisode] = useState<number | 'all'>(1);
    const [episodes, setEpisodes] = useState<TMDBEpisode[]>([]);
    const episodeGridRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (mediaType === 'tv' && selectedSeason !== undefined) {
            getSeasonDetails(details.id, selectedSeason)
                .then(data => setEpisodes(data.episodes))
                .catch(console.error);
        }
    }, [selectedSeason, details.id, mediaType]);

    // Mock Torrents matching the exact screenshot design
    const [results] = useState<TorrentResult[]>([
        { id: '1', typeBadge: 'Torrent', addonName: 'Comet', resolution: '2160p', videoInfo: 'HEVC | Dolby Digital Plus | WEB-DL', seeders: 105, size: '4.5 GB', provider: 'The PirateBay', seasonPack: 'null' },
        { id: '2', typeBadge: 'Torrent', addonName: 'Torrentio', resolution: '2160p', videoInfo: 'HEVC | Dolby Digital Plus | WEB-DL', seeders: 205, size: '9.5 GB', provider: 'The PirateBay', seasonPack: 'null' },
        { id: '3', typeBadge: 'Torrent', addonName: 'MediaFlow', resolution: '2160p', videoInfo: 'HEVC | Dolby Digital Plus | WEB-DL', seeders: 105, size: '45 GB', provider: 'The PirateBay', seasonPack: 'S3' },
        { id: '4', typeBadge: 'Torrent', addonName: 'Comet', resolution: '2160p', videoInfo: 'HEVC | Dolby Digital Plus | WEB-DL', seeders: 1053, size: '2 GB', provider: 'YTS', seasonPack: 'null' },
        { id: '5', typeBadge: 'Torrent', addonName: 'Comet', resolution: '2160p', videoInfo: 'HEVC | Dolby Digital Plus | WEB-DL', seeders: 312, size: '120 GB', provider: 'RARBG', seasonPack: 'S1-S3' },
        { id: '6', typeBadge: 'Torrent', addonName: 'Torrentio', resolution: '1080p', videoInfo: 'x264 | AAC | WEB-DL', seeders: 892, size: '1.8 GB', provider: '1337x', seasonPack: 'null' },
        { id: '7', typeBadge: 'Torrent', addonName: 'Comet', resolution: '720p', videoInfo: 'x264 | AAC | WEB-DL', seeders: 2104, size: '820 MB', provider: 'EZTV', seasonPack: 'null' },
    ]);

    const { playMedia } = usePlayer();

    const handlePlayStream = (torrent: TorrentResult) => {
         playMedia({
            mediaType: mediaType as 'movie' | 'tv',
            tmdbId: details.id,
            title: mediaType === 'tv' 
                ? `${title} - S${selectedSeason}E${selectedEpisode} [${torrent.resolution}]`
                : `${title} [${torrent.resolution}]`,
            posterPath: details.poster_path || '',
            season: mediaType === 'tv' ? selectedSeason : undefined,
            episode: mediaType === 'tv' && selectedEpisode !== 'all' ? selectedEpisode : undefined,
         });
    };

    const handleEpisodeGridWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        const grid = episodeGridRef.current;

        if (!grid || grid.scrollWidth <= grid.clientWidth) {
            return;
        }

        const dominantDelta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        if (dominantDelta === 0) {
            return;
        }

        event.preventDefault();
        grid.scrollLeft += dominantDelta;
    };

    return (
        <motion.div 
            className="d-wrapper"
            initial={{ opacity: 0, scale: 0.99 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.1, ease: "circOut" }}
        >
            <div className="d-backdrop" style={{ backgroundImage: `url(${backdropUrl})` }}></div>
            <div className="d-backdrop-gradient"></div>

            <button className="d-back-btn" onClick={onClose} onPointerDown={onClose}>
                <svg viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            </button>

            <div className="d-page">
                {/* ── LEFT: POSTER ── */}
                <div className="d-poster-col">
                    <div className="d-poster-wrap">
                        {posterUrl && <img src={posterUrl} alt={`${title} poster`} />}
                        <div className="d-poster-bar"></div>
                    </div>
                </div>

                {/* ── CENTER: INFO ── */}
                <div className="d-info-col">
                    <div className="d-info-meta">
                        <div className="d-eyebrow">{mediaType === 'tv' ? 'TV Series' : 'Movie'}</div>
                        <h1 className="d-title">{title}</h1>
                        {details.tagline && <p className="d-tagline">"{details.tagline}"</p>}

                        <div className="d-meta-row">
                            <span className="d-meta-star">★</span>
                            <span className="d-meta-val">{details.vote_average.toFixed(1)}</span>
                            <span className="d-meta-dot"></span>
                            <span className="d-meta-txt">{year}</span>
                            {mediaType === 'tv' && (
                                <>
                                    <span className="d-meta-dot"></span>
                                    <span className="d-meta-txt">{(details as TMDBTVShowDetails).number_of_seasons} Seasons</span>
                                </>
                            )}
                            {details.genres.map(g => (
                                <React.Fragment key={g.id}>
                                    <span className="d-meta-dot"></span>
                                    <span className="d-genre-tag">{g.name}</span>
                                </React.Fragment>
                            ))}
                        </div>

                        <div className="d-divider"></div>
                        <p className="d-overview">{details.overview}</p>

                        <div className="d-actions details-actions" style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                            <button className="btn btn-ghost btn-lg" onClick={() => {
                                if ((details as any).videos?.results?.find((v: any) => v.type === "Trailer" && v.site === "YouTube")) {
                                    const t = (details as any).videos.results.find((v: any) => v.type === "Trailer" && v.site === "YouTube");
                                    const youtubeUrl = `https://www.youtube.com/watch?v=${t.key}`;
                                    window.open(youtubeUrl, '_blank');
                                }
                            }}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polygon points="5 3 19 12 5 21 5 3" />
                                </svg>
                                Trailer
                            </button>
                            <WatchlistButton 
                                id={details.id} 
                                mediaType={mediaType as 'movie' | 'tv'} 
                                title={details.title || (details as any).name || 'Unknown'} 
                                posterPath={details.poster_path} 
                            />
                            <FavoritesButton 
                                id={details.id} 
                                mediaType={mediaType as 'movie' | 'tv'} 
                                title={details.title || (details as any).name || 'Unknown'} 
                                posterPath={details.poster_path} 
                            />
                            
                            {mediaType === 'tv' && (
                                <div style={{ marginLeft: 'auto' }}>
                                    <SeasonDropdown
                                        seasons={validSeasons}
                                        selectedSeason={selectedSeason}
                                        onSeasonSelect={(seasonNum) => {
                                            setSelectedSeason(seasonNum);
                                            setSelectedEpisode(1);
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {mediaType === 'tv' && (
                        <div className="d-ep-panel" onWheel={handleEpisodeGridWheel}>
                            <div className="d-ep-section-label">Episodes</div>
                            <div
                                className="d-ep-grid"
                                ref={episodeGridRef}
                            >
                                {episodes.map(ep => (
                                    <div 
                                        key={ep.id} 
                                        className={`d-ep-card ${selectedEpisode === ep.episode_number ? 'active' : ''}`}
                                        onClick={() => setSelectedEpisode(ep.episode_number)}
                                    >
                                        <div className="d-ep-line"></div>
                                        <div className="d-ep-thumb">
                                            {ep.still_path ? (
                                                <img src={getStillUrl(ep.still_path, 'medium')} alt={`E${ep.episode_number}`} />
                                            ) : (
                                                <div style={{ width: '100%', height: '100%', background: '#0f0e0d' }} />
                                            )}
                                            <span className="d-ep-rank-bg" aria-hidden="true">{ep.episode_number}</span>
                                            <div className="d-ep-thumb-overlay"></div>
                                            <div className="d-ep-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
                                            <span className="d-ep-num">E{ep.episode_number}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── RIGHT: TORRENT PANEL ── */}
                <div className="d-torrent-col">
                    <div className="d-torrent-header">
                        <div className="d-torrent-eyebrow">TORRIX</div>
                        <div className="d-torrent-title">
                            {mediaType === 'tv' ? `Season ${selectedSeason} · Episode ${selectedEpisode}` : 'Streams'}
                        </div>
                    </div>

                    {/* Episode tabs (only visible if TV series) */}
                    {mediaType === 'tv' && (
                        <div className="d-torrent-tabs">
                            {episodes.map(ep => (
                                <div 
                                    key={ep.id}
                                    className={`d-t-tab ${selectedEpisode === ep.episode_number ? 'active' : ''}`}
                                    onClick={() => setSelectedEpisode(ep.episode_number)}
                                >
                                    E{ep.episode_number}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Torrent list */}
                    <div className="d-torrent-list">
                        {results.map((torrent) => (
                            <div key={torrent.id} className="d-torrent-item" onClick={() => handlePlayStream(torrent)}>
                                <div className="d-torrent-badges">
                                    <span className="d-badge primary">{torrent.typeBadge}</span>
                                    <span className="d-badge">{torrent.addonName}</span>
                                </div>
                                <div className="d-torrent-info">
                                    <div className="d-torrent-name">{title}</div>
                                    <div className="d-torrent-meta-row">
                                        {mediaType === 'tv' && `S${selectedSeason} E${selectedEpisode} \u00A0`}
                                        {mediaType === 'tv' && <span>·</span>}
                                        {mediaType === 'tv' && `\u00A0 SeasonPack: `}
                                        {mediaType === 'tv' && torrent.seasonPack !== 'null' ? (
                                            <span style={{ color: 'rgba(139,26,26,0.6)' }}>{torrent.seasonPack}</span>
                                        ) : mediaType === 'tv' ? (
                                            'null'
                                        ) : null}
                                    </div>
                                    <div className="d-torrent-meta-row">
                                        {torrent.videoInfo.split(' | ').map((info, idx, arr) => (
                                            <React.Fragment key={idx}>
                                                {info} {idx < arr.length - 1 && <>&nbsp;<span>|</span>&nbsp;</>}
                                            </React.Fragment>
                                        ))}
                                    </div>
                                    <div className="d-torrent-stats">
                                        <span className="d-t-seed">{torrent.seeders}</span>
                                        <span className="d-t-size">{torrent.size}</span>
                                        <span className="d-t-source">{torrent.provider}</span>
                                    </div>
                                </div>
                                <div className="d-quality"><span className="d-quality-val">{torrent.resolution}</span></div>
                            </div>
                        ))}
                    </div>

                    <div className="d-torrent-footer">
                        <span className="d-t-footer-label">Results</span>
                        <span className="d-t-footer-count">{results.length} sources found</span>
                    </div>

                </div>
            </div>
        </motion.div>
    );
};

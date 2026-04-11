import React from 'react';
import { Magnet } from 'lucide-react';

interface TorrentButtonProps {
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
    className?: string;
}

export const TorrentButton: React.FC<TorrentButtonProps> = ({ 
    onClick, 
    disabled, 
    title,
    className = ""
}) => {
    return (
        <button
            className={`btn btn-torrent btn-lg ${className}`}
            onClick={onClick}
            disabled={disabled}
            title={title}
        >
            <Magnet size={20} />
            Torrent
        </button>
    );
};

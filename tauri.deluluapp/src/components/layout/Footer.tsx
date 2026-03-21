import { useRef } from 'react';
import { Heart, Popcorn, HeartHandshake, Github } from 'lucide-react';
import './Footer.css';

export function Footer() {
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

    return (
        <footer className="footer">
            <div className="footer-content">
                {/* Brand */}
                <h2 className="footer-brand">DELULU</h2>
                <p className="footer-tagline">Your streaming destination</p>

                {/* Action Buttons */}
                <div className="footer-actions">
                    <a
                        href="#"
                        className="footer-btn"
                        onClick={(e) => {
                            e.preventDefault();
                            playSound('/sounds/oi-oi-oe-oi-a-eye-eye.mp3');
                        }}
                    >
                        <Popcorn size={16} />
                        <span>Buy Me a Popcorn</span>
                    </a>
                    <a
                        href="#"
                        className="footer-btn"
                        onClick={(e) => {
                            e.preventDefault();
                            playSound('/sounds/faah.mp3');
                        }}
                    >
                        <HeartHandshake size={16} />
                        <span>Support Delulu</span>
                    </a>
                </div>

                {/* GitHub Icon */}
                <a
                    href="https://github.com/ZacKXSnydeR"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="footer-github"
                    onClick={() => {
                        playSound('/sounds/rizz.mp3');
                    }}
                >
                    <Github size={20} />
                </a>

                {/* Copyright */}
                <div className="footer-copyright">
                    <p>© {new Date().getFullYear()} DELULU.</p>
                    <span className="footer-dot">•</span>
                    <p>Data provided by TMDB</p>
                </div>

                {/* Made with love */}
                <p className="footer-credit">
                    Made with <Heart size={14} className="footer-heart" /> by TenZ
                </p>
            </div>
        </footer>
    );
}

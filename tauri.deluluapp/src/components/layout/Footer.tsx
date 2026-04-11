import './Footer.css';

export function Footer() {
    return (
        <footer className="footer">
            <div className="footer-content">
                <div className="footer-copyright">
                    <p>© {new Date().getFullYear()} DELULU.</p>
                    <span className="footer-dot">•</span>
                    <p>Data provided by TMDB</p>
                </div>
            </div>
        </footer>
    );
}

import './Skeleton.css';

interface SkeletonProps {
    variant?: 'card' | 'text' | 'circle' | 'hero' | 'detail';
    width?: string;
    height?: string;
    className?: string;
}

export function Skeleton({ variant = 'text', width, height, className = '' }: SkeletonProps) {
    const classes = `skeleton skeleton-${variant} ${className}`;
    return <div className={classes} style={{ width, height }} />;
}

export function SkeletonCard({ count = 1 }: { count?: number }) {
    return (
        <>
            {[...Array(count)].map((_, i) => (
                <div key={i} className="skeleton-card-wrapper">
                    <div className="skeleton skeleton-card" />
                </div>
            ))}
        </>
    );
}

export function SkeletonRow() {
    return (
        <div className="skeleton-row">
            <div className="skeleton skeleton-text" style={{ width: '200px', height: '28px' }} />
            <div className="skeleton-row-items">
                <SkeletonCard count={8} />
            </div>
        </div>
    );
}

export function SkeletonHero() {
    return (
        <div className="skeleton-hero">
            <div className="skeleton-hero-content">
                <div className="skeleton skeleton-text" style={{ width: '100px', height: '24px' }} />
                <div className="skeleton skeleton-text" style={{ width: '300px', height: '60px', marginTop: '16px' }} />
                <div className="skeleton-hero-meta">
                    <div className="skeleton skeleton-text" style={{ width: '80px', height: '20px' }} />
                    <div className="skeleton skeleton-text" style={{ width: '60px', height: '20px' }} />
                    <div className="skeleton skeleton-text" style={{ width: '80px', height: '20px' }} />
                </div>
                <div className="skeleton skeleton-text" style={{ width: '100%', height: '60px', marginTop: '16px' }} />
                <div className="skeleton-hero-buttons">
                    <div className="skeleton" style={{ width: '140px', height: '48px', borderRadius: '4px' }} />
                    <div className="skeleton" style={{ width: '140px', height: '48px', borderRadius: '4px' }} />
                </div>
            </div>
        </div>
    );
}

export function SkeletonDetail() {
    return (
        <div className="skeleton-detail">
            <div className="skeleton skeleton-detail-backdrop" />
            <div className="skeleton-detail-content">
                <div className="skeleton skeleton-detail-poster" />
                <div className="skeleton-detail-info">
                    <div className="skeleton skeleton-text" style={{ width: '300px', height: '40px' }} />
                    <div className="skeleton-detail-meta">
                        <div className="skeleton skeleton-text" style={{ width: '60px', height: '20px' }} />
                        <div className="skeleton skeleton-text" style={{ width: '60px', height: '20px' }} />
                        <div className="skeleton skeleton-text" style={{ width: '80px', height: '20px' }} />
                    </div>
                    <div className="skeleton-detail-tags">
                        {[...Array(3)].map((_, i) => (
                            <div key={i} className="skeleton" style={{ width: '80px', height: '28px', borderRadius: '999px' }} />
                        ))}
                    </div>
                    <div className="skeleton skeleton-text" style={{ width: '100%', height: '100px', marginTop: '16px' }} />
                    <div className="skeleton-detail-buttons">
                        <div className="skeleton" style={{ width: '120px', height: '44px', borderRadius: '4px' }} />
                        <div className="skeleton" style={{ width: '100px', height: '44px', borderRadius: '4px' }} />
                        <div className="skeleton" style={{ width: '100px', height: '44px', borderRadius: '4px' }} />
                    </div>
                </div>
            </div>
        </div>
    );
}

export function SkeletonCast({ count = 8 }: { count?: number }) {
    return (
        <div className="skeleton-cast">
            <div className="skeleton skeleton-text" style={{ width: '60px', height: '24px' }} />
            <div className="skeleton-cast-items">
                {[...Array(count)].map((_, i) => (
                    <div key={i} className="skeleton-cast-item">
                        <div className="skeleton skeleton-circle" style={{ width: '60px', height: '60px' }} />
                    </div>
                ))}
            </div>
        </div>
    );
}

export function SkeletonGrid({ count = 20 }: { count?: number }) {
    return (
        <div className="skeleton-grid">
            <div className="skeleton-grid-header">
                <div className="skeleton skeleton-text" style={{ width: '200px', height: '32px' }} />
                <div className="skeleton skeleton-text" style={{ width: '250px', height: '20px', marginTop: '8px' }} />
            </div>
            <div className="skeleton-grid-items">
                <SkeletonCard count={count} />
            </div>
        </div>
    );
}

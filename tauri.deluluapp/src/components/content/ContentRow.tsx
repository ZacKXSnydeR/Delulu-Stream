import { useRef, useState } from 'react';
import { type TMDBContent } from '../../services/tmdb';
import { ContentCard } from './ContentCard';
import './ContentRow.css';

interface ContentRowProps {
    title: string;
    items: TMDBContent[];
    icon?: string;
    isLoading?: boolean;
}

export function ContentRow({ title, items, icon, isLoading = false }: ContentRowProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [showLeftArrow, setShowLeftArrow] = useState(false);
    const [showRightArrow, setShowRightArrow] = useState(true);

    const handleScroll = () => {
        if (!scrollRef.current) return;
        const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
        setShowLeftArrow(scrollLeft > 20);
        setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 20);
    };

    const scroll = (direction: 'left' | 'right') => {
        if (!scrollRef.current) return;
        const container = scrollRef.current;
        const scrollAmount = container.clientWidth * 0.8;
        const target = direction === 'left'
            ? container.scrollLeft - scrollAmount
            : container.scrollLeft + scrollAmount;
        const start = container.scrollLeft;
        const distance = target - start;
        const duration = 500;
        let startTime: number | null = null;

        const ease = (t: number) => t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;

        const step = (timestamp: number) => {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;
            const progress = Math.min(elapsed / duration, 1);
            container.scrollLeft = start + distance * ease(progress);
            if (progress < 1) requestAnimationFrame(step);
        };

        requestAnimationFrame(step);
    };

    if (isLoading) {
        return (
            <div className="content-row">
                <div className="content-row-header">
                    <h2 className="content-row-title">
                        {icon && <span className="content-row-icon">{icon}</span>}
                        {title}
                    </h2>
                </div>
                <div className="content-row-items">
                    {[...Array(8)].map((_, i) => (
                        <div key={i} className="skeleton skeleton-card content-card-medium" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="content-row">
            {/* Header with title and nav buttons */}
            <div className="content-row-header">
                <h2 className="content-row-title">
                    {icon && <span className="content-row-icon">{icon}</span>}
                    {title}
                </h2>

                {/* Navigation buttons - clean & minimal */}
                <div className="content-row-nav">
                    <button
                        className={`content-row-nav-btn ${!showLeftArrow ? 'disabled' : ''}`}
                        onClick={() => scroll('left')}
                        disabled={!showLeftArrow}
                        aria-label="Scroll left"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15 18l-6-6 6-6" />
                        </svg>
                    </button>
                    <button
                        className={`content-row-nav-btn ${!showRightArrow ? 'disabled' : ''}`}
                        onClick={() => scroll('right')}
                        disabled={!showRightArrow}
                        aria-label="Scroll right"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 18l6-6-6-6" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Content items */}
            <div
                ref={scrollRef}
                className="content-row-items"
                onScroll={handleScroll}
            >
                {items.map((item) => (
                    <ContentCard key={item.id} content={item} />
                ))}
            </div>
        </div>
    );
}

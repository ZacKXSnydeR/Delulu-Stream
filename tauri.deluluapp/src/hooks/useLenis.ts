import Lenis from 'lenis';
import { useEffect, useRef } from 'react';

// Keep a global reference to the main document Lenis
export let globalLenis: Lenis | null = null;

export function useLenis() {
    const lenisRef = useRef<Lenis | null>(null);

    useEffect(() => {
        const lenis = new Lenis({
            duration: 1.2,
            easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
            touchMultiplier: 2,
            infinite: false,
        });

        lenisRef.current = lenis;
        globalLenis = lenis;

        function raf(time: number) {
            lenis.raf(time);
            requestAnimationFrame(raf);
        }
        requestAnimationFrame(raf);

        return () => {
            lenis.destroy();
            lenisRef.current = null;
            if (globalLenis === lenis) {
                globalLenis = null;
            }
        };
    }, []);

    return lenisRef;
}

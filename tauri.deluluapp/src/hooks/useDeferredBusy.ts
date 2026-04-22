import { useState, useEffect, useRef } from 'react';

/**
 * A hook to defer a busy state. 
 * If the 'isBusy' input becomes false before 'thresholdMs', 'isDeferredBusy' never becomes true.
 * This prevents "flicker" of loaders for fast requests.
 */
export function useDeferredBusy(isBusy: boolean, thresholdMs: number = 140): boolean {
    const [isDeferredBusy, setIsDeferredBusy] = useState(false);
    const timerRef = useRef<any>(null);

    useEffect(() => {
        if (isBusy) {
            // Start a timer to show loader
            if (!timerRef.current) {
                timerRef.current = setTimeout(() => {
                    setIsDeferredBusy(true);
                }, thresholdMs);
            }
        } else {
            // Immediately stop showing loader
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            setIsDeferredBusy(false);
        }

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [isBusy, thresholdMs]);

    return isDeferredBusy;
}

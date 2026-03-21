export interface AdvancedErrorLogEntry {
    timestamp: string;
    engine: string;
    code?: string;
    message: string;
    media: string;
}

const ADVANCED_ERROR_LOGS_KEY = 'delulu_advanced_error_logs';
const MAX_ADVANCED_LOGS = 80;

export function getAdvancedErrorLogs(): AdvancedErrorLogEntry[] {
    try {
        const raw = localStorage.getItem(ADVANCED_ERROR_LOGS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed as AdvancedErrorLogEntry[];
    } catch {
        return [];
    }
}

export function appendAdvancedErrorLog(entry: Omit<AdvancedErrorLogEntry, 'timestamp'>): void {
    try {
        const next: AdvancedErrorLogEntry = {
            ...entry,
            timestamp: new Date().toISOString(),
        };
        const existing = getAdvancedErrorLogs();
        const updated = [next, ...existing].slice(0, MAX_ADVANCED_LOGS);
        localStorage.setItem(ADVANCED_ERROR_LOGS_KEY, JSON.stringify(updated));
    } catch {
        // ignore logging failures
    }
}

export function clearAdvancedErrorLogs(): void {
    localStorage.removeItem(ADVANCED_ERROR_LOGS_KEY);
}

import { resolveResource } from '@tauri-apps/api/path';

export const RESOURCES = {
    BYPASS_SCRIPT: "bypass/bypass.js",
};

/**
 * Single centralized path resolver for all Delulu resources.
 * Ensures the app resolves to the exact absolute path inside the bundled application regardless of OS.
 * @param resourcePath the relative resource string (e.g. RESOURCES.BYPASS_SCRIPT)
 */
export async function getResourcePath(resourcePath: string): Promise<string> {
    try {
        return await resolveResource(resourcePath);
    } catch (err) {
        console.error(`[PathResolver] Failed to resolve resource path: ${resourcePath}`, err);
        throw err;
    }
}

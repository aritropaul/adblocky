/**
 * JSON response ad property pruning.
 *
 * Inspired by uBlock Origin's json-prune / json-prune-fetch-response scriptlets.
 * Generalizes YouTube's stripAdConfig pattern.
 */

import type { ResponseInterceptor } from "./fetch-proxy";

export interface JSONPruneOptions {
  /** Top-level keys to delete */
  pruneKeys: string[];
  /** Nested dot-separated paths to prune (e.g., "playerResponse.adPlacements") */
  prunePaths?: string[];
  /** Delete matching keys wherever found in the object tree */
  recursive?: boolean;
}

/**
 * Prune keys/paths from a parsed JSON object. Mutates and returns the object.
 */
export function pruneJSON(obj: any, options: JSONPruneOptions): any {
  if (!obj || typeof obj !== "object") return obj;

  const { pruneKeys, prunePaths = [], recursive = false } = options;

  // Delete top-level keys
  for (const key of pruneKeys) {
    if (key in obj) {
      delete obj[key];
    }
  }

  // Delete nested paths
  for (const path of prunePaths) {
    deletePath(obj, path.split("."));
  }

  // Recursive deletion
  if (recursive) {
    pruneRecursive(obj, new Set(pruneKeys));
  }

  return obj;
}

function deletePath(obj: any, parts: string[]): void {
  if (!obj || typeof obj !== "object") return;

  if (parts.length === 1) {
    delete obj[parts[0]];
    return;
  }

  const [head, ...rest] = parts;
  if (head in obj) {
    deletePath(obj[head], rest);
  }
}

function pruneRecursive(obj: any, keys: Set<string>): void {
  if (!obj || typeof obj !== "object") return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      pruneRecursive(item, keys);
    }
    return;
  }

  for (const key of Object.keys(obj)) {
    if (keys.has(key)) {
      delete obj[key];
    } else {
      pruneRecursive(obj[key], keys);
    }
  }
}

/**
 * Create a ResponseInterceptor that prunes JSON responses.
 * Register with addFetchInterceptor().
 */
export function createJSONInterceptor(
  urlFilter: (url: string) => boolean,
  options: JSONPruneOptions,
): ResponseInterceptor {
  return async (url, response) => {
    if (!urlFilter(url)) return null;

    try {
      const json = await response.clone().json();
      const pruned = pruneJSON(json, options);

      return new Response(JSON.stringify(pruned), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return null;
    }
  };
}

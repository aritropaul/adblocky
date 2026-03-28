/**
 * HLS M3U8 manifest ad segment stripping.
 *
 * Inspired by uBlock Origin's m3u-prune scriptlet. Consolidates identical
 * stripping logic from Twitch, Paramount+, Pluto TV, Roku, and Tubi.
 */

import type { ResponseInterceptor } from "./fetch-proxy";

export interface M3UPruneOptions {
  /** Strip SCTE-35 CUE-OUT/IN blocks and DATERANGE tags (default: true) */
  stripSCTE35?: boolean;
  /** Additional tag patterns that mark ad segments (e.g., 'stitched-ad') */
  adTagPatterns?: string[];
  /** URL path patterns for ad segments to remove (e.g., '_ad/') */
  adSegmentPatterns?: string[];
  /** Replace ad segment URLs with last known content segment (Twitch behavior) */
  replaceWithLastContent?: boolean;
  /** Custom regex for multiline pruning (uBO regex mode) */
  pruneRegex?: RegExp;
}

/**
 * Prune ad segments from an M3U8 playlist.
 *
 * Handles:
 * - SCTE-35 markers: EXT-X-CUE-OUT through EXT-X-CUE-IN
 * - DATERANGE tags with SCTE35/CUE attributes
 * - Platform-specific ad tag patterns
 * - Ad segment URL patterns
 * - Twitch-style segment replacement
 */
export function pruneM3U(playlist: string, options: M3UPruneOptions = {}): string {
  const {
    stripSCTE35 = true,
    adTagPatterns = [],
    adSegmentPatterns = [],
    replaceWithLastContent = false,
    pruneRegex,
  } = options;

  // Regex mode: apply regex against entire text first
  if (pruneRegex) {
    playlist = playlist.replace(pruneRegex, "");
  }

  const lines = playlist.split("\n");
  const output: string[] = [];
  let inAd = false;
  let lastContentSegment = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for ad tag patterns (Twitch: stitched-ad, X-TV-TWITCH-AD)
    if (adTagPatterns.length > 0) {
      const isAdTag = adTagPatterns.some((p) => line.includes(p));

      // DATERANGE with ad pattern marks ad segment start
      if (line.includes("EXT-X-DATERANGE") && isAdTag) {
        inAd = true;
        continue;
      }

      // DATERANGE without ad pattern ends ad segment
      if (inAd && line.includes("EXT-X-DATERANGE") && !isAdTag) {
        inAd = false;
      }

      // Skip standalone ad tag lines
      if (isAdTag && !line.includes("EXT-X-DATERANGE")) {
        continue;
      }
    }

    // SCTE-35 marker handling
    if (stripSCTE35) {
      // DATERANGE tags with SCTE35/CUE markers — skip the tag line only
      // Must check before CUE-OUT since DATERANGE lines can contain "SCTE35-OUT"
      if (
        line.includes("EXT-X-DATERANGE") &&
        (line.includes("SCTE35") || line.includes("CUE"))
      ) {
        continue;
      }

      if (
        line.includes("EXT-X-CUE-OUT") ||
        line.includes("SCTE35-OUT") ||
        line.includes("EXT-OATCLS-SCTE35")
      ) {
        inAd = true;
        continue;
      }

      if (line.includes("EXT-X-CUE-IN") || line.includes("SCTE35-IN")) {
        inAd = false;
        continue;
      }
    }

    // URL pattern-based ad segment removal (Pluto: _ad/ paths)
    if (
      adSegmentPatterns.length > 0 &&
      !line.startsWith("#") &&
      line.trim()
    ) {
      if (adSegmentPatterns.some((p) => line.includes(p))) {
        continue;
      }
    }

    // Handle segment lines during ad breaks
    if (inAd) {
      if (!line.startsWith("#") && line.trim()) {
        // This is an ad segment URL
        if (replaceWithLastContent && lastContentSegment) {
          output.push(lastContentSegment);
        }
        // Skip ad segment (or replaced above)
        continue;
      }
      // Skip ad-related comment/tag lines during ad break
      continue;
    }

    // Track last content segment URL (for replacement mode)
    if (replaceWithLastContent && !line.startsWith("#") && line.trim() && line.includes("http")) {
      lastContentSegment = line.trim();
    }

    output.push(line);
  }

  return output.join("\n");
}

/**
 * Create a ResponseInterceptor that prunes M3U8 playlists.
 * Register with addFetchInterceptor().
 */
export function createM3UInterceptor(
  urlFilter: (url: string) => boolean,
  options?: M3UPruneOptions,
): ResponseInterceptor {
  return async (url, response) => {
    if (!urlFilter(url)) return null;

    try {
      const text = await response.clone().text();

      // Quick check: does this look like an M3U8 with ads?
      if (!text.includes("#EXTM3U") && !text.includes("#EXTINF")) return null;

      const hasAds =
        text.includes("EXT-X-CUE") ||
        text.includes("SCTE35") ||
        text.includes("EXT-OATCLS-SCTE35") ||
        (options?.adTagPatterns?.some((p) => text.includes(p)) ?? false) ||
        (options?.adSegmentPatterns?.some((p) => text.includes(p)) ?? false);

      if (!hasAds) return null;

      const pruned = pruneM3U(text, options);
      return new Response(pruned, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return null;
    }
  };
}

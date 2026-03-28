/**
 * Ad break timeline detection and auto-skip.
 *
 * The core "detect and skip" engine. Parses manifests read-only to extract
 * ad break timing, then monitors video.currentTime and seeks past ads.
 *
 * Works in two modes:
 * 1. Active: Fetch proxy intercepts manifests and extracts timing before passing through
 * 2. Passive: PerformanceObserver detects manifest loads, fetches independently to read
 *
 * For platforms where manifest modification is unsafe (Netflix, Disney+, Amazon, Peacock),
 * this provides precise ad skipping without triggering anti-adblock detection.
 */

import type { ResponseInterceptor } from "./fetch-proxy";

export interface AdBreak {
  startTime: number;
  duration: number;
  endTime: number;
  type: "pre-roll" | "mid-roll" | "post-roll" | "unknown";
}

export interface TimelineMonitorOptions {
  /** CSS selector for the video element (default: 'video') */
  videoSelector?: string;
  /** Seek past ad break endTime (default: true) */
  seekToEnd?: boolean;
  /** Mute during ad breaks (default: true) */
  muteAds?: boolean;
  /** Unmute after ad break ends (default: true) */
  unmuteAfter?: boolean;
  /** Speed up during ads instead of seeking (e.g., 16 for Spotify-like fast-forward) */
  playbackRate?: number;
  /** DOM selectors to confirm ad is playing (secondary signal) */
  adDOMSelectors?: string[];
  /** Callback when entering an ad break */
  onAdStart?: (adBreak: AdBreak) => void;
  /** Callback when leaving an ad break */
  onAdEnd?: (adBreak: AdBreak) => void;
}

// --- Manifest Parsing (read-only, does not modify) ---

/**
 * Parse ad breaks from an HLS M3U8 playlist.
 * Extracts timing from CUE-OUT/IN markers and DATERANGE tags.
 */
export function parseHLSAdBreaks(playlist: string): AdBreak[] {
  const lines = playlist.split("\n");
  const breaks: AdBreak[] = [];
  let currentTime = 0;
  let adStartTime = -1;
  let adDuration = 0;

  for (const line of lines) {
    // Track timeline position from EXTINF durations
    if (line.startsWith("#EXTINF:")) {
      const durationStr = line.substring(8).split(",")[0];
      const segDuration = parseFloat(durationStr);
      if (!isNaN(segDuration)) {
        currentTime += segDuration;
      }
    }

    // CUE-OUT with duration: ad break start
    if (line.includes("EXT-X-CUE-OUT")) {
      adStartTime = currentTime;
      // Try to extract explicit duration
      const durMatch = line.match(/DURATION=([\d.]+)/i) || line.match(/EXT-X-CUE-OUT:([\d.]+)/);
      if (durMatch) {
        adDuration = parseFloat(durMatch[1]);
      }
    }

    // CUE-IN: ad break end
    if (line.includes("EXT-X-CUE-IN") && adStartTime >= 0) {
      const duration = adDuration > 0 ? adDuration : currentTime - adStartTime;
      breaks.push({
        startTime: adStartTime,
        duration,
        endTime: adStartTime + duration,
        type: adStartTime === 0 ? "pre-roll" : "mid-roll",
      });
      adStartTime = -1;
      adDuration = 0;
    }

    // DATERANGE with ad markers and explicit duration
    if (line.includes("EXT-X-DATERANGE")) {
      const isAd =
        line.includes("stitched-ad") ||
        line.includes("TWITCH-AD") ||
        line.includes("SCTE35-OUT") ||
        line.includes("CLASS=\"twitch-stitched-ad\"");

      if (isAd) {
        const durMatch = line.match(/DURATION=([\d.]+)/);
        if (durMatch) {
          const duration = parseFloat(durMatch[1]);
          breaks.push({
            startTime: currentTime,
            duration,
            endTime: currentTime + duration,
            type: currentTime === 0 ? "pre-roll" : "mid-roll",
          });
        }
      }
    }
  }

  // Handle unterminated ad break (CUE-OUT without CUE-IN)
  if (adStartTime >= 0 && adDuration > 0) {
    breaks.push({
      startTime: adStartTime,
      duration: adDuration,
      endTime: adStartTime + adDuration,
      type: adStartTime === 0 ? "pre-roll" : "mid-roll",
    });
  }

  return breaks;
}

/**
 * Parse ad breaks from a DASH MPD manifest.
 * Extracts timing from Period elements with ad-like IDs.
 */
export function parseDASHAdBreaks(mpdText: string): AdBreak[] {
  const breaks: AdBreak[] = [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(mpdText, "application/xml");
  if (doc.querySelector("parsererror")) return breaks;

  const periods = doc.querySelectorAll("Period");
  let cumulativeTime = 0;

  for (const period of periods) {
    const id = (period.getAttribute("id") || "").toLowerCase();
    const startAttr = period.getAttribute("start");
    const durationAttr = period.getAttribute("duration");

    // Parse ISO 8601 duration (PT30S, PT1M30S, etc.)
    const start = startAttr ? parseISO8601Duration(startAttr) : cumulativeTime;
    const duration = durationAttr ? parseISO8601Duration(durationAttr) : 0;

    // Detect ad periods by ID patterns (from uBO filter lists)
    const isAd =
      id.startsWith("ad") ||
      id.includes("-ad-") ||
      id.includes("-roll-") ||
      id.includes("_ad_") ||
      id.includes("adbreak") ||
      id.includes("commercial");

    if (isAd && duration > 0) {
      breaks.push({
        startTime: start,
        duration,
        endTime: start + duration,
        type: start === 0 ? "pre-roll" : "mid-roll",
      });
    }

    cumulativeTime = start + duration;
  }

  return breaks;
}

/** Parse ISO 8601 duration (PT30S, PT1M30S, PT1H2M3.5S) to seconds */
function parseISO8601Duration(str: string): number {
  const match = str.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
  if (!match) return 0;
  const hours = parseFloat(match[1] || "0");
  const minutes = parseFloat(match[2] || "0");
  const seconds = parseFloat(match[3] || "0");
  return hours * 3600 + minutes * 60 + seconds;
}

// --- Timeline Monitor ---

/**
 * Start monitoring video playback and auto-skipping ad breaks.
 *
 * Listens to the video element's timeupdate event (~4Hz). When currentTime
 * enters an ad break region, seeks past it and/or mutes.
 */
export function startTimelineMonitor(
  initialBreaks: AdBreak[],
  options: TimelineMonitorOptions = {},
): { stop: () => void; updateBreaks: (breaks: AdBreak[]) => void } {
  const {
    videoSelector = "video",
    seekToEnd = true,
    muteAds = true,
    unmuteAfter = true,
    playbackRate,
    adDOMSelectors,
    onAdStart,
    onAdEnd,
  } = options;

  let adBreaks = [...initialBreaks];
  let currentAdBreak: AdBreak | null = null;
  let mutedByUs = false;
  let originalPlaybackRate = 1;
  let stopped = false;
  let videoObserver: MutationObserver | null = null;

  function getVideo(): HTMLVideoElement | null {
    return document.querySelector<HTMLVideoElement>(videoSelector);
  }

  function isInAdBreak(time: number): AdBreak | null {
    for (const ab of adBreaks) {
      if (time >= ab.startTime && time < ab.endTime) {
        return ab;
      }
    }
    return null;
  }

  function isDOMConfirmingAd(): boolean {
    if (!adDOMSelectors || adDOMSelectors.length === 0) return true;
    return adDOMSelectors.some((sel) => document.querySelector(sel) !== null);
  }

  function handleTimeUpdate() {
    if (stopped) return;
    const video = getVideo();
    if (!video) return;

    const adBreak = isInAdBreak(video.currentTime);

    if (adBreak && !currentAdBreak) {
      // Entering ad break
      // Use DOM confirmation as secondary signal if available
      if (adDOMSelectors && adDOMSelectors.length > 0 && !isDOMConfirmingAd()) {
        // Manifest says ad, DOM disagrees — trust manifest but wait one more tick
        return;
      }

      currentAdBreak = adBreak;
      onAdStart?.(adBreak);

      if (seekToEnd) {
        video.currentTime = adBreak.endTime;
      } else if (playbackRate) {
        originalPlaybackRate = video.playbackRate;
        video.playbackRate = playbackRate;
      }

      if (muteAds && !video.muted) {
        video.muted = true;
        mutedByUs = true;
      }
    } else if (!adBreak && currentAdBreak) {
      // Leaving ad break
      const ended = currentAdBreak;
      currentAdBreak = null;
      onAdEnd?.(ended);

      if (playbackRate) {
        video.playbackRate = originalPlaybackRate;
      }

      if (unmuteAfter && mutedByUs) {
        video.muted = false;
        mutedByUs = false;
      }
    }
  }

  // Attach to video element, re-attach if it changes (SPA navigation)
  let currentVideo: HTMLVideoElement | null = null;

  function attachToVideo() {
    const video = getVideo();
    if (video === currentVideo) return;

    if (currentVideo) {
      currentVideo.removeEventListener("timeupdate", handleTimeUpdate);
    }

    currentVideo = video;
    if (video) {
      video.addEventListener("timeupdate", handleTimeUpdate);
    }
  }

  // Watch for video element changes
  attachToVideo();
  videoObserver = new MutationObserver(() => attachToVideo());
  videoObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Also poll as fallback (some platforms don't fire timeupdate reliably)
  const pollInterval = setInterval(() => {
    if (stopped) return;
    attachToVideo();
    handleTimeUpdate();
  }, 500);

  return {
    stop: () => {
      stopped = true;
      currentVideo?.removeEventListener("timeupdate", handleTimeUpdate);
      videoObserver?.disconnect();
      clearInterval(pollInterval);
      if (mutedByUs) {
        const video = getVideo();
        if (video) video.muted = false;
      }
    },
    updateBreaks: (breaks: AdBreak[]) => {
      adBreaks = [...breaks];
    },
  };
}

/**
 * Create a read-only ResponseInterceptor that extracts ad break timing
 * from manifests WITHOUT modifying the response.
 *
 * Use this for platforms where manifest modification is unsafe but you
 * still want timeline-based skipping.
 */
export function createTimelineExtractor(
  urlFilter: (url: string) => boolean,
  onBreaksFound: (breaks: AdBreak[], url: string) => void,
  format: "hls" | "dash" | "auto" = "auto",
): ResponseInterceptor {
  return async (url, response) => {
    if (!urlFilter(url)) return null;

    try {
      const text = await response.clone().text();
      let breaks: AdBreak[] = [];

      const isHLS = format === "hls" || (format === "auto" && (url.includes(".m3u8") || text.includes("#EXTM3U")));
      const isDASH = format === "dash" || (format === "auto" && (url.includes(".mpd") || text.includes("<MPD")));

      if (isHLS) {
        breaks = parseHLSAdBreaks(text);
      } else if (isDASH) {
        breaks = parseDASHAdBreaks(text);
      }

      if (breaks.length > 0) {
        onBreaksFound(breaks, url);
      }
    } catch {
      // Read-only — errors are fine, just skip
    }

    // Always return null — we never modify the response
    return null;
  };
}

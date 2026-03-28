/**
 * Filter list configuration — URLs and metadata for all supported lists.
 */

export interface FilterListConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  category: "core" | "privacy" | "annoyances" | "streaming" | "regional";
}

export const FILTER_LISTS: FilterListConfig[] = [
  // Core ad blocking
  {
    id: "easylist",
    name: "EasyList",
    url: "https://easylist.to/easylist/easylist.txt",
    enabled: true,
    category: "core",
  },
  // Privacy & tracking
  {
    id: "easyprivacy",
    name: "EasyPrivacy",
    url: "https://easylist.to/easylist/easyprivacy.txt",
    enabled: true,
    category: "privacy",
  },
  // uBlock Origin filters
  {
    id: "ublock",
    name: "uBlock Filters",
    url: "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt",
    enabled: true,
    category: "core",
  },
  // uBlock Origin unbreak list — fixes sites broken by EasyList/EasyPrivacy
  {
    id: "ublock_unbreak",
    name: "uBlock Filters – Unbreak",
    url: "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt",
    enabled: true,
    category: "core",
  },
  // uBlock Origin privacy filters
  {
    id: "ublock_privacy",
    name: "uBlock Filters – Privacy",
    url: "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt",
    enabled: true,
    category: "privacy",
  },
  // Peter Lowe's blocklist (hosts format)
  {
    id: "peter_lowe",
    name: "Peter Lowe's Blocklist",
    url: "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext",
    enabled: true,
    category: "core",
  },
  // Annoyances
  {
    id: "annoyances",
    name: "Fanboy's Annoyances",
    url: "https://secure.fanboy.co.nz/fanboy-annoyance.txt",
    enabled: false,
    category: "annoyances",
  },
];

/**
 * Streaming-specific ad domains and patterns.
 * These are compiled into ruleset_streaming.json.
 */
/**
 * Streaming-specific ad domains for DNR blocking.
 *
 * IMPORTANT: Most streaming services use SSAI (server-side ad insertion),
 * so network blocking is supplementary — content scripts do the real work.
 * Only include domains that are SAFE to block (won't break video playback).
 */
export const STREAMING_AD_DOMAINS = [
  // YouTube ad tracking (video ads handled by content script, not DNR)
  "www.youtube.com/api/stats/ads",
  "www.youtube.com/pagead/",
  "www.youtube.com/ptracking",
  "www.youtube.com/get_midroll_info",

  // Google ad infra (used across YouTube, Crunchyroll, etc.)
  "doubleclick.net",
  "googleadservices.com",
  "googleads.g.doubleclick.net",
  "pagead2.googlesyndication.com",
  "imasdk.googleapis.com",
  "pubads.g.doubleclick.net",

  // Spotify ad endpoints
  "spclient.wg.spotify.com/ads/",

  // Hulu ad tracking (safe to block — video served separately)
  "ads.hulu.com",
  "t2.hulu.com",
  "ads-e-darwin.hulustream.com",

  // Peacock — FreeWheel + SSAI tracking (NOT CDN shards — those break playback)
  "s.adex2.fwmrm.net",
  "video-ads-module.ad-tech.nbcuni.com",

  // Amazon ad system (safe to block — separate from video CDN)
  "aax-us-east.amazon-adsystem.com",
  "amazon-adsystem.com",

  // Roku ad tracking
  "ads.roku.com",
  "ads.api.roku.com",
  "identity.ads.roku.com",
  "roku.admeasurement.com",

  // Tubi ad tracking (NOT analytics-ingestion — that can break playback)
  "rainmaker.production-public.tubi.io",
  "rainmaker4.production-public.tubi.io",

  // NOTE: Pluto TV — do NOT block any domains, it breaks playback entirely.
  // NOTE: Netflix — ads served from same CDN as content, no safe domains to block.
  // NOTE: Disney+ — ads served from same CDN as content, no safe domains to block.
];

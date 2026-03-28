/**
 * Pluto TV content script — Paramount-owned FAST service ad handling.
 *
 * REALITY: Pluto TV uses FreeWheel/SpotX with full SSAI. Ads are stitched into
 * HLS streams using SCTE-35 markers (EXT-X-CUE-OUT/IN, EXT-OATCLS-SCTE35).
 *
 * CRITICAL: DNS/network blocking BREAKS playback entirely on Pluto TV.
 * Blocking tags.tiqcdn.com → app starts but won't play.
 * Blocking a-fds.youborafds01.com → video plays 30s then freezes.
 * (Source: hagezi/dns-blocklists#2569, AdguardFilters#182550)
 *
 * APPROACH: HLS manifest manipulation ONLY (strip SCTE-35 ad markers).
 * No network blocking. Detect ad UI and mute as fallback.
 */

import {
  installFetchProxy,
  addFetchInterceptor,
  createM3UInterceptor,
  startAdSkip,
} from "@/lib/ssai";

export default defineContentScript({
  matches: ["*://*.pluto.tv/*"],
  runAt: "document_start",
  world: "MAIN",

  main() {
    // HLS interception only — NO request blockers (breaks playback)
    installFetchProxy();

    addFetchInterceptor(
      createM3UInterceptor(
        (url) => url.includes(".m3u8"),
        {
          stripSCTE35: true,
          adTagPatterns: ["EXT-OATCLS-SCTE35"],
          adSegmentPatterns: ["_ad/"],
        },
      ),
    );

    injectAdBlockStyles();

    const ready = () => {
      startAdSkip({
        adSelectors: [
          '[class*="ad-overlay"]',
          '[class*="AdBreak"]',
          '[class*="ad-notice"]',
          '[class*="adMarker"]',
          '[class*="commercial-break"]',
        ],
        styleId: "adb-pluto",
        hideSelectors: [
          '[class*="ad-overlay"]',
          '[class*="AdBreak"]',
          '[class*="ad-notice"]',
          '[class*="adMarker"]',
          '[class*="ad-countdown"]',
          '[class*="commercial-break"]',
        ],
      });
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", ready);
    } else {
      ready();
    }
  },
});

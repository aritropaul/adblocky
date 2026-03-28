/**
 * Paramount+ content script — ad handling.
 *
 * REALITY: Paramount+ uses FreeWheel ad server with SSAI. Shares infrastructure
 * patterns with Pluto TV (same parent company). Uses HLS with SCTE-35 markers
 * and DASH with ad Periods.
 *
 * APPROACH: Block FreeWheel VAST requests, strip HLS/DASH ad markers, detect ad UI and skip.
 */

import {
  installFetchProxy,
  addRequestBlocker,
  addFetchInterceptor,
  installXHRProxy,
  addXHRBlocker,
  createM3UInterceptor,
  createXMLInterceptor,
  startAdSkip,
} from "@/lib/ssai";

const FREEWHEEL_DOMAINS = [
  "fwmrm.net",
  "freewheel.tv",
  "ads.cbsi.com",
  "ad.doubleclick.net",
];

const EMPTY_VAST = '<?xml version="1.0"?><VAST version="3.0"></VAST>';

export default defineContentScript({
  matches: ["*://*.paramountplus.com/*"],
  runAt: "document_start",
  world: "MAIN",

  main() {
    installFetchProxy();
    installXHRProxy();

    // Block FreeWheel VAST requests (fetch)
    addRequestBlocker((url) => {
      if (FREEWHEEL_DOMAINS.some((d) => url.includes(d))) {
        return new Response(EMPTY_VAST, {
          status: 200,
          headers: { "Content-Type": "application/xml" },
        });
      }
      return null;
    });

    // Block FreeWheel VAST requests (XHR)
    addXHRBlocker((url) => {
      if (FREEWHEEL_DOMAINS.some((d) => url.includes(d))) {
        return { status: 200, responseText: EMPTY_VAST, contentType: "application/xml" };
      }
      return null;
    });

    // Strip SCTE-35 ad markers from HLS manifests
    addFetchInterceptor(
      createM3UInterceptor(
        (url) => url.includes(".m3u8"),
        { stripSCTE35: true },
      ),
    );

    // Strip ad Periods from DASH manifests
    addFetchInterceptor(
      createXMLInterceptor(
        (url) => url.includes(".mpd") || url.includes("pubads.g.doubleclick.net/ondemand"),
        {
          removeSelectors: ['Period[id*="-roll-"][id*="-ad-"]'],
        },
      ),
    );

    const ready = () => {
      startAdSkip({
        adSelectors: [
          '[class*="ad-container"]',
          '[class*="AdBreak"]',
          '[class*="ad-playing"]',
          '[class*="adBreak"]',
          '[class*="ad-countdown"]',
        ],
        styleId: "adb-paramount",
        hideSelectors: [
          '[class*="ad-container"]',
          '[class*="AdBreak"]',
          '[class*="ad-overlay"]',
          '[class*="ad-playing"]',
          '[class*="adBreak"]',
          '[class*="ad-countdown"]',
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

/**
 * Tubi content script — Fox-owned free streaming ad handling.
 *
 * REALITY: Tubi uses FreeWheel/Beeswax DSP with SSAI. Ads stitched into HLS
 * streams via Akamai CDN (akamai.tubi.video). Traditional blocking is ineffective.
 *
 * KNOWN: Tubi uses `blockAdBlock` JS variable for adblock detection.
 * DO NOT block analytics-ingestion — it breaks playback.
 *
 * APPROACH: Bypass adblock detection, strip HLS ad markers, detect ad UI and skip/mute.
 */

import {
  installFetchProxy,
  addRequestBlocker,
  addFetchInterceptor,
  createM3UInterceptor,
  startAdSkip,
} from "@/lib/ssai";

const FREEWHEEL_DOMAINS = ["fwmrm.net", "freewheel.tv"];

const TUBI_TRACKING_DOMAINS = [
  "rainmaker.production-public.tubi.io",
  "rainmaker4.production-public.tubi.io",
  "user-signals.production-public.tubi.io",
];

export default defineContentScript({
  matches: ["*://*.tubitv.com/*"],
  runAt: "document_start",
  world: "MAIN",

  main() {
    bypassAdblockDetection();

    installFetchProxy();

    // Block FreeWheel VAST requests
    addRequestBlocker((url) => {
      if (FREEWHEEL_DOMAINS.some((d) => url.includes(d))) {
        return new Response(
          '<?xml version="1.0"?><VAST version="3.0"></VAST>',
          { status: 200, headers: { "Content-Type": "application/xml" } },
        );
      }
      // Block Tubi tracking endpoints (safe — tracking only)
      if (TUBI_TRACKING_DOMAINS.some((d) => url.includes(d))) {
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return null;
    });

    // Strip ad markers from HLS manifests
    addFetchInterceptor(
      createM3UInterceptor(
        (url) => url.includes(".m3u8"),
        { stripSCTE35: true },
      ),
    );

    injectAdBlockStyles();

    const ready = () => {
      startAdSkip({
        adSelectors: [
          '[class*="__ad"]',
          '[data-testid="ad-overlay"]',
          '[class*="adContainer"]',
          '[class*="ad-break"]',
          '[class*="AdLabel"]',
        ],
        styleId: "adb-tubi",
        hideSelectors: [
          '[class*="__ad"]',
          '[data-testid="ad-overlay"]',
          '[class*="adContainer"]',
          '[class*="ad-break"]',
          '[class*="AdLabel"]',
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

/**
 * Bypass Tubi's adblock detection.
 * Tubi checks the `blockAdBlock` variable and uses bait DOM elements.
 */
function bypassAdblockDetection() {
  try {
    Object.defineProperty(window, "blockAdBlock", {
      configurable: false,
      get() {
        return { check: () => false, on: () => ({}) };
      },
      set() {
        // Prevent reassignment
      },
    });
  } catch {}

  const origAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    return origAddEventListener.call(this, type, listener, options);
  };
}


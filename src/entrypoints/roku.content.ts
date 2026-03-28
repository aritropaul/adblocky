/**
 * The Roku Channel content script — Roku's free streaming ad handling.
 *
 * REALITY: Roku uses their proprietary Roku Ads Manager / Roku Ads API with
 * both SSAI and CSAI (Google IMA DAI). HLS is the primary format.
 *
 * Ad domains: ads.roku.com, ads.api.roku.com, identity.ads.roku.com,
 *   roku.admeasurement.com, ravm.tv, display.ravm.tv
 *
 * APPROACH: Block Roku ad tracking requests, strip HLS ad markers,
 * detect ad UI and skip/mute.
 */

import {
  installFetchProxy,
  addRequestBlocker,
  addFetchInterceptor,
  createM3UInterceptor,
  startAdSkip,
} from "@/lib/ssai";

const ROKU_AD_DOMAINS = [
  "ads.roku.com",
  "ads.api.roku.com",
  "identity.ads.roku.com",
  "roku.admeasurement.com",
  "ravm.tv",
  "p.ads.roku.com",
];

export default defineContentScript({
  matches: ["*://*.therokuchannel.roku.com/*", "*://therokuchannel.roku.com/*"],
  runAt: "document_start",
  world: "MAIN",

  main() {
    // Install shared fetch proxy + register blockers and interceptors
    installFetchProxy();

    addRequestBlocker((url) => {
      if (ROKU_AD_DOMAINS.some((d) => url.includes(d))) {
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return null;
    });

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
          '[class*="ad-overlay"]',
          '[class*="ad-break"]',
          '[class*="AdBreak"]',
          '[class*="ad-marker"]',
          '[class*="ad-countdown"]',
        ],
        styleId: "adb-roku",
        hideSelectors: [
          '[class*="ad-overlay"]',
          '[class*="ad-break"]',
          '[class*="AdBreak"]',
          '[class*="ad-marker"]',
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

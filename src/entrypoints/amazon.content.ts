/**
 * Amazon Prime Video / Freevee — detect ad, mute + 16x speed through.
 */

import { startAdSkip } from "@/lib/ssai";

export default defineContentScript({
  matches: [
    "*://*.amazon.com/gp/video/*",
    "*://*.amazon.com/dp/*",
    "*://*.primevideo.com/*",
  ],
  runAt: "document_idle",

  main() {
    startAdSkip({
      adSelectors: [
        ".atvwebplayersdk-ad-overlay",
        '[class*="adTimerText"]',
        '[class*="adContainerText"]',
        ".atvwebplayersdk-adtimerdisplay-text",
        '[class*="AdSlate"]',
        '[class*="adBreak"]',
        '[class*="ad-break"]',
      ],
    });
  },
});

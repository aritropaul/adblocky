/**
 * Peacock content script — detect ad, mute + 16x speed through.
 */

import { startAdSkip } from "@/lib/ssai";

export default defineContentScript({
  matches: ["*://*.peacocktv.com/*"],
  runAt: "document_idle",

  main() {
    startAdSkip({
      adSelectors: [
        '[class*="ad-indicator"]',
        '[class*="AdBreak"]',
        '[class*="ad-overlay"]',
        '[class*="AdCountdown"]',
        '[class*="ad-break"]',
        '[class*="pause-ad"]',
        '[class*="ad-progress"]',
      ],
    });
  },
});

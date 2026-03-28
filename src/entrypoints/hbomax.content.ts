/**
 * HBO Max / Max content script — ad-supported tier.
 *
 * SSAI. Real selectors from live DOM inspection (2026-03-28):
 *   [class*="AdOverlayContainer"]  — visible during ads
 */

import { startAdSkip } from "@/lib/ssai";

export default defineContentScript({
  matches: ["*://*.max.com/*", "*://play.max.com/*", "*://play.hbomax.com/*"],
  runAt: "document_idle",

  main() {
    startAdSkip({
      adSelectors: ['[class*="AdOverlayContainer"]'],
      clickSelectors: ['[data-testid="player-ux-skip-button"]'],
    });
  },
});

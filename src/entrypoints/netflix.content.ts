/**
 * Netflix content script — ad-supported tier.
 *
 * SSAI. Real selectors from live DOM inspection (2026-03-28):
 *   [data-uia="ads-info-container"]  — ad overlay
 */

import { startAdSkip } from "@/lib/ssai";

export default defineContentScript({
  matches: ["*://*.netflix.com/*"],
  runAt: "document_idle",

  main() {
    startAdSkip({
      adSelectors: ['[data-uia="ads-info-container"]'],
    });

    // Pause-screen ads
    setInterval(() => {
      const pauseAd = document.querySelector('[data-uia="pause-ad-title-display"]');
      if (pauseAd) {
        const btn = document.querySelector<HTMLElement>(
          '[data-uia="pause-ad-expand-button"], [data-uia="pause-ad-dismiss-button"]',
        );
        if (btn) btn.click();
        (pauseAd as HTMLElement).style.display = "none";
      }
    }, 500);
  },
});

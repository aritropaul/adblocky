/**
 * Peacock content script — detect ad, mute + 16x speed through.
 *
 * SSAI via FreeWheel. Real selectors from live DOM (2026-03-31):
 *   [data-testid="countdown"]  — circular countdown timer, only present during ads
 *   scrubber-bar disappears during ads (secondary signal)
 */

import { startAdSkip } from "@/lib/ssai";

export default defineContentScript({
  matches: ["*://*.peacocktv.com/*"],
  runAt: "document_idle",

  main() {
    startAdSkip({
      adSelectors: ['[data-testid="countdown"]'],
      styleId: "adb-peacock",
      hideRules: `[data-testid="countdown"] { opacity: 0 !important; }`,
    });
  },
});

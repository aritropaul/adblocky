/**
 * Hulu content script — ad handling.
 *
 * SSAI via #content-video-player. Real selectors from live DOM (2026-03-28):
 *   .AdUnitView__adBarContainer  — visible during ads
 */

import { startAdSkip } from "@/lib/ssai";

export default defineContentScript({
  matches: ["*://*.hulu.com/*"],
  runAt: "document_idle",

  main() {
    startAdSkip({
      adSelectors: ['.AdUnitView__adBarContainer'],
      clickSelectors: ['.SkipButton button'],
      styleId: "adb-hulu",
      hideRules: `.PauseAdCreative-wrap { display: none !important; }`,
    });
  },
});

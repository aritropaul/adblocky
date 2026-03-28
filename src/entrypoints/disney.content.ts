/**
 * Disney+ content script — ad-supported tier.
 *
 * Disney+ shares streaming infra with Hulu (both Disney Streaming/Bamtech).
 * Uses same AdUnitView selectors discovered on Hulu via live DOM inspection.
 * Fallback selectors for Disney-specific patterns.
 */

export default defineContentScript({
  matches: ["*://*.disneyplus.com/*"],
  runAt: "document_idle",

  main() {
    // Primary: Hulu-shared infra selectors (AdUnitView)
    // Fallback: Disney-specific patterns
    const AD_SELECTOR = '.AdUnitView__adBarContainer, [class*="ad-interstitial"], [class*="AdBreak"], [class*="bumper"]';
    const TIMER_SELECTOR = '.AdUnitView__adBar__plate';
    let inAd = false;
    let mutedByUs = false;
    let rateOverrideActive = false;

    const origDesc = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      "playbackRate",
    )!;

    function getSecondsRemaining(): number {
      const plate = document.querySelector(TIMER_SELECTOR);
      if (!plate) return 99;
      const match = plate.textContent?.match(/(\d+):(\d+)/);
      if (!match) return 99;
      return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    }

    function applyRateOverride(video: HTMLVideoElement) {
      if (rateOverrideActive) return;
      rateOverrideActive = true;
      Object.defineProperty(video, "playbackRate", {
        get() { return origDesc.get!.call(this); },
        set(val: number) {
          if (document.querySelector(AD_SELECTOR) && val <= 1) {
            if (getSecondsRemaining() <= 1) {
              origDesc.set!.call(this, val);
            } else {
              origDesc.set!.call(this, 16);
            }
          } else {
            origDesc.set!.call(this, val);
          }
        },
        configurable: true,
      });
      origDesc.set!.call(video, 16);
    }

    function removeRateOverride(video: HTMLVideoElement) {
      if (!rateOverrideActive) return;
      rateOverrideActive = false;
      delete (video as any).playbackRate;
      video.playbackRate = 1;
    }

    setInterval(() => {
      const adElement = document.querySelector(AD_SELECTOR);
      const video = document.querySelector<HTMLVideoElement>("video");
      if (!video) return;

      if (adElement && !inAd) {
        inAd = true;
        if (!video.muted) { video.muted = true; mutedByUs = true; }
        applyRateOverride(video);
      } else if (adElement && inAd) {
        const remaining = getSecondsRemaining();
        if (remaining <= 1) {
          origDesc.set!.call(video, 1);
        } else if (origDesc.get!.call(video) < 2) {
          origDesc.set!.call(video, 16);
        }
      } else if (!adElement && inAd) {
        inAd = false;
        removeRateOverride(video);
        if (mutedByUs) { video.muted = false; mutedByUs = false; }
      }
    }, 50);
  },
});

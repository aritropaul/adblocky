/**
 * Crunchyroll content script — free tier ad handling.
 *
 * REALITY: Crunchyroll uses Google IMA SDK for VAST/VPAID ad delivery.
 * This is client-side ad insertion (CSAI) — more blockable than SSAI.
 * IMA SDK loaded from imasdk.googleapis.com.
 *
 * APPROACH: Mock the Google IMA SDK so Crunchyroll thinks ads loaded
 * but nothing plays. Also block IMA/VAST fetch requests and strip
 * any ad markers from HLS manifests.
 */

export default defineContentScript({
  matches: ["*://*.crunchyroll.com/*"],
  runAt: "document_start",
  world: "MAIN",

  main() {
    mockGoogleIMA();
    injectAdBlockStyles();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        interceptAdRequests();
        observeAdPlayback();
      });
    } else {
      interceptAdRequests();
      observeAdPlayback();
    }
  },
});

/**
 * Mock the Google IMA SDK before it loads.
 * Crunchyroll checks window.google.ima — if we provide a mock that
 * reports "no ads available", the player proceeds without ads.
 */
function mockGoogleIMA() {
  const noop = () => {};

  // Create a comprehensive mock that satisfies IMA SDK API calls
  const mockAdsManager = {
    addEventListener: noop,
    destroy: noop,
    getCuePoints: () => [],
    getVolume: () => 1,
    init: noop,
    isCustomClickTrackingUsed: () => false,
    isCustomPlaybackUsed: () => false,
    pause: noop,
    requestNextAdBreak: noop,
    resize: noop,
    resume: noop,
    setVolume: noop,
    skip: noop,
    start: noop,
    stop: noop,
    updateAdsRenderingSettings: noop,
    getRemainingTime: () => 0,
  };

  const mockIma = {
    AdDisplayContainer: class {
      initialize() {}
      destroy() {}
    },
    AdError: {
      ErrorCode: {},
      Type: { AD_ERROR: "adError" },
    },
    AdErrorEvent: {
      Type: { AD_ERROR: "adError" },
    },
    AdEvent: {
      Type: {
        AD_BREAK_READY: "adBreakReady",
        AD_METADATA: "adMetadata",
        ALL_ADS_COMPLETED: "allAdsCompleted",
        CLICK: "click",
        COMPLETE: "complete",
        CONTENT_PAUSE_REQUESTED: "contentPauseRequested",
        CONTENT_RESUME_REQUESTED: "contentResumeRequested",
        FIRST_QUARTILE: "firstQuartile",
        LOADED: "loaded",
        MIDPOINT: "midpoint",
        PAUSED: "paused",
        RESUMED: "resumed",
        SKIPPABLE_STATE_CHANGED: "skippableStateChanged",
        STARTED: "started",
        THIRD_QUARTILE: "thirdQuartile",
        USER_CLOSE: "userClose",
        VOLUME_CHANGED: "volumeChanged",
        VOLUME_MUTED: "volumeMuted",
      },
    },
    AdsLoader: class {
      addEventListener(_event: string, callback: Function) {
        // Fire ALL_ADS_COMPLETED immediately so player moves on
        setTimeout(() => {
          try {
            callback({ type: "allAdsCompleted" });
          } catch {}
        }, 100);
      }
      removeEventListener() {}
      requestAds() {
        // Trigger error so player skips ads
        setTimeout(() => {
          const errorEvent = new CustomEvent("adError");
          window.dispatchEvent(errorEvent);
        }, 50);
      }
      contentComplete() {}
      destroy() {}
      getSettings() {
        return { setAutoPlayAdBreaks: noop };
      }
    },
    AdsManagerLoadedEvent: {
      Type: { ADS_MANAGER_LOADED: "adsManagerLoaded" },
    },
    AdsRenderingSettings: class {},
    AdsRequest: class {
      adTagUrl = "";
      linearAdSlotWidth = 0;
      linearAdSlotHeight = 0;
      nonLinearAdSlotWidth = 0;
      nonLinearAdSlotHeight = 0;
    },
    CompanionAdSelectionSettings: class {},
    ImaSdkSettings: class {
      setAutoPlayAdBreaks() {}
      setVpaidAllowed() {}
      setVpaidMode() {}
      setLocale() {}
    },
    UiElements: { COUNTDOWN: "countdown" },
    ViewMode: { NORMAL: "normal", FULLSCREEN: "fullscreen" },
    settings: { setAutoPlayAdBreaks: noop, setVpaidMode: noop, setLocale: noop },
  };

  // Intercept google.ima before Crunchyroll loads the real SDK
  try {
    let _google: any = {};
    Object.defineProperty(window, "google", {
      configurable: true,
      get() {
        _google.ima = mockIma;
        return _google;
      },
      set(val) {
        _google = val || {};
        _google.ima = mockIma; // Always override ima
      },
    });
  } catch {
    // Fallback: set directly
    (window as any).google = { ima: mockIma };
  }
}

function interceptAdRequests() {
  const originalFetch = window.fetch;

  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";

    // Block IMA SDK and VAST ad requests
    if (
      url.includes("imasdk.googleapis.com") ||
      url.includes("googleads") ||
      url.includes("doubleclick.net") ||
      url.includes("/v1/placements")
    ) {
      return new Response(
        '<?xml version="1.0"?><VAST version="3.0"></VAST>',
        { status: 200, headers: { "Content-Type": "application/xml" } },
      );
    }

    return originalFetch.apply(this, args);
  };
}

function observeAdPlayback() {
  setInterval(() => {
    const video = document.querySelector<HTMLVideoElement>("video");
    if (!video) return;

    // Crunchyroll uses vilos player with specific ad classes
    const adUI = document.querySelector(
      '[class*="ad-overlay"], [class*="vilos--ad"], [id*="vilosAd"], [class*="erc-ad"], [class*="bif-ad"]',
    );

    if (adUI) {
      if (video.duration && isFinite(video.duration) && video.duration < 120) {
        video.currentTime = video.duration;
      }
      video.muted = true;
    }
  }, 500);
}

function injectAdBlockStyles() {
  const style = document.createElement("style");
  style.id = "adb-crunchyroll";
  style.textContent = `
    [class*="ad-overlay"],
    [class*="vilos--ad"],
    [id*="vilosAd"],
    [class*="erc-ad"],
    [class*="bif-ad"],
    [class*="ad-countdown"] {
      display: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

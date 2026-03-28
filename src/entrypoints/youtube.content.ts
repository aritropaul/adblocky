/**
 * YouTube content script — ad detection, skip, and anti-adblock wall removal.
 * Runs in the ISOLATED world. Injects youtube-player.ts into MAIN world for player API access.
 */

export default defineContentScript({
  matches: ["*://*.youtube.com/*"],
  runAt: "document_start",

  main() {
    // Inject MAIN world script for player API manipulation
    injectMainWorldScript();

    // Wait for DOM ready, then start monitoring
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => init());
    } else {
      init();
    }
  },
});

function injectMainWorldScript() {
  const script = document.createElement("script");
  script.src = browser.runtime.getURL("/youtube-player.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

function init() {
  observeAdPlayback();
  removeAntiAdblockWalls();
  observeAntiAdblockWalls();
  injectAdBlockStyles();
}

/**
 * Monitor the YouTube player for ad playback and skip ads.
 */
function observeAdPlayback() {
  let wasShowingAd = false;

  function check() {
    const player = document.querySelector("#movie_player");
    if (!player) return;

    const isAd = player.classList.contains("ad-showing");
    if (isAd) {
      skipAd();
      wasShowingAd = true;
    } else if (wasShowingAd) {
      restoreAfterAd();
      wasShowingAd = false;
    }
  }

  const observer = new MutationObserver(check);

  const startObserving = () => {
    const player = document.querySelector("#movie_player");
    if (player) {
      observer.observe(player, {
        attributes: true,
        attributeFilter: ["class"],
      });
    } else {
      setTimeout(startObserving, 500);
    }
  };

  startObserving();

  // Poll as fallback
  setInterval(check, 1000);
}

/**
 * Skip the current ad by seeking to end and clicking skip button.
 */
let adSpeedApplied = false;

function skipAd() {
  const video = document.querySelector<HTMLVideoElement>(
    "#movie_player video",
  );

  // Click skip button if available (works for CSAI skippable ads)
  const skipBtn =
    document.querySelector<HTMLElement>(".ytp-skip-ad-button") ||
    document.querySelector<HTMLElement>(".ytp-ad-skip-button") ||
    document.querySelector<HTMLElement>(".ytp-ad-skip-button-modern") ||
    document.querySelector<HTMLElement>('[id^="skip-button"]');
  if (skipBtn) {
    skipBtn.click();
  }

  const skipOverlay = document.querySelector<HTMLElement>(
    ".ytp-ad-skip-button-slot button",
  );
  if (skipOverlay) {
    skipOverlay.click();
  }

  if (!video) return;

  // For short standalone ad videos (CSAI): seek to end
  if (video.duration && isFinite(video.duration) && video.duration < 120) {
    video.currentTime = video.duration;
  } else if (!adSpeedApplied) {
    // For SSAI or unskippable ads: fast-forward at 16x
    video.playbackRate = 16;
    adSpeedApplied = true;
  }

  // Mute during ad
  if (!video.muted) {
    video.muted = true;
    video.dataset.adbMuted = "true";
  }
}

/**
 * Restore normal playback after ad ends.
 */
function restoreAfterAd() {
  const video = document.querySelector<HTMLVideoElement>(
    "#movie_player video",
  );
  if (!video) return;

  if (adSpeedApplied) {
    video.playbackRate = 1;
    adSpeedApplied = false;
  }

  if (video.dataset.adbMuted === "true") {
    video.muted = false;
    delete video.dataset.adbMuted;
  }
}

/**
 * Remove YouTube's anti-adblock enforcement dialogs and overlays.
 */
function removeAntiAdblockWalls() {
  const wallSelectors = [
    "#enforcement-message-container",
    "tp-yt-paper-dialog.ytd-enforcement-message-view-model",
    "ytd-enforcement-message-view-model",
  ];

  const adOverlaySelectors = [
    ".ytp-ad-overlay-container",
    ".ytp-ad-message-container",
    ".ytd-ad-slot-renderer",
    "ytd-banner-promo-renderer",
    "ytd-statement-banner-renderer",
    "ytd-popup-container",
    "#masthead-ad",
    "#player-ads",
    "#panels > ytd-ads-engagement-panel-content-renderer",
  ];

  // Check if an actual enforcement wall is present before resuming playback
  let wallFound = false;
  for (const selector of wallSelectors) {
    for (const el of document.querySelectorAll(selector)) {
      (el as HTMLElement).remove();
      wallFound = true;
    }
  }

  // Always remove ad overlays
  for (const selector of adOverlaySelectors) {
    for (const el of document.querySelectorAll(selector)) {
      (el as HTMLElement).remove();
    }
  }

  // Only resume playback if an anti-adblock wall was actually removed
  // (not on every DOM mutation — that prevents user pause)
  if (wallFound) {
    const video = document.querySelector<HTMLVideoElement>(
      "#movie_player video",
    );
    if (video && video.paused) {
      video.play().catch(() => {});
    }
  }
}

/**
 * Continuously watch for anti-adblock elements being injected.
 * Only targets specific container elements to avoid triggering on every DOM change.
 */
function observeAntiAdblockWalls() {
  const WALL_SELECTORS = [
    "#enforcement-message-container",
    "tp-yt-paper-dialog.ytd-enforcement-message-view-model",
    "ytd-enforcement-message-view-model",
    "ytd-popup-container",
  ];

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        // Only remove walls when an actual anti-adblock element is added
        const isWall = WALL_SELECTORS.some(
          (sel) => node.matches?.(sel) || node.querySelector?.(sel),
        );
        if (isWall) {
          removeAntiAdblockWalls();
          return;
        }
      }
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
}

/**
 * Inject CSS to hide ad-related UI elements.
 */
function injectAdBlockStyles() {
  const style = document.createElement("style");
  style.id = "adb-youtube";
  style.textContent = `
    /* Hide ad containers */
    .ytp-ad-overlay-container,
    .ytp-ad-message-container,
    .ytp-ad-image-overlay,
    .ytp-ad-text-overlay,
    ytd-ad-slot-renderer,
    ytd-banner-promo-renderer,
    ytd-statement-banner-renderer,
    ytd-in-feed-ad-layout-renderer,
    ytd-promoted-sparkles-web-renderer,
    ytd-display-ad-renderer,
    ytd-promoted-video-renderer,
    #masthead-ad,
    #player-ads,
    #panels > ytd-ads-engagement-panel-content-renderer,
    #related ytd-promoted-sparkles-web-renderer,
    /* Anti-adblock walls */
    #enforcement-message-container,
    tp-yt-paper-dialog.ytd-enforcement-message-view-model,
    ytd-enforcement-message-view-model,
    /* Shorts ads */
    ytd-reel-video-renderer[is-ad],
    /* Search ads */
    ytd-search-pyv-renderer {
      display: none !important;
    }

    /* Ensure video is not paused by anti-adblock */
    .ad-showing video {
      visibility: visible !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

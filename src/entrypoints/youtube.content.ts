/**
 * YouTube content script (ISOLATED world) — ad detection, skip, anti-adblock
 * wall removal. MAIN-world player API hooks are in youtube-player.content.ts,
 * declared as a separate content script so they install synchronously at
 * document_start (external <script> injection was too late → YT processed
 * ads before we could strip them → server-side enforcement fired).
 */

import { log } from "@/lib/logger";

export default defineContentScript({
  matches: ["*://*.youtube.com/*"],
  runAt: "document_start",

  main() {
    log.info("youtube", "content script loaded");

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => init());
    } else {
      init();
    }

    // Diagnostic: sample the video + player state every 2s so Rocky can see
    // why the player is black (no stream? wrong size? element missing?).
    setInterval(() => {
      const movie = document.querySelector<HTMLElement>("#movie_player");
      const video = document.querySelector<HTMLVideoElement>(
        "#movie_player video",
      );
      const wall = document.querySelector(
        "ytd-enforcement-message-view-model, #enforcement-message-container",
      );
      log.info("yt-diag", "player state", {
        hasMoviePlayer: !!movie,
        moviePlayerSize: movie
          ? { w: movie.offsetWidth, h: movie.offsetHeight }
          : null,
        moviePlayerClass: movie?.className,
        hasVideo: !!video,
        videoSize: video
          ? { w: video.videoWidth, h: video.videoHeight }
          : null,
        readyState: video?.readyState,
        paused: video?.paused,
        currentTime: video?.currentTime,
        duration: video?.duration,
        error: video?.error
          ? { code: video.error.code, msg: video.error.message }
          : null,
        src: video?.currentSrc?.slice(0, 120),
        display: video ? getComputedStyle(video).display : null,
        visibility: video ? getComputedStyle(video).visibility : null,
        opacity: video ? getComputedStyle(video).opacity : null,
        wallPresent: !!wall,
        wallText: wall ? (wall.textContent || "").slice(0, 200) : null,
      });
    }, 2000);
  },
});

function init() {
  observeAdPlayback();
  removeAntiAdblockWalls();
  observeAntiAdblockWalls();
  skipPromotedShorts();
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

function isLiveStream(): boolean {
  const player = document.querySelector("#movie_player");
  if (!player) return false;
  // YouTube adds .ytp-live class to live stream players
  if (player.classList.contains("ytp-live")) return true;
  // Also check for live badge
  if (document.querySelector(".ytp-live-badge")) return true;
  const video = document.querySelector<HTMLVideoElement>(
    "#movie_player video",
  );
  if (video && !isFinite(video.duration)) return true;
  return false;
}

function isShortsPage(): boolean {
  return location.pathname.startsWith("/shorts/");
}

function skipAd() {
  // Don't interfere with Shorts at all
  if (isShortsPage()) return;

  // Click skip button if available (works for CSAI skippable ads)
  const skipBtn =
    document.querySelector<HTMLElement>(".ytp-skip-ad-button") ||
    document.querySelector<HTMLElement>(".ytp-ad-skip-button") ||
    document.querySelector<HTMLElement>(".ytp-ad-skip-button-modern") ||
    document.querySelector<HTMLElement>('[id^="skip-button"]');
  if (skipBtn) {
    skipBtn.click();
    log.block("youtube", "Clicked skip-ad button");
  }

  const skipOverlay = document.querySelector<HTMLElement>(
    ".ytp-ad-skip-button-slot button",
  );
  if (skipOverlay) {
    skipOverlay.click();
  }

  const video = document.querySelector<HTMLVideoElement>(
    "#movie_player video",
  );
  if (!video) return;

  // For live streams, only click skip buttons — never seek or change playback rate
  if (isLiveStream()) return;

  // For short standalone ad videos (CSAI): seek to end
  if (video.duration && isFinite(video.duration) && video.duration < 120) {
    video.currentTime = video.duration;
    log.block("youtube", `Seeked past CSAI ad (dur=${video.duration.toFixed(1)}s)`);
  } else if (!adSpeedApplied) {
    // For SSAI or unskippable ads: fast-forward at 16x
    video.playbackRate = 16;
    adSpeedApplied = true;
    log.block("youtube", "Fast-forward ad at 16x");
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
      const htmlEl = el as HTMLElement;
      log.block("youtube", `Removed anti-adblock wall: ${selector}`, {
        text: (htmlEl.textContent || "").slice(0, 500),
        outerHTMLSnippet: htmlEl.outerHTML.slice(0, 400),
      });
      htmlEl.remove();
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
 * Auto-skip promoted/sponsored Shorts. These are regular videos YouTube
 * inserts into the Shorts feed with a "Sponsored" badge (ad-badge-view-model).
 * They don't use adPlacements so MAIN world stripping can't catch them.
 */
function skipPromotedShorts() {
  // CSS hides promoted Shorts instantly (`:has(ad-badge-view-model)`).
  // This function auto-advances past the hidden reel so the user
  // doesn't get stuck on a blank screen.
  let lastCheckedUrl = "";

  function advancePastAd() {
    if (!location.pathname.startsWith("/shorts/")) return;
    if (location.href === lastCheckedUrl) return;

    const reels = document.querySelectorAll("ytd-reel-video-renderer");
    for (const reel of reels) {
      const rect = reel.getBoundingClientRect();
      if (rect.top < 0 || rect.top > window.innerHeight / 2) continue;
      if (reel.querySelector("ad-badge-view-model")) {
        lastCheckedUrl = location.href;
        const navDown = document.querySelector<HTMLElement>(
          "#navigation-button-down button",
        );
        if (navDown) navDown.click();
        return;
      }
    }
  }

  let currentUrl = location.href;
  setInterval(() => {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      setTimeout(advancePastAd, 100);
    }
  }, 150);
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
    /* Shorts ads — promoted Shorts with ad badge */
    ytd-reel-video-renderer:has(ad-badge-view-model),
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

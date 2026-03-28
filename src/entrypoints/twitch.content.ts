/**
 * Twitch content script — blocks pre-roll and mid-roll ads.
 *
 * Strategy:
 * 1. Intercept M3U8 playlist fetches and strip ad segments
 * 2. Block ad-related GraphQL mutations
 * 3. Fallback: detect ad playback and mute + overlay
 */

import {
  installFetchProxy,
  addRequestBlocker,
  addFetchInterceptor,
  createM3UInterceptor,
} from "@/lib/ssai";

const BLOCKED_GQL_OPS = new Set([
  "ClientSideAdEventHandling",
  "VideoAdImpression",
  "AdRequestHandling",
  "VideoAdRequestScheduling",
]);

export default defineContentScript({
  matches: ["*://*.twitch.tv/*"],
  runAt: "document_start",
  world: "MAIN",

  main() {
    // Single fetch proxy — fixes the previous double-override bug
    installFetchProxy();

    // Block ad-related GraphQL operations
    addRequestBlocker((url, request, init) => {
      if (!url.includes("gql.twitch.tv/gql")) return null;
      try {
        const body = init?.body;
        if (body && typeof body === "string") {
          const parsed = JSON.parse(body);
          const operations = Array.isArray(parsed) ? parsed : [parsed];
          for (const op of operations) {
            if (op.operationName && BLOCKED_GQL_OPS.has(op.operationName)) {
              return new Response(JSON.stringify({ data: {} }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }
          }
        }
      } catch {
        // Parse error, let it through
      }
      return null;
    });

    // Strip ad segments from M3U8 playlists
    addFetchInterceptor(
      createM3UInterceptor(
        (url) => url.includes(".m3u8") || url.includes("hls.ttvnw.net"),
        {
          adTagPatterns: ["stitched-ad", "X-TV-TWITCH-AD", "twitch-stitched-ad"],
          replaceWithLastContent: true,
        },
      ),
    );

    injectAdBlockStyles();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => observeAdPlayback());
    } else {
      observeAdPlayback();
    }
  },
});

// --- DOM-based Ad Detection (Fallback) ---

let overlayEl: HTMLElement | null = null;

function observeAdPlayback() {
  const observer = new MutationObserver(() => {
    const adLabel = document.querySelector(
      '[data-a-target="video-ad-label"], .ad-banner, [data-test-selector="ad-banner-default-id"]',
    );

    if (adLabel) {
      muteAndOverlay();
    } else {
      removeOverlay();
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
  });
}

function muteAndOverlay() {
  const video = document.querySelector<HTMLVideoElement>("video");
  if (video && !video.muted) {
    video.muted = true;
    video.dataset.adbMuted = "true";
  }

  if (!overlayEl) {
    overlayEl = document.createElement("div");
    overlayEl.id = "adb-twitch-overlay";
    overlayEl.innerHTML = `
      <div style="
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.85);
        display: flex; align-items: center; justify-content: center;
        color: white; font-family: system-ui; font-size: 14px; z-index: 9999;
      ">
        <div style="text-align: center;">
          <div style="font-size: 18px; font-weight: 600; margin-bottom: 4px;">Ad Blocked</div>
          <div style="opacity: 0.6;">Stream will resume shortly</div>
        </div>
      </div>
    `;
    const playerContainer = document.querySelector(
      ".video-player__container, .video-player",
    );
    if (playerContainer) {
      (playerContainer as HTMLElement).style.position = "relative";
      playerContainer.appendChild(overlayEl);
    }
  }
}

function removeOverlay() {
  const video = document.querySelector<HTMLVideoElement>("video");
  if (video?.dataset.adbMuted === "true") {
    video.muted = false;
    delete video.dataset.adbMuted;
  }

  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

function injectAdBlockStyles() {
  const style = document.createElement("style");
  style.id = "adb-twitch";
  style.textContent = `
    [data-a-target="video-ad-label"],
    .ad-banner,
    [data-test-selector="ad-banner-default-id"],
    .stream-display-ad,
    .tw-c-background-overlay {
      display: none !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

/**
 * Spotify Web Player content script — mute audio ads, hide ad UI.
 *
 * Strategy:
 * 1. Monitor audio element for ad audio sources
 * 2. Mute during ad playback, unmute when music resumes
 * 3. Hide ad banners and upgrade prompts via CSS
 */

export default defineContentScript({
  matches: ["*://open.spotify.com/*"],
  runAt: "document_start",
  world: "MAIN",

  main() {
    injectAdBlockStyles();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        monitorAudioAds();
        hideAdUI();
      });
    } else {
      monitorAudioAds();
      hideAdUI();
    }
  },
});

// --- Audio Ad Detection ---

// Patterns in audio source URLs that indicate ad content
const AD_AUDIO_PATTERNS = [
  "/ads/",
  "audio-ak-spotify-com.akamaized.net",
  "audio-ad",
  "spclient.wg.spotify.com/ads",
  "audio-fa.scdn.co/ad-logic",
];

function monitorAudioAds() {
  // Intercept audio element src changes
  const audioElements = document.querySelectorAll("audio");

  const observeAudio = (audio: HTMLAudioElement) => {
    let wasMutedByUs = false;

    // Monitor src changes
    const observer = new MutationObserver(() => {
      const src = audio.src || audio.currentSrc || "";

      if (isAdAudio(src)) {
        if (!audio.muted) {
          audio.muted = true;
          wasMutedByUs = true;
          audio.playbackRate = 16; // Speed through the ad
          showAdBlockedBanner();
        }
      } else if (wasMutedByUs) {
        audio.muted = false;
        audio.playbackRate = 1;
        wasMutedByUs = false;
        hideAdBlockedBanner();
      }
    });

    observer.observe(audio, {
      attributes: true,
      attributeFilter: ["src"],
    });

    // Also listen for source change events
    audio.addEventListener("loadstart", () => {
      const src = audio.src || audio.currentSrc || "";
      if (isAdAudio(src)) {
        audio.muted = true;
        wasMutedByUs = true;
        audio.playbackRate = 16;
        showAdBlockedBanner();
      }
    });

    audio.addEventListener("ended", () => {
      if (wasMutedByUs) {
        audio.muted = false;
        audio.playbackRate = 1;
        wasMutedByUs = false;
        hideAdBlockedBanner();
      }
    });
  };

  // Observe existing audio elements
  audioElements.forEach(observeAudio);

  // Watch for new audio elements
  const bodyObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLAudioElement) {
          observeAudio(node);
        }
        if (node instanceof HTMLElement) {
          for (const audio of node.querySelectorAll("audio")) {
            observeAudio(audio);
          }
        }
      }
    }
  });

  bodyObserver.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
}

function isAdAudio(src: string): boolean {
  if (!src) return false;
  return AD_AUDIO_PATTERNS.some((pattern) =>
    src.toLowerCase().includes(pattern.toLowerCase()),
  );
}

// --- Ad Blocked Banner ---

let bannerEl: HTMLElement | null = null;

function showAdBlockedBanner() {
  if (bannerEl) return;

  bannerEl = document.createElement("div");
  bannerEl.id = "adb-spotify-banner";
  bannerEl.style.cssText = `
    position: fixed; top: 16px; right: 16px; z-index: 99999;
    background: #1DB954; color: white; padding: 8px 16px;
    border-radius: 8px; font-family: system-ui; font-size: 13px;
    font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: adb-fade-in 0.2s ease;
  `;
  bannerEl.textContent = "Ad muted by adblocky";
  document.body.appendChild(bannerEl);
}

function hideAdBlockedBanner() {
  if (bannerEl) {
    bannerEl.remove();
    bannerEl = null;
  }
}

// --- Hide Ad UI Elements ---

function hideAdUI() {
  const observer = new MutationObserver(() => {
    // Remove ad containers
    const adSelectors = [
      '[data-testid="ad-slot-renderer"]',
      '[data-testid="hpto-banner"]',
      ".sponsor-container",
      '[aria-label="Advertisement"]',
      '[data-testid="upgrade-button"]',
    ];

    for (const selector of adSelectors) {
      for (const el of document.querySelectorAll(selector)) {
        (el as HTMLElement).style.display = "none";
      }
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
}

// --- CSS ---

function injectAdBlockStyles() {
  const style = document.createElement("style");
  style.id = "adb-spotify";
  style.textContent = `
    /* Hide ad UI */
    [data-testid="ad-slot-renderer"],
    [data-testid="hpto-banner"],
    .sponsor-container,
    [aria-label="Advertisement"],
    .ad-slot-container,
    /* Hide upgrade/premium prompts */
    [data-testid="upgrade-button"],
    .premium-upsell,
    /* Fade-in animation */
    @keyframes adb-fade-in {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  // The @keyframes inside a selector list is invalid CSS, fix:
  style.textContent = `
    [data-testid="ad-slot-renderer"],
    [data-testid="hpto-banner"],
    .sponsor-container,
    [aria-label="Advertisement"],
    .ad-slot-container,
    [data-testid="upgrade-button"],
    .premium-upsell {
      display: none !important;
    }
    @keyframes adb-fade-in {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

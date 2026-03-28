/**
 * Universal SSAI ad skip — mute + 16x speed via Object.defineProperty.
 *
 * No timer wind-down — keep 16x until ad selector is fully gone from DOM.
 * Shows brief "Ad skipped" toast. Increments skip counter in storage.
 */

import { log } from "@/lib/logger";

const origRateDesc = Object.getOwnPropertyDescriptor(
  HTMLMediaElement.prototype,
  "playbackRate",
);

export interface AdSkipOptions {
  /** CSS selectors that indicate an ad is playing */
  adSelectors: string[];
  /** Playback rate during ads (default: 16) */
  adRate?: number;
  /** Auto-click these selectors (skip/dismiss buttons) */
  clickSelectors?: string[];
  /** CSS to inject for hiding ad UI */
  hideRules?: string;
  /** Style element ID */
  styleId?: string;
}

function showToast() {
  if (document.getElementById("adb-toast")) return;
  const toast = document.createElement("div");
  toast.id = "adb-toast";
  toast.textContent = "Ad skipped";
  toast.style.cssText =
    "position:fixed;top:16px;right:16px;z-index:2147483647;" +
    "background:#10b981;color:#fff;padding:8px 16px;border-radius:8px;" +
    "font:600 13px/1 system-ui;opacity:0;transition:opacity 0.3s;" +
    "pointer-events:none;";
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = "1"; });
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 1500);
}

function incrementSkipCount() {
  try {
    chrome.storage?.local?.get("adb_ads_skipped", (data) => {
      const count = (data?.adb_ads_skipped || 0) + 1;
      chrome.storage.local.set({ adb_ads_skipped: count });
    });
  } catch {}
}

export function startAdSkip(options: AdSkipOptions): () => void {
  const {
    adSelectors,
    adRate = 16,
    clickSelectors = [],
    hideRules,
    styleId,
  } = options;

  const selectorString = adSelectors.join(", ");
  let inAd = false;
  let mutedByUs = false;
  let overrideActive = false;

  if (styleId && hideRules) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = hideRules;
    (document.head || document.documentElement).appendChild(style);
  }

  function applyOverride(video: HTMLVideoElement) {
    if (overrideActive || !origRateDesc) return;
    overrideActive = true;

    Object.defineProperty(video, "playbackRate", {
      get() { return origRateDesc!.get!.call(this); },
      set(val: number) {
        // Block ALL rate resets while ad selector exists
        if (document.querySelector(selectorString)) {
          origRateDesc!.set!.call(this, adRate);
        } else {
          origRateDesc!.set!.call(this, val);
        }
      },
      configurable: true,
    });

    origRateDesc!.set!.call(video, adRate);
  }

  function removeOverride(video: HTMLVideoElement) {
    if (!overrideActive) return;
    overrideActive = false;
    delete (video as any).playbackRate;
    video.playbackRate = 1;
  }

  const adInterval = setInterval(() => {
    const adElement = document.querySelector(selectorString);
    const video = document.querySelector<HTMLVideoElement>("video");
    if (!video) return;

    if (adElement) {
      if (!inAd) {
        inAd = true;
        const host = window.location.hostname.replace("www.", "");
        log.info(host, "Ad detected — muting + 16x", { selector: selectorString });
        if (!video.muted) {
          video.muted = true;
          mutedByUs = true;
        }
        applyOverride(video);
      }
      // Keep enforcing rate
      if (origRateDesc && origRateDesc.get!.call(video) < 2) {
        origRateDesc.set!.call(video, adRate);
      }
    } else if (inAd) {
      inAd = false;
      const host = window.location.hostname.replace("www.", "");
      log.info(host, "Ad ended — restored playback");
      removeOverride(video);
      if (mutedByUs) {
        video.muted = false;
        mutedByUs = false;
      }
      showToast();
      incrementSkipCount();
    }
  }, 50);

  let clickInterval: ReturnType<typeof setInterval> | null = null;
  if (clickSelectors.length > 0) {
    const clickSel = clickSelectors.join(", ");
    clickInterval = setInterval(() => {
      const btn = document.querySelector<HTMLElement>(clickSel);
      if (btn) btn.click();
    }, 500);
  }

  return () => {
    clearInterval(adInterval);
    if (clickInterval) clearInterval(clickInterval);
    const video = document.querySelector<HTMLVideoElement>("video");
    if (video && overrideActive) removeOverride(video);
    if (video && mutedByUs) video.muted = false;
  };
}

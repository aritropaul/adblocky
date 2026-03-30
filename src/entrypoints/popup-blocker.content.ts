/**
 * Popup/popunder ad blocker — MAIN world content script.
 *
 * Layer 2 defense (content script level). Layer 1 is in background.ts using
 * webNavigation API which catches popups regardless of technique.
 *
 * This script handles what it can at the page level:
 * 1. window.open() override using navigator.userActivation (proper browser API)
 * 2. Clickjacking overlay removal
 * 3. Anchor click() interception
 */

/** Known ad/popup network domains */
const AD_POPUP_DOMAINS = new Set([
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adnxs.com",
  "adsrvr.org",
  "adform.net",
  "criteo.com",
  "taboola.com",
  "outbrain.com",
  "popads.net",
  "popcash.net",
  "propellerads.com",
  "exoclick.com",
  "juicyads.com",
  "trafficjunky.com",
  "clickadu.com",
  "hilltopads.com",
  "adsterra.com",
  "a-ads.com",
  "admiralcloud.com",
  "bidvertiser.com",
  "revcontent.com",
  "mgid.com",
  "zedo.com",
  "ad.plus",
  "richpush.co",
  "pushground.com",
  "evadav.com",
  "clickaine.com",
  "adf.ly",
  "shorte.st",
  "linkbucks.com",
  "sh.st",
  "bc.vc",
  "adcash.com",
  "ad-maven.com",
  "admaven.com",
  "onclickmax.com",
  "onclickmega.com",
  "onclickads.net",
  "onclicksuper.com",
  "trafserv.com",
  "redirectvoluum.com",
  "adbooth.com",
  "terraclicks.com",
  "dolohen.com",
  "notifpush.com",
  "push-notification.com",
  "roodo.pro",
  "revrtb.com",
  "clickorati.com",
  "continue-download.com",
  "wonderlandads.com",
  "syndication.dynsrvtbg.com",
  "cdn.onclickgenius.com",
  "go.oclasrv.com",
  "go.transferzenad.com",
]);

function isAdDomain(urlStr: string): boolean {
  try {
    const hostname = new URL(urlStr, window.location.href).hostname;
    const parts = hostname.split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      if (AD_POPUP_DOMAINS.has(parts.slice(i).join("."))) return true;
    }
  } catch {}
  return false;
}

function log(msg: string, ...args: unknown[]) {
  console.log(
    "%c[adblocky]%c popup-blocker %c" + msg,
    "color:#10b981;font-weight:bold",
    "color:#ff6b35;font-weight:bold",
    "color:inherit",
    ...args,
  );
}

/**
 * Detect clickjacking overlay: transparent, full-page, high z-index div
 * that exists solely to capture clicks for popup ads.
 */
function isClickjackOverlay(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;

  const suspiciousIds = ["dontfoid", "popmagic", "apu", "overlaybg"];
  if (
    el.id &&
    suspiciousIds.some((id) => el.id.toLowerCase().includes(id))
  ) {
    return true;
  }

  const style = getComputedStyle(el);
  const isFixed = style.position === "fixed" || style.position === "absolute";
  const isTransparent =
    style.backgroundColor === "transparent" ||
    style.backgroundColor === "rgba(0, 0, 0, 0)" ||
    parseFloat(style.opacity) < 0.05;
  const isHighZ = parseInt(style.zIndex) > 999999;
  const coversPage =
    el.offsetWidth > window.innerWidth * 0.5 &&
    el.offsetHeight > window.innerHeight * 0.5;
  const isEmpty = el.children.length === 0 && !el.textContent?.trim();

  return isFixed && isTransparent && isHighZ && coversPage && isEmpty;
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  world: "MAIN",

  main() {
    // ── window.open override ─────────────────────────────────────────
    // Uses navigator.userActivation.isActive (proper browser API) instead
    // of manual click timestamp tracking.
    const originalOpen = window.open;

    window.open = function (
      url?: string | URL,
      target?: string,
      features?: string,
    ): Window | null {
      const urlStr = url?.toString() || "";

      // Always block known ad domains
      if (urlStr && isAdDomain(urlStr)) {
        log("Blocked ad popup:", urlStr);
        return null;
      }

      // Block if no user activation (replaces manual click tracking)
      // navigator.userActivation.isActive is true only during a genuine
      // user gesture's transient activation window (~5s in Chrome)
      if (!navigator.userActivation?.isActive) {
        log("Blocked non-user-activated popup:", urlStr || "(empty)");
        return null;
      }

      return originalOpen.call(this, url, target, features);
    };

    // ── HTMLAnchorElement.prototype.click override ────────────────────
    // Catches programmatic anchor.click() popunder tricks regardless of
    // how the anchor was created (createElement, cloneNode, innerHTML).
    const origAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      const href = this.href || "";

      // Block ad domain clicks
      if (href && isAdDomain(href)) {
        log("Blocked ad anchor click:", href);
        return;
      }

      // Block cross-origin clicks on detached anchors (classic popunder trick)
      if (href && !this.isConnected) {
        try {
          const anchorHost = new URL(href, window.location.href).hostname;
          const pageHost = window.location.hostname;
          if (anchorHost !== pageHost) {
            log("Blocked detached anchor popup:", href);
            return;
          }
        } catch {}
      }

      // Block if no user activation
      if (!navigator.userActivation?.isActive) {
        if (this.target === "_blank") {
          log("Blocked non-user-activated anchor popup:", href);
          return;
        }
      }

      return origAnchorClick.call(this);
    };

    // ── Overlay removal ──────────────────────────────────────────────
    function removeOverlay(el: HTMLElement) {
      const id = el.id || el.className || "(anonymous div)";
      el.remove();
      log("Removed clickjack overlay:", id);
    }

    function scanOverlays() {
      const candidates = document.querySelectorAll(
        'div[style*="position: fixed"], div[style*="position:fixed"]',
      );
      for (const el of candidates) {
        if (el instanceof HTMLElement && isClickjackOverlay(el)) {
          removeOverlay(el);
        }
      }
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", scanOverlays);
    } else {
      scanOverlays();
    }

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (
            node instanceof HTMLElement &&
            node.tagName === "DIV" &&
            isClickjackOverlay(node)
          ) {
            removeOverlay(node);
          }
        }
        if (
          m.type === "attributes" &&
          m.target instanceof HTMLElement &&
          m.target.tagName === "DIV" &&
          isClickjackOverlay(m.target)
        ) {
          removeOverlay(m.target);
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
  },
});

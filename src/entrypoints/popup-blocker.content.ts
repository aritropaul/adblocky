/**
 * Popup/popunder ad blocker — runs on all pages at document_start in MAIN world.
 *
 * Blocks:
 * 1. window.open() calls to ad domains
 * 2. window.open() calls not triggered by genuine user clicks
 * 3. Popunders (open ad in background, redirect current tab)
 */

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
]);

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  world: "MAIN",

  main() {
    let lastUserClick = 0;

    // Track genuine user clicks
    document.addEventListener("click", () => { lastUserClick = Date.now(); }, true);
    document.addEventListener("mousedown", () => { lastUserClick = Date.now(); }, true);

    const originalOpen = window.open;

    window.open = function (
      url?: string | URL,
      target?: string,
      features?: string,
    ): Window | null {
      const urlStr = url?.toString() || "";

      // Block if URL matches known ad domains
      if (urlStr) {
        try {
          const hostname = new URL(urlStr, window.location.href).hostname;
          const parts = hostname.split(".");
          for (let i = 0; i < parts.length - 1; i++) {
            if (AD_POPUP_DOMAINS.has(parts.slice(i).join("."))) {
              console.log("%c[adblocky]%c popup-blocker %cBlocked ad popup:", "color:#10b981;font-weight:bold", "color:#ff6b35;font-weight:bold", "color:inherit", urlStr);
              return null;
            }
          }
        } catch {}
      }

      // Block if not triggered by a recent user click (within 1s)
      const timeSinceClick = Date.now() - lastUserClick;
      if (timeSinceClick > 1000) {
        console.log("%c[adblocky]%c popup-blocker %cBlocked non-user popup:", "color:#10b981;font-weight:bold", "color:#ff6b35;font-weight:bold", "color:inherit", urlStr || "(empty)");
        return null;
      }

      // Allow — genuine user-initiated navigation
      return originalOpen.call(this, url, target, features);
    };

    // Block assignment to window.location from ad scripts (popunder technique)
    // Only block if it happens without a user click
    const origLocationDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    // Can't override window.location on most browsers — skip this

    // Block document.createElement("a").click() popunder trick
    const origCreateElement = document.createElement.bind(document);
    document.createElement = function (
      tagName: string,
      options?: ElementCreationOptions,
    ): HTMLElement {
      const el = origCreateElement(tagName, options);

      if (tagName.toLowerCase() === "a") {
        const origClick = el.click.bind(el);
        el.click = function () {
          const timeSinceClick = Date.now() - lastUserClick;
          const href = (el as HTMLAnchorElement).href || "";
          const target = (el as HTMLAnchorElement).target;

          // Block programmatic clicks on links to ad domains with target=_blank
          if (target === "_blank" && timeSinceClick > 1000) {
            try {
              const hostname = new URL(href, window.location.href).hostname;
              const parts = hostname.split(".");
              for (let i = 0; i < parts.length - 1; i++) {
                if (AD_POPUP_DOMAINS.has(parts.slice(i).join("."))) {
                  return;
                }
              }
            } catch {}
          }

          return origClick();
        };
      }

      return el;
    };
  },
});

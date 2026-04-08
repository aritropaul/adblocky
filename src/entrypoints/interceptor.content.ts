/**
 * MAIN WORLD REQUEST INTERCEPTOR — The webRequest API workaround.
 *
 * Runs on ALL pages at document_start in the page's JS context.
 * Monkey-patches fetch(), XMLHttpRequest, and document.createElement
 * to block ad/tracking requests before they happen.
 *
 * This replaces what webRequest did in MV2 — real-time request interception.
 */

export default defineContentScript({
  matches: ["*://*.twitch.tv/*"],
  runAt: "document_start",
  world: "MAIN",

  main() {
    // --- Ad pattern matching ---

    // Domain patterns (exact match or suffix match)
    const BLOCKED_DOMAINS: Set<string> = new Set([
      "doubleclick.net",
      "googleadservices.com",
      "googlesyndication.com",
      "googletagmanager.com",
      "googletagservices.com",
      "google-analytics.com",
      "adservice.google.com",
      "pagead2.googlesyndication.com",
      "adnxs.com",
      "adsrvr.org",
      "adform.net",
      "criteo.com",
      "criteo.net",
      "taboola.com",
      "outbrain.com",
      "moatads.com",
      "amazon-adsystem.com",
      "ads-twitter.com",
      "ads.linkedin.com",
      "ads.facebook.com",
      "pixel.facebook.com",
      "an.facebook.com",
      "ads.pinterest.com",
      "ads.reddit.com",
      "advertising.com",
      "scorecardresearch.com",
      "quantserve.com",
      "bluekai.com",
      "demdex.net",
      "krxd.net",
      "exelator.com",
      "tapad.com",
      "rubiconproject.com",
      "pubmatic.com",
      "openx.net",
      "casalemedia.com",
      "indexexchange.com",
      "sharethrough.com",
      "triplelift.com",
      "33across.com",
      "media.net",
      "revcontent.com",
      "mgid.com",
      "zedo.com",
      "undertone.com",
      "bidswitch.net",
      "smartadserver.com",
      "turn.com",
      "mathtag.com",
      "serving-sys.com",
      "eyeota.net",
      "lotame.com",
      "rlcdn.com",
      "addthis.com",
      "sharethis.com",
      "hotjar.com",
      "fullstory.com",
      "mouseflow.com",
      "crazyegg.com",
      "luckyorange.com",
      "clarity.ms",
      "newrelic.com",
      "nr-data.net",
      "bugsnag.com",
      "sentry.io",
      "sentry-cdn.com",
      "browser.sentry-cdn.com",
      "js.sentry-cdn.com",
      "static.cloudflareinsights.com",
      "cloudflareinsights.com",
      "segment.io",
      "segment.com",
      "mixpanel.com",
      "amplitude.com",
      "heapanalytics.com",
      "optimizely.com",
      "branch.io",
      "appsflyer.com",
      "adjust.com",
      "kochava.com",
      "mparticle.com",
      "braze.com",
      "onesignal.com",
      "pushwoosh.com",
      "imasdk.googleapis.com",
      "fwmrm.net",
      "freewheel.tv",
      "springserve.com",
    ]);

    // Path patterns (substring match on URL path)
    const BLOCKED_PATHS: string[] = [
      "/pagead/",
      "/ads/",
      "/ad/",
      "/adserver",
      "/adrequest",
      "/ad_request",
      "/ptracking",
      "/get_midroll_info",
      "/api/stats/ads",
      "/doubleclick/",
      "/gampad/",
      "/aclk?",
      "/log_event?",
      "/_ads/",
      "/adx/",
      "/sponsor",
      "/prebid",
      "/rtb/",
      "/bid?",
      "/bidrequest",
      "/impression?",
      "/track?",
      "/tracking/",
      "/tracker/",
      "/pixel?",
      "/pixel/",
      "/beacon?",
      "/collect?",
      "/event?type=ad",
      "/adSlot",
      "/adPlacements",
      "/bugsnag.min.js",
      "/beacon.min.js",
      "/tag.js",
      "/metrika/",
      "/analytics.js",
      "/gtag/js",
      "/gtm.js",
      "/fbevents.js",
    ];

    // Specific full URLs to block (for CDN-hosted trackers)
    const BLOCKED_URLS: string[] = [
      "d2wy8f7a9ursnm.cloudfront.net/v4/bugsnag",
      "d2wy8f7a9ursnm.cloudfront.net/v7/bugsnag",
      "mc.yandex.ru/metrika/tag.js",
      "mc.yandex.ru/watch/",
      "an.yandex.ru/system/context.js",
      "static.cloudflareinsights.com/beacon.min.js",
      "chaturbate.jjgirls.com",
      "jdrucker.com",
    ];

    // --- URL checking ---

    function isBlockedURL(urlStr: string): boolean {
      try {
        const url = new URL(urlStr);
        const hostname = url.hostname;

        // Check domain blocklist (exact + parent domain match)
        if (BLOCKED_DOMAINS.has(hostname)) return true;
        const parts = hostname.split(".");
        for (let i = 1; i < parts.length - 1; i++) {
          if (BLOCKED_DOMAINS.has(parts.slice(i).join("."))) return true;
        }

        // Check full URL patterns (for CDN-hosted trackers)
        const fullURL = hostname + url.pathname;
        for (const blocked of BLOCKED_URLS) {
          if (fullURL.includes(blocked)) return true;
        }

        // Check path patterns
        const fullPath = url.pathname + url.search;
        for (const pattern of BLOCKED_PATHS) {
          if (fullPath.includes(pattern)) return true;
        }

        return false;
      } catch {
        return false;
      }
    }

    // --- Response fields to strip from JSON APIs ---

    const AD_JSON_KEYS = [
      "adPlacements", "adSlots", "playerAds", "adBreakParams",
      "adBreakHeartbeatParams", "advertisingId", "ad_tag",
      "adVideoId", "adLayout", "adInfoRenderer",
      "instreamAdMetadata", "adInfoRenderer",
    ];

    function stripAdFields(obj: any): void {
      if (!obj || typeof obj !== "object") return;
      for (const key of AD_JSON_KEYS) {
        if (key in obj) delete obj[key];
      }
      // Recurse into known nested containers
      if (obj.playerResponse) stripAdFields(obj.playerResponse);
      if (obj.response) stripAdFields(obj.response);
      if (obj.args) stripAdFields(obj.args);
    }

    // --- Layer 2A: Patch fetch() ---

    const originalFetch = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const url = typeof args[0] === "string"
        ? args[0]
        : args[0] instanceof Request
          ? args[0].url
          : String(args[0]);

      if (isBlockedURL(url)) {
        console.log("%c[adblocky]%c interceptor %cBlocked fetch:", "color:#10b981;font-weight:bold", "color:#f9ca24;font-weight:bold", "color:inherit", url.substring(0, 80));
        return new Response(null, { status: 204, statusText: "Blocked by adblocky" });
      }

      const response = await originalFetch.apply(this, args);

      // Strip ad fields from JSON responses (YouTube, etc.)
      try {
        const ct = response.headers.get("content-type") || "";
        if (ct.includes("json") && (url.includes("youtubei") || url.includes("player"))) {
          const clone = response.clone();
          const body = await clone.json();
          stripAdFields(body);
          return new Response(JSON.stringify(body), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
      } catch {
        // Can't parse — return original
      }

      return response;
    };

    // --- Layer 2B: Patch XMLHttpRequest ---

    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      ...rest: any[]
    ) {
      const urlStr = url.toString();
      (this as any)._adbBlocked = isBlockedURL(urlStr);
      (this as any)._adbURL = urlStr;
      return originalXHROpen.apply(this, [method, url, ...rest] as any);
    };

    XMLHttpRequest.prototype.send = function (...args: any[]) {
      if ((this as any)._adbBlocked) {
        console.log("%c[adblocky]%c interceptor %cBlocked XHR:", "color:#10b981;font-weight:bold", "color:#f9ca24;font-weight:bold", "color:inherit", ((this as any)._adbURL || "").substring(0, 80));
        // Fake a successful empty response
        Object.defineProperty(this, "readyState", { value: 4, writable: false });
        Object.defineProperty(this, "status", { value: 204, writable: false });
        Object.defineProperty(this, "statusText", { value: "Blocked by adblocky", writable: false });
        Object.defineProperty(this, "responseText", { value: "", writable: false });
        Object.defineProperty(this, "response", { value: "", writable: false });
        this.dispatchEvent(new Event("readystatechange"));
        this.dispatchEvent(new Event("load"));
        this.dispatchEvent(new Event("loadend"));
        return;
      }
      return originalXHRSend.apply(this, args as any);
    };

    // NOTE: document.createElement override removed — it breaks sites that
    // dynamically create scripts (test sites, SPAs, etc.). DNR handles
    // script blocking at the network level. MutationObserver handles cleanup.

    // --- Layer 3: MutationObserver for dynamically inserted ad elements ---

    // Ad-related CSS selectors to hide (cosmetic blocking)
    const AD_SELECTORS = [
      '[id^="ad-"]', '[id^="ad_"]', '[id*="-ad-"]', '[id*="_ad_"]',
      '[class^="ad-"]', '[class^="ad_"]', '[class*=" ad-"]', '[class*=" ad_"]',
      '[id^="banner"]', '[class*="banner-ad"]',
      '[id*="google_ads"]', '[id*="div-gpt-ad"]',
      'ins.adsbygoogle',
      '[data-ad-slot]', '[data-ad-client]', '[data-ad]',
      '[class*="sponsor"]', '[id*="sponsor"]',
      'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]',
      'iframe[src*="chaturbate"]', 'iframe[src*="jjgirls"]',
      'iframe[src*="exoclick"]', 'iframe[src*="juicyads"]',
      'iframe[src*="popads"]', 'iframe[src*="jdrucker"]',
      '[class*="advert"]', '[id*="advert"]',
    ].join(",");

    function hideAdElements(root: HTMLElement | Document) {
      try {
        const ads = root.querySelectorAll(AD_SELECTORS);
        ads.forEach((el) => {
          (el as HTMLElement).style.setProperty("display", "none", "important");
        });
      } catch {}
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;

          // Check scripts with blocked src
          if (node.tagName === "SCRIPT") {
            const src = node.src || node.getAttribute("src") || "";
            if (src && isBlockedURL(src)) {
              node.type = "javascript/blocked";
              node.removeAttribute("src");
              node.remove();
              continue;
            }
          }

          // Check iframes with blocked src
          if (node.tagName === "IFRAME") {
            const src = node.src || node.getAttribute("src") || "";
            if (src && isBlockedURL(src)) {
              node.remove();
              continue;
            }
          }

          // Check images with blocked src (tracking pixels + ad images)
          if (node.tagName === "IMG") {
            const src = node.src || node.getAttribute("src") || "";
            if (src && isBlockedURL(src)) {
              node.remove();
              continue;
            }
          }

          // Check link tags (CSS from ad domains)
          if (node.tagName === "LINK") {
            const href = node.getAttribute("href") || "";
            if (href && isBlockedURL(href)) {
              node.remove();
              continue;
            }
          }

          // Hide ad elements by CSS selector
          if (node.matches?.(AD_SELECTORS)) {
            node.style.setProperty("display", "none", "important");
          }

          // Also check children
          hideAdElements(node);
        }
      }
    });

    // Start observing as soon as documentElement exists
    const startObserver = () => {
      observer.observe(document.documentElement, { childList: true, subtree: true });
      // Also run an initial pass on the existing DOM
      hideAdElements(document);
    };

    if (document.documentElement) {
      startObserver();
    } else {
      const waitForDoc = new MutationObserver(() => {
        if (document.documentElement) {
          waitForDoc.disconnect();
          startObserver();
        }
      });
      waitForDoc.observe(document, { childList: true });
    }

    // Run another pass after DOM is fully loaded
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => hideAdElements(document));
    }
    window.addEventListener("load", () => hideAdElements(document));
  },
});

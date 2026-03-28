/**
 * Anti-adblock wall bypass content script — neutralizes adblock detectors.
 *
 * Runs in MAIN world at document_start on all pages to:
 * 1. Override common adblock detection variables (blockAdBlock, fuckAdBlock, etc.)
 * 2. Create bait elements and override getComputedStyle to fool detection scripts
 * 3. Intercept fetch/XHR to block adblock detection script URLs
 * 4. Auto-dismiss anti-adblock walls via MutationObserver
 */

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  world: "MAIN",

  main() {
    overrideDetectionVariables();
    interceptNetworkRequests();
    createBaitElements();
    overrideGetComputedStyle();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        dismissAntiAdblockWalls();
        observeAntiAdblockWalls();
      });
    } else {
      dismissAntiAdblockWalls();
      observeAntiAdblockWalls();
    }
  },
});

// --- 1. Override adblock detection variables ---

/**
 * Define fake objects/values on window that adblock detection scripts check.
 */
function overrideDetectionVariables() {
  // Fake BlockAdBlock / FuckAdBlock / SniffAdBlock instance
  function createFakeAdBlockChecker() {
    const noop = () => {};
    const fakeChecker = {
      check: () => false,
      emitEvent: noop,
      on: () => fakeChecker,
      onDetected: () => fakeChecker,
      onNotDetected: () => fakeChecker,
      setOption: () => fakeChecker,
      _options: { checkOnLoad: false, resetOnEnd: false },
      _detected: false,
      _var: true,
    };
    return fakeChecker;
  }

  const checkerNames = ["blockAdBlock", "fuckAdBlock", "sniffAdBlock"];

  for (const name of checkerNames) {
    try {
      Object.defineProperty(window, name, {
        get: () => createFakeAdBlockChecker(),
        set: () => {},
        configurable: false,
      });
    } catch {
      // Property may already be non-configurable
    }
  }

  // canRunAds — many detection scripts check this global boolean
  try {
    Object.defineProperty(window, "canRunAds", {
      get: () => true,
      set: () => {},
      configurable: false,
    });
  } catch {
    // Already defined
  }

  // isAdBlockActive — another common detection flag
  try {
    Object.defineProperty(window, "isAdBlockActive", {
      get: () => false,
      set: () => {},
      configurable: false,
    });
  } catch {
    // Already defined
  }

  // Neutralize Sourcepoint (_sp_.config)
  try {
    Object.defineProperty(window, "_sp_", {
      get: () => ({
        config: {
          events: {},
          accountId: 0,
          baseEndpoint: "",
        },
        executeMessaging: () => {},
        loadPrivacyManagerModal: () => {},
      }),
      set: () => {},
      configurable: false,
    });
  } catch {
    // Already defined
  }

  // Fake TCF/CMP API — reports user consent to prevent consent-wall blocking
  try {
    const w = window as Record<string, unknown>;
    w.__tcfapi = (
      command: string,
      version: number,
      callback: (data: unknown, success: boolean) => void,
    ) => {
      if (command === "addEventListener" || command === "getTCData") {
        callback(
          {
            tcString: "",
            tcfPolicyVersion: 2,
            cmpId: 0,
            cmpVersion: 0,
            gdprApplies: false,
            eventStatus: "tcloaded",
            cmpStatus: "loaded",
            listenerId: 0,
            isServiceSpecific: true,
            useNonStandardStacks: false,
            publisherCC: "US",
            purposeOneTreatment: false,
            purpose: {
              consents: { 1: true, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true, 8: true, 9: true, 10: true },
              legitimateInterests: {},
            },
            vendor: { consents: {}, legitimateInterests: {} },
            specialFeatureOptins: {},
            publisher: { consents: {}, legitimateInterests: {}, customPurpose: {}, restrictions: {} },
          },
          true,
        );
      } else if (command === "ping") {
        callback(
          {
            gdprApplies: false,
            cmpLoaded: true,
            cmpStatus: "loaded",
            displayStatus: "hidden",
            apiVersion: "2.0",
          },
          true,
        );
      } else if (typeof callback === "function") {
        callback(null, true);
      }
    };
  } catch {
    // Already defined
  }
}

// --- 2. Bait elements and getComputedStyle override ---

/**
 * Create a hidden bait element that adblock detection scripts look for.
 * Detection scripts create ad-like elements and check if they're hidden;
 * our bait stays visible to them (but invisible to the user via positioning).
 */
function createBaitElements() {
  const createBait = () => {
    // Only create if not already present
    if (document.getElementById("ad_box")) return;

    const bait = document.createElement("div");
    bait.id = "ad_box";
    bait.className = "ad ads adsbox ad-placement ad-placeholder adbadge";
    bait.setAttribute("data-ad", "true");
    // Position offscreen but remain in DOM with non-zero dimensions
    bait.style.cssText =
      "position: absolute !important; " +
      "left: -9999px !important; " +
      "top: -9999px !important; " +
      "width: 1px !important; " +
      "height: 1px !important; " +
      "opacity: 0.01 !important; " +
      "pointer-events: none !important;";
    // Inner content — some detection scripts check innerHTML
    bait.innerHTML = "&nbsp;";

    (document.body || document.documentElement).appendChild(bait);
  };

  if (document.body) {
    createBait();
  } else {
    document.addEventListener("DOMContentLoaded", createBait);
  }
}

/**
 * Override getComputedStyle so ad-detection scripts see normal (non-hidden)
 * values for elements with ad-like class names.
 */
function overrideGetComputedStyle() {
  const AD_CLASS_PATTERNS = [
    "ad",
    "ads",
    "adsbox",
    "ad-placement",
    "ad-placeholder",
    "adbadge",
    "ad_box",
    "ad-banner",
    "adsbygoogle",
    "banner_ad",
    "textad",
  ];

  const originalGetComputedStyle = window.getComputedStyle;

  window.getComputedStyle = function (
    element: Element,
    pseudoElt?: string | null,
  ): CSSStyleDeclaration {
    const style = originalGetComputedStyle.call(window, element, pseudoElt);

    // Check if this element looks like an ad-detection bait
    const el = element as HTMLElement;
    const isAdLike =
      el.classList &&
      AD_CLASS_PATTERNS.some(
        (pattern) =>
          el.classList.contains(pattern) ||
          el.id?.includes(pattern),
      );

    if (isAdLike) {
      // Return a proxy that reports non-hidden values for visibility/display checks
      return new Proxy(style, {
        get(target, prop: string) {
          if (prop === "display") return "block";
          if (prop === "visibility") return "visible";
          if (prop === "opacity") return "1";
          if (prop === "height") return "1px";
          if (prop === "width") return "1px";
          if (prop === "getPropertyValue") {
            return (name: string) => {
              if (name === "display") return "block";
              if (name === "visibility") return "visible";
              if (name === "opacity") return "1";
              return target.getPropertyValue(name);
            };
          }
          const value = target[prop as keyof CSSStyleDeclaration];
          if (typeof value === "function") {
            return value.bind(target);
          }
          return value;
        },
      });
    }

    return style;
  };
}

// --- 3. Block adblock detection script URLs ---

const BLOCKED_URL_PATTERNS = [
  "adblock-detect",
  "blockadblock",
  "fuckadblock",
  "pagead/js/adsbygoogle",
  "fundingchoicesmessages",
];

function isBlockedDetectionUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return BLOCKED_URL_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Override fetch and XMLHttpRequest to block requests for adblock detection scripts.
 */
function interceptNetworkRequests() {
  // --- fetch override ---
  const originalFetch = window.fetch;
  window.fetch = function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input instanceof Request
            ? input.url
            : "";

    if (url && isBlockedDetectionUrl(url)) {
      // Return empty successful response
      return Promise.resolve(
        new Response("", {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "text/javascript" },
        }),
      );
    }

    return originalFetch.call(window, input, init);
  };

  // --- XMLHttpRequest override ---
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    const urlStr = typeof url === "string" ? url : url.toString();
    if (isBlockedDetectionUrl(urlStr)) {
      // Redirect to an empty data URI so the request silently succeeds
      return originalXHROpen.call(
        this,
        method,
        "data:text/javascript,",
        ...(rest as [boolean?, string?, string?]),
      );
    }
    return originalXHROpen.call(
      this,
      method,
      url,
      ...(rest as [boolean?, string?, string?]),
    );
  };
}

// --- 4. Auto-dismiss anti-adblock walls ---

const WALL_SELECTORS = [
  '[class*="adblock-notice"]',
  '[class*="adblock-overlay"]',
  '[class*="adblock-modal"]',
  '[class*="adblock-wrapper"]',
  '[class*="adb-overlay"]',
  '[id*="adblock"]',
  '[id*="adblock-notice"]',
  '[id*="adblock-overlay"]',
];

const WALL_TEXT_PATTERNS = [
  "ad blocker",
  "adblocker",
  "ad-blocker",
  "disable your ad",
  "turn off your ad",
  "deactivate your ad",
  "whitelist",
  "white list",
  "allow ads",
  "adblock detected",
  "ad blocker detected",
  "please disable",
  "disable adblock",
];

/**
 * Remove elements matching anti-adblock wall selectors and restore scrolling.
 */
function dismissAntiAdblockWalls() {
  // Remove elements matching known wall selectors
  for (const selector of WALL_SELECTORS) {
    for (const el of document.querySelectorAll(selector)) {
      const htmlEl = el as HTMLElement;
      // Only remove if it looks like an overlay/modal (large or covering viewport)
      if (isLikelyWall(htmlEl)) {
        console.log("%c[adblocky]%c anti-adblock %cRemoved wall:", "color:#10b981;font-weight:bold", "color:#ffd700;font-weight:bold", "color:inherit", selector, htmlEl.className?.toString?.()?.substring(0, 60));
        htmlEl.remove();
      }
    }
  }

  // Check for overlays containing anti-adblock text
  const overlaySelectors = [
    "[class*='overlay']",
    "[class*='modal']",
    "[class*='popup']",
    "[class*='dialog']",
    "[id*='overlay']",
    "[id*='modal']",
    "[id*='popup']",
  ];

  for (const selector of overlaySelectors) {
    for (const el of document.querySelectorAll(selector)) {
      const htmlEl = el as HTMLElement;
      const text = (htmlEl.textContent || "").toLowerCase();
      if (WALL_TEXT_PATTERNS.some((pattern) => text.includes(pattern))) {
        htmlEl.remove();
      }
    }
  }

  // Restore page scrolling (walls often set overflow: hidden on body)
  if (document.body) {
    const bodyOverflow = document.body.style.overflow;
    if (bodyOverflow === "hidden") {
      document.body.style.overflow = "";
    }
  }
  if (document.documentElement) {
    const htmlOverflow = document.documentElement.style.overflow;
    if (htmlOverflow === "hidden") {
      document.documentElement.style.overflow = "";
    }
  }
}

/**
 * Check if an element looks like a full-page wall/overlay.
 */
function isLikelyWall(el: HTMLElement): boolean {
  const style = el.style;
  const computed = window.getComputedStyle.call
    ? window.getComputedStyle(el)
    : null;

  // Check for fixed/absolute positioning covering the viewport
  const position = style.position || computed?.position || "";
  if (position === "fixed" || position === "absolute") {
    return true;
  }

  // Check for high z-index (common for overlay walls)
  const zIndex = parseInt(style.zIndex || computed?.zIndex || "0", 10);
  if (zIndex > 999) {
    return true;
  }

  // If it has "adblock" in class or id, remove it regardless
  const className = (el.className || "").toLowerCase();
  const id = (el.id || "").toLowerCase();
  if (className.includes("adblock") || id.includes("adblock")) {
    return true;
  }

  return false;
}

/**
 * Observe DOM for dynamically inserted anti-adblock walls.
 */
function observeAntiAdblockWalls() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;

        // Check if added node matches wall selectors
        const isWall = WALL_SELECTORS.some(
          (sel) => node.matches?.(sel) || node.querySelector?.(sel),
        );

        // Check if added node contains anti-adblock text
        const text = (node.textContent || "").toLowerCase();
        const hasWallText = WALL_TEXT_PATTERNS.some((pattern) =>
          text.includes(pattern),
        );

        if (isWall || hasWallText) {
          // Defer slightly to let the element fully render before removing
          setTimeout(() => dismissAntiAdblockWalls(), 50);
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

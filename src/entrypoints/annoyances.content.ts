/**
 * Annoyances content script — blocks common web annoyances.
 *
 * Targets: notification permission prompts, newsletter popups, chat widgets,
 * social share bars, app install banners, push notification prompts,
 * signup/registration walls, and push notification service workers.
 *
 * Runs on all URLs at document_idle in the ISOLATED world.
 */

// ---------------------------------------------------------------------------
// CSS selectors for annoyance categories
// ---------------------------------------------------------------------------

const NEWSLETTER_SELECTORS = [
  '[class*="newsletter-popup"]',
  '[class*="newsletter-modal"]',
  '[class*="NewsletterPopup"]',
  '[class*="email-popup"]',
  '[class*="subscribe-modal"]',
  '[id*="newsletter-popup"]',
  '[id*="subscribe-modal"]',
];

const CHAT_WIDGET_SELECTORS = [
  '[id*="intercom"]',
  '[id*="drift-"]',
  '[class*="intercom"]',
  '[class*="drift-"]',
  '[id*="hubspot-messages"]',
  '[id*="crisp-chatbox"]',
  '[id*="tawk-"]',
  '[class*="zE-Widget"]',
  "#fc_frame",
];

const SOCIAL_SHARE_SELECTORS = [
  '[class*="social-share-float"]',
  '[class*="share-bar-fixed"]',
];

const APP_BANNER_SELECTORS = [
  '[class*="smart-banner"]',
  '[class*="app-banner"]',
  '[id*="smart-banner"]',
  'meta[name="apple-itunes-app"]',
];

const PUSH_NOTIFICATION_SELECTORS = [
  '[class*="push-notification"]',
  '[class*="web-push"]',
  '[id*="push-prompt"]',
];

const SIGNUP_WALL_SELECTORS = [
  '[class*="signup-wall"]',
  '[class*="registration-wall"]',
];

const ALL_ANNOYANCE_SELECTORS = [
  ...NEWSLETTER_SELECTORS,
  ...CHAT_WIDGET_SELECTORS,
  ...SOCIAL_SHARE_SELECTORS,
  ...APP_BANNER_SELECTORS,
  ...PUSH_NOTIFICATION_SELECTORS,
  ...SIGNUP_WALL_SELECTORS,
];

// ---------------------------------------------------------------------------
// Dismiss button text patterns (case-insensitive)
// ---------------------------------------------------------------------------

const DISMISS_PATTERNS = [
  /no\s*thanks/i,
  /not\s*now/i,
  /\blater\b/i,
  /\bdeny\b/i,
  /\bdismiss\b/i,
  /\bclose\b/i,
  /\bno\b/i,
  /\bcancel\b/i,
  /\bblock\b/i,
];

// Domains whose service workers should be blocked from registering
// (common push notification / ad / tracking providers)
const BLOCKED_SW_DOMAINS = [
  "onesignal.com",
  "pushwoosh.com",
  "pushcrew.com",
  "pushengage.com",
  "webpushr.com",
  "cleverpush.com",
  "izooto.com",
  "pushassist.com",
  "aimtell.com",
  "wonderpush.com",
  "subscribers.com",
  "sendpulse.com",
  "gravitec.net",
  "pushpad.xyz",
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adnxs.com",
  "taboola.com",
  "outbrain.com",
];

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main() {
    injectMainWorldOverrides();
    injectAnnoyanceStyles();
    autoDismissNotificationPrompts();
    observeForNewAnnoyances();
  },
});

// ---------------------------------------------------------------------------
// 1. Block Notification.requestPermission + push SW registration (MAIN world)
// ---------------------------------------------------------------------------

/**
 * Inject a small inline script into the MAIN world to override browser APIs.
 * We use an inline script element (not a separate file) so we don't need to
 * register an additional web-accessible resource.
 */
function injectMainWorldOverrides() {
  const code = `
(function() {
  // --- Override Notification.requestPermission ---
  if (typeof Notification !== 'undefined') {
    Notification.requestPermission = function() {
      return Promise.resolve('denied');
    };
    // Also override the static permission getter to report denied
    try {
      Object.defineProperty(Notification, 'permission', {
        get: function() { return 'denied'; },
        configurable: true,
      });
    } catch(e) {}
  }

  // --- Block service worker registrations from ad/tracking domains ---
  if (navigator.serviceWorker) {
    var _origRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    var blockedDomains = ${JSON.stringify(BLOCKED_SW_DOMAINS)};

    navigator.serviceWorker.register = function(scriptURL, options) {
      try {
        var resolved = new URL(scriptURL, location.href).href.toLowerCase();
        for (var i = 0; i < blockedDomains.length; i++) {
          if (resolved.indexOf(blockedDomains[i]) !== -1) {
            return Promise.reject(new DOMException(
              'adblocky: blocked push notification service worker from ' + blockedDomains[i],
              'SecurityError'
            ));
          }
        }
      } catch(e) {}
      return _origRegister(scriptURL, options);
    };
  }
})();
`;

  const script = document.createElement("script");
  script.textContent = code;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

// ---------------------------------------------------------------------------
// 2. Hide common annoyance elements via CSS
// ---------------------------------------------------------------------------

function injectAnnoyanceStyles() {
  const style = document.createElement("style");
  style.id = "adb-annoyances";
  style.textContent =
    ALL_ANNOYANCE_SELECTORS.join(",\n") +
    " { display: none !important; visibility: hidden !important; }";
  (document.head || document.documentElement).appendChild(style);
}

// ---------------------------------------------------------------------------
// 3. Auto-dismiss custom notification permission prompts
// ---------------------------------------------------------------------------

/**
 * Look for push notification prompt dialogs and click dismiss buttons inside them.
 */
function autoDismissNotificationPrompts() {
  dismissVisiblePrompts();
}

function dismissVisiblePrompts() {
  const promptContainers = document.querySelectorAll<HTMLElement>(
    PUSH_NOTIFICATION_SELECTORS.join(", "),
  );

  for (const container of promptContainers) {
    clickDismissButton(container);
  }
}

/**
 * Find and click a dismiss/decline button within the given container.
 */
function clickDismissButton(container: HTMLElement) {
  const buttons = container.querySelectorAll<HTMLElement>(
    "button, a, [role='button'], .btn, [class*='btn'], [class*='close']",
  );

  for (const btn of buttons) {
    const text = (btn.textContent || "").trim();
    if (text.length > 50) continue; // skip non-button elements with lots of text

    for (const pattern of DISMISS_PATTERNS) {
      if (pattern.test(text)) {
        btn.click();
        return;
      }
    }

    // Also check aria-label
    const ariaLabel = btn.getAttribute("aria-label") || "";
    for (const pattern of DISMISS_PATTERNS) {
      if (pattern.test(ariaLabel)) {
        btn.click();
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Observe DOM for dynamically inserted annoyances
// ---------------------------------------------------------------------------

function observeForNewAnnoyances() {
  const observer = new MutationObserver((mutations) => {
    let shouldCheck = false;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;

        // Check if the added node itself is an annoyance
        const isAnnoyance = ALL_ANNOYANCE_SELECTORS.some(
          (sel) => node.matches?.(sel) || node.querySelector?.(sel),
        );

        if (isAnnoyance) {
          shouldCheck = true;
          break;
        }
      }
      if (shouldCheck) break;
    }

    if (shouldCheck) {
      // Try to auto-dismiss any newly appeared push notification prompts
      dismissVisiblePrompts();
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });
}

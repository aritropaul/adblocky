/**
 * Cookie consent banner auto-dismissal content script.
 * Runs on all pages at document_idle in ISOLATED world.
 * Prioritizes rejecting cookies; falls back to accepting to dismiss the banner.
 */

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",

  main() {
    injectBannerHidingCSS();

    // Wait 1 second after DOM ready to let banners animate in, then start clicking
    setTimeout(() => attemptDismiss(0), 1000);
  },
});

/**
 * Selectors for "reject" / "necessary only" buttons, in priority order.
 */
const REJECT_SELECTORS = [
  "#onetrust-reject-all-handler",
  '[data-testid="reject-all"]',
  'button[title="Reject All"]',
  'button[title="Reject all"]',
  ".css-47sehv",
  "#CybotCookiebotDialogBodyButtonDecline",
  '[data-action="reject"]',
  "button.decline-button",
  ".cc-deny",
  "#didomi-notice-disagree-button",
  ".cmpboxbtnno",
];

/**
 * Fallback selectors for "accept" buttons (used only when no reject button is found).
 */
const ACCEPT_SELECTORS = [
  "#onetrust-accept-btn-handler",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  ".cc-accept",
  ".cc-allow",
  "#didomi-notice-agree-button",
  '[data-action="accept"]',
  ".cmpboxbtnyes",
];

/**
 * Banner container selectors to hide via CSS.
 */
const BANNER_SELECTORS = [
  "#onetrust-consent-sdk",
  "#CybotCookiebotDialog",
  ".cc-window",
  "#didomi-popup",
  "#qc-cmp2-container",
  '[class*="cookie-banner"]',
  '[class*="cookie-consent"]',
  '[class*="CookieBanner"]',
  '[id*="cookie-banner"]',
  '[id*="cookie-consent"]',
];

/** Maximum number of retry attempts (every 2 seconds for 10 seconds = 5 retries). */
const MAX_RETRIES = 5;
const RETRY_INTERVAL_MS = 2000;

/**
 * Try to find and click a reject button. If none found, try accept buttons.
 * Retries every 2 seconds up to MAX_RETRIES times to handle lazily-loaded banners.
 */
function attemptDismiss(attempt: number) {
  // Try reject buttons first
  for (const selector of REJECT_SELECTORS) {
    const button = document.querySelector<HTMLElement>(selector);
    if (button && isVisible(button)) {
      button.click();
      return; // Done — banner dismissed via reject
    }
  }

  // No reject button found — try accept buttons as fallback
  for (const selector of ACCEPT_SELECTORS) {
    const button = document.querySelector<HTMLElement>(selector);
    if (button && isVisible(button)) {
      button.click();
      return; // Done — banner dismissed via accept
    }
  }

  // No button found yet — retry if we haven't exceeded the limit
  if (attempt < MAX_RETRIES) {
    setTimeout(() => attemptDismiss(attempt + 1), RETRY_INTERVAL_MS);
  }
}

/**
 * Check whether an element is visible (not hidden or zero-size).
 */
function isVisible(el: HTMLElement): boolean {
  if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Inject a <style> element to immediately hide known cookie consent banner containers.
 */
function injectBannerHidingCSS() {
  const style = document.createElement("style");
  style.id = "adb-cookie-consent";
  style.textContent =
    BANNER_SELECTORS.join(",\n") +
    " { display: none !important; visibility: hidden !important; }";
  (document.head || document.documentElement).appendChild(style);
}

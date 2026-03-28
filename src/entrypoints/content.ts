/**
 * Global content script — cosmetic filtering and anti-adblock.
 * Runs on all pages to hide ad elements via CSS.
 */

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",

  main() {
    const domain = window.location.hostname;

    // Inject cosmetic filter styles
    injectCosmeticFilters(domain);

    // Observe DOM for dynamically inserted ad elements
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            hideKnownAdElements(node);
          }
        }
      }
    });

    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      });
    }
  },
});

/**
 * Inject a <style> element with cosmetic filter selectors for the current domain.
 * The cosmetic-filters.json is loaded from extension storage (compiled at build time).
 */
async function injectCosmeticFilters(domain: string) {
  try {
    const url = browser.runtime.getURL("cosmetic-filters.json");
    const response = await fetch(url);
    if (!response.ok) return;

    const filters: Record<string, string[]> = await response.json();

    // Collect selectors: generic + domain-specific
    const selectors: string[] = [...(filters["*"] || [])];

    // Match domain and parent domains
    const parts = domain.split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      const sub = parts.slice(i).join(".");
      if (filters[sub]) {
        selectors.push(...filters[sub]);
      }
    }

    if (selectors.length === 0) return;

    console.log(`%c[adblocky]%c cosmetic %c${selectors.length} rules for ${domain}`, "color:#10b981;font-weight:bold", "color:#686de0;font-weight:bold", "color:inherit");

    const style = document.createElement("style");
    style.id = "adb-cosmetic";
    style.textContent = selectors.join(",\n") + " { display: none !important; }";

    // Insert as early as possible
    const target = document.head || document.documentElement;
    target.appendChild(style);
  } catch {
    // cosmetic-filters.json may not exist yet during development
  }
}

/**
 * Check dynamically added elements against known ad patterns.
 */
function hideKnownAdElements(root: HTMLElement) {
  // Common ad container patterns
  const adSelectors = [
    '[id^="google_ads"]',
    '[id^="div-gpt-ad"]',
    'ins.adsbygoogle',
    '[data-ad-slot]',
    '[data-ad-client]',
    ".ad-container",
    ".ad-wrapper",
    ".ad-banner",
  ];

  for (const selector of adSelectors) {
    if (root.matches(selector)) {
      root.style.display = "none";
      return;
    }
    for (const el of root.querySelectorAll(selector)) {
      (el as HTMLElement).style.display = "none";
    }
  }
}

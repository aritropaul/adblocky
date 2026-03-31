/**
 * Global content script — cosmetic filtering and anti-adblock.
 * Runs on all pages to hide ad elements via CSS.
 */

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",

  main() {
    injectCosmeticFilters(window.location.hostname);
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

    // Filter out uBlock extended CSS syntax that isn't valid CSS — one invalid
    // selector in a comma list invalidates the entire rule per CSS spec.
    const EXTENDED_RE = /:(?:style|upward|has-text|matches-path|matches-css|min-text-length|watch-attr|xpath|nth-ancestor|remove)\(/;

    const safened = selectors.filter(
      (s) => !s.startsWith("+") && !EXTENDED_RE.test(s),
    ).map((s) =>
      // Broad attribute selectors like [class*="cookie-banner"] can match
      // <html> or <body> and hide the entire page. Scope them out.
      /\[(?:class|id)[*^$~|]?=/.test(s) ? `${s}:not(html):not(body)` : s,
    );

    const style = document.createElement("style");
    style.id = "adb-cosmetic";
    style.textContent = safened.join(",\n") + " { display: none !important; }";

    // Insert as early as possible
    const target = document.head || document.documentElement;
    target.appendChild(style);
  } catch {
    // cosmetic-filters.json may not exist yet during development
  }
}


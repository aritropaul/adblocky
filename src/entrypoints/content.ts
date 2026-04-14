/**
 * Global content script — cosmetic filtering and anti-adblock.
 * Runs on all pages to hide ad elements via CSS.
 */

import { log } from "@/lib/logger";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",

  main() {
    injectCosmeticFilters(window.location.hostname);
    bridgeMainWorldLogs();
  },
});

/**
 * Listen for "adb-log" CustomEvents from MAIN world scripts and forward
 * them through the ISOLATED-world logger (which can reach background).
 */
function bridgeMainWorldLogs() {
  window.addEventListener("adb-log", (e: Event) => {
    const detail = (e as CustomEvent).detail as {
      level?: "info" | "warn" | "error" | "block";
      module?: string;
      msg?: string;
      data?: unknown;
    };
    if (!detail?.module || !detail?.msg) return;
    const level = detail.level || "info";
    log[level](detail.module, detail.msg, detail.data);
  });
}

/**
 * Sites that break when the 40K-selector generic cosmetic list is applied.
 * On these, we use ONLY the domain-specific selectors — generics are skipped.
 * Streaming/app sites typically have their own dedicated content scripts
 * handling ad hiding, so the generic dump is redundant.
 */
const SKIP_GENERIC_DOMAINS = [
  "youtube.com",
  "twitch.tv",
  "spotify.com",
  "hulu.com",
  "netflix.com",
  "disneyplus.com",
  "peacocktv.com",
  "paramountplus.com",
  "primevideo.com",
  "amazon.com",
  "tubitv.com",
  "pluto.tv",
  "crunchyroll.com",
  "roku.com",
  "accounts.google.com",
  "claude.ai",
];

function shouldSkipGeneric(domain: string): boolean {
  return SKIP_GENERIC_DOMAINS.some(
    (d) => domain === d || domain.endsWith(`.${d}`),
  );
}

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

    const skipGeneric = shouldSkipGeneric(domain);

    // Collect selectors: generic (unless skipped) + domain-specific
    const selectors: string[] = skipGeneric ? [] : [...(filters["*"] || [])];

    // Match domain and parent domains
    const parts = domain.split(".");
    for (let i = 0; i < parts.length - 1; i++) {
      const sub = parts.slice(i).join(".");
      if (filters[sub]) {
        selectors.push(...filters[sub]);
      }
    }

    if (selectors.length === 0) return;

    log.info(
      "cosmetic",
      `${selectors.length} rules for ${domain}${skipGeneric ? " (domain-only, generic skipped)" : ""}`,
    );

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
  } catch (e) {
    log.error("cosmetic", `Failed to inject filters for ${domain}`, e);
  }
}


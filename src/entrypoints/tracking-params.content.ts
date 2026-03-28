/**
 * Tracking parameter stripper — removes tracking/attribution query params from URLs.
 * Runs on all pages in ISOLATED world at document_end.
 * Uses history.replaceState to clean the URL without triggering navigation.
 * Also intercepts link clicks to clean outbound hrefs.
 */

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_end",
  world: "ISOLATED",

  main() {
    // Domains where stripping params would break core functionality
    const EXCLUDED_DOMAINS = [
      "google.com",
      "youtube.com",
      "facebook.com",
      "twitter.com",
      "x.com",
      "github.com",
    ];

    // All tracking parameters to strip
    const TRACKING_PARAMS = new Set([
      // Facebook
      "fbclid",
      "fb_action_ids",
      "fb_action_types",
      "fb_source",
      "fb_ref",
      // Google
      "gclid",
      "gclsrc",
      "dclid",
      "gbraid",
      "wbraid",
      // UTM
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "utm_id",
      // Microsoft
      "msclkid",
      // HubSpot
      "hsa_cam",
      "hsa_grp",
      "hsa_mt",
      "hsa_src",
      "hsa_ad",
      "hsa_acc",
      "hsa_net",
      "hsa_ver",
      "hsa_la",
      "hsa_ol",
      "hsa_kw",
      // Mailchimp
      "mc_cid",
      "mc_eid",
      // General
      "_ga",
      "_gl",
      "_ke",
      "ref_",
      "ref",
      "sref",
      "__s",
      // TikTok
      "ttclid",
      // Twitter/X
      "twclid",
      // Vero
      "vero_conv",
      "vero_id",
    ]);

    /**
     * Check whether a hostname belongs to an excluded domain.
     * Matches the domain itself and any subdomain (e.g. www.google.com).
     */
    function isExcludedDomain(hostname: string): boolean {
      const lower = hostname.toLowerCase();
      for (const domain of EXCLUDED_DOMAINS) {
        if (lower === domain || lower.endsWith(`.${domain}`)) {
          return true;
        }
      }
      return false;
    }

    /**
     * Remove tracking parameters from a URL string.
     * Returns the cleaned URL, or null if nothing changed.
     */
    function cleanUrl(urlString: string): string | null {
      try {
        const url = new URL(urlString);

        if (isExcludedDomain(url.hostname)) {
          return null;
        }

        let changed = false;
        const keysToDelete: string[] = [];

        for (const key of url.searchParams.keys()) {
          if (TRACKING_PARAMS.has(key)) {
            keysToDelete.push(key);
          }
        }

        for (const key of keysToDelete) {
          url.searchParams.delete(key);
          changed = true;
        }

        if (!changed) {
          return null;
        }

        return url.toString();
      } catch {
        // Invalid URL — leave it alone
        return null;
      }
    }

    // --- 1. Clean the current page URL ---
    if (!isExcludedDomain(window.location.hostname)) {
      const cleaned = cleanUrl(window.location.href);
      if (cleaned) {
        history.replaceState(history.state, "", cleaned);
      }
    }

    // --- 2. Intercept link clicks to clean outbound hrefs ---
    document.addEventListener(
      "click",
      (event: MouseEvent) => {
        // Walk up from the click target to find an anchor element
        const anchor = (event.target as Element)?.closest?.("a");
        if (!anchor) return;

        const href = anchor.href;
        if (!href) return;

        const cleaned = cleanUrl(href);
        if (cleaned) {
          anchor.href = cleaned;
        }
      },
      true, // capture phase so we clean before navigation
    );
  },
});

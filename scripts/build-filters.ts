/**
 * Build-time script: Download filter lists and compile to DNR JSON + WebKit JSON.
 * Run with: npm run build:filters
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { FILTER_LISTS, STREAMING_AD_DOMAINS } from "./lists.config";
import { parseFilterList } from "./parsers/abp-parser";
import { compileToDNR } from "./parsers/dnr-compiler";
import { compileToWebKit } from "./parsers/webkit-compiler";

const RULES_DIR = "public/rules";
const SAFARI_RULES_DIR = "safari-rules";
const PUBLIC_DIR = "public";

async function downloadFilterList(url: string): Promise<string> {
  console.log(`  Downloading: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  return response.text();
}

async function main() {
  console.log("[build-filters] Starting filter compilation...\n");

  // Ensure output directories
  for (const dir of [RULES_DIR, SAFARI_RULES_DIR, PUBLIC_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const allCosmeticFilters: Record<string, string[]> = {};
  let totalDNRRules = 0;
  let totalWebKitRules = 0;

  // Process each filter list
  for (const list of FILTER_LISTS) {
    console.log(`\nProcessing: ${list.name} (${list.id})`);
    try {
      const raw = await downloadFilterList(list.url);
      const parsed = parseFilterList(raw);

      console.log(
        `  Parsed: ${parsed.networkFilters.length} network, ${parsed.cosmeticFilters.length} cosmetic`,
      );

      // Compile to DNR
      const dnrRules = compileToDNR(parsed.networkFilters, list.id);
      const rulesetPath = `${RULES_DIR}/ruleset_${list.id}.json`;
      writeFileSync(rulesetPath, JSON.stringify(dnrRules, null, 2));
      console.log(`  DNR: ${dnrRules.length} rules → ${rulesetPath}`);
      totalDNRRules += dnrRules.length;

      // Compile to WebKit Content Blocker
      const webkitRules = compileToWebKit(parsed.networkFilters, parsed.cosmeticFilters);
      const safariPath = `${SAFARI_RULES_DIR}/${list.id}.json`;
      writeFileSync(safariPath, JSON.stringify(webkitRules, null, 2));
      console.log(`  WebKit: ${webkitRules.length} rules → ${safariPath}`);
      totalWebKitRules += webkitRules.length;

      // Collect cosmetic filters — only selectors safe for CSS display:none.
      //
      // We strip:
      // 1. Scriptlets (+js, +set-cookie) — not CSS at all
      // 2. Extended CSS (:style, :upward, :has-text, :remove, etc.) —
      //    invalid CSS that would break the entire selector rule
      // 3. Bare custom element selectors (e.g. "shreddit-experience-tree",
      //    ".v2 > shreddit-async-loader") — these are structural page
      //    components, not ads. uBlock uses them with :remove() or
      //    scriptlets; display:none breaks page layout.
      //    We keep custom elements that look ad-specific (contain "ad"
      //    in the tag name, e.g. "shreddit-ad-post").
      const EXTENDED_CSS_RE = /:(?:style|upward|has-text|matches-path|matches-css|matches-css-before|matches-css-after|min-text-length|watch-attr|xpath|nth-ancestor|remove)\(/;
      // Matches selectors whose final target is a bare custom element
      // (tag-with-hyphen not followed by class/id/attr qualifier).
      // Allows custom elements containing "ad" in the name.
      const BARE_CUSTOM_EL_RE = /(?:^|[>\s+~])(?![\w-]*ad[\w-]*-)(\w+-[\w-]+)\s*$/;
      for (const filter of parsed.cosmeticFilters) {
        const sel = filter.selector;
        if (sel.startsWith("+") || EXTENDED_CSS_RE.test(sel)) continue;
        // Skip bare custom elements (structural, not ad-specific)
        if (BARE_CUSTOM_EL_RE.test(sel)) {
          const match = sel.match(BARE_CUSTOM_EL_RE);
          // Allow if the tag name contains "ad" (like shreddit-ad-post)
          if (match && !match[1].includes("-ad")) continue;
        }
        const domains = filter.domains.length > 0 ? filter.domains : ["*"];
        for (const domain of domains) {
          if (!allCosmeticFilters[domain]) allCosmeticFilters[domain] = [];
          allCosmeticFilters[domain].push(sel);
        }
      }
    } catch (e) {
      console.error(`  ERROR processing ${list.name}:`, e);
    }
  }

  // Build streaming-specific DNR ruleset
  console.log("\nBuilding streaming ad ruleset...");
  let streamingRuleId = 1;

  // Block rules for streaming ad domains
  const blockRules = STREAMING_AD_DOMAINS.map((domain) => ({
    id: streamingRuleId++,
    priority: 1,
    action: { type: "block" as const },
    condition: {
      urlFilter: `||${domain}`,
      resourceTypes: [
        "script",
        "xmlhttprequest",
        "sub_frame",
        "media",
        "image",
        "other",
      ],
    },
  }));

  // Global allow rules for sites that EasyPrivacy/EasyList break.
  // No initiatorDomains — allows requests to these domains from anywhere.
  // This protects first-party site functionality. Ad blocking for these sites
  // is handled by content scripts, not DNR.
  const PROTECTED_DOMAINS = [
    // Streaming services (SSAI — ads can't be blocked via DNR anyway)
    "||netflix.com", "||netflix.net", "||nflxvideo.net", "||nflximg.net", "||nflxso.net", "||nflxext.com",
    "||bamgrid.com", "||disneyplus.com", "||dssott.com", "||disney-plus.net", "||disneystreaming.com",
    "||amazon.com", "||primevideo.com", "||aiv-cdn.net", "||aiv-delivery.net", "||atv-ps.amazon.com", "||pv-cdn.net", "||fls-na.amazon.com", "||media-amazon.com",
    "||hulu.com", "||hulustream.com",
    "||peacocktv.com",
    "||max.com", "||hbo.com", "||hbomaxcdn.com",
    // Social / messaging
    "||x.com", "||twitter.com", "||twimg.com", "||t.co",
    "||whatsapp.com", "||whatsapp.net", "||wa.me",
    // Developer tools
    "||github.com", "||github.dev", "||githubapp.com", "||githubusercontent.com",
    // Common sites EasyPrivacy breaks
    "||dropbox.com", "||roblox.com",
  ];

  const ALL_RESOURCE_TYPES = [
    "main_frame", "sub_frame", "stylesheet", "script", "image",
    "font", "object", "xmlhttprequest", "ping", "media",
    "websocket", "other",
  ];

  // Use requestDomains instead of urlFilter — this explicitly matches the
  // request's target domain and ALL paths under it, overriding any generic
  // path-based blocks from EasyPrivacy (like /events, /beacon, /stats).
  const exceptionRules: any[] = [];
  const protectedRequestDomains = PROTECTED_DOMAINS
    .map((p) => p.replace(/^\|\|/, "").replace(/\^$/, ""))
    .filter((d) => !d.includes("/"));  // Only pure domains, no paths

  // One rule per domain for maximum specificity
  for (const domain of protectedRequestDomains) {
    exceptionRules.push({
      id: streamingRuleId++,
      priority: 10,
      action: { type: "allow" as const },
      condition: {
        requestDomains: [domain],
        resourceTypes: ALL_RESOURCE_TYPES,
      },
    });
  }

  // YouTube-specific allow rules: let ad infra through when YouTube is the
  // initiator so YouTube's anti-adblock detection doesn't trigger 503s.
  // The MAIN world script strips ad config so ads never actually play.
  const YT_ALLOWED_DOMAINS = [
    "doubleclick.net",
    "googleadservices.com",
    "googleads.g.doubleclick.net",
    "pagead2.googlesyndication.com",
    "imasdk.googleapis.com",
    "pubads.g.doubleclick.net",
    "googlesyndication.com",
    "google.com",
    "googleusercontent.com",
  ];
  for (const domain of YT_ALLOWED_DOMAINS) {
    exceptionRules.push({
      id: streamingRuleId++,
      priority: 10,
      action: { type: "allow" as const },
      condition: {
        initiatorDomains: ["youtube.com"],
        requestDomains: [domain],
        resourceTypes: ALL_RESOURCE_TYPES,
      },
    });
  }
  // Allow YouTube's own API endpoints — uBlock filter lists block /youtubei/v1/player
  // and /get_watch via DNR which kills SPA navigation, Shorts, and live streams.
  // Those filters work in uBO (scriptlet fallback) but not in DNR-only extensions.
  const YT_ALLOWED_PATHS = [
    "||www.youtube.com/youtubei/",
    "||youtube.com/youtubei/",
  ];
  for (const path of YT_ALLOWED_PATHS) {
    exceptionRules.push({
      id: streamingRuleId++,
      priority: 10,
      action: { type: "allow" as const },
      condition: {
        urlFilter: path,
        initiatorDomains: ["youtube.com"],
        resourceTypes: ALL_RESOURCE_TYPES,
      },
    });
  }

  const streamingRules = [...blockRules, ...exceptionRules];
  writeFileSync(
    `${RULES_DIR}/ruleset_streaming.json`,
    JSON.stringify(streamingRules, null, 2),
  );
  console.log(`  Streaming: ${blockRules.length} block + ${exceptionRules.length} allow = ${streamingRules.length} rules`);

  // Write cosmetic filters map
  writeFileSync(
    `${PUBLIC_DIR}/cosmetic-filters.json`,
    JSON.stringify(allCosmeticFilters, null, 2),
  );

  console.log(`\n[build-filters] Done!`);
  console.log(`  Total DNR rules: ${totalDNRRules}`);
  console.log(`  Total WebKit rules: ${totalWebKitRules}`);
  console.log(
    `  Cosmetic domains: ${Object.keys(allCosmeticFilters).length}`,
  );
  console.log(
    `  Streaming rules: ${streamingRules.length}`,
  );
}

main().catch((e) => {
  console.error("[build-filters] Fatal error:", e);
  process.exit(1);
});

/**
 * Build domain-only DNR ruleset from curated domain blocklists.
 * These are SAFE — blocking entire ad domains never breaks sites
 * because legitimate sites don't serve content from ad domains.
 *
 * Path-based blocking is handled by the MAIN world interceptor script.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";

const RULES_DIR = "public/rules";

const DOMAIN_LISTS = [
  {
    name: "OISD Small",
    url: "https://small.oisd.nl/domainswild",
  },
  {
    name: "Peter Lowe's",
    url: "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=nohtml&showintro=0&mimetype=plaintext",
  },
];

// Additional domains to block that may not be in the lists
const EXTRA_DOMAINS = [
  "sentry-cdn.com",
  "browser.sentry-cdn.com",
  "js.sentry-cdn.com",
  "static.cloudflareinsights.com",
  "cloudflareinsights.com",
  "hotjar.com",
  "static.hotjar.com",
  "script.hotjar.com",
  "vars.hotjar.com",
  "ymatuhin.ru",
  "chaturbate.jjgirls.com",
  "jdrucker.com",
  "popads.net",
  "serve.popads.net",
  "exoclick.com",
  "syndication.exoclick.com",
  "juicyads.com",
  "ads.juicyads.com",
  "pagead2.googlesyndication.com",
  "d2wy8f7a9ursnm.cloudfront.net",
  "d2fltix0v2e0sb.cloudfront.net",
];

async function downloadList(url: string): Promise<string> {
  console.log(`  Downloading: ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed: ${response.status}`);
  return response.text();
}

function parseDomains(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || line.startsWith("#") || line.startsWith("!")) return false;
      // Remove wildcard prefix
      if (line.startsWith("*.")) line = line.slice(2);
      // Must look like a domain
      return line.includes(".") && !line.includes("/") && !line.includes(" ");
    })
    .map((line) => (line.startsWith("*.") ? line.slice(2) : line).toLowerCase());
}

async function main() {
  console.log("[build-domain-rules] Building domain-only DNR ruleset...\n");

  if (!existsSync(RULES_DIR)) mkdirSync(RULES_DIR, { recursive: true });

  const allDomains = new Set<string>();

  // Add extra domains first
  for (const d of EXTRA_DOMAINS) {
    allDomains.add(d.toLowerCase());
  }

  for (const list of DOMAIN_LISTS) {
    console.log(`Processing: ${list.name}`);
    try {
      const text = await downloadList(list.url);
      const domains = parseDomains(text);
      domains.forEach((d) => allDomains.add(d));
      console.log(`  ${domains.length} domains\n`);
    } catch (e) {
      console.error(`  ERROR: ${e}\n`);
    }
  }

  // Build DNR rules — batch domains into groups to stay under 330K rule limit
  // Each rule can have multiple requestDomains
  const BATCH_SIZE = 50; // Keep batches small — Chrome may reject large requestDomains arrays
  const sortedDomains = Array.from(allDomains).sort();
  const rules: any[] = [];
  const resourceTypes = [
    "script", "image", "stylesheet", "sub_frame",
    "xmlhttprequest", "media", "font", "ping",
    "websocket", "other",
  ];

  // urlFilter "||domain^" — matches domain + all subdomains.
  // requestDomains was silently failing in Chrome with batched arrays.
  const MAX_RULES = 329000;
  const capped = sortedDomains.slice(0, MAX_RULES);
  if (sortedDomains.length > MAX_RULES) {
    console.log(`  Capped at ${MAX_RULES} (had ${sortedDomains.length})`);
  }
  for (const domain of capped) {
    rules.push({
      id: rules.length + 1,
      priority: 1,
      action: { type: "block" as const },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes,
      },
    });
  }

  writeFileSync(
    `${RULES_DIR}/ruleset_domains.json`,
    JSON.stringify(rules, null, 2),
  );

  console.log(`[build-domain-rules] Done!`);
  console.log(`  ${rules.length} domain block rules → ${RULES_DIR}/ruleset_domains.json`);
}

main().catch((e) => {
  console.error("[build-domain-rules] Fatal:", e);
  process.exit(1);
});

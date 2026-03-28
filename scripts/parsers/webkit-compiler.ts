/**
 * WebKit Content Blocker Compiler — converts parsed ABP filters to Safari's JSON format.
 *
 * Safari Content Blocker JSON format:
 *   [{ "trigger": { "url-filter": "..." }, "action": { "type": "block" } }, ...]
 *
 * Limit: 150,000 rules per content blocker.
 */

import type { NetworkFilter, CosmeticFilter } from "./abp-parser";

// --- Types ---

export interface WebKitRule {
  trigger: {
    "url-filter": string;
    "url-filter-is-case-sensitive"?: boolean;
    "resource-type"?: string[];
    "load-type"?: ("first-party" | "third-party")[];
    "if-domain"?: string[];
    "unless-domain"?: string[];
  };
  action: {
    type: "block" | "ignore-previous-rules" | "css-display-none";
    selector?: string;
  };
}

const MAX_WEBKIT_RULES = 140000; // leave headroom below 150K

// Resource type mapping (ABP → WebKit)
const WEBKIT_RESOURCE_TYPES: Record<string, string> = {
  script: "script",
  image: "image",
  stylesheet: "style-sheet",
  sub_frame: "document",
  main_frame: "document",
  xmlhttprequest: "raw",
  font: "font",
  media: "media",
  websocket: "websocket",
  other: "raw",
  ping: "ping",
  object: "plugin",
};

// --- Compiler ---

export function compileToWebKit(
  networkFilters: NetworkFilter[],
  cosmeticFilters: CosmeticFilter[],
): WebKitRule[] {
  const rules: WebKitRule[] = [];

  // Network filters → block/ignore-previous-rules
  for (const filter of networkFilters) {
    if (rules.length >= MAX_WEBKIT_RULES) break;
    if (filter.isCsp || filter.isRedirect) continue;

    const rule = compileNetworkFilter(filter);
    if (rule) rules.push(rule);
  }

  // Cosmetic filters → css-display-none
  for (const filter of cosmeticFilters) {
    if (rules.length >= MAX_WEBKIT_RULES) break;
    if (filter.isScriptlet || filter.isException) continue;

    const rule = compileCosmeticFilter(filter);
    if (rule) rules.push(rule);
  }

  return rules;
}

function compileNetworkFilter(filter: NetworkFilter): WebKitRule | null {
  const urlFilter = abpPatternToRegex(filter);
  if (!urlFilter) return null;

  const trigger: WebKitRule["trigger"] = {
    "url-filter": urlFilter,
  };

  // Resource types
  if (filter.resourceTypes.length > 0) {
    const webkitTypes = filter.resourceTypes
      .map((t) => WEBKIT_RESOURCE_TYPES[t])
      .filter(Boolean);
    if (webkitTypes.length > 0) {
      trigger["resource-type"] = webkitTypes;
    }
  }

  // Load type
  if (filter.thirdParty === true) {
    trigger["load-type"] = ["third-party"];
  } else if (filter.firstParty === true || filter.thirdParty === false) {
    trigger["load-type"] = ["first-party"];
  }

  // Domain constraints
  if (filter.domains.length > 0) {
    trigger["if-domain"] = filter.domains.map((d) => `*${d}`);
  }
  if (filter.excludedDomains.length > 0) {
    trigger["unless-domain"] = filter.excludedDomains.map((d) => `*${d}`);
  }

  const action: WebKitRule["action"] = {
    type: filter.isException ? "ignore-previous-rules" : "block",
  };

  return { trigger, action };
}

function compileCosmeticFilter(filter: CosmeticFilter): WebKitRule | null {
  // Only simple CSS selectors can be expressed as css-display-none
  const selector = filter.selector.trim();
  if (!selector || selector.includes("+js(")) return null;

  const trigger: WebKitRule["trigger"] = {
    "url-filter": ".*",
  };

  if (filter.domains.length > 0) {
    trigger["if-domain"] = filter.domains.map((d) => `*${d}`);
  }
  if (filter.excludedDomains.length > 0) {
    trigger["unless-domain"] = filter.excludedDomains.map((d) => `*${d}`);
  }

  return {
    trigger,
    action: {
      type: "css-display-none",
      selector,
    },
  };
}

/**
 * Convert ABP pattern to a regex string for WebKit's url-filter.
 */
function abpPatternToRegex(filter: NetworkFilter): string | null {
  if (filter.isRegex) return filter.pattern;

  let pattern = filter.pattern;
  if (!pattern) return null;

  // Escape regex special characters (except ABP wildcards)
  pattern = pattern.replace(/([.+?{}()[\]\\])/g, "\\$1");

  // ABP `*` → regex `.*`
  pattern = pattern.replace(/\*/g, ".*");

  // ABP `^` → separator class
  pattern = pattern.replace(/\^/g, "[^a-zA-Z0-9_.%-]");

  // Anchoring
  let regex = "";
  if (filter.isHostnameAnchor) {
    regex = "^[^:]+://([^/]*\\.)?" + pattern;
  } else if (filter.isLeftAnchor) {
    regex = "^" + pattern;
  } else {
    regex = pattern;
  }

  if (filter.isRightAnchor) {
    regex += "$";
  }

  // Validate regex
  try {
    new RegExp(regex);
  } catch {
    return null;
  }

  return regex;
}

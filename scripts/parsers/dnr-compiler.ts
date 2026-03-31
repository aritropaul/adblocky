/**
 * DNR Compiler — converts parsed ABP network filters to Chrome declarativeNetRequest JSON rules.
 *
 * Chrome MV3 limits (updated Jan 2026):
 *   - 330,000 safe static rules total across all enabled rulesets
 *   - 1,000 regex rules per ruleset
 *   - Each rule ID must be unique within a ruleset
 */

import type { NetworkFilter } from "./abp-parser";

// --- Types ---

export interface DNRRule {
  id: number;
  priority: number;
  action: {
    type: "block" | "allow" | "upgradeScheme" | "redirect" | "modifyHeaders";
    redirect?: { url?: string; extensionPath?: string };
  };
  condition: {
    urlFilter?: string;
    regexFilter?: string;
    isUrlFilterCaseSensitive?: boolean;
    domains?: string[];
    excludedDomains?: string[];
    initiatorDomains?: string[];
    excludedInitiatorDomains?: string[];
    resourceTypes?: string[];
    excludedResourceTypes?: string[];
    domainType?: "firstParty" | "thirdParty";
  };
}

const MAX_RULES_PER_RULESET = 150000; // Chrome MV3 allows 330K total across all rulesets
const MAX_REGEX_RULES = 900; // leave headroom below 1K

// --- Compiler ---

export function compileToDNR(
  filters: NetworkFilter[],
  rulesetId: string,
): DNRRule[] {
  const rules: DNRRule[] = [];
  let regexCount = 0;
  let ruleId = 1;

  for (const filter of filters) {
    if (rules.length >= MAX_RULES_PER_RULESET) {
      console.warn(
        `[dnr-compiler] Ruleset ${rulesetId} hit ${MAX_RULES_PER_RULESET} rule cap, skipping remaining`,
      );
      break;
    }

    // Skip filters we can't express in DNR
    if (filter.isCsp || filter.isRedirect || filter.isRemoveParam) continue;

    const rule = compileFilter(filter, ruleId);
    if (!rule) continue;

    // Check regex limit and complexity
    if (rule.condition.regexFilter) {
      if (regexCount >= MAX_REGEX_RULES) continue;
      // Chrome RE2 engine rejects regexes that compile to >2KB bytecode.
      // Drop overly complex patterns (lookaheads, long alternations, 80+ chars).
      const re = rule.condition.regexFilter;
      if (re.length > 80 || re.includes("(?!") || re.includes("(?=") || re.includes("(?<")) {
        continue;
      }
      regexCount++;
    }

    // Drop wildcard rules without domain scope — they block everything
    const uf = rule.condition.urlFilter;
    if (
      (uf === "*" || uf === "||*" || !uf) &&
      !rule.condition.initiatorDomains?.length &&
      !rule.condition.requestDomains?.length &&
      rule.action.type === "block"
    ) {
      continue;
    }

    rules.push(rule);
    ruleId++;
  }

  return rules;
}

function compileFilter(filter: NetworkFilter, id: number): DNRRule | null {
  const condition: DNRRule["condition"] = {};

  // URL filter
  if (filter.isRegex) {
    try {
      // Validate regex
      new RegExp(filter.pattern);
      condition.regexFilter = filter.pattern;
    } catch {
      return null; // invalid regex
    }
  } else {
    const urlFilter = buildUrlFilter(filter);
    if (!urlFilter) return null;
    condition.urlFilter = urlFilter;
    condition.isUrlFilterCaseSensitive = false;
  }

  // Domain constraints
  if (filter.domains.length > 0) {
    condition.initiatorDomains = filter.domains;
  }
  if (filter.excludedDomains.length > 0) {
    condition.excludedInitiatorDomains = filter.excludedDomains;
  }

  // Resource types
  if (filter.resourceTypes.length > 0) {
    condition.resourceTypes = filter.resourceTypes;
  }
  if (filter.excludedResourceTypes.length > 0) {
    condition.excludedResourceTypes = filter.excludedResourceTypes;
  }

  // Party type
  if (filter.thirdParty === true) {
    condition.domainType = "thirdParty";
  } else if (filter.firstParty === true || filter.thirdParty === false) {
    condition.domainType = "firstParty";
  }

  // Action type
  const actionType: DNRRule["action"]["type"] = filter.isException
    ? "allow"
    : "block";

  // Priority: exceptions get higher priority; $important gets highest
  let priority = 1;
  if (filter.isException) priority = 2;
  if (filter.isImportant) priority = 3;

  return {
    id,
    priority,
    action: { type: actionType },
    condition,
  };
}

/**
 * Convert ABP pattern syntax to DNR urlFilter syntax.
 *
 * ABP anchors:
 *   || = hostname anchor → || in DNR
 *   |  = start anchor → | in DNR
 *   ^  = separator (non-alphanumeric except _.-%) — approximated
 *   *  = wildcard → * in DNR
 */
function buildUrlFilter(filter: NetworkFilter): string | null {
  let pattern = filter.pattern;

  if (!pattern) return null;

  let urlFilter = "";

  if (filter.isHostnameAnchor) {
    // Chrome DNR does not allow `*` immediately after `||`
    if (pattern.startsWith("*")) return null;
    urlFilter = "||" + pattern;
  } else if (filter.isLeftAnchor) {
    urlFilter = "|" + pattern;
  } else {
    urlFilter = pattern;
  }

  if (filter.isRightAnchor) {
    urlFilter += "|";
  }

  return urlFilter;
}

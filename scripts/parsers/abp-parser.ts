/**
 * ABP (Adblock Plus) / uBlock Origin filter syntax parser.
 * Parses filter list text into an intermediate representation (IR).
 */

// --- Types ---

export interface NetworkFilter {
  raw: string;
  pattern: string;
  isException: boolean;
  isRegex: boolean;
  // Anchoring
  isHostnameAnchor: boolean; // ||
  isLeftAnchor: boolean; // |
  isRightAnchor: boolean; // |$
  // Options
  thirdParty: boolean | null; // null = not specified
  firstParty: boolean | null;
  domains: string[]; // $domain= include domains
  excludedDomains: string[]; // $domain= excluded (~domain)
  resourceTypes: string[]; // $script, $image, etc.
  excludedResourceTypes: string[];
  // Special
  isImportant: boolean; // $important
  isRedirect: boolean;
  redirectName: string;
  isCsp: boolean;
  cspDirective: string;
}

export interface CosmeticFilter {
  raw: string;
  selector: string;
  domains: string[];
  excludedDomains: string[];
  isException: boolean; // #@# exception
  isScriptlet: boolean; // +js(...)
  scriptletName: string;
  scriptletArgs: string[];
}

export interface ParsedFilterList {
  networkFilters: NetworkFilter[];
  cosmeticFilters: CosmeticFilter[];
  metadata: Record<string, string>;
}

// --- Resource type mapping ---

const RESOURCE_TYPE_MAP: Record<string, string> = {
  script: "script",
  image: "image",
  stylesheet: "stylesheet",
  "sub_frame": "sub_frame",
  subdocument: "sub_frame",
  xmlhttprequest: "xmlhttprequest",
  xhr: "xmlhttprequest",
  object: "object",
  ping: "ping",
  media: "media",
  font: "font",
  websocket: "websocket",
  other: "other",
  "main_frame": "main_frame",
  document: "main_frame",
  popup: "main_frame",
};

// --- Parser ---

export function parseFilterList(text: string): ParsedFilterList {
  const lines = text.split("\n");
  const networkFilters: NetworkFilter[] = [];
  const cosmeticFilters: CosmeticFilter[] = [];
  const metadata: Record<string, string> = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip empty lines
    if (!line) continue;

    // Metadata comments (! Key: Value)
    if (line.startsWith("!")) {
      const match = line.match(/^!\s*(\w[\w\s]*?):\s*(.+)/);
      if (match) {
        metadata[match[1].trim()] = match[2].trim();
      }
      continue;
    }

    // Skip [Adblock Plus ...] header
    if (line.startsWith("[")) continue;

    // Cosmetic filter (## or #@# or #?# or #+js)
    const cosmeticMatch = line.match(
      /^([^#]*?)(#@?\??#\+?js\(|#@?\??#)(.+)$/,
    );
    if (cosmeticMatch) {
      const cosmetic = parseCosmeticFilter(
        line,
        cosmeticMatch[1],
        cosmeticMatch[2],
        cosmeticMatch[3],
      );
      if (cosmetic) cosmeticFilters.push(cosmetic);
      continue;
    }

    // Network filter
    const network = parseNetworkFilter(line);
    if (network) networkFilters.push(network);
  }

  return { networkFilters, cosmeticFilters, metadata };
}

function parseCosmeticFilter(
  raw: string,
  domainPart: string,
  separator: string,
  selectorPart: string,
): CosmeticFilter | null {
  const isException = separator.includes("#@#");
  const isScriptlet =
    separator.includes("+js(") || selectorPart.startsWith("+js(");

  let selector = selectorPart;
  let scriptletName = "";
  let scriptletArgs: string[] = [];

  if (isScriptlet) {
    // Parse +js(name, arg1, arg2)
    const full = selector.startsWith("+js(") ? selector : `+js(${selector}`;
    const inner = full.replace(/^\+js\(/, "").replace(/\)$/, "");
    const parts = inner.split(",").map((s) => s.trim());
    scriptletName = parts[0] || "";
    scriptletArgs = parts.slice(1);
    selector = full;
  }

  // Parse domains
  const domains: string[] = [];
  const excludedDomains: string[] = [];
  if (domainPart) {
    for (const d of domainPart.split(",")) {
      const domain = d.trim();
      if (!domain) continue;
      if (domain.startsWith("~")) {
        excludedDomains.push(domain.slice(1));
      } else {
        domains.push(domain);
      }
    }
  }

  return {
    raw,
    selector,
    domains,
    excludedDomains,
    isException,
    isScriptlet,
    scriptletName,
    scriptletArgs,
  };
}

function parseNetworkFilter(line: string): NetworkFilter | null {
  let raw = line;
  let isException = false;

  // Exception filter (@@)
  if (line.startsWith("@@")) {
    isException = true;
    line = line.slice(2);
  }

  // Split pattern from options ($)
  let pattern = line;
  let optionsStr = "";
  const dollarIdx = findOptionsSeparator(line);
  if (dollarIdx >= 0) {
    pattern = line.slice(0, dollarIdx);
    optionsStr = line.slice(dollarIdx + 1);
  }

  // Skip empty patterns
  if (!pattern && !optionsStr) return null;

  // Anchoring
  let isHostnameAnchor = false;
  let isLeftAnchor = false;
  let isRightAnchor = false;

  if (pattern.startsWith("||")) {
    isHostnameAnchor = true;
    pattern = pattern.slice(2);
  } else if (pattern.startsWith("|")) {
    isLeftAnchor = true;
    pattern = pattern.slice(1);
  }

  if (pattern.endsWith("|")) {
    isRightAnchor = true;
    pattern = pattern.slice(0, -1);
  }

  // Detect regex
  const isRegex = pattern.startsWith("/") && pattern.endsWith("/");
  if (isRegex) {
    pattern = pattern.slice(1, -1);
  }

  // Parse options
  const options = parseOptions(optionsStr);

  return {
    raw,
    pattern,
    isException,
    isRegex,
    isHostnameAnchor,
    isLeftAnchor,
    isRightAnchor,
    ...options,
  };
}

/**
 * Find the `$` that separates pattern from options.
 * Must not be inside a regex or part of `$domain`.
 */
function findOptionsSeparator(line: string): number {
  // If the line starts with /, it might be a regex — find closing /
  if (line.startsWith("/")) {
    const closingSlash = line.lastIndexOf("/");
    if (closingSlash > 0) {
      // Options come after the closing slash's $
      const afterRegex = line.indexOf("$", closingSlash);
      return afterRegex >= 0 ? afterRegex : -1;
    }
  }

  // Find last $ that's likely the options separator
  // We look for $ not preceded by an escape
  for (let i = line.length - 1; i >= 0; i--) {
    if (line[i] === "$" && (i === 0 || line[i - 1] !== "\\")) {
      // Verify the part after $ looks like options
      const after = line.slice(i + 1);
      if (looksLikeOptions(after)) return i;
    }
  }

  return -1;
}

function looksLikeOptions(str: string): boolean {
  if (!str) return false;
  const knownOptions = [
    "script",
    "image",
    "stylesheet",
    "sub_frame",
    "subdocument",
    "xmlhttprequest",
    "xhr",
    "object",
    "ping",
    "media",
    "font",
    "websocket",
    "other",
    "document",
    "main_frame",
    "popup",
    "third-party",
    "3p",
    "first-party",
    "1p",
    "domain",
    "important",
    "redirect",
    "redirect-rule",
    "csp",
    "removeparam",
    "all",
    "match-case",
    "badfilter",
    "~script",
    "~image",
    "~stylesheet",
    "~sub_frame",
    "~subdocument",
    "~xmlhttprequest",
    "~xhr",
    "~third-party",
    "~3p",
    "~first-party",
    "~1p",
    "~object",
    "~media",
    "~font",
    "~websocket",
    "~document",
    "~main_frame",
    "~other",
    "~ping",
  ];
  const first = str.split(",")[0].split("=")[0].trim().toLowerCase();
  return knownOptions.includes(first);
}

interface ParsedOptions {
  thirdParty: boolean | null;
  firstParty: boolean | null;
  domains: string[];
  excludedDomains: string[];
  resourceTypes: string[];
  excludedResourceTypes: string[];
  isImportant: boolean;
  isRedirect: boolean;
  redirectName: string;
  isCsp: boolean;
  cspDirective: string;
}

function parseOptions(optionsStr: string): ParsedOptions {
  const result: ParsedOptions = {
    thirdParty: null,
    firstParty: null,
    domains: [],
    excludedDomains: [],
    resourceTypes: [],
    excludedResourceTypes: [],
    isImportant: false,
    isRedirect: false,
    redirectName: "",
    isCsp: false,
    cspDirective: "",
  };

  if (!optionsStr) return result;

  for (const opt of optionsStr.split(",")) {
    const option = opt.trim().toLowerCase();

    if (option === "third-party" || option === "3p") {
      result.thirdParty = true;
    } else if (option === "~third-party" || option === "~3p") {
      result.thirdParty = false;
    } else if (option === "first-party" || option === "1p") {
      result.firstParty = true;
    } else if (option === "~first-party" || option === "~1p") {
      result.firstParty = false;
    } else if (option === "important") {
      result.isImportant = true;
    } else if (option.startsWith("domain=")) {
      const domainStr = opt.trim().slice("domain=".length);
      for (const d of domainStr.split("|")) {
        const domain = d.trim();
        if (domain.startsWith("~")) {
          result.excludedDomains.push(domain.slice(1));
        } else {
          result.domains.push(domain);
        }
      }
    } else if (option.startsWith("redirect=") || option.startsWith("redirect-rule=")) {
      result.isRedirect = true;
      result.redirectName = opt.split("=")[1]?.trim() || "";
    } else if (option.startsWith("csp=")) {
      result.isCsp = true;
      result.cspDirective = opt.slice("csp=".length).trim();
    } else if (option.startsWith("~")) {
      const type = RESOURCE_TYPE_MAP[option.slice(1)];
      if (type) result.excludedResourceTypes.push(type);
    } else {
      const type = RESOURCE_TYPE_MAP[option];
      if (type) result.resourceTypes.push(type);
    }
  }

  return result;
}

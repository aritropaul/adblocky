/**
 * DASH MPD manifest ad Period removal.
 *
 * Inspired by uBlock Origin's xml-prune scriptlet. Parses DASH manifests
 * with DOMParser, removes ad Period elements, serializes back.
 *
 * Proven configurations from uBO filter lists:
 * - Hulu: Remove Period[id^="Ad"], remove MPD/@mediaPresentationDuration
 * - Paramount+: Remove Period[id*="-roll-"][id*="-ad-"]
 */

import type { ResponseInterceptor } from "./fetch-proxy";

export interface XMLPruneOptions {
  /** CSS selectors for elements to remove (e.g., 'Period[id^="Ad"]') */
  removeSelectors?: string[];
  /** Attributes to remove from matching elements */
  removeAttributes?: { selector: string; attribute: string }[];
}

/**
 * Prune ad elements from an XML/MPD manifest.
 */
export function pruneXML(xmlText: string, options: XMLPruneOptions): string {
  const { removeSelectors = [], removeAttributes = [] } = options;

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");

  // Check for parse errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) return xmlText;

  let modified = false;

  // Remove matching elements
  for (const selector of removeSelectors) {
    const elements = doc.querySelectorAll(selector);
    for (const el of elements) {
      el.parentNode?.removeChild(el);
      modified = true;
    }
  }

  // Remove matching attributes
  for (const { selector, attribute } of removeAttributes) {
    const elements = doc.querySelectorAll(selector);
    for (const el of elements) {
      if (el.hasAttribute(attribute)) {
        el.removeAttribute(attribute);
        modified = true;
      }
    }
  }

  if (!modified) return xmlText;

  const serializer = new XMLSerializer();
  return serializer.serializeToString(doc);
}

/**
 * Create a ResponseInterceptor that prunes DASH MPD manifests.
 * Register with addFetchInterceptor().
 */
export function createXMLInterceptor(
  urlFilter: (url: string) => boolean,
  options: XMLPruneOptions,
): ResponseInterceptor {
  return async (url, response) => {
    if (!urlFilter(url)) return null;

    try {
      const text = await response.clone().text();

      // Quick check: is this an MPD?
      if (!text.includes("<MPD") && !text.includes("<SmoothStreamingMedia")) {
        return null;
      }

      const pruned = pruneXML(text, options);
      if (pruned === text) return null;

      return new Response(pruned, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return null;
    }
  };
}

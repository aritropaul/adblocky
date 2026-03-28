/**
 * Vitest setup — mock browser extension APIs.
 */

import { vi } from "vitest";
import { DOMParser, XMLSerializer } from "linkedom";

// Mock the global `browser` namespace used by WXT
const mockStorage: Record<string, unknown> = {};

const browserMock = {
  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://mock-id/${path}`),
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
    onInstalled: {
      addListener: vi.fn(),
    },
    openOptionsPage: vi.fn(),
  },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: mockStorage[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
      }),
    },
  },
  tabs: {
    query: vi.fn(),
    onUpdated: { addListener: vi.fn() },
    onRemoved: { addListener: vi.fn() },
  },
  declarativeNetRequest: {
    updateEnabledRulesets: vi.fn(),
    updateDynamicRules: vi.fn(),
    getDynamicRules: vi.fn(async () => []),
    onRuleMatchedDebug: { addListener: vi.fn() },
  },
};

// @ts-expect-error — mock globals
globalThis.browser = browserMock;
// @ts-expect-error — mock globals
globalThis.chrome = browserMock;

// Provide DOM APIs for XML/HTML parsing tests (not available in Node)
// @ts-expect-error — polyfill for Node environment
globalThis.DOMParser = DOMParser;

// linkedom doesn't export XMLSerializer — shim using doc.toString()
class XMLSerializerShim {
  serializeToString(doc: any): string {
    return doc.toString();
  }
}
// @ts-expect-error — polyfill for Node environment
globalThis.XMLSerializer = XMLSerializerShim;

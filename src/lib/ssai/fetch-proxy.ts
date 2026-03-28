/**
 * Shared fetch/XHR interception infrastructure.
 *
 * Solves the problem of multiple content scripts each overriding window.fetch
 * independently. One installFetchProxy() call, all platforms register
 * interceptors and blockers on the single proxy.
 */

declare global {
  interface Window {
    __adb_fetch_proxy?: {
      interceptors: ResponseInterceptor[];
      blockers: RequestBlocker[];
      originalFetch: typeof fetch;
    };
    __adb_xhr_proxy?: {
      blockers: XHRBlocker[];
      originalOpen: typeof XMLHttpRequest.prototype.open;
      originalSend: typeof XMLHttpRequest.prototype.send;
    };
  }
}

/** Post-response interceptor: modify the Response before the caller sees it */
export type ResponseInterceptor = (
  url: string,
  response: Response,
  request: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response | null>; // null = pass through unchanged

/** Pre-request blocker: return a Response to short-circuit (block) the request */
export type RequestBlocker = (
  url: string,
  request: RequestInfo | URL,
  init?: RequestInit,
) => Response | null; // non-null = blocked with this response

/** XHR blocker: return truthy to block, with optional fake response */
export type XHRBlocker = (url: string) => {
  status: number;
  responseText: string;
  contentType?: string;
} | null;

function extractURL(input: RequestInfo | URL, init?: RequestInit): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input?.url || "";
}

/**
 * Install fetch proxy. Idempotent — safe to call from multiple content scripts.
 * Overrides window.fetch exactly once, stores original in closure.
 */
export function installFetchProxy(): void {
  if (window.__adb_fetch_proxy) return;

  const originalFetch = window.fetch.bind(window);

  const state: Window["__adb_fetch_proxy"] = {
    interceptors: [],
    blockers: [],
    originalFetch,
  };
  window.__adb_fetch_proxy = state;

  window.fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = extractURL(input, init);

    // Phase 1: Check blockers (pre-request)
    for (const blocker of state!.blockers) {
      const blocked = blocker(url, input, init);
      if (blocked) return blocked;
    }

    // Phase 2: Execute actual fetch
    const response = await originalFetch(input, init);

    // Phase 3: Run interceptors (post-response)
    let result = response;
    for (const interceptor of state!.interceptors) {
      try {
        const modified = await interceptor(url, result, input, init);
        if (modified) result = modified;
      } catch {
        // Interceptor error — pass through
      }
    }

    return result;
  };
}

/** Add a response interceptor to the proxy */
export function addFetchInterceptor(interceptor: ResponseInterceptor): void {
  if (!window.__adb_fetch_proxy) installFetchProxy();
  window.__adb_fetch_proxy!.interceptors.push(interceptor);
}

/** Add a request blocker to the proxy */
export function addRequestBlocker(blocker: RequestBlocker): void {
  if (!window.__adb_fetch_proxy) installFetchProxy();
  window.__adb_fetch_proxy!.blockers.push(blocker);
}

/** Get the original (unproxied) fetch function */
export function getOriginalFetch(): typeof fetch {
  return window.__adb_fetch_proxy?.originalFetch ?? window.fetch.bind(window);
}

/**
 * Install XHR proxy for platforms that use XMLHttpRequest (e.g. FreeWheel VAST).
 * Idempotent.
 */
export function installXHRProxy(): void {
  if (window.__adb_xhr_proxy) return;

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  const state: Window["__adb_xhr_proxy"] = {
    blockers: [],
    originalOpen,
    originalSend,
  };
  window.__adb_xhr_proxy = state;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: any[]
  ) {
    const urlStr = url.toString();
    (this as any)._adb_url = urlStr;

    for (const blocker of state!.blockers) {
      const result = blocker(urlStr);
      if (result) {
        (this as any)._adb_blocked = result;
        return;
      }
    }

    return originalOpen.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function (...args: any[]) {
    const blocked = (this as any)._adb_blocked;
    if (blocked) {
      Object.defineProperty(this, "status", { value: blocked.status, writable: false });
      Object.defineProperty(this, "responseText", { value: blocked.responseText, writable: false });
      Object.defineProperty(this, "readyState", { value: 4, writable: false });
      this.dispatchEvent(new Event("load"));
      return;
    }
    return originalSend.apply(this, args as any);
  };
}

/** Add an XHR blocker */
export function addXHRBlocker(blocker: XHRBlocker): void {
  if (!window.__adb_xhr_proxy) installXHRProxy();
  window.__adb_xhr_proxy!.blockers.push(blocker);
}

/**
 * Observe fetched resource URLs passively via PerformanceObserver.
 * Does NOT override fetch — safe for anti-adblock-sensitive platforms.
 */
export function observeResourceLoads(
  urlFilter: (url: string) => boolean,
  callback: (url: string) => void,
): { stop: () => void } {
  const seen = new Set<string>();

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const url = (entry as PerformanceResourceTiming).name;
      if (url && urlFilter(url) && !seen.has(url)) {
        seen.add(url);
        callback(url);
      }
    }
  });

  observer.observe({ type: "resource", buffered: true });

  return {
    stop: () => observer.disconnect(),
  };
}

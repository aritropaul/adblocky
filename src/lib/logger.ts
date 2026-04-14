/**
 * Cross-context persistent logger.
 *
 * Writes a ring buffer to chrome.storage.local so events from background,
 * content scripts, popup, and options all end up in one place that is
 * viewable live in Options → Debug tab.
 *
 * Usage:
 *   import { log } from "@/lib/logger";
 *   log.info("youtube", "Ad detected", { duration: 5 });
 *   log.warn("hulu", "Rate override rejected");
 *   log.error("popup-blocker", "Failed to block", err);
 *
 * Background context writes storage directly. Content/popup/options forward
 * via chrome.runtime.sendMessage({ type: "LOG_EVENT" }) — the background
 * handler (src/entrypoints/background.ts) appends it.
 */

export const LOG_KEY = "adb_log";
export const LOG_MAX = 2000;

export type LogLevel = "info" | "warn" | "error" | "block";

export interface LogEntry {
  ts: number;
  level: LogLevel;
  module: string;
  msg: string;
  data?: unknown;
  url?: string;
  tabId?: number;
}

const MODULE_COLORS: Record<string, string> = {
  netflix: "#e50914",
  hulu: "#1ce783",
  "hbo-max": "#b535f6",
  "disney+": "#113ccf",
  amazon: "#00a8e1",
  peacock: "#000",
  twitch: "#9146ff",
  youtube: "#ff0000",
  spotify: "#1db954",
  paramount: "#0064ff",
  pluto: "#2ecc40",
  roku: "#6c3c97",
  tubi: "#fa382f",
  crunchyroll: "#f47521",
  "popup-blocker": "#ff6b35",
  "anti-adblock": "#ffd700",
  "cookie-consent": "#4ecdc4",
  "tracking-params": "#95afc0",
  annoyances: "#eb4d4b",
  cosmetic: "#686de0",
  interceptor: "#f9ca24",
  background: "#535c68",
  block: "#ef4444",
  settings: "#10b981",
  default: "#888",
};

function getColor(module: string): string {
  return MODULE_COLORS[module] || MODULE_COLORS.default;
}

function isBackground(): boolean {
  // MV3 service worker: no `window`. Content scripts & popup/options have it.
  return typeof window === "undefined";
}

/**
 * POST entry to local dev log sink (scripts/log-sink.py on :9999).
 * Best-effort: if sink isn't running, silently skip. Keeps working in
 * production where the user hasn't started the sink.
 */
const SINK_URL = "http://127.0.0.1:9999/adb-log";
let sinkFailedOnce = false; // after first failure, stop spamming console errors

async function postToSink(entry: LogEntry): Promise<void> {
  try {
    await fetch(SINK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
      // Don't keep the connection alive for dev sink
      keepalive: false,
    });
    sinkFailedOnce = false;
  } catch (e) {
    if (!sinkFailedOnce) {
      sinkFailedOnce = true;
      // Silent — sink not running is normal
    }
  }
}

/** Background-only: append entry to persistent ring buffer + POST to sink. */
export async function appendEntry(entry: LogEntry): Promise<void> {
  // Fire-and-forget to the local sink
  postToSink(entry);

  try {
    const stored = await chrome.storage.local.get(LOG_KEY);
    const buf: LogEntry[] = Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY] : [];
    buf.push(entry);
    if (buf.length > LOG_MAX) buf.splice(0, buf.length - LOG_MAX);
    await chrome.storage.local.set({ [LOG_KEY]: buf });
  } catch (e) {
    console.error("[adb:logger] append failed", e);
  }
}

export async function getLog(): Promise<LogEntry[]> {
  const stored = await chrome.storage.local.get(LOG_KEY);
  return Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY] : [];
}

export async function clearLog(): Promise<void> {
  await chrome.storage.local.set({ [LOG_KEY]: [] });
}

function emit(entry: LogEntry) {
  // Console echo with module color
  const color = getColor(entry.module);
  const prefix = `%c[adblocky]%c ${entry.module} %c${entry.msg}`;
  const styles = [
    "color:#10b981;font-weight:bold",
    `color:${color};font-weight:bold`,
    "color:inherit",
  ];
  const args: unknown[] = [prefix, ...styles];
  if (entry.data !== undefined) args.push(entry.data);

  if (entry.level === "error") console.error(...args);
  else if (entry.level === "warn") console.warn(...args);
  else console.log(...args);

  // Persist
  if (isBackground()) {
    appendEntry(entry);
  } else {
    try {
      chrome.runtime
        .sendMessage({ type: "LOG_EVENT", payload: entry })
        .catch?.(() => {});
    } catch {
      // Extension context invalidated (reload in progress) — drop
    }
  }
}

function build(
  level: LogLevel,
  module: string,
  msg: string,
  data?: unknown,
): LogEntry {
  const entry: LogEntry = { ts: Date.now(), level, module, msg };
  if (data !== undefined) entry.data = sanitize(data);
  if (typeof location !== "undefined") entry.url = location.href;
  return entry;
}

/** Strip non-serializable fields (Error → {name,message,stack}, drop DOM, functions). */
function sanitize(v: unknown): unknown {
  if (v instanceof Error) {
    return { name: v.name, message: v.message, stack: v.stack };
  }
  if (v === null || typeof v !== "object") return v;
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}

export const log = {
  info(module: string, msg: string, data?: unknown) {
    emit(build("info", module, msg, data));
  },
  warn(module: string, msg: string, data?: unknown) {
    emit(build("warn", module, msg, data));
  },
  error(module: string, msg: string, data?: unknown) {
    emit(build("error", module, msg, data));
  },
  block(module: string, msg: string, data?: unknown) {
    emit(build("block", module, msg, data));
  },
};

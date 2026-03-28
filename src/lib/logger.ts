/**
 * Centralized logging for the adblocky extension.
 *
 * Usage:
 *   import { log } from "@/lib/logger";
 *   log.info("netflix", "Ad detected", { selector: "...", remaining: 31 });
 *   log.warn("hulu", "Rate override rejected");
 *   log.error("popup-blocker", "Failed to block", error);
 *
 * Logs are:
 * - Prefixed with [adblocky] for easy filtering in DevTools
 * - Color-coded by module
 * - Stored in memory for the options page debug panel
 * - Optionally persisted to chrome.storage for cross-session debugging
 */

interface LogEntry {
  ts: number;
  level: "info" | "warn" | "error";
  module: string;
  msg: string;
  data?: unknown;
}

const LOG_BUFFER_SIZE = 500;
const buffer: LogEntry[] = [];

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
  default: "#888",
};

function getColor(module: string): string {
  return MODULE_COLORS[module] || MODULE_COLORS.default;
}

function push(entry: LogEntry) {
  buffer.push(entry);
  if (buffer.length > LOG_BUFFER_SIZE) buffer.shift();
}

function fmt(level: string, module: string, msg: string, data?: unknown) {
  const color = getColor(module);
  const prefix = `%c[adblocky]%c ${module} %c${msg}`;
  const styles = [
    "color:#10b981;font-weight:bold",
    `color:${color};font-weight:bold`,
    "color:inherit",
  ];

  if (data !== undefined) {
    return { args: [prefix, ...styles, data], styles };
  }
  return { args: [prefix, ...styles], styles };
}

export const log = {
  info(module: string, msg: string, data?: unknown) {
    push({ ts: Date.now(), level: "info", module, msg, data });
    const f = fmt("info", module, msg, data);
    console.log(...f.args);
  },

  warn(module: string, msg: string, data?: unknown) {
    push({ ts: Date.now(), level: "warn", module, msg, data });
    const f = fmt("warn", module, msg, data);
    console.warn(...f.args);
  },

  error(module: string, msg: string, data?: unknown) {
    push({ ts: Date.now(), level: "error", module, msg, data });
    const f = fmt("error", module, msg, data);
    console.error(...f.args);
  },

  /** Get all buffered log entries */
  getBuffer(): readonly LogEntry[] {
    return buffer;
  },

  /** Clear buffer */
  clear() {
    buffer.length = 0;
  },
};

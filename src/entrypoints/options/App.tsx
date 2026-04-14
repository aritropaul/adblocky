import { useState, useEffect, useRef } from "react";
import { sendMessage, type Settings, DEFAULT_SETTINGS } from "@/lib/messaging";
import { LOG_KEY, type LogEntry, log } from "@/lib/logger";

const FILTER_LIST_LABELS: Record<string, { name: string; description: string }> = {
  ruleset_easylist: { name: "EasyList", description: "Primary ad filtering" },
  ruleset_easyprivacy: { name: "EasyPrivacy", description: "Tracker & analytics blocking" },
  ruleset_ublock: { name: "uBlock Filters", description: "Optimized supplement rules" },
  ruleset_peter_lowe: { name: "Peter Lowe's List", description: "Curated ad/tracking domains" },
  ruleset_streaming: { name: "Streaming Ads", description: "YouTube, Twitch, Hulu, Spotify" },
  ruleset_annoyances: { name: "Annoyances", description: "Cookie banners, popups, newsletter prompts" },
};

type Tab = "filters" | "allowlist" | "debug";

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [newDomain, setNewDomain] = useState("");
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<Tab>("filters");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    log.info("options", "mounted");
    sendMessage<Settings>({ type: "GET_SETTINGS" })
      .then(setSettings)
      .catch((e) => {
        log.error("options", "GET_SETTINGS failed", e);
        setError(String(e));
      });
  }, []);

  const update = async (partial: Partial<Settings>) => {
    const merged = { ...settings, ...partial };
    setSettings(merged);
    try {
      await sendMessage({ type: "UPDATE_SETTINGS", payload: merged });
      setSaved(true);
      setError(null);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      log.error("options", "UPDATE_SETTINGS failed", e);
      setError(String(e));
    }
  };

  const toggleRuleset = (id: string) => {
    update({
      rulesets: { ...settings.rulesets, [id]: !settings.rulesets[id] },
    });
  };

  const toggleStreaming = (service: keyof Settings["streaming"]) => {
    update({
      streaming: { ...settings.streaming, [service]: !settings.streaming[service] },
    });
  };

  const addDomain = () => {
    const domain = newDomain.trim().toLowerCase();
    if (domain && !settings.allowlist.includes(domain)) {
      update({ allowlist: [...settings.allowlist, domain] });
      setNewDomain("");
    }
  };

  const removeDomain = (domain: string) => {
    update({ allowlist: settings.allowlist.filter((d) => d !== domain) });
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <div className="max-w-3xl mx-auto p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold tracking-tight">adblocky Settings</h1>
          {saved && (
            <span className="text-sm text-emerald-400">Saved</span>
          )}
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-950/50 border border-red-900/50 text-sm text-red-300 break-all">
            {error}
          </div>
        )}

        <div className="flex gap-1 mb-6 border-b border-zinc-800">
          {(
            [
              ["filters", "Filters"],
              ["allowlist", "Allowlist"],
              ["debug", "Debug"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key
                  ? "border-emerald-500 text-emerald-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "filters" && (
          <>
            <section className="mb-8">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                Filter Lists
              </h2>
              <div className="space-y-2">
                {Object.entries(FILTER_LIST_LABELS).map(([id, { name, description }]) => (
                  <label
                    key={id}
                    className="flex items-center justify-between bg-zinc-900 rounded-lg p-3 cursor-pointer hover:bg-zinc-800 transition-colors"
                  >
                    <div>
                      <div className="font-medium text-sm">{name}</div>
                      <div className="text-xs text-zinc-500">{description}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.rulesets[id] ?? false}
                      onChange={() => toggleRuleset(id)}
                      className="w-4 h-4 accent-emerald-500"
                    />
                  </label>
                ))}
              </div>
            </section>

            <section className="mb-8">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                Streaming Ad Blocking
              </h2>
              <div className="space-y-2">
                {(
                  [
                    ["youtube", "YouTube", "Skip & block video ads"],
                    ["twitch", "Twitch", "Block pre-roll & mid-roll ads"],
                    ["spotify", "Spotify Web", "Mute audio ads, hide banners"],
                    ["hulu", "Hulu", "Block client-side ad injection"],
                    ["netflix", "Netflix", "Block ads on ad-supported tier"],
                    ["disney", "Disney+", "Block ads on ad-supported tier"],
                    ["peacock", "Peacock", "Block pre-roll & mid-roll ads"],
                    ["paramount", "Paramount+", "Block FreeWheel ad insertion"],
                    ["amazon", "Prime Video / Freevee", "Block ads on ad-supported tiers"],
                    ["tubi", "Tubi", "Block ads on free streaming"],
                    ["pluto", "Pluto TV", "Block FAST channel ads"],
                    ["crunchyroll", "Crunchyroll", "Block ads on free anime tier"],
                    ["roku", "The Roku Channel", "Block ads on free streaming"],
                    ["sponsorblock", "SponsorBlock", "Skip community-reported sponsors on YouTube"],
                  ] as const
                ).map(([key, name, desc]) => (
                  <label
                    key={key}
                    className="flex items-center justify-between bg-zinc-900 rounded-lg p-3 cursor-pointer hover:bg-zinc-800 transition-colors"
                  >
                    <div>
                      <div className="font-medium text-sm">{name}</div>
                      <div className="text-xs text-zinc-500">{desc}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.streaming[key]}
                      onChange={() => toggleStreaming(key)}
                      className="w-4 h-4 accent-emerald-500"
                    />
                  </label>
                ))}
              </div>
            </section>
          </>
        )}

        {tab === "allowlist" && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
              Allowlist
            </h2>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addDomain()}
                placeholder="example.com"
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={addDomain}
                className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Add
              </button>
            </div>
            {settings.allowlist.length > 0 ? (
              <div className="space-y-1">
                {settings.allowlist.map((domain) => (
                  <div
                    key={domain}
                    className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2"
                  >
                    <span className="text-sm font-mono">{domain}</span>
                    <button
                      onClick={() => removeDomain(domain)}
                      className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-600">No domains allowlisted.</p>
            )}
          </section>
        )}

        {tab === "debug" && <DebugPanel />}
      </div>
    </div>
  );
}

// ---- Debug panel ----------------------------------------------------------

const LEVEL_STYLES: Record<LogEntry["level"], string> = {
  block: "text-red-400",
  error: "text-red-400",
  warn: "text-amber-400",
  info: "text-zinc-400",
};

function DebugPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [filterModule, setFilterModule] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Initial load + live updates via storage.onChanged
  useEffect(() => {
    chrome.storage.local.get(LOG_KEY).then((data) => {
      if (Array.isArray(data[LOG_KEY])) setEntries(data[LOG_KEY]);
    });

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "local") return;
      if (!(LOG_KEY in changes)) return;
      if (paused) return;
      const next = changes[LOG_KEY].newValue;
      if (Array.isArray(next)) setEntries(next);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [paused]);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (!autoScroll || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [entries, autoScroll]);

  const modules = Array.from(new Set(entries.map((e) => e.module))).sort();

  const q = search.trim().toLowerCase();
  const filtered = entries.filter((e) => {
    if (filterLevel !== "all" && e.level !== filterLevel) return false;
    if (filterModule !== "all" && e.module !== filterModule) return false;
    if (q) {
      const hay = `${e.module} ${e.msg} ${e.url || ""} ${JSON.stringify(e.data || "")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const clear = async () => {
    await sendMessage({ type: "CLEAR_LOG" });
    setEntries([]);
  };

  const copyAll = () => {
    const text = filtered
      .map((e) => {
        const time = new Date(e.ts).toISOString();
        const extra = e.data !== undefined ? ` ${JSON.stringify(e.data)}` : "";
        const url = e.url ? ` [${e.url}]` : "";
        return `${time} ${e.level.toUpperCase()} [${e.module}] ${e.msg}${extra}${url}`;
      })
      .join("\n");
    navigator.clipboard.writeText(text);
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `adblocky-log-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
          Debug Log
        </h2>
        <div className="text-xs text-zinc-500">
          {filtered.length} / {entries.length} entries
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search message, url, data…"
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
        />
        <select
          value={filterLevel}
          onChange={(e) => setFilterLevel(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All levels</option>
          <option value="block">Block</option>
          <option value="error">Error</option>
          <option value="warn">Warn</option>
          <option value="info">Info</option>
        </select>
        <select
          value={filterModule}
          onChange={(e) => setFilterModule(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All modules</option>
          {modules.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2 mb-3 text-xs">
        <label className="flex items-center gap-1.5 text-zinc-400 cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-emerald-500"
          />
          Auto-scroll
        </label>
        <button
          onClick={() => setPaused((p) => !p)}
          className={`px-2 py-1 rounded ${paused ? "bg-amber-600/30 text-amber-300" : "bg-zinc-800 text-zinc-400"}`}
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={copyAll}
          className="px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
        >
          Copy
        </button>
        <button
          onClick={download}
          className="px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
        >
          Download JSON
        </button>
        <button
          onClick={clear}
          className="px-2 py-1 rounded bg-red-900/40 text-red-300 hover:bg-red-900/60 ml-auto"
        >
          Clear
        </button>
      </div>

      <div
        ref={listRef}
        className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 h-[60vh] overflow-auto font-mono text-xs space-y-0.5"
      >
        {filtered.length === 0 ? (
          <div className="text-zinc-600 p-3 text-center">No entries</div>
        ) : (
          filtered.map((e, i) => <LogRow key={`${e.ts}-${i}`} entry={e} />)
        )}
      </div>
    </section>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(entry.ts).toLocaleTimeString("en-US", { hour12: false });
  const ms = String(entry.ts % 1000).padStart(3, "0");
  const hasData = entry.data !== undefined;

  return (
    <div
      className="px-2 py-1 hover:bg-zinc-800/50 rounded cursor-pointer"
      onClick={() => hasData && setExpanded((x) => !x)}
    >
      <div className="flex items-start gap-2">
        <span className="text-zinc-600 shrink-0 tabular-nums">
          {time}.{ms}
        </span>
        <span
          className={`shrink-0 w-12 uppercase text-[10px] font-bold ${LEVEL_STYLES[entry.level]}`}
        >
          {entry.level}
        </span>
        <span className="shrink-0 text-emerald-400 w-28 truncate">
          {entry.module}
        </span>
        <span className="text-zinc-200 break-all">{entry.msg}</span>
      </div>
      {entry.url && (
        <div className="pl-[9.5rem] text-zinc-500 truncate">{entry.url}</div>
      )}
      {hasData && expanded && (
        <pre className="pl-[9.5rem] text-zinc-400 whitespace-pre-wrap break-all mt-1">
          {JSON.stringify(entry.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

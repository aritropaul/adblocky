import { useState, useEffect } from "react";
import {
  sendMessage,
  type StatsResponse,
  type Settings,
  DEFAULT_SETTINGS,
} from "@/lib/messaging";
import { log } from "@/lib/logger";

const FILTER_LABELS: Record<string, string> = {
  ruleset_easylist: "EasyList",
  ruleset_easyprivacy: "EasyPrivacy",
  ruleset_ublock: "uBlock Filters",
  ruleset_peter_lowe: "Peter Lowe",
  ruleset_streaming: "Streaming Ads",
  ruleset_annoyances: "Annoyances",
};

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [stats, setStats] = useState<StatsResponse>({
    totalBlocked: 0,
    currentTabBlocked: 0,
  });
  const [currentDomain, setCurrentDomain] = useState("");
  const [domainAllowed, setDomainAllowed] = useState(false);
  const [adsSkipped, setAdsSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    log.info("popup", "mounted");
    (async () => {
      try {
        const [s, tabs] = await Promise.all([
          sendMessage<Settings>({ type: "GET_SETTINGS" }),
          new Promise<chrome.tabs.Tab[]>((r) =>
            chrome.tabs.query({ active: true, currentWindow: true }, r),
          ),
        ]);
        setSettings(s);

        const tab = tabs[0];
        if (tab?.url && tab.id) {
          try {
            const url = new URL(tab.url);
            setCurrentDomain(url.hostname);

            const [statsData, isAllowed] = await Promise.all([
              sendMessage<StatsResponse>({
                type: "GET_STATS",
                payload: { tabId: tab.id },
              }),
              sendMessage<boolean>({
                type: "IS_DOMAIN_ALLOWED",
                payload: url.hostname,
              }),
            ]);
            setStats(statsData);
            setDomainAllowed(isAllowed);
          } catch {
            // non-http tab (chrome://, about:) — skip tab-specific state
          }
        }

        const { adb_ads_skipped } =
          await chrome.storage.local.get("adb_ads_skipped");
        setAdsSkipped(adb_ads_skipped || 0);
      } catch (e) {
        log.error("popup", "initial load failed", e);
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const saveSettings = async (partial: Partial<Settings>) => {
    const merged = { ...settings, ...partial };
    setSettings(merged);
    setError(null);
    try {
      await sendMessage({ type: "UPDATE_SETTINGS", payload: merged });
    } catch (e) {
      log.error("popup", "save failed", e);
      setError(String(e));
    }
  };

  const toggleGlobal = () => {
    log.info("popup", "toggleGlobal", { next: !settings.enabled });
    saveSettings({ enabled: !settings.enabled });
  };

  const toggleRuleset = (id: string) => {
    log.info("popup", "toggleRuleset", { id, next: !settings.rulesets[id] });
    saveSettings({
      rulesets: { ...settings.rulesets, [id]: !settings.rulesets[id] },
    });
  };

  const toggleDomain = async () => {
    if (!currentDomain) return;
    log.info("popup", "toggleDomain", { domain: currentDomain });
    try {
      const result = await sendMessage<{ isAllowed: boolean }>({
        type: "TOGGLE_DOMAIN",
        payload: currentDomain,
      });
      setDomainAllowed(result.isAllowed);
      setError(null);
    } catch (e) {
      log.error("popup", "toggleDomain failed", e);
      setError(String(e));
    }
  };

  const openSettings = () => {
    log.info("popup", "openSettings click");
    // chrome.runtime.openOptionsPage() is unreliable — on macOS it opens an
    // embedded panel inside chrome://extensions that often appears behind the
    // current window and looks like nothing happened. Open as a plain new tab
    // instead — guaranteed visible feedback.
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html") });
    window.close();
  };

  const clearStats = async () => {
    log.info("popup", "clearStats");
    await chrome.storage.local.set({
      adb_stats: { totalBlocked: 0, domainCounts: {} },
      adb_ads_skipped: 0,
    });
    setStats({ totalBlocked: 0, currentTabBlocked: stats.currentTabBlocked });
    setAdsSkipped(0);
  };

  return (
    <div className="bg-zinc-950 text-zinc-100 p-4 font-sans text-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${settings.enabled ? "bg-emerald-500" : "bg-zinc-600"}`}
          />
          <h1 className="text-base font-bold tracking-tight">adblocky</h1>
        </div>
        <button
          onClick={toggleGlobal}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            settings.enabled ? "bg-emerald-500" : "bg-zinc-700"
          }`}
          aria-label="Toggle global blocker"
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
              settings.enabled ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <StatCard label="This page" value={stats.currentTabBlocked} color="text-emerald-400" />
        <StatCard label="Total" value={stats.totalBlocked} color="text-zinc-200" />
        <StatCard label="Ads skipped" value={adsSkipped} color="text-purple-400" />
      </div>

      {/* Current site */}
      {currentDomain && (
        <div className="mb-3 rounded-lg bg-zinc-900 p-3">
          <div className="text-xs text-zinc-500 mb-1">Current site</div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs truncate text-zinc-300">
              {currentDomain}
            </span>
            <button
              onClick={toggleDomain}
              className={`shrink-0 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                domainAllowed
                  ? "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                  : "bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30"
              }`}
            >
              {domainAllowed ? "Allowed — click to block" : "Blocking — click to allow"}
            </button>
          </div>
        </div>
      )}

      {/* Filter Lists */}
      <div className="mb-3">
        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Filter Lists
        </div>
        <div className="space-y-1">
          {Object.entries(FILTER_LABELS).map(([id, name]) => (
            <label
              key={id}
              className="flex items-center justify-between bg-zinc-900 rounded-md px-3 py-1.5 cursor-pointer hover:bg-zinc-800 transition-colors"
            >
              <span className="text-xs">{name}</span>
              <input
                type="checkbox"
                checked={settings.rulesets[id] ?? false}
                onChange={() => toggleRuleset(id)}
                className="w-3.5 h-3.5 accent-emerald-500"
              />
            </label>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-950/50 border border-red-900/50 text-xs text-red-300 break-all">
          {error}
        </div>
      )}

      {loading && (
        <div className="mb-3 text-xs text-zinc-600 text-center">Loading…</div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-zinc-900">
        <button
          onClick={clearStats}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          Reset stats
        </button>
        <button
          onClick={openSettings}
          className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors font-medium"
        >
          Advanced settings →
        </button>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-zinc-900 rounded-lg p-2.5">
      <div className={`text-lg font-mono font-bold ${color} tabular-nums`}>
        {value.toLocaleString()}
      </div>
      <div className="text-[10px] text-zinc-500 mt-0.5 leading-tight">
        {label}
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { sendMessage, type StatsResponse, type Settings } from "@/lib/messaging";

export default function App() {
  const [enabled, setEnabled] = useState(true);
  const [stats, setStats] = useState<StatsResponse>({
    totalBlocked: 0,
    currentTabBlocked: 0,
  });
  const [currentDomain, setCurrentDomain] = useState("");
  const [domainAllowed, setDomainAllowed] = useState(false);
  const [adsSkipped, setAdsSkipped] = useState(0);

  useEffect(() => {
    // Get current tab info
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || !tab.url) return;

      try {
        const url = new URL(tab.url);
        setCurrentDomain(url.hostname);

        const statsData = await sendMessage<StatsResponse>({
          type: "GET_STATS",
          payload: { tabId: tab.id },
        });
        setStats(statsData);

        const isAllowed = await sendMessage<boolean>({
          type: "IS_DOMAIN_ALLOWED",
          payload: url.hostname,
        });
        setDomainAllowed(isAllowed);
      } catch (e) {
        console.error("[adb] popup error:", e);
      }
    });

    // Load global enabled state
    sendMessage<Settings>({ type: "GET_SETTINGS" }).then((s) => {
      setEnabled(s.enabled);
    });

    // Load streaming ad skip count
    chrome.storage.local.get("adb_ads_skipped", (data) => {
      setAdsSkipped(data.adb_ads_skipped || 0);
    });
  }, []);

  const toggleGlobal = async () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    await sendMessage({ type: "UPDATE_SETTINGS", payload: { enabled: newEnabled } });
  };

  const toggleDomain = async () => {
    const result = await sendMessage<{ isAllowed: boolean }>({
      type: "TOGGLE_DOMAIN",
      payload: currentDomain,
    });
    setDomainAllowed(result.isAllowed);
  };

  return (
    <div className="w-80 bg-zinc-950 text-zinc-100 p-4 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold tracking-tight">adblocky</h1>
        <button
          onClick={toggleGlobal}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            enabled ? "bg-emerald-500" : "bg-zinc-700"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
              enabled ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-zinc-900 rounded-lg p-3">
          <div className="text-xl font-mono font-bold text-emerald-400">
            {stats.currentTabBlocked.toLocaleString()}
          </div>
          <div className="text-xs text-zinc-500 mt-1">This page</div>
        </div>
        <div className="bg-zinc-900 rounded-lg p-3">
          <div className="text-xl font-mono font-bold text-zinc-300">
            {stats.totalBlocked.toLocaleString()}
          </div>
          <div className="text-xs text-zinc-500 mt-1">Total blocked</div>
        </div>
        <div className="bg-zinc-900 rounded-lg p-3">
          <div className="text-xl font-mono font-bold text-purple-400">
            {adsSkipped.toLocaleString()}
          </div>
          <div className="text-xs text-zinc-500 mt-1">Ads skipped</div>
        </div>
      </div>

      {/* Domain toggle */}
      {currentDomain && (
        <button
          onClick={toggleDomain}
          className={`w-full py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
            domainAllowed
              ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
              : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
          }`}
        >
          {domainAllowed ? `Allowed: ${currentDomain}` : `Block ads on ${currentDomain}`}
        </button>
      )}

      {/* Footer */}
      <div className="mt-4 flex justify-end">
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Settings
        </button>
      </div>
    </div>
  );
}

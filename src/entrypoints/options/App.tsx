import { useState, useEffect } from "react";
import { sendMessage, type Settings, DEFAULT_SETTINGS } from "@/lib/messaging";

const FILTER_LIST_LABELS: Record<string, { name: string; description: string }> = {
  ruleset_easylist: { name: "EasyList", description: "Primary ad filtering" },
  ruleset_easyprivacy: { name: "EasyPrivacy", description: "Tracker & analytics blocking" },
  ruleset_ublock: { name: "uBlock Filters", description: "Optimized supplement rules" },
  ruleset_peter_lowe: { name: "Peter Lowe's List", description: "Curated ad/tracking domains" },
  ruleset_streaming: { name: "Streaming Ads", description: "YouTube, Twitch, Hulu, Spotify" },
  ruleset_annoyances: { name: "Annoyances", description: "Cookie banners, popups, newsletter prompts" },
};

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [newDomain, setNewDomain] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    sendMessage<Settings>({ type: "GET_SETTINGS" }).then(setSettings);
  }, []);

  const update = async (partial: Partial<Settings>) => {
    const merged = { ...settings, ...partial };
    setSettings(merged);
    await sendMessage({ type: "UPDATE_SETTINGS", payload: merged });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
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
      <div className="max-w-2xl mx-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold tracking-tight">adblocky Settings</h1>
          {saved && (
            <span className="text-sm text-emerald-400">Saved</span>
          )}
        </div>

        {/* Filter Lists */}
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

        {/* Streaming */}
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

        {/* Allowlist */}
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
      </div>
    </div>
  );
}

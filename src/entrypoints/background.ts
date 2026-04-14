/**
 * Background service worker — manages DNR rulesets, allowlist, stats, and messaging.
 */

import { onMessage, type Message, type Settings } from "@/lib/messaging";
import {
  getSettings,
  saveSettings,
  getStats,
  incrementBlockCount,
} from "@/lib/storage";
import { incrementTabCount, getTabCount, resetTabCount } from "@/lib/stats";
import {
  log,
  appendEntry,
  getLog,
  clearLog,
  type LogEntry,
} from "@/lib/logger";

export default defineBackground(() => {
  // Ruleset action cache: rulesetId → { allow: Set<ruleId>, block: Set<ruleId> }
  // Built lazily by loading each ruleset's JSON from the bundle. Lets us log
  // DNR matches with the correct action type — onRuleMatchedDebug doesn't
  // include the action, so we look it up here.
  const actionCache = new Map<string, { allow: Set<number>; block: Set<number> }>();

  async function loadRulesetActions(rulesetId: string) {
    if (actionCache.has(rulesetId)) return;
    try {
      const url = chrome.runtime.getURL(`rules/${rulesetId}.json`);
      const res = await fetch(url);
      if (!res.ok) return;
      const rules: Array<{ id: number; action: { type: string } }> = await res.json();
      const allow = new Set<number>();
      const block = new Set<number>();
      for (const r of rules) {
        if (r.action?.type === "allow" || r.action?.type === "allowAllRequests") {
          allow.add(r.id);
        } else if (r.action?.type === "block") {
          block.add(r.id);
        }
      }
      actionCache.set(rulesetId, { allow, block });
    } catch {
      // ignore — will retry on next match
    }
  }

  function classifyAction(
    rulesetId: string,
    ruleId: number,
  ): "allow" | "block" | "unknown" {
    const c = actionCache.get(rulesetId);
    if (!c) return "unknown";
    if (c.allow.has(ruleId)) return "allow";
    if (c.block.has(ruleId)) return "block";
    return "unknown";
  }

  // Log every matched DNR rule (block or allow) with rule ID and ruleset.
  // Requires "declarativeNetRequestFeedback" permission; works for unpacked
  // extensions and packed extensions from Chrome Web Store with that perm.
  if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
    chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
      const { rule, request } = info;
      const rulesetId = rule.rulesetId || "dnr";
      await loadRulesetActions(rulesetId);
      const action = classifyAction(rulesetId, rule.ruleId);
      const meta = {
        ruleId: rule.ruleId,
        rulesetId,
        action,
        url: request.url,
        type: request.type,
        initiator: request.initiator,
        tabId: request.tabId,
      };

      if (action === "block") {
        log.block(rulesetId, `BLOCK rule=${rule.ruleId} ${request.type}`, meta);
        const tabId = request.tabId;
        if (tabId >= 0) {
          incrementTabCount(tabId);
          try {
            const url = new URL(request.url);
            incrementBlockCount(url.hostname);
          } catch {}
        }
      } else if (action === "allow") {
        log.info(rulesetId, `ALLOW rule=${rule.ruleId} ${request.type}`, meta);
      } else {
        log.info(rulesetId, `MATCH rule=${rule.ruleId} ${request.type}`, meta);
      }
    });
    log.info("background", "DNR debug listener attached");
  } else {
    log.warn(
      "background",
      "onRuleMatchedDebug unavailable — enable declarativeNetRequestFeedback",
    );
  }

  // Reset tab count on navigation
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "loading") {
      resetTabCount(tabId);
    }
  });

  // Clean up on tab close
  chrome.tabs.onRemoved.addListener((tabId) => {
    resetTabCount(tabId);
  });

  // Message handler
  onMessage(async (message: Message, sender) => {
    switch (message.type) {
      case "GET_STATS": {
        const stats = await getStats();
        const tabId = (message.payload as { tabId?: number })?.tabId;
        return {
          totalBlocked: stats.totalBlocked,
          currentTabBlocked: tabId ? getTabCount(tabId) : 0,
        };
      }

      case "GET_DOMAIN_STATS": {
        const domain = message.payload as string;
        const settings = await getSettings();
        const stats = await getStats();
        return {
          domain,
          blocked: stats.domainCounts[domain] || 0,
          isAllowed: settings.allowlist.includes(domain),
        };
      }

      case "TOGGLE_DOMAIN": {
        const domain = message.payload as string;
        const settings = await getSettings();
        const idx = settings.allowlist.indexOf(domain);
        if (idx >= 0) {
          settings.allowlist.splice(idx, 1);
        } else {
          settings.allowlist.push(domain);
        }
        await saveSettings(settings);
        await syncAllowlistRules(settings);
        return { isAllowed: settings.allowlist.includes(domain) };
      }

      case "IS_DOMAIN_ALLOWED": {
        const domain = message.payload as string;
        const settings = await getSettings();
        return settings.allowlist.includes(domain);
      }

      case "GET_SETTINGS": {
        return await getSettings();
      }

      case "UPDATE_SETTINGS": {
        const newSettings = message.payload as Partial<Settings>;
        const current = await getSettings();
        const merged = { ...current, ...newSettings };
        await saveSettings(merged);
        await syncRulesets(merged);
        return merged;
      }

      case "FORCE_UPDATE_FILTERS": {
        // TODO: Phase 8 — fetch filter list updates
        return { updated: false, reason: "Not yet implemented" };
      }

      case "GET_STREAMING_STATUS": {
        const settings = await getSettings();
        return settings.streaming;
      }

      case "LOG_EVENT": {
        const entry = message.payload as LogEntry;
        if (entry && typeof entry === "object") {
          if (sender?.tab?.id != null) entry.tabId = sender.tab.id;
          if (!entry.url && sender?.url) entry.url = sender.url;
          await appendEntry(entry);
        }
        return { ok: true };
      }

      case "GET_LOG": {
        return await getLog();
      }

      case "CLEAR_LOG": {
        await clearLog();
        log.info("background", "Log cleared");
        return { ok: true };
      }

      default:
        return null;
    }
  });

  // Sync enabled rulesets based on settings.
  // Only pass deltas (what Chrome actually needs to change) to
  // updateEnabledRulesets — passing already-enabled/disabled rulesets
  // triggers DNR "Internal error" on some Chrome versions.
  async function syncRulesets(settings: Settings) {
    try {
      const currentlyEnabled = new Set(
        await chrome.declarativeNetRequest.getEnabledRulesets(),
      );

      const want = new Map<string, boolean>();
      for (const [id, enabled] of Object.entries(settings.rulesets)) {
        want.set(id, !!(settings.enabled && enabled));
      }

      const toEnable: string[] = [];
      const toDisable: string[] = [];
      for (const [id, wantOn] of want) {
        const isOn = currentlyEnabled.has(id);
        if (wantOn && !isOn) toEnable.push(id);
        if (!wantOn && isOn) toDisable.push(id);
      }

      if (toEnable.length === 0 && toDisable.length === 0) {
        log.info("settings", "Rulesets already in desired state, no-op", {
          currentlyEnabled: [...currentlyEnabled],
        });
        return;
      }

      log.info("settings", "Updating rulesets", {
        currentlyEnabled: [...currentlyEnabled],
        toEnable,
        toDisable,
        globalEnabled: settings.enabled,
      });

      try {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds: toEnable,
          disableRulesetIds: toDisable,
        });
        log.info("settings", "Rulesets synced OK", { toEnable, toDisable });
      } catch (innerErr) {
        log.error("settings", "updateEnabledRulesets failed, retrying individually", {
          toEnable,
          toDisable,
          err: String(innerErr),
        });
        // Chrome's "Internal error" is often triggered by one specific ruleset
        // (rule count over limit, regex count over 1000, etc.). Apply each
        // change individually so we can see which ruleset is the bad one.
        for (const id of toEnable) {
          try {
            await chrome.declarativeNetRequest.updateEnabledRulesets({
              enableRulesetIds: [id],
            });
            log.info("settings", `enabled ${id}`);
          } catch (e) {
            log.error("settings", `FAILED to enable ${id}`, { err: String(e) });
          }
        }
        for (const id of toDisable) {
          try {
            await chrome.declarativeNetRequest.updateEnabledRulesets({
              disableRulesetIds: [id],
            });
            log.info("settings", `disabled ${id}`);
          } catch (e) {
            log.error("settings", `FAILED to disable ${id}`, {
              err: String(e),
            });
          }
        }
      }
    } catch (e) {
      log.error("settings", "syncRulesets outer failure", e);
    }
  }

  // Sync allowlist as dynamic DNR "allow" rules
  async function syncAllowlistRules(settings: Settings) {
    const existingRules =
      await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existingRules
      .filter((r) => r.id >= 100000)
      .map((r) => r.id);

    const addRules = settings.allowlist.map((domain, i) => ({
      id: 100000 + i,
      priority: 10,
      action: {
        type: "allow" as chrome.declarativeNetRequest.RuleActionType,
      },
      condition: {
        requestDomains: [domain],
        resourceTypes: [
          "main_frame",
          "sub_frame",
          "stylesheet",
          "script",
          "image",
          "font",
          "object",
          "xmlhttprequest",
          "ping",
          "media",
          "websocket",
          "other",
        ] as chrome.declarativeNetRequest.ResourceType[],
      },
    }));

    try {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules,
      });
      log.info("settings", "Synced allowlist", {
        count: settings.allowlist.length,
        domains: settings.allowlist,
      });
    } catch (e) {
      log.error("settings", "Failed to sync allowlist rules", e);
    }
  }

  // ── Popup click-hijack detector ─────────────────────────────────────
  // Detects click-hijacking: when a user clicks a link, the page navigates
  // AND an ad script simultaneously opens a popup tab (piggybacking on the
  // click). We only close the piggybacked popup — never legitimate
  // user-initiated "open in new tab" actions.

  // Track tabs that are currently navigating (user clicked a link).
  // Maps tabId → { timestamp, fromHost }
  const navigatingTabs = new Map<number, { ts: number; host: string }>();

  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0) return; // main frame only
    try {
      const host = new URL(details.url).hostname;
      navigatingTabs.set(details.tabId, { ts: Date.now(), host });
      // Clean up after 2s
      setTimeout(() => navigatingTabs.delete(details.tabId), 2000);
    } catch {}
  });

  // Detect click-hijacking: a popup opens while the opener tab is
  // simultaneously navigating (within 2s). This is the classic pattern
  // where an ad script intercepts a click, lets the page navigate normally,
  // and opens an ad in a new tab at the same time.
  chrome.webNavigation.onCreatedNavigationTarget.addListener(
    async (details) => {
      const { tabId, sourceTabId, url } = details;
      try {
        // Only act if the opener tab was navigating (click-hijack signal)
        const nav = navigatingTabs.get(sourceTabId);
        if (!nav || Date.now() - nav.ts > 2000) return;

        const popupHost = new URL(url).hostname;

        // Click-hijack confirmed → close the piggybacked popup
        chrome.tabs.remove(tabId);
        log.block("popup-blocker", `Closed click-hijack popup to ${popupHost}`, {
          from: nav.host,
          to: popupHost,
          url,
        });
        if (sourceTabId >= 0) {
          incrementTabCount(sourceTabId);
          incrementBlockCount(popupHost);
        }
      } catch {}
    },
  );

  // Initialize on install/update
  chrome.runtime.onInstalled.addListener(async () => {
    const settings = await getSettings();
    await syncRulesets(settings);
    await syncAllowlistRules(settings);
    log.info("background", "Extension installed/updated, rulesets synced");
  });

  log.info("background", "Service worker started");
});

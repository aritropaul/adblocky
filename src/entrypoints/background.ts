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

export default defineBackground(() => {
  // Log every blocked request with rule ID and ruleset
  chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
    const { rule, request } = info;
    console.log(
      `[adblocky] BLOCKED rule=${rule.ruleId} ruleset=${rule.rulesetId} url=${request.url} type=${request.type} initiator=${request.initiator || "none"}`,
    );

    const tabId = request.tabId;
    if (tabId >= 0) {
      incrementTabCount(tabId);
      try {
        const url = new URL(request.url);
        incrementBlockCount(url.hostname);
      } catch {
        // ignore invalid URLs
      }
    }
  });

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

      default:
        return null;
    }
  });

  // Sync enabled rulesets based on settings
  async function syncRulesets(settings: Settings) {
    try {
      const enableRulesetIds: string[] = [];
      const disableRulesetIds: string[] = [];

      for (const [id, enabled] of Object.entries(settings.rulesets)) {
        if (settings.enabled && enabled) {
          enableRulesetIds.push(id);
        } else {
          disableRulesetIds.push(id);
        }
      }

      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds,
        disableRulesetIds,
      });
    } catch (e) {
      console.error("[adb] Failed to sync rulesets:", e);
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
    } catch (e) {
      console.error("[adb] Failed to sync allowlist rules:", e);
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
        console.log(
          "[adblocky] popup-killer: closed click-hijack popup to",
          popupHost,
          "(from",
          nav.host + ")",
        );
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
    console.log("[adb] Extension installed/updated, rulesets synced");
  });
});

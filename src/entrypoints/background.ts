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
  // Track blocked requests per tab
  chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
    const tabId = info.request.tabId;
    if (tabId >= 0) {
      incrementTabCount(tabId);
      try {
        const url = new URL(info.request.url);
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

  // Sync enabled rulesets — only toggle ruleset_domains based on global enabled state
  async function syncRulesets(settings: Settings) {
    try {
      if (settings.enabled) {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds: ["ruleset_domains"],
        });
      } else {
        await chrome.declarativeNetRequest.updateEnabledRulesets({
          disableRulesetIds: ["ruleset_domains"],
        });
      }
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

  // Initialize on install/update
  chrome.runtime.onInstalled.addListener(async () => {
    const settings = await getSettings();
    await syncRulesets(settings);
    await syncAllowlistRules(settings);
    console.log("[adb] Extension installed/updated, rulesets synced");
  });
});

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

  // ── Popup tab killer ──────────────────────────────────────────────────
  // Browser-level popup blocking using webNavigation API.
  // Technique from uBlock Origin: detect popup tabs and close them.
  // Can't be bypassed by page scripts saving native window.open.
  //
  // Strategy: detect click-hijacking by tracking when a tab navigates
  // (user clicked a link) and a NEW tab opens simultaneously (ad script
  // piggybacked on the click). Close the piggybacked tab.

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

  // Primary popup detection: onCreatedNavigationTarget fires when a
  // new tab/window is created via window.open or target=_blank.
  //
  // Strategy: close ALL cross-origin popup tabs. Legitimate target=_blank
  // links are rare and users can middle-click if needed. Ad scripts use
  // multiple bypass techniques (saved native window.open, overlays,
  // rotating domains) so domain-based detection doesn't work.
  chrome.webNavigation.onCreatedNavigationTarget.addListener(
    async (details) => {
      const { tabId, sourceTabId, url } = details;
      try {
        const popupHost = new URL(url).hostname;

        // Get opener tab's URL to check same-origin
        const openerTab = await chrome.tabs.get(sourceTabId);
        const openerHost = openerTab.url
          ? new URL(openerTab.url).hostname
          : null;

        // Same-origin popups are legitimate (e.g. site opening its own page)
        if (popupHost === openerHost) return;

        // Cross-origin popup → close it
        chrome.tabs.remove(tabId);
        console.log(
          "[adblocky] popup-killer: closed cross-origin popup to",
          popupHost,
          "(from",
          openerHost + ")",
        );
        if (sourceTabId >= 0) {
          incrementTabCount(sourceTabId);
          incrementBlockCount(popupHost);
        }
      } catch {}
    },
  );

  // Fallback: tabs.onCreated — Chromium sometimes fails to fire
  // onCreatedNavigationTarget (known Chromium bug). Like uBlock Origin,
  // we synthesize the missing event using tabs.onCreated + delay.
  chrome.tabs.onCreated.addListener(async (tab) => {
    if (typeof tab.openerTabId !== "number") return;

    // Wait briefly for the URL to populate (starts as about:blank)
    setTimeout(async () => {
      try {
        const updated = await chrome.tabs.get(tab.id!);
        if (
          !updated.url ||
          updated.url === "about:blank" ||
          updated.url.startsWith("chrome://")
        )
          return;

        const popupHost = new URL(updated.url).hostname;

        // Get opener tab to check same-origin
        const openerTab = await chrome.tabs.get(tab.openerTabId!);
        const openerHost = openerTab.url
          ? new URL(openerTab.url).hostname
          : null;

        // Cross-origin popup → close it
        if (popupHost !== openerHost) {
          chrome.tabs.remove(tab.id!);
          console.log(
            "[adblocky] popup-killer (fallback): closed cross-origin popup to",
            popupHost,
          );
          if (tab.openerTabId! >= 0) {
            incrementTabCount(tab.openerTabId!);
            incrementBlockCount(popupHost);
          }
        }
      } catch {}
    }, 200);
  });

  // Initialize on install/update
  chrome.runtime.onInstalled.addListener(async () => {
    const settings = await getSettings();
    await syncRulesets(settings);
    await syncAllowlistRules(settings);
    console.log("[adb] Extension installed/updated, rulesets synced");
  });
});

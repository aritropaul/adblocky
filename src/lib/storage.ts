/**
 * Persistent storage for settings and statistics.
 */

import { DEFAULT_SETTINGS, type Settings } from "./messaging";

const SETTINGS_KEY = "adb_settings";
const STATS_KEY = "adb_stats";

export interface BlockStats {
  totalBlocked: number;
  domainCounts: Record<string, number>;
  dailyCounts: Record<string, number>; // ISO date string → count
}

const DEFAULT_STATS: BlockStats = {
  totalBlocked: 0,
  domainCounts: {},
  dailyCounts: {},
};

export async function getSettings(): Promise<Settings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  if (result[SETTINGS_KEY]) {
    return { ...DEFAULT_SETTINGS, ...result[SETTINGS_KEY] };
  }
  return DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getStats(): Promise<BlockStats> {
  const result = await browser.storage.local.get(STATS_KEY);
  if (result[STATS_KEY]) {
    return result[STATS_KEY];
  }
  return DEFAULT_STATS;
}

export async function incrementBlockCount(domain: string): Promise<void> {
  const stats = await getStats();
  stats.totalBlocked++;
  stats.domainCounts[domain] = (stats.domainCounts[domain] || 0) + 1;

  const today = new Date().toISOString().split("T")[0];
  stats.dailyCounts[today] = (stats.dailyCounts[today] || 0) + 1;

  await browser.storage.local.set({ [STATS_KEY]: stats });
}

export async function resetStats(): Promise<void> {
  await browser.storage.local.set({ [STATS_KEY]: DEFAULT_STATS });
}

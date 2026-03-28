/**
 * Per-tab block counting using in-memory maps (service worker lifetime).
 * Persisted totals are handled by storage.ts.
 */

const tabCounts = new Map<number, number>();

export function incrementTabCount(tabId: number): number {
  const current = tabCounts.get(tabId) || 0;
  const next = current + 1;
  tabCounts.set(tabId, next);
  return next;
}

export function getTabCount(tabId: number): number {
  return tabCounts.get(tabId) || 0;
}

export function resetTabCount(tabId: number): void {
  tabCounts.delete(tabId);
}

export function clearAllTabCounts(): void {
  tabCounts.clear();
}

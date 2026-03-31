/**
 * Typed message protocol for communication between background, content scripts, and popup.
 */

export type MessageType =
  | "GET_STATS"
  | "GET_DOMAIN_STATS"
  | "TOGGLE_DOMAIN"
  | "IS_DOMAIN_ALLOWED"
  | "GET_SETTINGS"
  | "UPDATE_SETTINGS"
  | "FORCE_UPDATE_FILTERS"
  | "GET_STREAMING_STATUS";

export interface Message<T extends MessageType = MessageType> {
  type: T;
  payload?: unknown;
}

export interface StatsResponse {
  totalBlocked: number;
  currentTabBlocked: number;
}

export interface DomainStatsResponse {
  domain: string;
  blocked: number;
  isAllowed: boolean;
}

export interface Settings {
  enabled: boolean;
  rulesets: Record<string, boolean>;
  allowlist: string[];
  streaming: {
    youtube: boolean;
    twitch: boolean;
    spotify: boolean;
    hulu: boolean;
    netflix: boolean;
    disney: boolean;
    peacock: boolean;
    paramount: boolean;
    amazon: boolean;
    tubi: boolean;
    pluto: boolean;
    crunchyroll: boolean;
    roku: boolean;
    sponsorblock: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  rulesets: {
    ruleset_domains: true,
    ruleset_easylist: true,
    ruleset_easyprivacy: true,
    ruleset_ublock: true,
    ruleset_ublock_privacy: true,
    ruleset_ublock_unbreak: true,
    ruleset_peter_lowe: true,
    ruleset_streaming: true,
    ruleset_annoyances: false,
  },
  allowlist: [],
  streaming: {
    youtube: true,
    twitch: true,
    spotify: true,
    hulu: true,
    netflix: true,
    disney: true,
    peacock: true,
    paramount: true,
    amazon: true,
    tubi: true,
    pluto: true,
    crunchyroll: true,
    roku: true,
    sponsorblock: true,
  },
};

export function onMessage(
  handler: (
    message: Message,
    sender: browser.Runtime.MessageSender,
  ) => Promise<unknown> | unknown,
) {
  chrome.runtime.onMessage.addListener(
    (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
      const message = msg as Message;
      const result = handler(message, sender as any);
      if (result instanceof Promise) {
        result.then(sendResponse).catch((e) => {
          console.error("[adb] message handler error:", e);
          sendResponse(null);
        });
        return true; // Keep channel open for async response
      }
      sendResponse(result);
      return false;
    },
  );
}

export function sendMessage<T = unknown>(message: Message): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      resolve(response);
    });
  });
}

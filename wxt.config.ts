import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: ({ browser }) => ({
    name: "adblocky",
    description:
      "Fast, privacy-focused ad blocker for Chrome and Safari. Blocks ads, trackers, popups, cookie banners, and streaming ads on Netflix, Hulu, HBO Max, YouTube, Twitch, and more.",
    version: "0.3.0",
    permissions: [
      "declarativeNetRequest",
      "declarativeNetRequestFeedback",
      "storage",
      "tabs",
      "activeTab",
      "scripting",
      "webNavigation",
    ],
    host_permissions: ["<all_urls>"],
    ...(browser === "chrome" && {
      declarative_net_request: {
        rule_resources: [
          {
            id: "ruleset_domains",
            enabled: true,
            path: "rules/ruleset_domains.json",
          },
          {
            id: "ruleset_easylist",
            enabled: true,
            path: "rules/ruleset_easylist.json",
          },
          {
            id: "ruleset_easyprivacy",
            enabled: true,
            path: "rules/ruleset_easyprivacy.json",
          },
          {
            id: "ruleset_ublock",
            enabled: true,
            path: "rules/ruleset_ublock.json",
          },
          {
            id: "ruleset_ublock_privacy",
            enabled: true,
            path: "rules/ruleset_ublock_privacy.json",
          },
          {
            id: "ruleset_ublock_unbreak",
            enabled: true,
            path: "rules/ruleset_ublock_unbreak.json",
          },
          {
            id: "ruleset_peter_lowe",
            enabled: true,
            path: "rules/ruleset_peter_lowe.json",
          },
          {
            id: "ruleset_annoyances",
            enabled: false,
            path: "rules/ruleset_annoyances.json",
          },
          {
            id: "ruleset_streaming",
            enabled: true,
            path: "rules/ruleset_streaming.json",
          },
        ],
      },
    }),
    web_accessible_resources: [
      {
        resources: ["youtube-player.js", "cosmetic-filters.json"],
        matches: ["<all_urls>"],
      },
    ],
  }),
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});

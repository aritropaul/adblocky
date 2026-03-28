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
    ],
    host_permissions: ["<all_urls>"],
    ...(browser === "chrome" && {
      declarative_net_request: {
        rule_resources: [
          {
            // DOMAIN-ONLY rules — safe, won't break sites
            // Path-based blocking is handled by the MAIN world interceptor
            id: "ruleset_domains",
            enabled: true,
            path: "rules/ruleset_domains.json",
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

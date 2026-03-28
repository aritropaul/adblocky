# adblocky

**Fast, privacy-focused ad blocker that actually blocks streaming ads.**

![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)
![Safari](https://img.shields.io/badge/Safari-Web%20Extension-006CFF?logo=safari&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

Most ad blockers stop at banner ads. adblocky goes further -- it handles network ads via declarativeNetRequest, hides elements with cosmetic filtering, strips tracking parameters from URLs, auto-dismisses cookie consent banners, and speeds through server-side inserted streaming ads that no network-level blocker can touch.

---

## Features

### Web Ad Blocking

- **Network request blocking** -- compiled DNR rulesets from EasyList, EasyPrivacy, uBlock Origin filters, and Peter Lowe's blocklist
- **Cosmetic filtering** -- element hiding via CSS injection and MutationObserver, with per-domain selector maps
- **Popup and popunder blocking** -- intercepts `window.open` abuse and popup-triggering click handlers
- **Anti-adblock wall bypass** -- detects and removes adblock detection overlays so content remains accessible
- **Cookie consent auto-dismiss** -- clicks through GDPR/cookie banners automatically (Cookiebot, OneTrust, Quantcast, TrustArc, and generic patterns)
- **URL tracking parameter cleanup** -- strips `fbclid`, `gclid`, `utm_source`, `utm_medium`, `utm_campaign`, and dozens more via `history.replaceState` without triggering navigation
- **Annoyance blocking** -- optional Fanboy's Annoyances list for newsletter popups, chat widgets, notification prompts, and social share overlays

### Streaming Ad Skip

Most major streaming platforms use **Server-Side Ad Insertion (SSAI)**, stitching ads directly into the video stream. Network-level blocking cannot distinguish ad segments from content segments on these services.

adblocky handles this differently. When an ad is detected via DOM inspection, the extension mutes the video and sets playback speed to 16x using an `Object.defineProperty` override on the video element. The ad completes in under 2 seconds. When the ad selector disappears from the DOM, normal playback resumes automatically.

**Supported platforms:**

| Platform | Technique |
|---|---|
| YouTube | Player API interception, JSON config stripping, skip button clicking, anti-adblock wall removal |
| Twitch | HLS M3U8 manifest ad segment stripping, GraphQL ad operation blocking, mute-and-overlay fallback |
| Spotify | Audio ad detection, mute/speed skip |
| Netflix | `[data-uia="ads-info-container"]` detection, pause-screen ad dismissal |
| Hulu | `.AdUnitView__adBarContainer` detection |
| HBO Max / Max | `[class*="AdOverlayContainer"]` detection |
| Disney+ | Shared Hulu infrastructure |
| Amazon Prime Video | SSAI detection and speed skip |
| Peacock | FreeWheel VAST blocking, ad overlay detection |
| Paramount+ | FreeWheel VAST blocking, HLS/DASH manifest pruning |
| Pluto TV | HLS SCTE-35 ad marker stripping |
| Tubi | Adblock detection bypass, HLS ad segment stripping |
| Crunchyroll | Google IMA SDK mocking, ad overlay detection |
| Roku Channel | HLS ad marker stripping |

### MAIN World Request Interceptor

On sites like YouTube and Twitch, adblocky injects a MAIN world content script that monkey-patches `fetch()`, `XMLHttpRequest`, and `document.createElement` to block ad and tracking requests before they leave the page. This replaces the real-time request interception that `webRequest` provided in Manifest V2.

---

## Install

### Chrome

1. Clone and build the extension (see Build below)
2. Open `chrome://extensions`
3. Enable **Developer Mode**
4. Click **Load unpacked** and select the `.output/chrome-mv3/` directory

### Safari

1. Build with `npm run build:safari`
2. Open the generated Xcode project in `macos/`
3. Build and enable the extension in Safari preferences

---

## Build

```bash
npm install

npm run build            # Full build: domain rules + filter compilation + extension (both platforms)
npm run build:chrome     # Chrome only
npm run build:safari     # Safari only

npm run dev              # Dev mode with HMR (Chrome)
npm run dev:chrome       # Dev mode targeting Chrome
npm run dev:safari       # Dev mode targeting Safari

npm test                 # Run all tests (vitest)
npm run typecheck        # TypeScript type checking
```

The `build:filters` step downloads filter lists from upstream sources, parses ABP/uBlock Origin filter syntax into an intermediate representation, and compiles two outputs:

- **Chrome DNR JSON** -- respects the 30K static rule limit and 1K regex rule limit per ruleset
- **Safari WebKit Content Blocker JSON** -- respects the 150K rule limit

Compiled rulesets are written to `rules/` (Chrome) and `safari-rules/` (Safari). Cosmetic filter selectors are written to `public/cosmetic-filters.json`.

---

## Architecture

```
src/
  entrypoints/
    background.ts              Service worker: DNR management, allowlist, stats, message hub
    content.ts                 Global cosmetic filtering (all pages)
    interceptor.content.ts     MAIN world fetch/XHR/createElement interception
    youtube.content.ts         YouTube ad handling
    twitch.content.ts          Twitch M3U8 + GraphQL ad handling
    spotify.content.ts         Spotify audio ad handling
    netflix.content.ts         Netflix SSAI ad skip
    hulu.content.ts            Hulu SSAI ad skip
    hbomax.content.ts          HBO Max SSAI ad skip
    disney.content.ts          Disney+ SSAI ad skip
    amazon.content.ts          Prime Video SSAI ad skip
    peacock.content.ts         Peacock SSAI ad skip
    paramount.content.ts       Paramount+ SSAI ad skip
    pluto.content.ts           Pluto TV HLS ad stripping
    tubi.content.ts            Tubi SSAI ad skip
    crunchyroll.content.ts     Crunchyroll IMA SDK mocking
    roku.content.ts            Roku Channel ad skip
    popup-blocker.content.ts   Popup/popunder interception
    anti-adblock.content.ts    Anti-adblock wall bypass
    cookie-consent.content.ts  Cookie consent auto-dismiss
    tracking-params.content.ts URL tracking parameter cleanup
    annoyances.content.ts      Newsletter/chat/notification blocking
    popup/                     React popup UI
    options/                   React options page
  lib/
    ssai/                      Shared SSAI toolkit
      fetch-proxy.ts           fetch/XHR monkey-patching
      m3u-prune.ts             HLS M3U8 ad segment removal
      xml-prune.ts             DASH/VAST XML pruning
      json-prune.ts            JSON response ad data removal
      ad-timeline.ts           HLS/DASH ad break parsing
      skip.ts                  Universal mute + 16x speed skip
    messaging.ts               Typed message protocol
    storage.ts                 Settings and stats persistence
    stats.ts                   Per-tab block counting
    logger.ts                  Debug logging
scripts/
  lists.config.ts              Filter list URLs and metadata
  build-filters.ts             Master filter compilation script
  build-domain-rules.ts        Domain-level DNR rule builder
  parsers/
    abp-parser.ts              ABP/uBlock syntax parser
    dnr-compiler.ts            Chrome DNR JSON compiler
    webkit-compiler.ts         Safari WebKit JSON compiler
```

**Key design decisions:**

- **WXT framework** for auto-manifest generation, entrypoint discovery, and multi-browser builds
- **Build-time filter compilation** (like uBlock Origin Lite) rather than runtime parsing -- keeps the service worker fast and memory-lean
- **DNR for network blocking, content scripts for cosmetic** -- declarativeNetRequest handles request blocking; content scripts handle element hiding and streaming ad manipulation
- **MAIN world scripts for streaming** -- YouTube, Twitch, Spotify, and the SSAI skip library run in the page's JavaScript context to intercept player APIs, fetch, and JSON.parse
- **Shared SSAI library** -- all streaming content scripts share `src/lib/ssai/` for fetch proxying, manifest pruning, and the universal ad skip mechanism

---

## How Streaming Ad Skip Works

The core technique lives in `src/lib/ssai/skip.ts`. When a streaming content script starts, it passes CSS selectors that identify ad UI elements to `startAdSkip()`.

A 50ms interval checks the DOM for those selectors. When an ad element appears:

1. The video element is **muted**
2. `Object.defineProperty` overrides the `playbackRate` property on the video element instance, forcing it to **16x**. This override intercepts any attempt by the player to reset the rate back to 1x -- the setter checks whether the ad selector still exists in the DOM and only allows normal rate changes after the ad ends.
3. Any skip/dismiss buttons matching configured selectors are **auto-clicked**

When the ad selector disappears from the DOM, the override is removed, the video is unmuted, playback returns to 1x, and a brief "Ad skipped" toast is shown. The result: a 30-second ad plays in under 2 seconds.

---

## Contributing

Contributions are welcome. To get started:

1. Fork the repository and create a feature branch
2. Run `npm install` and `npm run dev` to start development
3. Make your changes with tests where applicable (`npm test`)
4. Ensure the build passes: `npm run build:chrome && npm run typecheck`
5. Open a pull request with a clear description of what changed and why

When adding support for a new streaming platform, use the shared SSAI library in `src/lib/ssai/` and follow the pattern established by existing content scripts (e.g., `netflix.content.ts` for simple DOM-based detection, `twitch.content.ts` for manifest-level interception).

---

## License

MIT

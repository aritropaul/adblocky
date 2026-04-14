/**
 * YouTube MAIN-world hooks — implements the 2025/2026 uBO/uBOL anti-adblock
 * defense. Research findings:
 *
 *  - Wall is rendered CLIENT-SIDE from
 *    `ytInitialPlayerResponse.auxiliaryUi.messageRenderers.enforcementMessageViewModel`
 *    (not server-refused). Must strip that field, not just adPlacements.
 *  - YouTube ships inline <script> that sets ytInitialPlayerResponse
 *    synchronously during HTML parse. MAIN-world content scripts at
 *    document_start race. Reliable intercept = Object.defineProperty setter
 *    trap on window.ytInitialPlayerResponse installed before first write.
 *  - YT reads fetch responses via both .text() and .json(); hook both.
 *    Also hook XMLHttpRequest for fallback path.
 *  - Set Object.prototype.adBlocksFound = 0 to neutralize detection counter.
 *
 * Heavily instrumented — every decision emits an adb-log CustomEvent picked
 * up by content.ts (ISOLATED) and forwarded to the logger.
 */

export default defineContentScript({
  matches: ["*://*.youtube.com/*"],
  runAt: "document_start",
  world: "MAIN",

  main() {
    function mainLog(
      level: "info" | "warn" | "error" | "block",
      msg: string,
      data?: unknown,
    ) {
      try {
        window.dispatchEvent(
          new CustomEvent("adb-log", {
            detail: { level, module: "yt-main", msg, data },
          }),
        );
      } catch {}
    }

    mainLog("info", "MAIN-world hooks installing", {
      readyState: document.readyState,
      url: location.href,
    });

    // ---- Strip logic -----------------------------------------------------

    function stripAds(obj: any): { stripped: string[]; hadWall: boolean } {
      const stripped: string[] = [];
      let hadWall = false;
      if (!obj || typeof obj !== "object") return { stripped, hadWall };

      // Don't touch livestreams (breaks live DVR controls)
      const details = obj.videoDetails;
      const isLive =
        details &&
        (details.isLive === true ||
          details.isLiveContent === true ||
          details.isLiveDvrEnabled === true);

      if (!isLive) {
        for (const k of ["adPlacements", "adSlots", "playerAds"]) {
          if (k in obj) {
            delete obj[k];
            stripped.push(k);
          }
        }
      }

      // The client-side wall renderer — THIS is why the player goes black
      const aux = obj.auxiliaryUi;
      const mr = aux?.messageRenderers;
      if (mr) {
        if (mr.enforcementMessageViewModel) {
          hadWall = true;
          delete mr.enforcementMessageViewModel;
          stripped.push("enforcementMessageViewModel");
        }
        if (mr.messageRenderer) {
          delete mr.messageRenderer;
          stripped.push("messageRenderer");
        }
      }

      // playabilityStatus errorScreen that surfaces the wall UI
      const ps = obj.playabilityStatus;
      if (ps?.errorScreen?.playerErrorMessageRenderer) {
        // Only strip if it's the adblock wall, not genuine errors
        const reason =
          ps.errorScreen.playerErrorMessageRenderer.reason?.simpleText || "";
        if (/ad block|adblock/i.test(reason)) {
          delete ps.errorScreen;
          stripped.push("playabilityStatus.errorScreen");
        }
      }

      return { stripped, hadWall };
    }

    // ---- Neutralize detection counter -----------------------------------
    try {
      Object.defineProperty(Object.prototype, "adBlocksFound", {
        get: () => 0,
        set: () => {},
        configurable: false,
      });
      mainLog("info", "Object.prototype.adBlocksFound neutralized");
    } catch (e) {
      mainLog("warn", "adBlocksFound define failed", { err: String(e) });
    }

    // ---- ytInitialPlayerResponse setter trap ----------------------------
    let _ytInitialPlayerResponse: any = undefined;
    let ytSetCount = 0;
    try {
      Object.defineProperty(window, "ytInitialPlayerResponse", {
        configurable: true,
        get: () => _ytInitialPlayerResponse,
        set: (value) => {
          ytSetCount++;
          if (value && typeof value === "object") {
            const before = {
              hadAdPlacements: !!value.adPlacements,
              hadPlayerAds: !!value.playerAds,
              hadWall:
                !!value.auxiliaryUi?.messageRenderers
                  ?.enforcementMessageViewModel,
              status: value.playabilityStatus?.status,
              reason: value.playabilityStatus?.reason,
              videoId: value.videoDetails?.videoId,
            };
            const { stripped, hadWall } = stripAds(value);
            if (stripped.length || hadWall || before.hadWall) {
              mainLog("block", "ytInitialPlayerResponse stripped", {
                setCount: ytSetCount,
                stripped,
                before,
              });
            } else if (ytSetCount === 1) {
              mainLog("info", "ytInitialPlayerResponse clean (first set)", {
                before,
              });
            }
          }
          _ytInitialPlayerResponse = value;
        },
      });
      mainLog("info", "ytInitialPlayerResponse setter trap installed");
    } catch (e) {
      mainLog("error", "setter trap install failed", { err: String(e) });
    }

    // ---- Response.prototype.text + .json --------------------------------
    function isPlayerUrl(url: string): boolean {
      return (
        url.indexOf("/youtubei/v1/player") !== -1 ||
        url.indexOf("/youtubei/v1/next") !== -1
      );
    }

    const origText = Response.prototype.text;
    Response.prototype.text = function () {
      const url = this.url || "";
      if (!isPlayerUrl(url)) return origText.call(this);
      return origText.call(this).then((text) => {
        try {
          const obj = JSON.parse(text);
          const { stripped, hadWall } = stripAds(obj);
          if (
            obj.playerResponse &&
            typeof obj.playerResponse === "object"
          ) {
            const inner = stripAds(obj.playerResponse);
            stripped.push(...inner.stripped.map((k) => `playerResponse.${k}`));
          }
          if (stripped.length) {
            mainLog("block", "Response.text stripped /player", {
              url,
              stripped,
              hadWall,
            });
            return JSON.stringify(obj);
          }
        } catch (e) {
          mainLog("error", "Response.text parse fail", {
            url,
            err: String(e),
          });
        }
        return text;
      });
    };

    const origJson = Response.prototype.json;
    Response.prototype.json = function () {
      const url = this.url || "";
      if (!isPlayerUrl(url)) return origJson.call(this);
      // Re-implement via .text so we share stripping path
      return origText.call(this).then((text) => {
        try {
          const obj = JSON.parse(text);
          const { stripped, hadWall } = stripAds(obj);
          if (
            obj.playerResponse &&
            typeof obj.playerResponse === "object"
          ) {
            const inner = stripAds(obj.playerResponse);
            stripped.push(...inner.stripped.map((k) => `playerResponse.${k}`));
          }
          if (stripped.length) {
            mainLog("block", "Response.json stripped /player", {
              url,
              stripped,
              hadWall,
            });
          }
          return obj;
        } catch (e) {
          mainLog("error", "Response.json parse fail", {
            url,
            err: String(e),
          });
          return JSON.parse(text);
        }
      });
    };

    // ---- XMLHttpRequest hook --------------------------------------------
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      ...rest: any[]
    ) {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (isPlayerUrl(urlStr)) {
        (this as any).__adbPlayerXhr = true;
        (this as any).__adbUrl = urlStr;
      }
      return origOpen.call(this, method, url, ...(rest as [boolean?, string?, string?]));
    };

    // Wrap responseText getter to strip on read
    const origRespText = Object.getOwnPropertyDescriptor(
      XMLHttpRequest.prototype,
      "responseText",
    );
    const origResponse = Object.getOwnPropertyDescriptor(
      XMLHttpRequest.prototype,
      "response",
    );

    if (origRespText?.get) {
      Object.defineProperty(XMLHttpRequest.prototype, "responseText", {
        configurable: true,
        get: function () {
          const raw = origRespText.get!.call(this);
          if (!(this as any).__adbPlayerXhr) return raw;
          try {
            const obj = JSON.parse(raw);
            const { stripped } = stripAds(obj);
            if (
              obj.playerResponse &&
              typeof obj.playerResponse === "object"
            ) {
              const inner = stripAds(obj.playerResponse);
              stripped.push(
                ...inner.stripped.map((k) => `playerResponse.${k}`),
              );
            }
            if (stripped.length) {
              mainLog("block", "XHR responseText stripped", {
                url: (this as any).__adbUrl,
                stripped,
              });
              return JSON.stringify(obj);
            }
          } catch {
            // not JSON
          }
          return raw;
        },
      });
    }

    if (origResponse?.get) {
      Object.defineProperty(XMLHttpRequest.prototype, "response", {
        configurable: true,
        get: function () {
          const raw = origResponse.get!.call(this);
          if (!(this as any).__adbPlayerXhr) return raw;
          if (this.responseType === "json" && raw && typeof raw === "object") {
            const { stripped } = stripAds(raw);
            if (stripped.length) {
              mainLog("block", "XHR response (json) stripped", {
                url: (this as any).__adbUrl,
                stripped,
              });
            }
          }
          return raw;
        },
      });
    }

    // ---- SponsorBlock skip bridge ---------------------------------------
    window.addEventListener("message", (event) => {
      const data = event.data as { type?: string; time?: number } | undefined;
      if (!data || data.type !== "ADB_SKIP_SEGMENT") return;
      const video = document.querySelector<HTMLVideoElement>(
        "#movie_player video",
      );
      if (video && typeof data.time === "number") {
        video.currentTime = data.time;
      }
    });

    mainLog("info", "MAIN-world hooks ready");
  },
});

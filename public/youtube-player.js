/**
 * YouTube MAIN world script — strips ad config from player responses.
 * Runs in the page's JS context (not extension sandbox).
 *
 * YouTube reads API responses via response.text() (not .json() or JSON.parse),
 * then parses internally. We patch Response.prototype.text to intercept
 * /player responses and strip ad fields from the JSON text before YouTube
 * sees it. The HTTP response itself is untouched.
 *
 * This file is injected as a <script> tag by youtube.content.ts.
 */

(function () {
  "use strict";

  var AD_KEYS = ["adPlacements", "adSlots", "playerAds"];

  function stripPlayerAds(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (!obj.videoDetails) return false;
    if (obj.videoDetails.isLive === true) return false;
    if (obj.videoDetails.isLiveContent === true) return false;
    if (obj.videoDetails.isLiveDvrEnabled === true) return false;

    var stripped = false;
    for (var i = 0; i < AD_KEYS.length; i++) {
      if (AD_KEYS[i] in obj) {
        delete obj[AD_KEYS[i]];
        stripped = true;
      }
    }
    return stripped;
  }

  // --- Response.prototype.text interception ---
  // YouTube calls response.text() on /player and /reel_item_watch responses,
  // then parses the text internally. We intercept .text() to strip ad fields
  // from JSON text before YouTube's parser sees it.

  var originalText = Response.prototype.text;
  Response.prototype.text = function () {
    var url = this.url || "";
    var isPlayer = url.indexOf("/youtubei/v1/player") !== -1;

    if (!isPlayer) {
      return originalText.call(this);
    }

    return originalText.call(this).then(function (text) {
      try {
        var obj = JSON.parse(text);
        if (stripPlayerAds(obj)) {
          return JSON.stringify(obj);
        }
        if (obj.playerResponse && stripPlayerAds(obj.playerResponse)) {
          return JSON.stringify(obj);
        }
      } catch (e) {
        // Not JSON or parse error — return original
      }
      return text;
    });
  };

  // --- JSON.parse interception ---
  // Fallback for any code path that uses JSON.parse directly.

  var originalParse = JSON.parse;
  JSON.parse = function () {
    var result = originalParse.apply(this, arguments);
    try {
      if (result && typeof result === "object") {
        if (result.adPlacements && result.videoDetails) {
          stripPlayerAds(result);
        }
        if (result.playerResponse && result.playerResponse.adPlacements) {
          stripPlayerAds(result.playerResponse);
        }
      }
    } catch (e) {}
    return result;
  };

  // --- ytInitialPlayerResponse interception ---

  var _ytInitialPlayerResponse = undefined;
  try {
    Object.defineProperty(window, "ytInitialPlayerResponse", {
      configurable: true,
      get: function () {
        return _ytInitialPlayerResponse;
      },
      set: function (value) {
        if (value && typeof value === "object") {
          try { stripPlayerAds(value); } catch (e) {}
        }
        _ytInitialPlayerResponse = value;
      },
    });
  } catch (e) {}

  // --- SponsorBlock integration ---

  window.addEventListener("message", function (event) {
    if (!event.data || event.data.type !== "ADB_SKIP_SEGMENT") return;
    var video = document.querySelector("#movie_player video");
    if (video && typeof event.data.time === "number") {
      video.currentTime = event.data.time;
    }
  });

  console.log("[adb] YouTube ad blocking active (MAIN world)");
})();

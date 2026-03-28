/**
 * YouTube MAIN world script — intercepts player API to strip ad config.
 * Runs in the page's JS context (not extension sandbox) to access YouTube's APIs.
 *
 * This file is injected as a <script> tag by youtube.content.ts.
 */

(function () {
  "use strict";

  // --- JSON.parse interception ---
  // YouTube loads player config via JSON.parse. We intercept to strip ad data.

  const originalParse = JSON.parse;
  JSON.parse = function () {
    const result = originalParse.apply(this, arguments);

    if (result && typeof result === "object") {
      stripAdConfig(result);
    }

    return result;
  };

  // --- Strip ad configuration from player responses ---

  function stripAdConfig(obj) {
    if (!obj || typeof obj !== "object") return;

    // Player response ad fields
    var adKeys = [
      "adPlacements",
      "adSlots",
      "playerAds",
      "adBreakParams",
      "adBreakHeartbeatParams",
      "advertisingId",
      "ad_tag",
      "adVideoId",
    ];

    for (var i = 0; i < adKeys.length; i++) {
      if (adKeys[i] in obj) {
        delete obj[adKeys[i]];
      }
    }

    // Nested in playerResponse
    if (obj.playerResponse && typeof obj.playerResponse === "object") {
      stripAdConfig(obj.playerResponse);
    }

    // Nested in response
    if (obj.response && typeof obj.response === "object") {
      stripAdConfig(obj.response);
    }

    // Player config
    if (obj.args && typeof obj.args === "object") {
      delete obj.args.ad_tag;
      delete obj.args.ad_video_id;
      delete obj.args.ad_preroll;

      // Strip ad config from embedded player response
      if (typeof obj.args.raw_player_response === "string") {
        try {
          var parsed = originalParse(obj.args.raw_player_response);
          stripAdConfig(parsed);
          obj.args.raw_player_response = JSON.stringify(parsed);
        } catch (e) {
          // ignore parse errors
        }
      }
    }
  }

  // --- Intercept ytInitialPlayerResponse ---

  var _ytInitialPlayerResponse = undefined;
  try {
    Object.defineProperty(window, "ytInitialPlayerResponse", {
      configurable: true,
      get: function () {
        return _ytInitialPlayerResponse;
      },
      set: function (value) {
        if (value && typeof value === "object") {
          stripAdConfig(value);
        }
        _ytInitialPlayerResponse = value;
      },
    });
  } catch (e) {
    // Property may already be non-configurable
  }

  // --- Intercept fetch for player API responses ---

  var originalFetch = window.fetch;
  window.fetch = function () {
    var args = arguments;
    var url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";

    return originalFetch.apply(this, args).then(function (response) {
      // Intercept player API responses
      if (
        url.indexOf("/youtubei/v1/player") !== -1 ||
        url.indexOf("/youtubei/v1/next") !== -1
      ) {
        try {
          var clone = response.clone();
          return clone.json().then(function (body) {
            stripAdConfig(body);
            return new Response(JSON.stringify(body), {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            });
          }).catch(function () {
            return response;
          });
        } catch (e) {
          // If parsing fails, return original
        }
      }
      return response;
    });
  };

  // --- SponsorBlock integration ---
  // Listens for messages from the content script to skip sponsor segments.

  window.addEventListener("message", function (event) {
    if (!event.data || event.data.type !== "ADB_SKIP_SEGMENT") return;

    var video = document.querySelector("#movie_player video");
    if (video && typeof event.data.time === "number") {
      video.currentTime = event.data.time;
    }
  });

  console.log("[adb] YouTube ad blocking active (MAIN world)");
})();

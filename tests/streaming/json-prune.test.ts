import { describe, it, expect } from "vitest";
import { pruneJSON } from "@/lib/ssai/json-prune";

describe("pruneJSON", () => {
  it("deletes top-level keys", () => {
    const obj = {
      videoId: "abc123",
      title: "Test Video",
      adPlacements: [{ offset: 0, duration: 30 }],
      playerAds: [{ type: "preroll" }],
      content: { url: "video.mp4" },
    };

    const result = pruneJSON(obj, {
      pruneKeys: ["adPlacements", "playerAds"],
    });

    expect(result.adPlacements).toBeUndefined();
    expect(result.playerAds).toBeUndefined();
    expect(result.videoId).toBe("abc123");
    expect(result.title).toBe("Test Video");
    expect(result.content.url).toBe("video.mp4");
  });

  it("deletes nested paths", () => {
    const obj = {
      playerResponse: {
        adPlacements: [{ duration: 30 }],
        videoDetails: { title: "Test" },
      },
    };

    const result = pruneJSON(obj, {
      pruneKeys: [],
      prunePaths: ["playerResponse.adPlacements"],
    });

    expect(result.playerResponse.adPlacements).toBeUndefined();
    expect(result.playerResponse.videoDetails.title).toBe("Test");
  });

  it("handles recursive deletion", () => {
    const obj = {
      data: {
        nested: {
          adSlots: [1, 2, 3],
          content: "ok",
          deeper: {
            adSlots: [4, 5],
            value: "also ok",
          },
        },
        adSlots: [6],
      },
    };

    const result = pruneJSON(obj, {
      pruneKeys: ["adSlots"],
      recursive: true,
    });

    expect(result.data.adSlots).toBeUndefined();
    expect(result.data.nested.adSlots).toBeUndefined();
    expect(result.data.nested.deeper.adSlots).toBeUndefined();
    expect(result.data.nested.content).toBe("ok");
    expect(result.data.nested.deeper.value).toBe("also ok");
  });

  it("handles recursive deletion in arrays", () => {
    const obj = {
      items: [
        { adBreakParams: { type: "pre" }, title: "Video 1" },
        { adBreakParams: { type: "mid" }, title: "Video 2" },
      ],
    };

    const result = pruneJSON(obj, {
      pruneKeys: ["adBreakParams"],
      recursive: true,
    });

    expect(result.items[0].adBreakParams).toBeUndefined();
    expect(result.items[1].adBreakParams).toBeUndefined();
    expect(result.items[0].title).toBe("Video 1");
    expect(result.items[1].title).toBe("Video 2");
  });

  it("returns primitives unchanged", () => {
    expect(pruneJSON(null, { pruneKeys: ["a"] })).toBeNull();
    expect(pruneJSON(42, { pruneKeys: ["a"] })).toBe(42);
    expect(pruneJSON("string", { pruneKeys: ["a"] })).toBe("string");
  });

  it("handles missing keys gracefully", () => {
    const obj = { a: 1, b: 2 };
    const result = pruneJSON(obj, { pruneKeys: ["nonexistent"] });
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("handles missing nested paths gracefully", () => {
    const obj = { a: { b: 1 } };
    const result = pruneJSON(obj, {
      pruneKeys: [],
      prunePaths: ["a.c.d"],
    });
    expect(result).toEqual({ a: { b: 1 } });
  });

  it("simulates YouTube player response pruning", () => {
    const ytResponse = {
      videoDetails: { videoId: "dQw4w9WgXcQ", title: "Never Gonna Give You Up" },
      adPlacements: [
        { adPlacementRenderer: { adTimeOffset: { offsetEndMilliseconds: "0" } } },
      ],
      adSlots: [{ adSlotRenderer: { slotId: "slot1" } }],
      playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
      adBreakParams: { visibleUrl: "example.com" },
      adBreakHeartbeatParams: "heartbeat",
      advertisingId: "ad-id-123",
      streamingData: { formats: [{ url: "video.mp4" }] },
    };

    const result = pruneJSON(ytResponse, {
      pruneKeys: [
        "adPlacements",
        "adSlots",
        "playerAds",
        "adBreakParams",
        "adBreakHeartbeatParams",
        "advertisingId",
      ],
    });

    expect(result.adPlacements).toBeUndefined();
    expect(result.adSlots).toBeUndefined();
    expect(result.playerAds).toBeUndefined();
    expect(result.adBreakParams).toBeUndefined();
    expect(result.adBreakHeartbeatParams).toBeUndefined();
    expect(result.advertisingId).toBeUndefined();
    expect(result.videoDetails.title).toBe("Never Gonna Give You Up");
    expect(result.streamingData.formats[0].url).toBe("video.mp4");
  });
});

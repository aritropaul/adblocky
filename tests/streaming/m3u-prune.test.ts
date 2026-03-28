import { describe, it, expect } from "vitest";
import { pruneM3U } from "@/lib/ssai/m3u-prune";

const BASIC_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXTINF:4.000,
segment001.ts
#EXTINF:4.000,
segment002.ts
#EXTINF:4.000,
segment003.ts
#EXT-X-ENDLIST`;

const SCTE35_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXTINF:4.000,
segment001.ts
#EXTINF:4.000,
segment002.ts
#EXT-X-CUE-OUT:30.000
#EXTINF:4.000,
ad-segment001.ts
#EXTINF:4.000,
ad-segment002.ts
#EXTINF:4.000,
ad-segment003.ts
#EXT-X-CUE-IN
#EXTINF:4.000,
segment003.ts
#EXT-X-ENDLIST`;

const DATERANGE_SCTE35_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXTINF:4.000,
segment001.ts
#EXT-X-DATERANGE:ID="splice-1",START-DATE="2024-01-01T00:00:00Z",SCTE35-OUT=0xFC30
#EXTINF:4.000,
ad-segment001.ts
#EXTINF:4.000,
segment002.ts
#EXT-X-ENDLIST`;

const TWITCH_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXTINF:2.000,
https://video-weaver.example.com/content001.ts
#EXTINF:2.000,
https://video-weaver.example.com/content002.ts
#EXT-X-DATERANGE:ID="stitched-ad-12345",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T00:00:00Z",DURATION=30.0
#EXT-X-TV-TWITCH-AD-URL=https://ad.example.com
#EXT-X-TV-TWITCH-AD-ROLL-TYPE=PREROLL
#EXTINF:2.000,
https://video-weaver.example.com/ad001.ts
#EXTINF:2.000,
https://video-weaver.example.com/ad002.ts
#EXT-X-DATERANGE:ID="content-resume",CLASS="twitch-content",START-DATE="2024-01-01T00:00:30Z"
#EXTINF:2.000,
https://video-weaver.example.com/content003.ts
#EXT-X-ENDLIST`;

const PLUTO_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXTINF:4.000,
https://cdn.pluto.tv/content/segment001.ts
#EXT-X-CUE-OUT:60.000
#EXT-OATCLS-SCTE35:/DAhAAAAAAAAAP/wBQb+AAAAAAL/AOoAAA==
#EXTINF:4.000,
https://cdn.pluto.tv/_ad/break1/ad001.ts
#EXTINF:4.000,
https://cdn.pluto.tv/_ad/break1/ad002.ts
#EXT-X-CUE-IN
#EXTINF:4.000,
https://cdn.pluto.tv/content/segment002.ts
#EXT-X-ENDLIST`;

describe("pruneM3U", () => {
  it("passes through playlist without ads unchanged", () => {
    const result = pruneM3U(BASIC_PLAYLIST);
    expect(result).toBe(BASIC_PLAYLIST);
  });

  it("strips SCTE-35 CUE-OUT/IN blocks", () => {
    const result = pruneM3U(SCTE35_PLAYLIST);
    expect(result).not.toContain("EXT-X-CUE-OUT");
    expect(result).not.toContain("EXT-X-CUE-IN");
    expect(result).not.toContain("ad-segment001.ts");
    expect(result).not.toContain("ad-segment002.ts");
    expect(result).not.toContain("ad-segment003.ts");
    expect(result).toContain("segment001.ts");
    expect(result).toContain("segment002.ts");
    expect(result).toContain("segment003.ts");
  });

  it("strips DATERANGE tags with SCTE35 markers", () => {
    const result = pruneM3U(DATERANGE_SCTE35_PLAYLIST);
    expect(result).not.toContain("EXT-X-DATERANGE");
    expect(result).not.toContain("SCTE35-OUT");
    expect(result).toContain("segment001.ts");
    expect(result).toContain("segment002.ts");
  });

  it("handles Twitch stitched-ad format with segment replacement", () => {
    const result = pruneM3U(TWITCH_PLAYLIST, {
      adTagPatterns: ["stitched-ad", "X-TV-TWITCH-AD", "twitch-stitched-ad"],
      replaceWithLastContent: true,
    });

    // Ad markers should be gone
    expect(result).not.toContain("stitched-ad");
    expect(result).not.toContain("X-TV-TWITCH-AD");

    // Ad segment URLs should be replaced with last content segment
    expect(result).not.toContain("ad001.ts");
    expect(result).not.toContain("ad002.ts");

    // Content segments should remain
    expect(result).toContain("content001.ts");
    expect(result).toContain("content002.ts");
    expect(result).toContain("content003.ts");
  });

  it("strips Pluto TV EXT-OATCLS-SCTE35 and _ad/ segments", () => {
    const result = pruneM3U(PLUTO_PLAYLIST, {
      adTagPatterns: ["EXT-OATCLS-SCTE35"],
      adSegmentPatterns: ["_ad/"],
    });

    expect(result).not.toContain("EXT-OATCLS-SCTE35");
    expect(result).not.toContain("_ad/break1");
    expect(result).not.toContain("EXT-X-CUE-OUT");
    expect(result).toContain("segment001.ts");
    expect(result).toContain("segment002.ts");
  });

  it("applies regex pruning", () => {
    const regex = /#EXT-X-DATERANGE[^\n]*stitched-ad[^\n]*/g;
    const result = pruneM3U(TWITCH_PLAYLIST, { pruneRegex: regex });
    expect(result).not.toContain("stitched-ad-12345");
  });

  it("handles empty playlist", () => {
    const result = pruneM3U("");
    expect(result).toBe("");
  });

  it("handles playlist with only headers", () => {
    const result = pruneM3U("#EXTM3U\n#EXT-X-VERSION:3");
    expect(result).toBe("#EXTM3U\n#EXT-X-VERSION:3");
  });

  it("disables SCTE-35 stripping when option is false", () => {
    const result = pruneM3U(SCTE35_PLAYLIST, { stripSCTE35: false });
    expect(result).toContain("EXT-X-CUE-OUT");
    expect(result).toContain("ad-segment001.ts");
  });
});

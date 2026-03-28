import { describe, it, expect } from "vitest";
import { parseHLSAdBreaks, parseDASHAdBreaks } from "@/lib/ssai/ad-timeline";

const HLS_WITH_CUE_OUT = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXTINF:4.000,
segment001.ts
#EXTINF:4.000,
segment002.ts
#EXTINF:4.000,
segment003.ts
#EXT-X-CUE-OUT:30.000
#EXTINF:4.000,
ad001.ts
#EXTINF:4.000,
ad002.ts
#EXT-X-CUE-IN
#EXTINF:4.000,
segment004.ts
#EXTINF:4.000,
segment005.ts
#EXT-X-ENDLIST`;

const HLS_PREROLL = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-CUE-OUT:15.000
#EXTINF:5.000,
ad001.ts
#EXTINF:5.000,
ad002.ts
#EXTINF:5.000,
ad003.ts
#EXT-X-CUE-IN
#EXTINF:4.000,
content001.ts
#EXT-X-ENDLIST`;

const HLS_DATERANGE = `#EXTM3U
#EXT-X-VERSION:3
#EXTINF:2.000,
content001.ts
#EXTINF:2.000,
content002.ts
#EXT-X-DATERANGE:ID="stitched-ad-123",CLASS="twitch-stitched-ad",START-DATE="2024-01-01T00:00:00Z",DURATION=30.0
#EXTINF:2.000,
ad001.ts
#EXTINF:2.000,
content003.ts
#EXT-X-ENDLIST`;

const HLS_MULTIPLE_BREAKS = `#EXTM3U
#EXT-X-VERSION:3
#EXTINF:10.000,
content001.ts
#EXT-X-CUE-OUT:20.000
#EXTINF:10.000,
ad001.ts
#EXTINF:10.000,
ad002.ts
#EXT-X-CUE-IN
#EXTINF:10.000,
content002.ts
#EXTINF:10.000,
content003.ts
#EXT-X-CUE-OUT:15.000
#EXTINF:5.000,
ad003.ts
#EXTINF:5.000,
ad004.ts
#EXTINF:5.000,
ad005.ts
#EXT-X-CUE-IN
#EXTINF:10.000,
content004.ts
#EXT-X-ENDLIST`;

describe("parseHLSAdBreaks", () => {
  it("extracts CUE-OUT/IN ad break with correct timing", () => {
    const breaks = parseHLSAdBreaks(HLS_WITH_CUE_OUT);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].startTime).toBe(12); // 3 segments × 4s = 12s
    expect(breaks[0].duration).toBe(30);
    expect(breaks[0].endTime).toBe(42);
    expect(breaks[0].type).toBe("mid-roll");
  });

  it("detects pre-roll at start of playlist", () => {
    const breaks = parseHLSAdBreaks(HLS_PREROLL);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].startTime).toBe(0);
    expect(breaks[0].duration).toBe(15);
    expect(breaks[0].type).toBe("pre-roll");
  });

  it("extracts DATERANGE ad breaks", () => {
    const breaks = parseHLSAdBreaks(HLS_DATERANGE);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].startTime).toBe(4); // 2 segments × 2s
    expect(breaks[0].duration).toBe(30);
    expect(breaks[0].endTime).toBe(34);
  });

  it("handles multiple ad breaks", () => {
    const breaks = parseHLSAdBreaks(HLS_MULTIPLE_BREAKS);
    expect(breaks).toHaveLength(2);

    // First break: starts at 10s (one 10s segment), 20s duration
    expect(breaks[0].startTime).toBe(10);
    expect(breaks[0].duration).toBe(20);
    expect(breaks[0].endTime).toBe(30);

    // Second break: starts at 50s (10+20+10+10), 15s duration
    expect(breaks[1].startTime).toBe(50);
    expect(breaks[1].duration).toBe(15);
    expect(breaks[1].endTime).toBe(65);
  });

  it("returns empty array for playlist without ads", () => {
    const playlist = `#EXTM3U
#EXTINF:4.000,
segment001.ts
#EXTINF:4.000,
segment002.ts
#EXT-X-ENDLIST`;
    expect(parseHLSAdBreaks(playlist)).toHaveLength(0);
  });

  it("handles unterminated ad break with duration", () => {
    const playlist = `#EXTM3U
#EXTINF:10.000,
content001.ts
#EXT-X-CUE-OUT:30.000
#EXTINF:10.000,
ad001.ts`;

    const breaks = parseHLSAdBreaks(playlist);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].startTime).toBe(10);
    expect(breaks[0].duration).toBe(30);
  });
});

const DASH_WITH_ADS = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
  <Period id="content-1" start="PT0S" duration="PT15M0S">
    <AdaptationSet />
  </Period>
  <Period id="Ad-preroll-1" start="PT15M0S" duration="PT30S">
    <AdaptationSet />
  </Period>
  <Period id="content-2" start="PT15M30S" duration="PT30M0S">
    <AdaptationSet />
  </Period>
  <Period id="Ad-midroll-1" start="PT45M30S" duration="PT1M0S">
    <AdaptationSet />
  </Period>
  <Period id="content-3" start="PT46M30S" duration="PT43M30S">
    <AdaptationSet />
  </Period>
</MPD>`;

const DASH_NO_ADS = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
  <Period id="main-content" duration="PT1H0M0S">
    <AdaptationSet />
  </Period>
</MPD>`;

describe("parseDASHAdBreaks", () => {
  it("extracts ad breaks from DASH Periods with ad IDs", () => {
    const breaks = parseDASHAdBreaks(DASH_WITH_ADS);
    expect(breaks).toHaveLength(2);

    expect(breaks[0].startTime).toBe(900); // PT15M0S = 900s
    expect(breaks[0].duration).toBe(30); // PT30S
    expect(breaks[0].endTime).toBe(930);
    expect(breaks[0].type).toBe("mid-roll");

    expect(breaks[1].startTime).toBe(2730); // PT45M30S
    expect(breaks[1].duration).toBe(60); // PT1M0S
    expect(breaks[1].endTime).toBe(2790);
    expect(breaks[1].type).toBe("mid-roll");
  });

  it("returns empty array for DASH without ad Periods", () => {
    const breaks = parseDASHAdBreaks(DASH_NO_ADS);
    expect(breaks).toHaveLength(0);
  });

  it("returns empty array for invalid XML", () => {
    const breaks = parseDASHAdBreaks("<invalid><<<");
    expect(breaks).toHaveLength(0);
  });

  it("handles empty input", () => {
    const breaks = parseDASHAdBreaks("");
    expect(breaks).toHaveLength(0);
  });
});

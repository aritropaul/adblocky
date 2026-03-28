import { describe, it, expect } from "vitest";
import { pruneXML } from "@/lib/ssai/xml-prune";

const HULU_MPD = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT1H30M0S" type="static">
  <Period id="content-1" start="PT0S" duration="PT15M0S">
    <AdaptationSet mimeType="video/mp4">
      <Representation bandwidth="5000000" />
    </AdaptationSet>
  </Period>
  <Period id="Ad-preroll-1" start="PT15M0S" duration="PT30S">
    <AdaptationSet mimeType="video/mp4">
      <Representation bandwidth="3000000" />
    </AdaptationSet>
  </Period>
  <Period id="content-2" start="PT15M30S" duration="PT30M0S">
    <AdaptationSet mimeType="video/mp4">
      <Representation bandwidth="5000000" />
    </AdaptationSet>
  </Period>
  <Period id="Ad-midroll-1" start="PT45M30S" duration="PT1M0S">
    <AdaptationSet mimeType="video/mp4">
      <Representation bandwidth="3000000" />
    </AdaptationSet>
  </Period>
  <Period id="content-3" start="PT46M30S" duration="PT43M30S">
    <AdaptationSet mimeType="video/mp4">
      <Representation bandwidth="5000000" />
    </AdaptationSet>
  </Period>
</MPD>`;

const PARAMOUNT_MPD = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic">
  <Period id="content-main" duration="PT20M0S">
    <AdaptationSet mimeType="video/mp4">
      <Representation bandwidth="5000000" />
    </AdaptationSet>
  </Period>
  <Period id="pre-roll-ad-1" duration="PT15S">
    <AdaptationSet mimeType="video/mp4">
      <Representation bandwidth="3000000" />
    </AdaptationSet>
  </Period>
  <Period id="mid-roll-ad-2" duration="PT30S">
    <AdaptationSet mimeType="video/mp4">
      <Representation bandwidth="3000000" />
    </AdaptationSet>
  </Period>
  <Period id="content-resume" duration="PT40M0S">
    <AdaptationSet mimeType="video/mp4">
      <Representation bandwidth="5000000" />
    </AdaptationSet>
  </Period>
</MPD>`;

describe("pruneXML", () => {
  it("removes Hulu ad Periods by id prefix", () => {
    const result = pruneXML(HULU_MPD, {
      removeSelectors: ['Period[id^="Ad"]'],
    });

    expect(result).not.toContain("Ad-preroll-1");
    expect(result).not.toContain("Ad-midroll-1");
    expect(result).toContain("content-1");
    expect(result).toContain("content-2");
    expect(result).toContain("content-3");
  });

  it("removes Paramount+ ad Periods by id pattern", () => {
    const result = pruneXML(PARAMOUNT_MPD, {
      removeSelectors: ['Period[id*="-roll-"][id*="-ad-"]'],
    });

    expect(result).not.toContain("pre-roll-ad-1");
    expect(result).not.toContain("mid-roll-ad-2");
    expect(result).toContain("content-main");
    expect(result).toContain("content-resume");
  });

  it("removes attributes from matching elements", () => {
    const result = pruneXML(HULU_MPD, {
      removeAttributes: [
        { selector: "MPD", attribute: "mediaPresentationDuration" },
      ],
    });

    expect(result).not.toContain("mediaPresentationDuration");
    expect(result).toContain("<MPD");
  });

  it("handles combined selectors and attributes", () => {
    const result = pruneXML(HULU_MPD, {
      removeSelectors: ['Period[id^="Ad"]'],
      removeAttributes: [
        { selector: "MPD", attribute: "mediaPresentationDuration" },
        { selector: "Period", attribute: "start" },
      ],
    });

    expect(result).not.toContain("Ad-preroll-1");
    expect(result).not.toContain("mediaPresentationDuration");
    expect(result).toContain("content-1");
  });

  it("returns original text for invalid XML", () => {
    const invalid = "<not valid xml<<<>>>";
    const result = pruneXML(invalid, {
      removeSelectors: ["Period"],
    });
    expect(result).toBe(invalid);
  });

  it("returns original text when nothing matches", () => {
    const result = pruneXML(HULU_MPD, {
      removeSelectors: ['Period[id="nonexistent"]'],
    });
    expect(result).toBe(HULU_MPD);
  });

  it("handles empty options", () => {
    const result = pruneXML(HULU_MPD, {});
    expect(result).toBe(HULU_MPD);
  });
});

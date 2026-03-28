import { describe, it, expect } from "vitest";
import { parseFilterList } from "../../scripts/parsers/abp-parser";

describe("ABP Parser", () => {
  it("parses hostname-anchored block filter", () => {
    const result = parseFilterList("||ads.example.com^");
    expect(result.networkFilters).toHaveLength(1);
    const f = result.networkFilters[0];
    expect(f.isHostnameAnchor).toBe(true);
    expect(f.pattern).toBe("ads.example.com^");
    expect(f.isException).toBe(false);
  });

  it("parses exception filter", () => {
    const result = parseFilterList("@@||example.com^$document");
    expect(result.networkFilters).toHaveLength(1);
    const f = result.networkFilters[0];
    expect(f.isException).toBe(true);
    expect(f.isHostnameAnchor).toBe(true);
    expect(f.resourceTypes).toContain("main_frame");
  });

  it("parses third-party option", () => {
    const result = parseFilterList("||tracker.com^$third-party");
    const f = result.networkFilters[0];
    expect(f.thirdParty).toBe(true);
  });

  it("parses domain option", () => {
    const result = parseFilterList(
      "||ads.com^$domain=site1.com|site2.com|~exclude.com",
    );
    const f = result.networkFilters[0];
    expect(f.domains).toEqual(["site1.com", "site2.com"]);
    expect(f.excludedDomains).toEqual(["exclude.com"]);
  });

  it("parses multiple resource types", () => {
    const result = parseFilterList("||ads.com^$script,image,xhr");
    const f = result.networkFilters[0];
    expect(f.resourceTypes).toEqual(["script", "image", "xmlhttprequest"]);
  });

  it("parses cosmetic filter", () => {
    const result = parseFilterList("example.com##.ad-banner");
    expect(result.cosmeticFilters).toHaveLength(1);
    const f = result.cosmeticFilters[0];
    expect(f.selector).toBe(".ad-banner");
    expect(f.domains).toEqual(["example.com"]);
    expect(f.isException).toBe(false);
  });

  it("parses cosmetic exception filter", () => {
    const result = parseFilterList("example.com#@#.ad-banner");
    const f = result.cosmeticFilters[0];
    expect(f.isException).toBe(true);
  });

  it("parses generic cosmetic filter (no domain)", () => {
    const result = parseFilterList("##.ad-wrapper");
    const f = result.cosmeticFilters[0];
    expect(f.selector).toBe(".ad-wrapper");
    expect(f.domains).toEqual([]);
  });

  it("skips comments and headers", () => {
    const input = `[Adblock Plus 2.0]
! Title: Test List
! Last modified: 2026-01-01

||ads.com^`;
    const result = parseFilterList(input);
    expect(result.networkFilters).toHaveLength(1);
    expect(result.metadata["Title"]).toBe("Test List");
  });

  it("parses $important flag", () => {
    const result = parseFilterList("||ads.com^$important");
    const f = result.networkFilters[0];
    expect(f.isImportant).toBe(true);
  });

  it("parses regex filter", () => {
    const result = parseFilterList("/ads\\.js\\?id=[0-9]+/");
    const f = result.networkFilters[0];
    expect(f.isRegex).toBe(true);
    expect(f.pattern).toBe("ads\\.js\\?id=[0-9]+");
  });

  it("handles negated resource types", () => {
    const result = parseFilterList("||cdn.com^$~image,~media");
    const f = result.networkFilters[0];
    expect(f.excludedResourceTypes).toEqual(["image", "media"]);
  });
});

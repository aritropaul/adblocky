import { describe, it, expect } from "vitest";
import { parseFilterList } from "../../scripts/parsers/abp-parser";
import { compileToDNR } from "../../scripts/parsers/dnr-compiler";

describe("DNR Compiler", () => {
  function compile(filter: string) {
    const parsed = parseFilterList(filter);
    return compileToDNR(parsed.networkFilters, "test");
  }

  it("compiles hostname-anchored block rule", () => {
    const rules = compile("||ads.example.com^");
    expect(rules).toHaveLength(1);
    expect(rules[0].action.type).toBe("block");
    expect(rules[0].condition.urlFilter).toBe("||ads.example.com^");
    expect(rules[0].priority).toBe(1);
  });

  it("compiles exception as allow rule with higher priority", () => {
    const rules = compile("@@||safe.example.com^");
    expect(rules).toHaveLength(1);
    expect(rules[0].action.type).toBe("allow");
    expect(rules[0].priority).toBe(2);
  });

  it("compiles $important with highest priority", () => {
    const rules = compile("||ads.com^$important");
    expect(rules[0].priority).toBe(3);
  });

  it("maps third-party to domainType", () => {
    const rules = compile("||tracker.com^$third-party");
    expect(rules[0].condition.domainType).toBe("thirdParty");
  });

  it("maps domain option to initiatorDomains", () => {
    const rules = compile("||ads.com^$domain=site.com|~exclude.com");
    expect(rules[0].condition.initiatorDomains).toEqual(["site.com"]);
    expect(rules[0].condition.excludedInitiatorDomains).toEqual([
      "exclude.com",
    ]);
  });

  it("maps resource types", () => {
    const rules = compile("||cdn.com^$script,image");
    expect(rules[0].condition.resourceTypes).toEqual(["script", "image"]);
  });

  it("assigns unique IDs", () => {
    const parsed = parseFilterList("||a.com^\n||b.com^\n||c.com^");
    const rules = compileToDNR(parsed.networkFilters, "test");
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("skips CSP and redirect filters", () => {
    const rules = compile("||ads.com^$csp=script-src 'self'");
    expect(rules).toHaveLength(0);
  });

  it("handles regex filters", () => {
    const rules = compile("/ads\\.js/");
    expect(rules).toHaveLength(1);
    expect(rules[0].condition.regexFilter).toBe("ads\\.js");
  });
});

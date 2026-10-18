import { describe, expect, it } from "vitest";
import {
  type EvalCompany,
  defaultHvacRuleConfig,
  evaluateRule,
  matchExclusion,
  normalizeExclusionValue,
  ruleConfigSchema,
  SCORE_CATEGORIES,
} from "@/server/domain/rules";
import type { FactEntry, FactMap } from "@/server/domain/facts";
import type { ContactInput } from "@/server/domain/contact";

const fact = (value: string, confidence = 0.9): FactEntry => ({
  value,
  confidence,
  provenance: "PUBLICLY_VERIFIED",
  evidenceId: null,
  updatedAt: new Date().toISOString(),
});

const company = (over: Partial<EvalCompany> = {}, facts: FactMap = {}): EvalCompany => ({
  name: "Cool Air",
  website: "https://coolair.com",
  state: "TX",
  city: "Dallas",
  zip: null,
  facts,
  contacts: [],
  contactResearchDone: false,
  ...over,
});

const rule = defaultHvacRuleConfig();
const check = (r: ReturnType<typeof evaluateRule>, id: string) => r.checks.find((c) => c.id === id);

describe("default rule", () => {
  it("is valid against the schema and matches the spec defaults", () => {
    expect(() => ruleConfigSchema.parse(rule)).not.toThrow();
    expect(rule.geography.country).toBe("United States");
    expect(rule.businessType).toBe("residential");
    expect(rule.services.requiredAnyOf).toEqual(["replacement", "installation"]);
    expect(rule.size).toEqual({ minEmployees: 5, maxEmployees: 50, allowUnknown: true });
    expect(rule.scoring.minScore).toBe(70);
    expect(rule.requirements.websiteRequired).toBe(true);
    expect(SCORE_CATEGORIES.reduce((a, c) => a + rule.scoring.categoryCaps[c], 0)).toBe(100);
  });
});

describe("evaluateRule", () => {
  it("an unresearched company is UNVERIFIED, never PASS and never FAIL", () => {
    const r = evaluateRule(company(), rule);
    expect(r.verdict).toBe("UNVERIFIED");
    expect(check(r, "services")?.status).toBe("UNKNOWN");
  });
  it("passes with residential + replacement evidenced", () => {
    const r = evaluateRule(company({}, { residential: fact("YES"), replacement: fact("YES") }), rule);
    expect(r.verdict).toBe("PASS");
  });
  it("installation alone satisfies the any-of service requirement", () => {
    const r = evaluateRule(company({}, { residential: fact("YES"), installation: fact("YES") }), rule);
    expect(check(r, "services")?.status).toBe("PASS");
  });
  it("fails commercial-only", () => {
    const r = evaluateRule(company({}, { commercial: fact("YES"), residential: fact("NO"), replacement: fact("YES") }), rule);
    expect(r.verdict).toBe("FAIL");
  });
  it("fails when HVAC is absent, website dead, or one-person operation", () => {
    for (const f of [{ hvac: fact("NO") }, { website_alive: fact("NO") }, { one_person_operation: fact("YES") }] as FactMap[]) {
      expect(evaluateRule(company({}, { residential: fact("YES"), replacement: fact("YES"), ...f }), rule).verdict).toBe("FAIL");
    }
  });
  it("fails when no website", () => {
    expect(evaluateRule(company({ website: null }), rule).verdict).toBe("FAIL");
  });
  it("CONFLICTING is reported as unknown-ish, not as a pass", () => {
    const r = evaluateRule(company({}, { residential: fact("YES"), replacement: fact("CONFLICTING"), installation: fact("UNKNOWN") }), rule);
    expect(check(r, "services")?.status).toBe("UNKNOWN");
  });

  describe("employee range", () => {
    const base: FactMap = { residential: fact("YES"), replacement: fact("YES") };
    it("unknown size is allowed by default and noted, not invented", () => {
      const c = check(evaluateRule(company({}, base), rule), "size");
      expect(c?.status).toBe("UNKNOWN");
      expect(c?.required).toBe(false);
    });
    it("unknown size fails when the rule disallows unknown", () => {
      const strict = { ...rule, size: { ...rule.size, allowUnknown: false } };
      expect(evaluateRule(company({}, base), strict).verdict).toBe("FAIL");
    });
    it("in-range passes, out-of-range fails, overlapping passes", () => {
      expect(check(evaluateRule(company({}, { ...base, employees: fact("12") }), rule), "size")?.status).toBe("PASS");
      expect(check(evaluateRule(company({}, { ...base, employees: fact("200") }), rule), "size")?.status).toBe("FAIL");
      expect(check(evaluateRule(company({}, { ...base, employees: fact("1-3") }), rule), "size")?.status).toBe("FAIL");
      expect(check(evaluateRule(company({}, { ...base, employees: fact("30-80") }), rule), "size")?.status).toBe("PASS");
    });
  });

  describe("geography", () => {
    const base: FactMap = { residential: fact("YES"), replacement: fact("YES") };
    const tx = { ...rule, geography: { ...rule.geography, states: ["Texas"] } };
    it("passes inside, fails outside, unknown when state missing", () => {
      expect(check(evaluateRule(company({ state: "TX" }, base), tx), "state")?.status).toBe("PASS");
      expect(check(evaluateRule(company({ state: "OK" }, base), tx), "state")?.status).toBe("FAIL");
      expect(check(evaluateRule(company({ state: null }, base), tx), "state")?.status).toBe("UNKNOWN");
    });
    it("reports settings that cannot be enforced yet instead of silently ignoring them", () => {
      const r = evaluateRule(company({}, base), { ...rule, geography: { ...rule.geography, radiusMiles: 25, metros: ["Dallas-Fort Worth"] } });
      expect(r.notEnforced.length).toBe(2);
    });
  });

  describe("technology is a signal only", () => {
    it("ServiceTitan never disqualifies", () => {
      const r = evaluateRule(company({}, { residential: fact("YES"), replacement: fact("YES"), software: fact("servicetitan") }), rule);
      expect(r.verdict).toBe("PASS");
      expect(check(r, "technology")?.required).toBe(false);
    });
  });

  describe("contact requirements", () => {
    const base: FactMap = { residential: fact("YES"), replacement: fact("YES") };
    const strict = { ...rule, contacts: { ...rule.contacts, ownerRequired: true, directPhoneRequired: true } };
    const owner: ContactInput = { name: "Pat", title: "Owner", roleClass: "owner", email: null, emailType: "UNKNOWN", phone: "(214) 555-2368", phoneType: "PUBLISHED_DIRECT", verified: true };
    it("is UNKNOWN before contact research and FAIL after it found nothing", () => {
      expect(evaluateRule(company({}, base), strict).verdict).toBe("UNVERIFIED");
      expect(evaluateRule(company({ contactResearchDone: true }, base), strict).verdict).toBe("FAIL");
    });
    it("passes with a verified owner and direct line", () => {
      expect(evaluateRule(company({ contacts: [owner] }, base), strict).verdict).toBe("PASS");
    });
    it("an unverified owner does not count", () => {
      expect(evaluateRule(company({ contacts: [{ ...owner, verified: false }], contactResearchDone: true }, base), strict).verdict).toBe("FAIL");
    });
  });
});

describe("exclusions", () => {
  const ex = [
    { id: "1", kind: "domain" as const, value: "badco.com", reason: null },
    { id: "2", kind: "name" as const, value: "acme hvac", reason: null },
    { id: "3", kind: "phone" as const, value: "+12145552368", reason: null },
    { id: "4", kind: "state" as const, value: "AK", reason: null },
  ];
  it("normalizes values before storing", () => {
    expect(normalizeExclusionValue("domain", "https://www.BadCo.com/x")).toBe("badco.com");
    expect(normalizeExclusionValue("name", "Acme HVAC, LLC")).toBe("acme hvac");
    expect(normalizeExclusionValue("phone", "(214) 555-2368")).toBe("+12145552368");
    expect(normalizeExclusionValue("state", "alaska")).toBe("AK");
    expect(normalizeExclusionValue("phone", "123")).toBeNull();
  });
  it("matches by each kind", () => {
    expect(matchExclusion({ name: "x", website: "www.badco.com" }, ex)?.id).toBe("1");
    expect(matchExclusion({ name: "ACME HVAC LLC" }, ex)?.id).toBe("2");
    expect(matchExclusion({ name: "x", phone: "214-555-2368" }, ex)?.id).toBe("3");
    expect(matchExclusion({ name: "x", state: "AK" }, ex)?.id).toBe("4");
    expect(matchExclusion({ name: "fine", website: "good.com", state: "TX" }, ex)).toBeNull();
  });
});

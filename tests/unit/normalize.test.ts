import { describe, expect, it } from "vitest";
import {
  normalizeCompanyName,
  normalizeStreetAddress,
  normalizeUsPhone,
  normalizeUsState,
  normalizeWebsite,
  normalizeZip,
} from "@/server/domain/normalize";

describe("normalizeUsPhone", () => {
  it("normalizes common formats to E.164 and display", () => {
    for (const raw of ["(214) 555-2368", "214-555-2368", "214.555.2368", "+1 214 555 2368", "1-214-555-2368", "2145552368"]) {
      const p = normalizeUsPhone(raw);
      expect(p?.e164, raw).toBe("+12145552368");
      expect(p?.display).toBe("(214) 555-2368");
    }
  });
  it("captures extensions without altering the number", () => {
    const p = normalizeUsPhone("214-555-2368 ext. 42");
    expect(p?.e164).toBe("+12145552368");
    expect(p?.extension).toBe("42");
  });
  it("rejects invalid numbers instead of repairing them", () => {
    for (const raw of ["", "  ", "555-2368", "123-456-7890", "214-155-2368", "911-555-2368", "21455523681", "call us", "(214) 555-01XX", null, undefined]) {
      expect(normalizeUsPhone(raw as string), String(raw)).toBeNull();
    }
  });
  it("rejects the reserved fictional 555-01XX range", () => {
    expect(normalizeUsPhone("(214) 555-0123")).toBeNull();
  });
});

describe("normalizeWebsite", () => {
  it("reduces URLs to origin + bare domain", () => {
    const r = normalizeWebsite("HTTP://WWW.Example-HVAC.com/services/ac?x=1#top");
    expect(r).toEqual({ ok: true, value: { url: "https://example-hvac.com", domain: "example-hvac.com" } });
  });
  it("accepts bare domains", () => {
    const r = normalizeWebsite("coolair.net");
    expect(r.ok && r.value.domain).toBe("coolair.net");
  });
  it("rejects social/directory pages as company websites", () => {
    for (const u of ["https://facebook.com/coolair", "https://www.yelp.com/biz/cool-air", "https://m.facebook.com/x", "maps.google.com/?q=hvac"]) {
      const r = normalizeWebsite(u);
      expect(r.ok, u).toBe(false);
      if (!r.ok) expect(r.reason).toBe("not_a_company_site");
    }
  });
  it("rejects garbage, IPs and localhost", () => {
    expect(normalizeWebsite("")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeWebsite("not a url")).toMatchObject({ ok: false });
    expect(normalizeWebsite("http://192.168.0.1")).toEqual({ ok: false, reason: "ip_or_local" });
    expect(normalizeWebsite("localhost")).toMatchObject({ ok: false });
    expect(normalizeWebsite("ftp://example.com")).toMatchObject({ ok: false });
  });
});

describe("normalizeCompanyName", () => {
  it("drops legal suffixes, punctuation and case", () => {
    expect(normalizeCompanyName("Cool Air Heating & Cooling, LLC")).toBe("cool air heating and cooling");
    expect(normalizeCompanyName("COOL AIR HEATING AND COOLING INC.")).toBe("cool air heating and cooling");
    expect(normalizeCompanyName("Bob's A/C Co.")).toBe("bobs a c");
  });
  it("never reduces a name to empty", () => {
    expect(normalizeCompanyName("LLC")).toBe("llc");
  });
  it("handles accents", () => {
    expect(normalizeCompanyName("Café Climate")).toBe("cafe climate");
  });
});

describe("address / state / zip", () => {
  it("abbreviates street words", () => {
    expect(normalizeStreetAddress("123 North Main Street, Suite 4")).toBe("123 n main st ste 4");
  });
  it("normalizes state names and codes", () => {
    expect(normalizeUsState("Texas")).toBe("TX");
    expect(normalizeUsState("tx")).toBe("TX");
    expect(normalizeUsState("New Mexico")).toBe("NM");
    expect(normalizeUsState("Ontario")).toBeNull();
    expect(normalizeUsState("")).toBeNull();
  });
  it("validates zips", () => {
    expect(normalizeZip("75201")).toBe("75201");
    expect(normalizeZip("75201-1234")).toBe("75201");
    expect(normalizeZip("7520")).toBeNull();
  });
});

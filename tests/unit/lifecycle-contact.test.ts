import { describe, expect, it } from "vitest";
import {
  LIFECYCLE,
  POST_APPROVAL,
  REVIEWABLE,
  canTransition,
  isStale,
  isSyncEligible,
  type LifecycleStatus,
} from "@/server/domain/lifecycle";
import {
  classifyEmail,
  classifyTitle,
  pickBestContact,
  type ContactInput,
} from "@/server/domain/contact";
import { parseEmployeeRange, parseSoftware, triFactDisplay } from "@/server/domain/facts";

describe("lifecycle", () => {
  it("every status is either reviewable or post-approval", () => {
    for (const s of LIFECYCLE) expect(REVIEWABLE.includes(s) || POST_APPROVAL.includes(s), s).toBe(true);
  });
  it("only a reviewer decision can reach APPROVED, and only from pre-approval stages", () => {
    expect(canTransition("NEEDS_REVIEW", "APPROVED")).toBe(true);
    expect(canTransition("DISCOVERED", "APPROVED")).toBe(true);
    expect(canTransition("REJECTED", "APPROVED")).toBe(false);
    expect(canTransition("CLOSED", "APPROVED")).toBe(false);
  });
  it("the engine cannot skip to sales stages", () => {
    for (const to of ["PAIN_FOUND", "QUALIFIED", "MEETING_BOOKED", "CLOSED"] as LifecycleStatus[]) {
      for (const from of ["DISCOVERED", "RESEARCHING", "RESEARCHED", "NEEDS_REVIEW"] as LifecycleStatus[]) {
        expect(canTransition(from, to), `${from}->${to}`).toBe(false);
      }
    }
  });
  it("rejected leads can only return to review/research", () => {
    expect(canTransition("REJECTED", "NEEDS_REVIEW")).toBe(true);
    expect(canTransition("REJECTED", "SYNCED")).toBe(false);
  });
});

describe("isSyncEligible: the Google Sheets gate", () => {
  it("requires an approval record AND a post-approval status", () => {
    expect(isSyncEligible({ status: "APPROVED", hasApprovalRecord: true })).toBe(true);
    expect(isSyncEligible({ status: "APPROVED", hasApprovalRecord: false })).toBe(false);
    for (const s of REVIEWABLE) expect(isSyncEligible({ status: s, hasApprovalRecord: true }), s).toBe(false);
  });
  it("does not push finished or parked leads", () => {
    for (const s of ["LOST", "NURTURE", "CLOSED"] as LifecycleStatus[]) {
      expect(isSyncEligible({ status: s, hasApprovalRecord: true })).toBe(false);
    }
  });
});

describe("isStale", () => {
  const now = new Date("2026-06-30T00:00:00Z");
  it("flags records older than the threshold", () => {
    expect(isStale("2026-05-01T00:00:00Z", 30, now)).toBe(true);
    expect(isStale("2026-06-15T00:00:00Z", 30, now)).toBe(false);
  });
  it("never-verified is not 'stale'", () => {
    expect(isStale(null, 30, now)).toBe(false);
  });
});

describe("classifyTitle", () => {
  it.each([
    ["Owner", "owner"],
    ["Co-Owner & GM", "owner"],
    ["President", "president"],
    ["Vice President of Sales", "other"],
    ["CEO", "president"],
    ["Founder", "founder"],
    ["General Manager", "general_manager"],
    ["Operations Manager", "operations_manager"],
    ["Director of Operations", "operations_manager"],
    ["Sales Manager", "sales_manager"],
    ["Lead Technician", "other"],
    [null, "other"],
  ])("%s → %s", (title, role) => {
    expect(classifyTitle(title as string | null)).toBe(role);
  });
});

describe("classifyEmail", () => {
  it("personal mailbox at the company domain is PUBLIC_BUSINESS", () => {
    expect(classifyEmail("pat@coolair.com", "coolair.com")).toBe("PUBLIC_BUSINESS");
  });
  it("role mailboxes and foreign domains are GENERAL", () => {
    expect(classifyEmail("info@coolair.com", "coolair.com")).toBe("GENERAL");
    expect(classifyEmail("pat@gmail.com", "coolair.com")).toBe("GENERAL");
  });
  it("invalid is UNKNOWN", () => {
    expect(classifyEmail("nope", "coolair.com")).toBe("UNKNOWN");
    expect(classifyEmail(null, null)).toBe("UNKNOWN");
  });
});

describe("pickBestContact", () => {
  const owner: ContactInput = { id: "o", name: "Pat Lee", title: "Owner", roleClass: "owner", email: "pat@coolair.com", emailType: "PUBLIC_BUSINESS", phone: "(214) 555-2368", phoneType: "PUBLISHED_DIRECT", verified: true };
  const gm: ContactInput = { id: "g", name: "Sam Roe", title: "General Manager", roleClass: "general_manager", email: null, emailType: "UNKNOWN", phone: "(214) 555-7788", phoneType: "PROFESSIONAL_MOBILE", verified: true };
  const company = "(214) 555-1000";

  it("P1: verified owner direct line wins over everything", () => {
    const b = pickBestContact([gm, owner], company);
    expect(b).toMatchObject({ priority: 1, label: "DIRECT PROFESSIONAL", name: "Pat Lee", phone: "(214) 555-2368", grade: "A" });
  });
  it("P2: verified GM direct line when no owner line", () => {
    const b = pickBestContact([{ ...owner, phone: null, phoneType: "UNKNOWN" }, gm], company);
    expect(b).toMatchObject({ priority: 2, label: "PROFESSIONAL MOBILE", name: "Sam Roe", grade: "A" });
  });
  it("P3: verified DM business email + company line", () => {
    const b = pickBestContact([{ ...owner, phone: null, phoneType: "UNKNOWN" }], company);
    expect(b).toMatchObject({ priority: 3, label: "PUBLIC BUSINESS EMAIL", phone: company, email: "pat@coolair.com", grade: "B" });
  });
  it("P4: company main line, and says direct phone is not found", () => {
    const b = pickBestContact([], company);
    expect(b).toMatchObject({ priority: 4, label: "COMPANY MAIN LINE", phone: company, name: null, grade: "C" });
  });
  it("an UNVERIFIED direct number is never promoted", () => {
    const b = pickBestContact([{ ...owner, verified: false }], company);
    expect(b.priority).toBe(4);
    expect(b.phone).toBe(company);
  });
  it("a non-decision-maker's direct line is not used as the decision maker's", () => {
    const tech: ContactInput = { ...gm, roleClass: "other", title: "Technician" };
    expect(pickBestContact([tech], company).priority).toBe(4);
  });
  it("nothing at all → NOT FOUND / grade D", () => {
    expect(pickBestContact([], null)).toMatchObject({ priority: null, label: "NOT FOUND", grade: "D", phone: null });
  });
  it("DM verified but only company line → grade B", () => {
    const dmNoContact: ContactInput = { ...owner, phone: null, phoneType: "UNKNOWN", email: null, emailType: "UNKNOWN" };
    expect(pickBestContact([dmNoContact], company)).toMatchObject({ priority: 4, grade: "B", name: "Pat Lee" });
  });
});

describe("fact helpers", () => {
  it("parseEmployeeRange never guesses", () => {
    expect(parseEmployeeRange("5-50")).toEqual({ min: 5, max: 50 });
    expect(parseEmployeeRange("12")).toEqual({ min: 12, max: 12 });
    expect(parseEmployeeRange("50+")?.min).toBe(50);
    expect(parseEmployeeRange("lots")).toBeNull();
    expect(parseEmployeeRange("UNKNOWN")).toBeNull();
    expect(parseEmployeeRange("50-5")).toBeNull();
    expect(parseEmployeeRange(null)).toBeNull();
  });
  it("parseSoftware ignores unknown tokens", () => {
    expect(parseSoftware("servicetitan,jobber,bogus")).toEqual(["servicetitan", "jobber"]);
    expect(parseSoftware("UNKNOWN")).toEqual([]);
  });
  it("triFactDisplay: YES with weak evidence is LOW_CONFIDENCE, not VERIFIED", () => {
    const e = (value: string, confidence: number) => ({ value, confidence, provenance: "PUBLICLY_VERIFIED" as const, evidenceId: null, updatedAt: "" });
    expect(triFactDisplay(e("YES", 0.95))).toBe("VERIFIED");
    expect(triFactDisplay(e("YES", 0.4))).toBe("LOW_CONFIDENCE");
    expect(triFactDisplay(e("CONFLICTING", 0.9))).toBe("CONFLICTING");
    expect(triFactDisplay(e("NO", 0.9))).toBe("NO");
    expect(triFactDisplay(undefined)).toBe("UNKNOWN");
  });
});

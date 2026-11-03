import { describe, it, expect } from "vitest";
import {
  computeProspectLocalTimeInfo,
  computeAutoFollowUpCadence,
  rankLeadsForFocusStream,
  buildFlashBattlecard,
  getQuickNoteChipsForOutcome,
} from "@/server/domain/focus-queue";
import type { CallerLeadView } from "@/server/repo/caller";

function mockLead(overrides: Partial<CallerLeadView> = {}): CallerLeadView {
  return {
    companyId: "comp-1",
    name: "Apex Property Management",
    address: "123 Main St",
    city: "Austin",
    state: "TX",
    phone: "(512) 555-0199",
    website: "https://apexproperties.com",
    status: "APPROVED",
    confidence: 0.9,
    icpScore: 85,
    grade: "A",
    replacement: "None",
    installation: "None",
    financing: "None",
    software: "Buildium",
    bestContact: {
      name: "Marcus Vance",
      title: "Managing Broker & Owner",
      phone: "(512) 555-0199",
      email: "marcus@apexproperties.com",
      grade: "A",
    },
    facts: {
      bleeding_ads: "YES",
      google_ads: "YES",
      doors_managed: "450",
    },
    notes: null,
    nextFollowUp: null,
    researchSummary: null,
    assignedMemberId: null,
    assignedMemberName: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("computeProspectLocalTimeInfo", () => {
  it("resolves US timezone and prime calling window accurately", () => {
    // 2026-10-29 15:00 UTC = 10:00 AM Central (TX) -> Prime Calling Window Morning
    const mockNow = Date.UTC(2026, 9, 29, 15, 0, 0);
    const txInfo = computeProspectLocalTimeInfo("TX", mockNow);
    expect(txInfo.iana).toBe("America/Chicago");
    expect(txInfo.localHour).toBe(10);
    expect(txInfo.windowStatus).toBe("PRIME_WINDOW");
    expect(txInfo.windowLabel).toContain("Prime Pickup Window");

    // 2026-10-29 04:00 UTC = 11:00 PM Central -> Outside calling hours
    const lateNow = Date.UTC(2026, 9, 29, 4, 0, 0);
    const lateInfo = computeProspectLocalTimeInfo("TX", lateNow);
    expect(lateInfo.windowStatus).toBe("AFTER_HOURS");
    expect(lateInfo.windowLabel).toContain("Outside Standard Hours");
  });

  it("handles CA (Pacific) and NY (Eastern) correctly", () => {
    const mockNow = Date.UTC(2026, 9, 29, 17, 0, 0); // 17:00 UTC = 1:00 PM Eastern, 10:00 AM Pacific
    const caInfo = computeProspectLocalTimeInfo("CA", mockNow);
    expect(caInfo.iana).toBe("America/Los_Angeles");
    expect(caInfo.localHour).toBe(10);

    const nyInfo = computeProspectLocalTimeInfo("NY", mockNow);
    expect(nyInfo.iana).toBe("America/New_York");
    expect(nyInfo.localHour).toBe(13);
  });
});

describe("computeAutoFollowUpCadence (Zero-Escape Loop)", () => {
  const baseNow = Date.UTC(2026, 9, 29, 14, 0, 0); // 2:00 PM UTC

  it("schedules +4 hours on NO_ANSWER first attempt", () => {
    const res = computeAutoFollowUpCadence({
      outcome: "NO_ANSWER",
      previousAttempts: 0,
      nowMs: baseNow,
    });
    expect(res.isTerminal).toBe(false);
    expect(res.nextFollowUpIso).toBeTruthy();
    expect(res.cadenceReason).toContain("+4h time-shift retry");
  });

  it("schedules next day cadence on NO_ANSWER second attempt", () => {
    const res = computeAutoFollowUpCadence({
      outcome: "NO_ANSWER",
      previousAttempts: 1,
      nowMs: baseNow,
    });
    expect(res.isTerminal).toBe(false);
    expect(res.nextFollowUpIso).toBeTruthy();
    expect(res.cadenceReason).toContain("Attempt 2 No-Answer");
  });

  it("schedules Gatekeeper Bypass window on GATEKEEPER_BLOCKED", () => {
    const res = computeAutoFollowUpCadence({
      outcome: "GATEKEEPER_BLOCKED",
      previousAttempts: 0,
      nowMs: baseNow,
    });
    expect(res.isTerminal).toBe(false);
    expect(res.nextFollowUpIso).toBeTruthy();
    expect(res.cadenceReason).toContain("Gatekeeper Bypass");
  });

  it("clears follow-up on terminal outcomes (MEETING_BOOKED, NOT_INTERESTED, WRONG_NUMBER)", () => {
    const booked = computeAutoFollowUpCadence({ outcome: "MEETING_BOOKED", previousAttempts: 1, nowMs: baseNow });
    expect(booked.nextFollowUpIso).toBeNull();
    expect(booked.isTerminal).toBe(true);

    const lost = computeAutoFollowUpCadence({ outcome: "NOT_INTERESTED", previousAttempts: 1, nowMs: baseNow });
    expect(lost.nextFollowUpIso).toBeNull();
    expect(lost.isTerminal).toBe(true);

    const wrong = computeAutoFollowUpCadence({ outcome: "WRONG_NUMBER", previousAttempts: 1, nowMs: baseNow });
    expect(wrong.nextFollowUpIso).toBeNull();
    expect(wrong.isTerminal).toBe(true);
  });

  it("preserves explicit follow-up date chosen by caller", () => {
    const explicitDate = "2026-11-05T14:30";
    const res = computeAutoFollowUpCadence({
      outcome: "CONNECTED",
      previousAttempts: 1,
      explicitFollowUpDate: explicitDate,
      nowMs: baseNow,
    });
    expect(res.nextFollowUpIso).toBe(explicitDate);
    expect(res.isTerminal).toBe(false);
    expect(res.cadenceReason).toContain("Manual follow-up");
  });
});

describe("rankLeadsForFocusStream", () => {
  const mockNow = Date.UTC(2026, 9, 29, 15, 0, 0); // 10:00 AM Central

  it("hijacks #1 position when a follow-up is due/overdue with mandatory lock", () => {
    const overdueLead = mockLead({
      companyId: "overdue-1",
      name: "Overdue Callback Lead",
      nextFollowUp: new Date(mockNow - 3600 * 1000).toISOString(), // 1 hour overdue
      icpScore: 40,
    });

    const highIcpLead = mockLead({
      companyId: "fresh-high-icp",
      name: "High ICP Lead",
      nextFollowUp: null,
      icpScore: 98,
    });

    const stream = rankLeadsForFocusStream([highIcpLead, overdueLead], mockNow);
    expect(stream[0]!.lead.companyId).toBe("overdue-1");
    expect(stream[0]!.isMandatoryFollowUpLock).toBe(true);
    expect(stream[0]!.tier).toBe("MANDATORY_FOLLOW_UP_DUE");
  });

  it("ranks prime calling window and higher ICP higher when no follow-ups are due", () => {
    // Lead 1: TX (10 AM -> Prime Window), ICP 80
    const leadTx = mockLead({
      companyId: "tx-lead",
      state: "TX",
      icpScore: 80,
    });

    // Lead 2: HI (Hawaii, UTC-10 -> 5:00 AM local -> Outside hours), ICP 95
    const leadHi = mockLead({
      companyId: "hi-lead",
      state: "HI",
      icpScore: 95,
    });

    const stream = rankLeadsForFocusStream([leadHi, leadTx], mockNow);
    expect(stream[0]!.lead.companyId).toBe("tx-lead");
    expect(stream[0]!.isMandatoryFollowUpLock).toBe(false);
  });
});

describe("buildFlashBattlecard", () => {
  it("generates targeted pain points and gatekeeper bypass", () => {
    const lead = mockLead({
      facts: {
        bleeding_ads: "YES",
        doors_managed: "600",
      },
    });

    const battlecard = buildFlashBattlecard({
      companyName: lead.name,
      contactName: lead.bestContact.name,
      contactTitle: lead.bestContact.title,
      city: lead.city,
      state: lead.state,
      nicheName: "Property Management",
      software: lead.software,
      facts: lead.facts as any,
      openingScript: "Hey Marcus...",
    });

    expect(battlecard.painTrigger).toContain("Active paid ad traffic");
    expect(battlecard.gatekeeperTip).toContain("Marcus");
    expect(battlecard.scaleAndTech).toContain("600 Doors Managed");
  });
});

describe("getQuickNoteChipsForOutcome", () => {
  it("provides relevant 1-tap note chips for outcomes", () => {
    const chipsNoAns = getQuickNoteChipsForOutcome("NO_ANSWER");
    expect(chipsNoAns).toContain("Rang 5x, no pickup");

    const chipsGatekeeper = getQuickNoteChipsForOutcome("GATEKEEPER_BLOCKED");
    expect(chipsGatekeeper).toContain("Owner in the field, call back afternoon");

    const chipsConnected = getQuickNoteChipsForOutcome("CONNECTED");
    expect(chipsConnected).toContain("Spoke with owner, interested, call back tomorrow");
  });
});

import { describe, it, expect } from "vitest";
import {
  deriveCallStatus,
  parseCallLog,
  parseNoteTimestamp,
  outcomeKeyFromLabel,
  inferOutcomeFromText,
  computeLiveCrmTelemetry,
} from "@/server/domain/call-outcomes";
import { zoneForState, convertHourBetweenZones, wallClock } from "@/server/domain/call-time";
import { canViewSalesAnalytics, getPermissionsForRole, type TeamMember } from "@/server/domain/team";
import {
  buildCallEvents,
  computeFunnel,
  type FunnelLead,
  type AuditCallInput,
} from "@/server/domain/funnel-analytics";

// 2026-10-29 10:00 UTC (= 3:00 PM PKT, 6:00 AM ET)
const NOW = Date.UTC(2026, 9, 29, 10, 0, 0);
const HOUR = 3600 * 1000;

function lead(id: string, over: Partial<FunnelLead> = {}): FunnelLead {
  return {
    id,
    name: `Lead ${id}`,
    state: "TX",
    status: "APPROVED",
    notes: null,
    icpScore: 60,
    assignedMemberId: null,
    createdAtMs: NOW - 5 * 86400000,
    ...over,
  };
}

function call(id: string, companyId: string, outcome: string, atMs: number): AuditCallInput {
  return { id, actor: "Hamda", companyId, callOutcome: outcome, notes: "", createdAtMs: atMs };
}

const members = [{ id: "m1", name: "Hamda", email: "hamda@x.com", title: "Caller" }];

describe("call outcome parsing", () => {
  it("maps note labels to outcomes", () => {
    expect(outcomeKeyFromLabel("Connected / Spoke")).toBe("CONNECTED");
    expect(outcomeKeyFromLabel("Left Voicemail")).toBe("CALL_COMPLETED");
    expect(outcomeKeyFromLabel("Not Interested")).toBe("NOT_INTERESTED");
    expect(outcomeKeyFromLabel("Gatekeeper")).toBe("GATEKEEPER_BLOCKED");
    expect(outcomeKeyFromLabel("???")).toBeNull();
  });

  it("prioritizes honest specific note text over generic labels", () => {
    // If caller clicked 'Connected' but wrote they only reached a gatekeeper:
    const gkNote = "[Oct 28, 3:05 PM • Hamda (Connected / Spoke)]: Receptionist picked up, refused to transfer to the owner.";
    const parsedGk = parseCallLog(gkNote);
    expect(parsedGk[0]?.outcome).toBe("GATEKEEPER_BLOCKED");

    // If caller clicked 'Connected' but booked a meeting:
    const meetingNote = "[Oct 28, 3:10 PM • Hamda (Connected / Spoke)]: Meeting booked with owner John for Thursday at 2pm!";
    const parsedMeeting = parseCallLog(meetingNote);
    expect(parsedMeeting[0]?.outcome).toBe("MEETING_BOOKED");

    // If caller clicked 'Connected' but lead was not interested / hung up:
    const declineNote = "[Oct 28, 3:15 PM • Hamda (Connected / Spoke)]: Not interested, told me to remove their number from list.";
    const parsedDecline = parseCallLog(declineNote);
    expect(parsedDecline[0]?.outcome).toBe("NOT_INTERESTED");

    // If caller clicked 'Connected' but left a voicemail:
    const vmNote = "[Oct 28, 3:20 PM • Hamda (Connected / Spoke)]: Left a voicemail on their answering machine.";
    const parsedVm = parseCallLog(vmNote);
    expect(parsedVm[0]?.outcome).toBe("CALL_COMPLETED");
  });

  it("derives one exclusive status per lead from the newest log line", () => {
    const notes =
      "[Oct 28, 3:05 PM • Hamda (Gatekeeper)]: receptionist\n[Oct 27, 1:00 PM • Hamda (No Answer)]: rang out";
    const d = deriveCallStatus({ status: "CALLING", notes });
    expect(d.key).toBe("GATEKEEPER_BLOCKED");
    expect(d.attempts).toBe(2);
    expect(parseCallLog(notes)).toHaveLength(2);
    expect(deriveCallStatus({ status: "APPROVED", notes: null }).key).toBe("UNTOUCHED");
    expect(deriveCallStatus({ status: "MEETING_BOOKED", notes: notes }).key).toBe("MEETING_BOOKED");
  });

  it("infers the year of note timestamps without landing in the future", () => {
    const ms = parseNoteTimestamp("Oct 28, 3:05 PM", NOW)!;
    expect(new Date(ms).getUTCFullYear()).toBe(2026);
    const future = parseNoteTimestamp("Dec 30, 3:05 PM", NOW)!;
    expect(new Date(future).getUTCFullYear()).toBe(2025);
  });
});

describe("time zones", () => {
  it("resolves US states by abbreviation or name", () => {
    expect(zoneForState("tx")?.groupId).toBe("CT");
    expect(zoneForState("New York")?.groupId).toBe("ET");
    expect(zoneForState("AZ")?.iana).toBe("America/Phoenix");
    expect(zoneForState("")).toBeNull();
  });

  it("converts prospect hours to PKT with DST handled", () => {
    // Oct 29 2026 is still EDT (UTC-4): 9 AM ET -> 13:00 UTC -> 6 PM PKT
    const r = convertHourBetweenZones(9, "America/New_York", "Asia/Karachi", NOW);
    expect(r.hour).toBe(18);
    expect(wallClock(NOW, "Asia/Karachi").hour).toBe(15);
  });
});

describe("funnel math", () => {
  const leads: FunnelLead[] = [
    lead("a"), // never called
    lead("b"), // no answer only
    lead("c"), // gatekeeper only
    lead("d"), // spoke, no next step
    lead("e"), // meeting booked
    lead("f"), // not interested
  ];
  const audit: AuditCallInput[] = [
    call("1", "b", "NO_ANSWER", NOW - 5 * HOUR),
    call("2", "c", "NO_ANSWER", NOW - 6 * HOUR),
    call("3", "c", "GATEKEEPER_BLOCKED", NOW - 4 * HOUR),
    call("4", "d", "GATEKEEPER_BLOCKED", NOW - 8 * HOUR),
    call("5", "d", "CONNECTED", NOW - 3 * HOUR),
    call("6", "e", "CONNECTED", NOW - 9 * HOUR),
    call("7", "e", "MEETING_BOOKED", NOW - 2 * HOUR),
    call("8", "f", "NOT_INTERESTED", NOW - 1 * HOUR),
  ];

  const events = buildCallEvents(leads, audit, members, NOW);
  const res = computeFunnel(leads, events, members, { scope: "ALL", timeframe: "ALL", nowMs: NOW });

  it("counts unique leads per stage and never lets a stage exceed the previous one", () => {
    const counts = res.stages.map((s) => s.count);
    expect(counts).toEqual([6, 5, 4, 3, 1]);
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeLessThanOrEqual(counts[i - 1]!);
  });

  it("explains every lost lead with a leak reason", () => {
    for (const s of res.stages.slice(1)) {
      const explained = s.leaks.reduce((a, l) => a + l.count, 0);
      expect(explained).toBe(s.lost);
    }
  });

  it("keeps dial level and lead level separate", () => {
    expect(res.dial.total).toBe(8);
    // human answers: 2x gatekeeper, 2x connected, 1x meeting, 1x not interested
    expect(res.dial.human).toBe(6);
    expect(res.dial.owner).toBe(4);
    expect(res.dial.meetings).toBe(1);
  });

  it("builds the exclusive status snapshot that sums to the pool", () => {
    const total = Object.values(res.statusCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(res.pool);
  });
});

describe("legacy notes are not double counted", () => {
  it("uses notes only for leads without audit events", () => {
    const withBoth = lead("x", {
      notes: "[Oct 28, 3:05 PM • Hamda (No Answer)]: rang",
    });
    const onlyNotes = lead("y", {
      notes: "[Oct 27, 3:05 PM • Hamda (Connected / Spoke)]: talked",
    });
    const audit = [call("1", "x", "NO_ANSWER", NOW - 2 * HOUR)];
    const events = buildCallEvents([withBoth, onlyNotes], audit, members, NOW);
    expect(events.filter((e) => e.companyId === "x")).toHaveLength(1);
    expect(events.filter((e) => e.companyId === "y")).toHaveLength(1);
    expect(events.find((e) => e.companyId === "y")!.source).toBe("note");
  });
});

describe("timing", () => {
  it("only uses exact audit timestamps and the prospect's local clock", () => {
    const leads = [lead("t1", { state: "NY" })];
    // 14:00 UTC = 10 AM ET (EDT)
    const at = Date.UTC(2026, 9, 28, 14, 0, 0);
    const events = buildCallEvents(leads, [call("1", "t1", "CONNECTED", at)], members, NOW);
    const res = computeFunnel(leads, events, members, { scope: "ALL", timeframe: "ALL", nowMs: NOW });
    expect(res.timing.prospectHours[10]!.dials).toBe(1);
    expect(res.timing.callerHours[19]!.dials).toBe(1); // 14:00 UTC = 7 PM PKT
    expect(res.timing.confidence).toBe("LOW");
  });
});

describe("live CRM inline notes, smart fields, and telemetry sync", () => {
  it("infers outcomes from freeform inline caller notes and follow-up notes", () => {
    expect(inferOutcomeFromText("Spoke with owner, uses ServiceTitan")).toBe("CONNECTED");
    expect(inferOutcomeFromText("No answer, rang 5 times")).toBe("NO_ANSWER");
    expect(inferOutcomeFromText("Left voicemail on cell")).toBe("CALL_COMPLETED");
    expect(inferOutcomeFromText("Receptionist took a message")).toBe("GATEKEEPER_BLOCKED");
    expect(inferOutcomeFromText("Owner said not interested right now")).toBe("NOT_INTERESTED");
    expect(inferOutcomeFromText("Demo booked for Thursday at 2pm")).toBe("MEETING_BOOKED");

    const parsed = parseCallLog(
      "[Follow-Up Note 2026-10-29] Call back tomorrow afternoon\nNo answer on main office line"
    );
    expect(parsed.length).toBeGreaterThanOrEqual(2);
    expect(parsed[0]!.outcome).toBe("CONNECTED");
    expect(parsed[1]!.outcome).toBe("NO_ANSWER");
  });

  it("derives call status from smart qualification fields and custom columns when notes are empty", () => {
    const d1 = deriveCallStatus({
      status: "APPROVED",
      notes: null,
      facts: {
        current_crm: { value: "Guesty", provenance: "HUMAN_CONFIRMED" },
        twenty_four_seven_concierge: { value: "Missed Late-Night Calls (High Pain)", provenance: "HUMAN_CONFIRMED" },
      },
    });
    expect(d1.key).toBe("CONNECTED");
    expect(d1.attempts).toBeGreaterThanOrEqual(1);
    expect(d1.qualifiedFieldsCount).toBe(2);

    const d2 = deriveCallStatus({
      status: "APPROVED",
      notes: null,
      facts: {
        custom_call_result: { value: "No Answer", provenance: "HUMAN_CONFIRMED" },
      },
    });
    expect(d2.key).toBe("NO_ANSWER");
  });

  it("computes live CRM telemetry accurately across pool and callers", () => {
    const pool = [
      {
        id: "l1",
        status: "APPROVED",
        notes: null,
        facts: {},
        assignedMemberId: "m1",
      },
      {
        id: "l2",
        status: "CALLING",
        notes: "[Oct 28, 3:05 PM • Hamda (No Answer)]: rang out",
        facts: {},
        assignedMemberId: "m1",
      },
      {
        id: "l3",
        status: "CONNECTED",
        notes: "[Oct 28, 4:10 PM • Hamda (Connected / Spoke)]: spoke with owner",
        facts: {
          str_pms_software: { value: "Hostaway", provenance: "HUMAN_CONFIRMED" },
        },
        nextFollowUp: "2026-10-30",
        assignedMemberId: "m1",
      },
      {
        id: "l4",
        status: "MEETING_BOOKED",
        notes: "[Oct 28, 5:00 PM • Hamda (Meeting Booked)]: booked demo",
        facts: {},
        assignedMemberId: "m1",
      },
    ];

    const telemetry = computeLiveCrmTelemetry(pool, members, NOW);
    expect(telemetry.totalLeads).toBe(4);
    expect(telemetry.untouchedLeads).toBe(1);
    expect(telemetry.dialedLeads).toBe(3);
    expect(telemetry.totalCallsDialed).toBe(3);
    expect(telemetry.noAnswerLeads).toBe(1);
    expect(telemetry.answeredLeads).toBe(2); // l3 (CONNECTED) + l4 (MEETING_BOOKED)
    expect(telemetry.connectedLeads).toBe(2);
    expect(telemetry.meetingsBooked).toBe(1);
    expect(telemetry.followUpsScheduled).toBe(1);
    expect(telemetry.qualifiedLeadsCount).toBe(1);
    expect(telemetry.callerMap["m1"]?.assigned).toBe(4);
    expect(telemetry.callerMap["m1"]?.callsLogged).toBe(3);
    expect(telemetry.callerMap["m1"]?.answered).toBe(2);
    expect(telemetry.callerMap["m1"]?.connected).toBe(2);
    expect(telemetry.callerMap["m1"]?.meetings).toBe(1);
  });

  it("synthesizes funnel call events for CRM-updated leads so /analytics matches /caller", () => {
    const crmLeads: FunnelLead[] = [
      lead("c1", {
        status: "APPROVED",
        assignedMemberId: "m1",
        facts: {
          decision_maker_confirmed: { value: "Spoke to Owner", provenance: "HUMAN_CONFIRMED" },
        },
      }),
      lead("c2", {
        status: "CALLING",
        assignedMemberId: "m1",
        notes: "No answer on cell",
      }),
    ];
    const events = buildCallEvents(crmLeads, [], members, NOW);
    expect(events).toHaveLength(2);
    const funnel = computeFunnel(crmLeads, events, members, {
      scope: "ALL",
      timeframe: "ALL",
      nowMs: NOW,
    });
    expect(funnel.dial.total).toBe(2);
    expect(funnel.dial.human).toBe(1);
    expect(funnel.dial.owner).toBe(1);
  });

  it("allows callers to access Sales Funnel (/analytics) when salesAnalytics permission is enabled, and blocks when disabled", () => {
    const callerMember: TeamMember = {
      id: "caller_1",
      name: "Hamda",
      email: "hamda@astraventa.com",
      title: "Sales Caller",
      role: "CALLER",
      status: "ACTIVE",
      avatarColor: "bg-indigo-500/15",
      nicheScope: "ALL",
      allowedNicheIds: [],
      tenantIds: ["tenant_main"],
      permissions: getPermissionsForRole("CALLER"),
      invitedAt: new Date().toISOString(),
    };

    expect(callerMember.permissions.salesAnalytics).toBe(true);
    expect(canViewSalesAnalytics(callerMember)).toBe(true);

    const disabledCaller: TeamMember = {
      ...callerMember,
      permissions: { ...callerMember.permissions, salesAnalytics: false },
    };
    expect(canViewSalesAnalytics(disabledCaller)).toBe(false);
  });
});

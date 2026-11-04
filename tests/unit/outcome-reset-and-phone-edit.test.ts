import { describe, it, expect } from "vitest";
import { deriveCallStatus, parseCallLog } from "@/server/domain/call-outcomes";
import { rankLeadsForFocusStream } from "@/server/domain/focus-queue";

describe("Outcome Reset & Accidental Outcome Recovery", () => {
  it("derives WRONG_NUMBER when cold caller logs a wrong number attempt", () => {
    const lead = {
      name: "Acme Corp",
      status: "NURTURE",
      notes: "[Nov 4, 2:30 PM • Caller (Wrong Number)]: Phone number disconnected / wrong company",
    };
    const derived = deriveCallStatus(lead);
    expect(derived.key).toBe("WRONG_NUMBER");

    // focus stream excludes it from calling deck
    const stream = rankLeadsForFocusStream([lead]);
    expect(stream).toHaveLength(0);
  });

  it("restores lead to UNTOUCHED when Owner explicitly resets or approves it back to APPROVED", () => {
    const lead = {
      name: "Acme Corp",
      status: "APPROVED",
      notes: "[Nov 4, 2:30 PM • Caller (Wrong Number)]: Phone number disconnected / wrong company",
    };
    const derived = deriveCallStatus(lead);
    // Because status is APPROVED (Owner human override), it is no longer blocked as WRONG_NUMBER
    expect(derived.key).toBe("UNTOUCHED");

    // Active focus stream now includes it for dialing!
    const stream = rankLeadsForFocusStream([lead]);
    expect(stream).toHaveLength(1);
    expect(stream[0]?.lead).toBe(lead);
  });

  it("handles sanitized notes where (Wrong Number) was converted to (Number Corrected)", () => {
    const sanitizedNotes =
      "[Nov 4, 5:00 PM • Owner (Ready to Call)]: Phone updated to +1 919 555 1234. Ready for dialing.\n[Nov 4, 2:30 PM • Caller (Number Corrected)]: Phone number disconnected";
    const lead = {
      name: "Acme Corp",
      status: "APPROVED",
      notes: sanitizedNotes,
    };
    const derived = deriveCallStatus(lead);
    expect(derived.key).toBe("UNTOUCHED");

    const logs = parseCallLog(sanitizedNotes);
    expect(logs[0]?.outcome).not.toBe("WRONG_NUMBER");
  });

  it("restores lead to callable stream when accidental NOT_INTERESTED is reset to APPROVED", () => {
    const lead = {
      name: "Acme Corp",
      status: "APPROVED",
      notes: "[Nov 4, 1:00 PM • Caller (Not Interested)]: Clicked decline by mistake",
    };
    const derived = deriveCallStatus(lead);
    expect(derived.key).toBe("UNTOUCHED");

    const stream = rankLeadsForFocusStream([lead]);
    expect(stream).toHaveLength(1);
  });
});

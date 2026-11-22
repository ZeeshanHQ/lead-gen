import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDb, type DbHandle } from "../../src/server/db/client";
import { bootstrap } from "../../src/server/db/bootstrap";
import { createCandidate } from "../../src/server/repo/companies";
import { approveCompany } from "../../src/server/repo/approvals";
import { activities, companies, emailActivities, auditLogs } from "../../src/server/db/schema";
import { eq } from "drizzle-orm";
import {
  EMAIL_TEMPLATES,
  renderEmailTemplate,
  getLeadEmailStatus,
} from "../../src/server/domain/email-templates";
import {
  sendAndLogProspectEmail,
  getEmailActivitiesForCompany,
} from "../../src/server/repo/email-activities";
import { createActivity } from "../../src/server/repo/activities";
import { recordCallFeedback } from "../../src/server/repo/caller";

describe("Phase 3: Outbound Prospect Email Loop & Infrastructure", () => {
  let handle: DbHandle;
  let testCompanyId: string;

  beforeAll(async () => {
    handle = await createDb("memory://");
    await bootstrap(handle.db);

    const cand = await createCandidate(
      handle.db,
      {
        name: "Lone Star Realty Group",
        website: "https://lonestarrealty.test",
        phone: "(512) 555-1212",
        city: "Austin",
        state: "TX",
      },
      { actor: "setup" }
    );
    if (cand.kind !== "created") throw new Error("Failed to create candidate");
    testCompanyId = cand.id;
    await approveCompany(handle.db, testCompanyId, { actor: "admin@astraventa.com", note: "Approved" });
  });

  afterAll(async () => {
    await handle.close();
  });

  describe("1. Template Rendering & Substitution", () => {
    it("renders gatekeeper_intro template with custom variables", () => {
      const rendered = renderEmailTemplate("gatekeeper_intro", {
        ownerName: "Sarah Jenkins",
        companyName: "Lone Star Realty",
        senderName: "Hamda",
        city: "Austin",
      });

      expect(rendered.subject).toBe("Question about lead management at Lone Star Realty");
      expect(rendered.bodyText).toContain("Hi Sarah Jenkins,");
      expect(rendered.bodyText).toContain("top-performing teams in Austin");
      expect(rendered.bodyText).toContain("Hamda");
      expect(rendered.bodyText).toContain("Astraventa Sales Operations");
    });

    it("falls back cleanly when variables are missing or blank", () => {
      const rendered = renderEmailTemplate("info_requested", {
        companyName: "",
        ownerName: "",
      });

      expect(rendered.subject).toContain("your team");
      expect(rendered.bodyText).toContain("Hi there,");
      expect(rendered.bodyText).toContain("Astraventa Team");
    });
  });

  describe("2. getLeadEmailStatus Helper", () => {
    it("returns null for fresh leads with no email logs", () => {
      expect(getLeadEmailStatus({ notes: null })).toBeNull();
      expect(getLeadEmailStatus({ notes: "Some notes without email tags" })).toBeNull();
    });

    it("returns PENDING when an email was requested", () => {
      const notes = "[Nov 20, 2:30 PM • Hamda (Email Requested)]: Owner asked for pricing deck";
      expect(getLeadEmailStatus({ notes })).toBe("PENDING");
    });

    it("returns SENT when an email was dispatched", () => {
      const notes = '[Nov 20, 2:35 PM • Hamda (Email Sent)]: Sent email to owner@realty.com ("Overview")';
      expect(getLeadEmailStatus({ notes })).toBe("SENT");
    });

    it("correctly identifies the most recent state when both exist", () => {
      // Sent happened after requested (sent is at the top)
      const sentAfterNotes =
        '[Nov 20, 2:35 PM • Hamda (Email Sent)]: Sent email to owner@realty.com\n[Nov 20, 2:30 PM • Hamda (Email Requested)]: Owner asked for deck';
      expect(getLeadEmailStatus({ notes: sentAfterNotes })).toBe("SENT");

      // Requested happened after sent (requested is at the top)
      const requestedAgainNotes =
        '[Nov 22, 10:00 AM • Hamda (Email Requested)]: Owner requested updated deck\n[Nov 20, 2:35 PM • Hamda (Email Sent)]: Sent email to owner@realty.com';
      expect(getLeadEmailStatus({ notes: requestedAgainNotes })).toBe("PENDING");
    });
  });

  describe("3. sendAndLogProspectEmail Execution Loop", () => {
    it("completes open EMAIL task, records email activity, and schedules +2 business day follow-up CALL", async () => {
      // 1. First simulate a call that requested an email
      await recordCallFeedback(handle.db, {
        companyId: testCompanyId,
        callOutcome: "EMAIL_REQUESTED",
        actor: "Hamda",
        callerNotes: "Assistant asked to send 1-pager to sarah@lonestarrealty.test",
      });

      // Verify open EMAIL task exists
      const openTasksBefore = await handle.db
        .select()
        .from(activities)
        .where(eq(activities.companyId, testCompanyId));
      const emailTask = openTasksBefore.find((t) => t.type === "EMAIL" && t.status === "TODO");
      expect(emailTask).toBeDefined();

      // 2. Dispatch email via sendAndLogProspectEmail
      const result = await sendAndLogProspectEmail(handle.db, {
        companyId: testCompanyId,
        recipientEmail: "sarah@lonestarrealty.test",
        recipientName: "Sarah Jenkins",
        templateKey: "info_requested",
        subject: "Astraventa AI workflow overview for Lone Star Realty",
        bodyText: "Hi Sarah,\n\nHere is our 1-page overview.\n\nBest,\nHamda",
        actor: "Hamda",
      });

      expect(result.ok).toBe(true);
      expect(result.emailActivityId).toBeDefined();
      expect(result.followUpDate).toBeDefined();
      expect(result.updatedNotes).toContain("[Next Follow-up Scheduled:");
      expect(result.updatedNotes).toContain("(Email Sent)");

      // 3. Verify EMAIL task is marked DONE with outcome EMAIL_SENT
      const [updatedEmailTask] = await handle.db
        .select()
        .from(activities)
        .where(eq(activities.id, emailTask!.id));
      expect(updatedEmailTask?.status).toBe("DONE");
      expect(updatedEmailTask?.outcome).toBe("EMAIL_SENT");

      // 4. Verify a new CALL task is scheduled for follow-up (+2 business days)
      const allTasks = await handle.db
        .select()
        .from(activities)
        .where(eq(activities.companyId, testCompanyId));
      const followUpCallTask = allTasks.find(
        (t) => t.type === "CALL" && t.status === "TODO" && t.notes?.includes("Follow up on sent email")
      );
      expect(followUpCallTask).toBeDefined();
      expect(followUpCallTask?.dueAt).toBeInstanceOf(Date);

      // 5. Verify email_activities record exists
      const emailRecords = await getEmailActivitiesForCompany(handle.db, testCompanyId);
      expect(emailRecords.length).toBeGreaterThanOrEqual(1);
      const latestEmail = emailRecords[0];
      expect(latestEmail?.recipientEmail).toBe("sarah@lonestarrealty.test");
      expect(latestEmail?.status).toBe("SENT");
      expect(latestEmail?.templateKey).toBe("info_requested");

      // 6. Verify audit log entry
      const auditEntries = await handle.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, testCompanyId));
      const emailAudit = auditEntries.find((a) => a.action === "PROSPECT_EMAIL_SENT");
      expect(emailAudit).toBeDefined();
      expect(emailAudit?.actor).toBe("Hamda");
    });
  });
});

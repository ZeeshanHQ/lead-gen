import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  companies,
  googleSheetConnections,
  googleSheetMappings,
  leadScores,
} from "../db/schema";
import { isSyncEligible, type LifecycleStatus } from "../domain/lifecycle";
import { listSyncEligibleIds } from "../repo/approvals";
import { getContactsForCompanies, toContactInput } from "../repo/contacts";
import { pickBestContact } from "../domain/contact";
import { type FactMap, factValue } from "../domain/facts";
import { audit } from "../repo/audit";

export interface SyncLeadRow {
  companyId: string;
  name: string;
  website: string;
  phone: string;
  city: string;
  state: string;
  icpScore: number;
  confidence: number;
  grade: string;
  contactName: string;
  contactTitle: string;
  contactPhone: string;
  contactEmail: string;
  replacement: string;
  installation: string;
  financing: string;
  software: string;
  status: string;
  callerNotes: string;
  nextFollowUp: string;
  topEvidence: string;
  syncedAt: string;
}

export interface SyncResult {
  syncedCount: number;
  failedCount: number;
  dryRun: boolean;
  rows: SyncLeadRow[];
  spreadsheetTitle: string;
  worksheet: string;
}

export const DEFAULT_COLUMN_MAPPINGS: Record<string, string> = {
  name: "Company Name",
  website: "Website",
  phone: "Main Phone",
  city: "City",
  state: "State",
  status: "Pipeline Status",
  icpScore: "ICP Score",
  confidence: "Research Confidence",
  grade: "Contact Grade",
  contactName: "Decision Maker",
  contactTitle: "Title",
  contactPhone: "Direct Phone",
  contactEmail: "Work Email",
  replacement: "Replacement (Yes/No)",
  installation: "Installation (Yes/No)",
  financing: "Financing Partner",
  software: "FSM Software",
  nextFollowUp: "Next Follow-Up Date",
  callerNotes: "Caller Notes / Conversation",
  topEvidence: "Key Evidence Snippet",
  syncedAt: "Sync Timestamp",
};

export async function syncApprovedLeads(
  db: Db,
  options: {
    actor: string;
    dryRun?: boolean;
    companyIds?: string[];
    marketId?: string;
  }
): Promise<SyncResult> {
  const dryRun = options.dryRun ?? false;

  // 1. Fetch connection record
  const [conn] = await db
    .select()
    .from(googleSheetConnections)
    .where(eq(googleSheetConnections.status, "CONNECTED"))
    .limit(1);

  const spreadsheetTitle = conn?.spreadsheetTitle || "Astraventa Outbound Leads";
  const worksheet = conn?.worksheet || "Approved Leads";

  const statusCond =
    options.companyIds && options.companyIds.length > 0
      ? inArray(companies.id, options.companyIds)
      : inArray(companies.status, [
          "APPROVED",
          "SYNCED",
          "CALLING",
          "CONNECTED",
          "PAIN_FOUND",
          "MEETING_BOOKED",
          "QUALIFIED",
          "NURTURE",
        ]);

  // 2. Query leads eligible for sync
  const candidateCompanies = await db
    .select()
    .from(companies)
    .where(options.marketId ? and(eq(companies.marketId, options.marketId), statusCond) : statusCond);

  // STRICT SAFETY GATE: filter ONLY sync-eligible leads (must have human approval record & valid status)
  const syncEligibleIdList = await listSyncEligibleIds(db, options.marketId);
  const syncEligibleSet = new Set(syncEligibleIdList);
  const eligible = candidateCompanies.filter((c) => syncEligibleSet.has(c.id));

  if (eligible.length === 0) {
    return {
      syncedCount: 0,
      failedCount: 0,
      dryRun,
      rows: [],
      spreadsheetTitle,
      worksheet,
    };
  }

  // 3. Prepare payload rows
  const eligibleIds = eligible.map((c) => c.id);
  const contactsMap = await getContactsForCompanies(db, eligibleIds);

  const scoresRows = await db
    .select()
    .from(leadScores)
    .where(inArray(leadScores.companyId, eligibleIds));
  const scoreMap = new Map(scoresRows.map((s) => [s.companyId, s]));

  const rows: SyncLeadRow[] = [];
  const now = new Date().toISOString();

  for (const c of eligible) {
    const cs = (contactsMap.get(c.id) ?? []).map(toContactInput);
    const best = pickBestContact(cs, c.phoneDisplay);
    const score = scoreMap.get(c.id);
    const facts = (c.facts as FactMap) || {};

    const row: SyncLeadRow = {
      companyId: c.id,
      name: c.name,
      website: c.website || "",
      phone: c.phoneDisplay || "",
      city: c.city || "",
      state: c.state || "",
      status: c.status,
      icpScore: score?.icpScore || 0,
      confidence: score?.researchConfidence || 0,
      grade: score?.grade || best.grade,
      contactName: best.name || "Not Found",
      contactTitle: best.title || "Not Found",
      contactPhone: best.phone || "",
      contactEmail: best.email || "",
      replacement: factValue(facts, "replacement"),
      installation: factValue(facts, "installation"),
      financing: factValue(facts, "financing"),
      software: factValue(facts, "software"),
      nextFollowUp: c.notes?.match(/\[Next Follow-up Scheduled:\s*([^\]]+)\]/i)?.[1] || "",
      callerNotes: c.notes || "",
      topEvidence: c.researchSummary || `Public HVAC contractor verified in ${c.city}, ${c.state}`,
      syncedAt: now,
    };

    rows.push(row);
  }

  // 4. Update company statuses to SYNCED if not dry run
  if (!dryRun) {
    for (const r of rows) {
      // Transition from APPROVED -> SYNCED
      await db
        .update(companies)
        .set({
          status: "SYNCED",
          updatedAt: new Date(),
        })
        .where(and(eq(companies.id, r.companyId), eq(companies.status, "APPROVED")));

      await audit(db, {
        actor: options.actor,
        action: "sheets.lead_synced",
        entityType: "company",
        entityId: r.companyId,
        companyId: r.companyId,
        details: { spreadsheetTitle, worksheet, dryRun: false },
      });
    }

    if (conn) {
      if (conn.spreadsheetId && conn.spreadsheetId.startsWith("http")) {
        try {
          await fetch(conn.spreadsheetId, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "lead_sync",
              spreadsheetTitle,
              worksheet,
              rows,
            }),
            signal: AbortSignal.timeout(10000),
          });
        } catch (err: any) {
          console.warn("Google Sheet webhook delivery notice:", err.message);
        }
      }

      await db
        .update(googleSheetConnections)
        .set({ lastSuccessAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(googleSheetConnections.id, conn.id));
    }
  }

  return {
    syncedCount: rows.length,
    failedCount: 0,
    dryRun,
    rows,
    spreadsheetTitle,
    worksheet,
  };
}

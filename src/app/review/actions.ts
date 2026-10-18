"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import {
  approveCompany,
  rejectCompany,
  restoreCompany,
  getApprovalSummary,
} from "@/server/repo/approvals";
import { editCompany, type CompanyEdit } from "@/server/repo/companies";
import { getActor } from "@/server/repo/settings";
import { getEvidenceDrawer } from "@/server/repo/detail";
import { setFact, clearFact, acceptSuggestion, rejectSuggestion } from "@/server/repo/facts";
import type { FactKey, Provenance, SourceType } from "@/server/domain/facts";

export async function fetchApprovalSummaryAction(companyId: string) {
  try {
    const db = await getDb();
    const summary = await getApprovalSummary(db, companyId);
    return { ok: true, summary };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to load approval summary" };
  }
}

export async function fetchEvidenceDrawerAction(companyId: string) {
  try {
    const db = await getDb();
    const drawer = await getEvidenceDrawer(db, companyId);
    return { ok: true, drawer };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to load evidence drawer" };
  }
}

export async function approveLeadAction(
  companyId: string,
  note?: string,
  acknowledgeUnresearched?: boolean
) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    await approveCompany(db, companyId, { actor, note, acknowledgeUnresearched });

    // If auto-push to dialer on approval is enabled, dispatch the approved lead automatically
    try {
      const { getDialerConfigServer, pushLeadsToDialerAction } = await import("@/app/caller/actions");
      const { loadLeadRows } = await import("@/server/repo/queue");
      const dialerConfig = await getDialerConfigServer();
      if (dialerConfig.enabled && dialerConfig.autoPushOnApprove) {
        const rows = await loadLeadRows(db, "approved");
        const matched = rows.find((r) => r.id === companyId);
        if (matched) {
          await pushLeadsToDialerAction([
            {
              id: matched.id,
              name: matched.name,
              contactName: matched.best?.name || matched.owner?.name || null,
              contactTitle: matched.best?.title || matched.owner?.title || null,
              phone: matched.best?.phone || matched.phoneDisplay || null,
              email: matched.best?.email || null,
              city: matched.city,
              state: matched.state,
              website: matched.website,
              icpScore: matched.icpScore,
              notes: matched.notes || matched.researchSummary || null,
            },
          ]);
        }
      }
    } catch {
      // Never block approval if background dialer push fails
    }

    revalidatePath("/review");
    revalidatePath("/approved");
    revalidatePath("/caller");
    revalidatePath("/");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to approve lead" };
  }
}

export async function rejectLeadAction(companyId: string, reason?: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    await rejectCompany(db, companyId, { actor, reason });
    revalidatePath("/review");
    revalidatePath("/approved");
    revalidatePath("/");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to reject lead" };
  }
}

export async function restoreLeadAction(companyId: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    await restoreCompany(db, companyId, actor);
    revalidatePath("/review");
    revalidatePath("/approved");
    revalidatePath("/");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to restore lead" };
  }
}

export async function editLeadAction(companyId: string, edit: CompanyEdit) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const res = await editCompany(db, companyId, edit, actor);
    revalidatePath("/review");
    revalidatePath("/approved");
    revalidatePath(`/company/${companyId}`);
    return res;
  } catch (err: any) {
    return { ok: false, errors: { name: err.message || "Failed to edit lead" } };
  }
}

export async function addHumanFactAction(
  companyId: string,
  field: FactKey,
  value: string,
  evidenceText: string,
  sourceUrl?: string
) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const res = await setFact(db, {
      companyId,
      field,
      value,
      confidence: 1.0,
      provenance: "HUMAN_CONFIRMED",
      sourceType: "manual_entry",
      sourceUrl: sourceUrl || null,
      evidenceText,
      actor,
    });
    revalidatePath("/review");
    revalidatePath(`/company/${companyId}`);
    return { ok: true, res };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to set fact" };
  }
}

export async function clearFactAction(companyId: string, field: FactKey) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    await clearFact(db, companyId, field, actor);
    revalidatePath("/review");
    revalidatePath(`/company/${companyId}`);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to clear fact" };
  }
}

export async function acceptSuggestionAction(suggestionId: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    await acceptSuggestion(db, suggestionId, actor);
    revalidatePath("/review");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to accept suggestion" };
  }
}

export async function rejectSuggestionAction(suggestionId: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    await rejectSuggestion(db, suggestionId, actor);
    revalidatePath("/review");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to reject suggestion" };
  }
}

import React from "react";
import Link from "next/link";
import { getDb } from "@/server/db/client";
import { loadLeadRows } from "@/server/repo/queue";
import { listSyncEligibleIds } from "@/server/repo/approvals";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { getDialerConfigServer } from "@/app/caller/actions";
import { factValue } from "@/server/domain/facts";
import { CrmLeadSheet, type CrmLeadItem } from "@/components/crm-lead-sheet";
import { Sheet, PhoneCall, Download } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ApprovedLeadsPage() {
  const db = await getDb();
  const { market } = await getActiveContext(db);

  const [leads, syncEligibleList, teamState, dialerConfig] = await Promise.all([
    loadLeadRows(db, "approved", market.id),
    listSyncEligibleIds(db, market.id),
    getActiveTeamMember(db),
    getDialerConfigServer(),
  ]);

  const syncEligibleIds = new Set(syncEligibleList);
  const perms = teamState.activeMember.permissions;

  const crmLeads: CrmLeadItem[] = leads.map((l) => ({
    id: l.id,
    name: l.name,
    address: l.address,
    city: l.city,
    state: l.state,
    website: l.website,
    phoneDisplay: l.phoneDisplay,
    status: l.status,
    icpScore: l.icpScore,
    researchConfidence: l.researchConfidence,
    bestContact: {
      name: l.best?.name || l.owner?.name || null,
      title: l.best?.title || l.owner?.title || null,
      phone: l.best?.phone || null,
      email: l.best?.email || null,
    },
    replacement: factValue(l.facts, "replacement"),
    financing: factValue(l.facts, "financing"),
    software: factValue(l.facts, "software"),
    notes: l.notes,
    nextFollowUp: l.notes?.match(/\[Next Follow-up Scheduled:\s*([^\]]+)\]/i)?.[1] || null,
    researchSummary: l.researchSummary,
    approvedAt: l.approvedAt,
  }));

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="border-b border-slate-800/80 pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-white">
            CRM Leads — {market.name}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Approved leads for <strong className="text-slate-200">{market.name}</strong> ({syncEligibleIds.size} ready for export or calling).
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {perms?.exportAndSync !== false && (
            <>
              <a
                href="/api/export/csv"
                download
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-medium text-xs border border-slate-700/80 transition-colors"
              >
                <Download className="w-3.5 h-3.5 text-slate-400" />
                Export CSV
              </a>
              <Link
                href="/sheets"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-medium text-xs border border-slate-700/80 transition-colors"
              >
                <Sheet className="w-3.5 h-3.5 text-slate-400" />
                Sheets Sync
              </Link>
            </>
          )}
          {perms?.callerWorkbench !== false && (
            <Link
              href="/caller"
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-white hover:bg-slate-200 text-slate-950 font-semibold text-xs transition-colors"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              Caller Queue
            </Link>
          )}
        </div>
      </div>

      {/* Interactive CRM Sheet Table */}
      <CrmLeadSheet
        key={market.id}
        initialLeads={crmLeads}
        nicheName={market.name}
        title={`${market.name} — Approved Leads`}
        subtitle="Manage call status, notes, follow-up dates, and dialer exports."
        showCallerLink={perms?.callerWorkbench !== false}
        dialerConfig={dialerConfig}
        permissions={perms}
      />
    </div>
  );
}

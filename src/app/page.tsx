import React from "react";
import Link from "next/link";
import { getDb } from "@/server/db/client";
import { getOverview } from "@/server/repo/detail";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { getSetting } from "@/server/repo/settings";
import { DEFAULT_DIALER_CONFIG, type DialerConfig } from "@/server/domain/dialer";
import { ROLE_PRESETS } from "@/server/domain/team";
import { ActiveOperatingRules } from "@/components/active-operating-rules";
import { loadLeadRows } from "@/server/repo/queue";
import { factValue } from "@/server/domain/facts";
import { CrmLeadSheet, type CrmLeadItem } from "@/components/crm-lead-sheet";
import { formatDateTime } from "@/lib/utils";
import {
  Compass,
  Inbox,
  PhoneCall,
  SlidersHorizontal,
  Users,
  ArrowRight,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const db = await getDb();
  const ctx = await getActiveContext(db);
  const { market, tenant, rule: defaultRule } = ctx;
  const { activeMember, allMembers } = await getActiveTeamMember(db);
  const savedDialer = await getSetting<Partial<DialerConfig>>(
    db,
    "dialer_config"
  );
  const dialerConfig: DialerConfig = {
    ...DEFAULT_DIALER_CONFIG,
    ...(savedDialer || {}),
  };

  const overview = await getOverview(db, market.id);
  const approvedRows = await loadLeadRows(db, "approved", market.id);

  const crmLeads: CrmLeadItem[] = approvedRows.map((l) => ({
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
    nextFollowUp:
      l.notes?.match(/\[Next Follow-up Scheduled:\s*([^\]]+)\]/i)?.[1] || null,
    researchSummary: l.researchSummary,
    approvedAt: l.approvedAt,
  }));

  const needsReview = overview.byStatus["NEEDS_REVIEW"] ?? 0;
  const discovered = overview.byStatus["DISCOVERED"] ?? 0;
  const approved = overview.byStatus["APPROVED"] ?? 0;
  const inPipeline =
    (overview.byStatus["CALLING"] ?? 0) + (overview.byStatus["CONNECTED"] ?? 0);

  const perms = activeMember.permissions;
  const nicheMembers = allMembers.filter(
    (m) =>
      m.status !== "SUSPENDED" &&
      (m.nicheScope === "ALL" ||
        m.allowedNicheIds.length === 0 ||
        m.allowedNicheIds.includes(market.id))
  );

  return (
    <div className="space-y-5">
      {/* Top Overview Header */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>{tenant.name}</span>
              <span>•</span>
              <span className="font-medium text-slate-200">Niche: {market.name}</span>
              <span>•</span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950 px-2 py-0.5 text-[11px] text-slate-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Viewing as {activeMember.name} ({ROLE_PRESETS[activeMember.role]?.label})
              </span>
            </div>

            <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {market.name} — Dashboard
            </h1>
            <p className="text-xs sm:text-sm text-slate-400">
              {market.description ||
                `Manage leads, review contacts, and run outbound calls for ${market.name}.`}
            </p>
          </div>

          {/* Role-Aware Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {perms.approveLeads && (
              <Link
                href="/review"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-xs font-medium text-slate-950 transition hover:bg-slate-200"
              >
                <Inbox className="w-3.5 h-3.5" />
                <span>Review Leads ({needsReview + discovered})</span>
              </Link>
            )}

            {perms.callerWorkbench && (
              <Link
                href="/caller"
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition ${
                  !perms.approveLeads
                    ? "bg-white text-slate-950 hover:bg-slate-200"
                    : "border border-slate-700/80 bg-slate-800/70 text-slate-200 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <PhoneCall className="w-3.5 h-3.5" />
                <span>Caller Queue ({approved + inPipeline})</span>
              </Link>
            )}

            {perms.discoverLeads && (
              <Link
                href="/discover"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-800/70 px-3.5 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-800 hover:text-white"
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Find Leads</span>
              </Link>
            )}

            {perms.editRules && (
              <Link
                href="/rules"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-700 hover:text-white"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Scoring Rules</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Summary Cards — Cohesive, Clean Slate Palette */}
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
          <div className="text-xs text-slate-400">Total Leads</div>
          <div className="mt-1.5 text-2xl font-semibold text-white">{overview.total}</div>
          <div className="mt-1 text-[11px] text-slate-500 truncate">{market.name}</div>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
          <div className="text-xs text-slate-400">Needs Review</div>
          <div className="mt-1.5 text-2xl font-semibold text-white">
            {needsReview + discovered}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">Waiting for approval</div>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
          <div className="text-xs text-slate-400">Approved Leads</div>
          <div className="mt-1.5 text-2xl font-semibold text-white">{approved}</div>
          <div className="mt-1 text-[11px] text-slate-500">Ready for outreach</div>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
          <div className="text-xs text-slate-400">In Calling Queue</div>
          <div className="mt-1.5 text-2xl font-semibold text-white">
            {approved + inPipeline}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">{dialerConfig.platformName}</div>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
          <div className="text-xs text-slate-400">Saved Contacts</div>
          <div className="mt-1.5 text-2xl font-semibold text-white">
            {overview.contactTotal}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">Phones &amp; emails</div>
        </div>

        <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
          <div className="text-xs text-slate-400">Team on Niche</div>
          <div className="mt-1.5 text-2xl font-semibold text-white">
            {nicheMembers.length}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">Active members</div>
        </div>
      </div>

      {/* Main Lead Sheet Table */}
      <CrmLeadSheet
        key={market.id}
        initialLeads={crmLeads}
        nicheName={market.name}
        title={`${market.name} — Lead Sheet`}
        subtitle={`Approved leads, phone numbers, call notes, and dialer actions for ${market.name}.`}
        showCallerLink={perms.callerWorkbench}
        dialerConfig={dialerConfig}
        permissions={perms}
        activeActorName={activeMember.name}
      />

      {/* Bottom Section: Scoring Rules, Team Access & Recent Activity */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Scoring Rules Summary */}
        <ActiveOperatingRules
          key={defaultRule.id}
          initialRule={defaultRule as any}
          nicheName={market.name}
          canEditRules={perms.editRules}
        />

        {/* Right 2 Columns: Team Assigned to This Niche + Recent Activity */}
        <div className="space-y-5 lg:col-span-2">
          {/* Team Assigned to This Niche & Dialer Status */}
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-400" />
                <h2 className="text-sm font-semibold text-white">
                  Team Members on {market.name}
                </h2>
              </div>
              {perms.manageTeamAndSettings && (
                <Link
                  href="/settings"
                  className="inline-flex items-center gap-1 text-xs text-slate-300 hover:text-white"
                >
                  <span>Manage Team &amp; Dialer</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {nicheMembers.map((m) => {
                const roleLabel = ROLE_PRESETS[m.role]?.label || m.role;
                const isYou = m.id === activeMember.id;
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between rounded-lg border border-slate-800/80 bg-slate-950/60 px-3.5 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            m.status === "ACTIVE" ? "bg-emerald-400" : "bg-amber-400"
                          }`}
                        />
                        <span className="font-medium text-white truncate">{m.name}</span>
                        {isYou && (
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                            Current
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400 truncate">
                        {roleLabel} • {m.nicheScope === "ALL" ? "All Niches" : "Assigned Niches"}
                      </div>
                    </div>
                    <span className="text-[11px] text-slate-400 shrink-0">
                      {m.status === "ACTIVE" ? "Active" : "Invited"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Activity Log */}
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <h2 className="text-sm font-semibold text-white">Recent Activity</h2>
              <Link href="/audit" className="text-xs text-slate-400 hover:text-white">
                View All &rarr;
              </Link>
            </div>

            {overview.recent.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                No activity recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60 text-xs">
                {overview.recent.slice(0, 6).map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-4 py-2.5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="rounded border border-slate-800 bg-slate-950 px-2 py-0.5 font-mono text-[10px] text-slate-300 whitespace-nowrap">
                        {entry.action}
                      </span>
                      <span className="text-slate-300 truncate">
                        {entry.entityId ?? entry.companyId ?? "Workspace"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-400 shrink-0">
                      <span className="text-slate-300">{entry.actor}</span>
                      <span>{formatDateTime(entry.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type DealStage } from "@/server/db/schema";
import { type TeamMember } from "@/server/domain/team";
import { updateCompanyDealStageAction } from "@/app/caller/actions";
import { SalesFunnelClient } from "@/app/analytics/analytics-client";
import type { LeadRow } from "@/server/repo/queue";
import {
  Briefcase,
  Calendar,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  ExternalLink,
  Filter,
  Layers,
  MapPin,
  Phone,
  Search,
  Sparkles,
  TrendingUp,
  User,
  XCircle,
  FileText,
  AlertCircle,
  Loader2,
  BarChart3,
  Mail,
  Zap,
  RefreshCw,
} from "lucide-react";

interface PipelineClientProps {
  initialDeals: any[];
  contacts: any[];
  activeMember?: any;
  leads?: LeadRow[];
  teamCallers?: TeamMember[];
  callEvents?: any[];
  marketName?: string;
  tenantName?: string;
  initialTab?: "PIPELINE" | "ANALYTICS";
}

const STAGES: {
  key: DealStage;
  label: string;
  color: string;
  headerBorder: string;
  badgeBg: string;
}[] = [
  {
    key: "MEETING_BOOKED",
    label: "Discovery Scheduled",
    color: "text-blue-400",
    headerBorder: "border-blue-500",
    badgeBg: "bg-blue-950/40 text-blue-300 border-blue-500/40",
  },
  {
    key: "DISCOVERY",
    label: "Discovery Held",
    color: "text-cyan-400",
    headerBorder: "border-cyan-500",
    badgeBg: "bg-cyan-950/40 text-cyan-300 border-cyan-500/40",
  },
  {
    key: "PROPOSAL",
    label: "Proposal Sent",
    color: "text-amber-400",
    headerBorder: "border-amber-500",
    badgeBg: "bg-amber-950/40 text-amber-300 border-amber-500/40",
  },
  {
    key: "NEGOTIATION",
    label: "Negotiation / Pilot",
    color: "text-purple-400",
    headerBorder: "border-purple-500",
    badgeBg: "bg-purple-950/40 text-purple-300 border-purple-500/40",
  },
  {
    key: "CLOSED_WON",
    label: "Closed Won",
    color: "text-emerald-400",
    headerBorder: "border-emerald-500",
    badgeBg: "bg-emerald-950/40 text-emerald-300 border-emerald-500/40",
  },
  {
    key: "CLOSED_LOST",
    label: "Closed Lost",
    color: "text-rose-400",
    headerBorder: "border-rose-500",
    badgeBg: "bg-rose-950/40 text-rose-300 border-rose-500/40",
  },
];

const STAGE_ORDER: DealStage[] = [
  "MEETING_BOOKED",
  "DISCOVERY",
  "PROPOSAL",
  "NEGOTIATION",
  "CLOSED_WON",
];

export function PipelineClient({
  initialDeals,
  contacts,
  activeMember,
  leads = [],
  teamCallers = [],
  callEvents = [],
  marketName = "All Niches",
  tenantName = "Astraventa",
  initialTab = "PIPELINE",
}: PipelineClientProps) {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<"PIPELINE" | "ANALYTICS">(initialTab);
  const [deals, setDeals] = useState<any[]>(initialDeals);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editingValueId, setEditingValueId] = useState<string | null>(null);
  const [editValueUsd, setEditValueUsd] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  // Sync deals when server re-renders (e.g. after router.refresh)
  React.useEffect(() => {
    setDeals(initialDeals);
  }, [initialDeals]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    router.refresh();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  // Contact lookup map
  const contactMap = React.useMemo(() => {
    const map = new Map<string, any>();
    for (const c of contacts) {
      if (!map.has(c.companyId)) {
        map.set(c.companyId, c);
      }
    }
    return map;
  }, [contacts]);

  // Filtered deals
  const filteredDeals = React.useMemo(() => {
    if (!search.trim()) return deals;
    const q = search.toLowerCase().trim();
    return deals.filter((d) => {
      const c = contactMap.get(d.id);
      return (
        d.name?.toLowerCase().includes(q) ||
        d.city?.toLowerCase().includes(q) ||
        d.state?.toLowerCase().includes(q) ||
        c?.name?.toLowerCase().includes(q) ||
        c?.email?.toLowerCase().includes(q) ||
        c?.phone?.toLowerCase().includes(q)
      );
    });
  }, [deals, search, contactMap]);

  // Aggregate Real-time Live Metrics across Leads + Deals
  const metrics = React.useMemo(() => {
    const activeStages = new Set(["MEETING_BOOKED", "DISCOVERY", "PROPOSAL", "NEGOTIATION"]);
    let activeCount = 0;
    let activeValue = 0;
    let wonCount = 0;
    let wonValue = 0;
    let lostCount = 0;

    for (const d of deals) {
      const stage = d.dealStage as DealStage;
      const val = d.dealValueUsd || 0;
      if (activeStages.has(stage)) {
        activeCount++;
        activeValue += val;
      } else if (stage === "CLOSED_WON") {
        wonCount++;
        wonValue += val;
      } else if (stage === "CLOSED_LOST") {
        lostCount++;
      }
    }

    const totalClosed = wonCount + lostCount;
    const winRate = totalClosed > 0 ? Math.round((wonCount / totalClosed) * 100) : 0;

    // Real-time metrics across all leads
    const totalLeads = leads.length;
    let emailRequestedCount = 0;
    let meetingBookedCount = deals.length;
    let contactedCount = 0;

    for (const l of leads) {
      const notes = (l.notes || "").toLowerCase();
      if (l.status === "MEETING_BOOKED" || notes.includes("meeting booked")) {
        // already counted in meetingBookedCount
      }
      if (notes.includes("email requested") || notes.includes("email_requested") || notes.includes("send info")) {
        emailRequestedCount++;
      }
      if (notes.includes("[") && notes.includes("•")) {
        contactedCount++;
      }
    }

    return {
      activeCount,
      activeValue,
      wonCount,
      wonValue,
      lostCount,
      winRate,
      totalLeads,
      contactedCount,
      emailRequestedCount,
      meetingBookedCount,
    };
  }, [deals, leads]);

  const handleStageChange = async (
    companyId: string,
    newStage: DealStage,
    notes?: string
  ) => {
    setUpdatingId(companyId);
    // Optimistic UI update
    setDeals((prev) =>
      prev.map((d) =>
        d.id === companyId ? { ...d, dealStage: newStage } : d
      )
    );

    const res = await updateCompanyDealStageAction({
      companyId,
      dealStage: newStage,
      actor: activeMember?.name || "Pipeline Admin",
      notes,
    });

    setUpdatingId(null);
    if (!res.success) {
      // Revert if error
      setDeals(initialDeals);
      alert(`Failed to update deal stage: ${res.error}`);
    } else {
      router.refresh();
    }
  };

  const handleSaveDealValue = async (companyId: string) => {
    const num = editValueUsd.trim() ? parseInt(editValueUsd.replace(/[^0-9]/g, ""), 10) : null;
    const deal = deals.find((d) => d.id === companyId);
    if (!deal) return;

    setUpdatingId(companyId);
    setDeals((prev) =>
      prev.map((d) =>
        d.id === companyId ? { ...d, dealValueUsd: num } : d
      )
    );
    setEditingValueId(null);

    const res = await updateCompanyDealStageAction({
      companyId,
      dealStage: deal.dealStage,
      dealValueUsd: num,
      actor: activeMember?.name || "Pipeline Admin",
      notes: `Deal value updated to ${num != null ? `$${num.toLocaleString()}` : "Unset"}`,
    });

    setUpdatingId(null);
    if (!res.success) {
      setDeals(initialDeals);
      alert(`Failed to update deal value: ${res.error}`);
    } else {
      router.refresh();
    }
  };

  const advanceStage = (deal: any) => {
    const currentStage = (deal.dealStage as DealStage) || "MEETING_BOOKED";
    const currentIdx = STAGE_ORDER.indexOf(currentStage);
    if (currentIdx >= 0 && currentIdx < STAGE_ORDER.length - 1) {
      const nextStage = STAGE_ORDER[currentIdx + 1];
      if (nextStage) {
        handleStageChange(deal.id, nextStage);
      }
    }
  };

  const isOwner = activeMember?.role === "OWNER" || Boolean(activeMember?.permissions?.manageTeamAndSettings);

  return (
    <div className="space-y-6">
      {/* Top Unified Header & View Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span className="text-cyan-400 font-semibold uppercase tracking-wider">
              {tenantName}
            </span>
            <span>/</span>
            <span className="text-slate-200">Unified Sales Hub</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
              <Briefcase className="w-6 h-6 text-cyan-400" />
              Pipeline & Sales Funnel
            </h1>
            <span className="text-xs font-mono bg-cyan-950/60 text-cyan-300 border border-cyan-700/60 px-2.5 py-0.5 rounded-full font-bold">
              {metrics.activeCount} Active Deals
            </span>
          </div>
        </div>

        {/* View Mode Switcher + Refresh + Quick Search */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-xl p-1 bg-slate-900 border border-slate-800">
            <button
              type="button"
              onClick={() => setViewMode("PIPELINE")}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === "PIPELINE"
                  ? "bg-cyan-500 text-black shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Deal Pipeline (Kanban)</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("ANALYTICS")}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                viewMode === "ANALYTICS"
                  ? "bg-cyan-500 text-black shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Funnel Analytics</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white hover:border-slate-700 transition cursor-pointer disabled:opacity-50"
            title="Refresh live data from database"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-cyan-400" : "text-slate-400"}`}
            />
            <span>{isRefreshing ? "Refreshing..." : "Refresh Live Data"}</span>
          </button>

          {viewMode === "PIPELINE" && (
            <div className="relative w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search deals..."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
          )}
        </div>
      </div>

      {/* Real-Time Live KPI Strip (Always visible across both views) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <span className="text-slate-400 text-[11px] font-medium block">
            Active Deals Value
          </span>
          <div className="text-lg font-black text-white tracking-tight flex items-center gap-0.5 font-mono">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            {metrics.activeValue.toLocaleString()}
          </div>
          <span className="text-[10px] text-slate-500">
            {metrics.activeCount} in-flight deals
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <span className="text-slate-400 text-[11px] font-medium block">
            Closed Won Revenue
          </span>
          <div className="text-lg font-black text-emerald-400 tracking-tight flex items-center gap-0.5 font-mono">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            {metrics.wonValue.toLocaleString()}
          </div>
          <span className="text-[10px] text-emerald-500 font-semibold">
            {metrics.wonCount} won ({metrics.winRate}% win rate)
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <span className="text-slate-400 text-[11px] font-medium block">
            Discovery Scheduled
          </span>
          <div className="text-lg font-black text-blue-400 tracking-tight flex items-center gap-1 font-mono">
            <Calendar className="w-4 h-4 text-blue-400" />
            {metrics.meetingBookedCount}
          </div>
          <span className="text-[10px] text-slate-500">
            Meetings booked
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <span className="text-slate-400 text-[11px] font-medium block">
            Email / Info Sent
          </span>
          <div className="text-lg font-black text-cyan-400 tracking-tight flex items-center gap-1 font-mono">
            <Mail className="w-4 h-4 text-cyan-400" />
            {metrics.emailRequestedCount}
          </div>
          <span className="text-[10px] text-slate-500">
            High-intent requests
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <span className="text-slate-400 text-[11px] font-medium block">
            Total Leads in System
          </span>
          <div className="text-lg font-black text-white tracking-tight flex items-center gap-1 font-mono">
            <User className="w-4 h-4 text-slate-400" />
            {metrics.totalLeads.toLocaleString()}
          </div>
          <span className="text-[10px] text-slate-500">
            Verified database pool
          </span>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <span className="text-slate-400 text-[11px] font-medium block">
            Calls Attempted
          </span>
          <div className="text-lg font-black text-amber-400 tracking-tight flex items-center gap-1 font-mono">
            <Phone className="w-4 h-4 text-amber-400" />
            {metrics.contactedCount.toLocaleString()}
          </div>
          <span className="text-[10px] text-slate-500">
            Lifetime logged contacts
          </span>
        </div>
      </div>

      {/* VIEW 1: DEAL PIPELINE KANBAN BOARD */}
      {viewMode === "PIPELINE" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 min-h-[580px] w-full">
          {STAGES.map((stage) => {
            const stageDeals = filteredDeals.filter(
              (d) => (d.dealStage || "MEETING_BOOKED") === stage.key
            );
            const stageValue = stageDeals.reduce(
              (acc, cur) => acc + (cur.dealValueUsd || 0),
              0
            );

            return (
              <div
                key={stage.key}
                className="flex flex-col bg-slate-900/40 rounded-xl border border-slate-800/80 overflow-hidden min-w-0 w-full"
              >
                {/* Column Header */}
                <div
                  className={`p-3 border-b-2 bg-slate-900/90 ${stage.headerBorder} flex flex-col gap-1`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-200">
                      {stage.label}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-semibold">
                      {stageDeals.length}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 flex items-center gap-0.5">
                    <span>${stageValue.toLocaleString()}</span>
                  </div>
                </div>

                {/* Deal Cards Container */}
                <div className="p-2 space-y-2.5 flex-1 overflow-y-auto max-h-[720px] min-w-0">
                  {stageDeals.length === 0 ? (
                    <div className="h-28 border border-dashed border-slate-800/60 rounded-lg flex items-center justify-center text-[11px] text-slate-600">
                      No deals in stage
                    </div>
                  ) : (
                    stageDeals.map((deal) => {
                      const contact = contactMap.get(deal.id);
                      const isUpdating = updatingId === deal.id;
                      const isEditingVal = editingValueId === deal.id;
                      const canAdvance =
                        stage.key !== "CLOSED_WON" && stage.key !== "CLOSED_LOST";

                      return (
                        <div
                          key={deal.id}
                          className="group relative p-2.5 rounded-lg border border-slate-800 bg-slate-900/90 hover:border-slate-700 transition shadow-sm space-y-2 text-left min-w-0 w-full overflow-hidden"
                        >
                          {/* Top Row: Company & Link (Opens in New Tab) */}
                          <div className="flex items-start justify-between gap-1.5 min-w-0">
                            <Link
                              href={`/company/${deal.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-bold text-xs text-white hover:text-cyan-400 transition-colors truncate block flex-1"
                              title={`${deal.name} (Opens in new tab)`}
                            >
                              {deal.name}
                            </Link>
                            <Link
                              href={`/company/${deal.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-slate-500 hover:text-slate-300 shrink-0 p-0.5"
                              title="Open Full Profile in New Tab"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </Link>
                          </div>

                          {/* Contact Info */}
                          {contact && (
                            <div className="text-[11px] text-slate-400 space-y-0.5">
                              {contact.name && (
                                <div className="flex items-center gap-1 font-medium text-slate-300">
                                  <User className="w-3 h-3 text-slate-500" />
                                  <span className="truncate">{contact.name}</span>
                                </div>
                              )}
                              {contact.phone && (
                                <div className="flex items-center gap-1 text-[10px]">
                                  <Phone className="w-2.5 h-2.5 text-slate-500" />
                                  <span className="font-mono text-slate-400">
                                    {contact.phone}
                                  </span>
                                </div>
                              )}
                              {contact.email && (
                                <div className="flex items-center gap-1 text-[10px] text-cyan-400/80 truncate">
                                  <Mail className="w-2.5 h-2.5 text-cyan-500" />
                                  <span className="truncate">{contact.email}</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Location */}
                          {(deal.city || deal.state) && (
                            <div className="flex items-center gap-1 text-[10px] text-slate-500">
                              <MapPin className="w-2.5 h-2.5" />
                              <span>
                                {[deal.city, deal.state].filter(Boolean).join(", ")}
                              </span>
                            </div>
                          )}

                          {/* Deal Value Editor */}
                          <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between">
                            {isEditingVal ? (
                              <div className="flex items-center gap-1 w-full">
                                <span className="text-slate-400 text-xs">$</span>
                                <input
                                  type="text"
                                  autoFocus
                                  value={editValueUsd}
                                  onChange={(e) => setEditValueUsd(e.target.value)}
                                  placeholder="5000"
                                  className="w-20 bg-black border border-cyan-500 rounded px-1.5 py-0.5 text-xs text-white font-mono focus:outline-none"
                                />
                                <button
                                  onClick={() => handleSaveDealValue(deal.id)}
                                  className="text-[10px] bg-cyan-600 hover:bg-cyan-500 text-black font-bold px-2 py-0.5 rounded"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingValueId(null)}
                                  className="text-[10px] text-slate-400 hover:text-white px-1"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <div
                                onClick={() => {
                                  setEditingValueId(deal.id);
                                  setEditValueUsd(
                                    deal.dealValueUsd != null
                                      ? String(deal.dealValueUsd)
                                      : ""
                                  );
                                }}
                                className="cursor-pointer group-hover:border-b group-hover:border-dashed border-slate-600 text-xs font-mono font-bold text-emerald-400 flex items-center gap-0.5"
                                title="Click to edit deal value"
                              >
                                <span>
                                  {deal.dealValueUsd != null
                                    ? `$${deal.dealValueUsd.toLocaleString()}`
                                    : "+ Set Value"}
                                </span>
                              </div>
                            )}

                            {isUpdating && (
                              <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />
                            )}
                          </div>

                          {/* Stage Selector Dropdown */}
                          <div className="flex items-center gap-1.5 pt-1">
                            <select
                              value={deal.dealStage || "MEETING_BOOKED"}
                              onChange={(e) =>
                                handleStageChange(deal.id, e.target.value as DealStage)
                              }
                              className="bg-slate-900 border border-slate-800 text-[10px] text-slate-300 rounded px-1.5 py-1 focus:outline-none focus:border-cyan-500 cursor-pointer flex-1 truncate"
                            >
                              {STAGES.map((s) => (
                                <option key={s.key} value={s.key}>
                                  {s.label}
                                </option>
                              ))}
                            </select>

                            {/* Quick Advance Button */}
                            {canAdvance && (
                              <button
                                onClick={() => advanceStage(deal)}
                                className="px-2 py-1 rounded bg-slate-800 hover:bg-cyan-900/40 hover:text-cyan-300 text-slate-300 text-[10px] font-semibold flex items-center gap-0.5 transition-colors shrink-0"
                                title="Advance to next pipeline stage"
                              >
                                <span>Next</span>
                                <ChevronRight className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* VIEW 2: SALES FUNNEL & CONVERSION ANALYTICS */
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <SalesFunnelClient
            leads={leads}
            teamCallers={teamCallers}
            callEvents={callEvents}
            marketName={marketName}
            tenantName={tenantName}
            isOwner={isOwner}
            activeMemberId={activeMember?.id}
            activeMemberName={activeMember?.name}
          />
        </div>
      )}
    </div>
  );
}

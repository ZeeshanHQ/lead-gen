"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type DealStage } from "@/server/db/schema";
import { type TeamMember } from "@/server/domain/team";
import { updateCompanyDealStageAction } from "@/app/caller/actions";
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
} from "lucide-react";

interface PipelineClientProps {
  initialDeals: any[];
  contacts: any[];
  activeMember?: any;
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
}: PipelineClientProps) {
  const router = useRouter();
  const [deals, setDeals] = useState<any[]>(initialDeals);
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editingValueId, setEditingValueId] = useState<string | null>(null);
  const [editValueUsd, setEditValueUsd] = useState<string>("");
  const [isPending, startTransition] = useTransition();

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

  // Aggregate Metrics
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

    return {
      activeCount,
      activeValue,
      wonCount,
      wonValue,
      lostCount,
      winRate,
    };
  }, [deals]);

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

  return (
    <div className="space-y-6">
      {/* Top Header & Metrics Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span className="text-cyan-400 font-semibold uppercase tracking-wider">
              Astraventa CRM
            </span>
            <span>/</span>
            <span className="text-slate-200">Executive Pipeline</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
              <Briefcase className="w-6 h-6 text-cyan-400" />
              Founder Deal Pipeline
            </h1>
            <span className="text-xs font-mono bg-cyan-950/60 text-cyan-300 border border-cyan-700/60 px-2.5 py-0.5 rounded-full font-bold">
              {metrics.activeCount} Active Opportunities
            </span>
          </div>
        </div>

        {/* Quick Search */}
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search companies, contacts..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <span className="text-slate-400 text-[11px] font-medium block">
            Active Pipeline Value
          </span>
          <div className="text-xl font-black text-white tracking-tight flex items-center gap-1 font-mono">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            {metrics.activeValue.toLocaleString()}
          </div>
          <span className="text-[10px] text-slate-500">
            Across {metrics.activeCount} in-flight deals
          </span>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <span className="text-slate-400 text-[11px] font-medium block">
            Closed Won Revenue
          </span>
          <div className="text-xl font-black text-emerald-400 tracking-tight flex items-center gap-1 font-mono">
            <DollarSign className="w-4 h-4 text-emerald-400" />
            {metrics.wonValue.toLocaleString()}
          </div>
          <span className="text-[10px] text-emerald-500 font-semibold">
            {metrics.wonCount} deals won
          </span>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <span className="text-slate-400 text-[11px] font-medium block">
            Win Rate (Closed)
          </span>
          <div className="text-xl font-black text-cyan-300 tracking-tight flex items-center gap-1 font-mono">
            {metrics.winRate}%
          </div>
          <span className="text-[10px] text-slate-500">
            {metrics.wonCount} won / {metrics.lostCount} lost
          </span>
        </div>

        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-1">
          <span className="text-slate-400 text-[11px] font-medium block">
            Pipeline Health
          </span>
          <div className="text-xl font-black text-purple-300 tracking-tight flex items-center gap-1 font-mono">
            {deals.length} Total
          </div>
          <span className="text-[10px] text-slate-500">
            {metrics.lostCount} closed lost deals archived
          </span>
        </div>
      </div>

      {/* Kanban Board Columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 items-start overflow-x-auto pb-6">
        {STAGES.map((col) => {
          const colDeals = filteredDeals.filter((d) => d.dealStage === col.key);
          const colTotal = colDeals.reduce((sum, d) => sum + (d.dealValueUsd || 0), 0);

          return (
            <div
              key={col.key}
              className="rounded-xl border border-slate-800/80 bg-slate-900/40 flex flex-col min-w-[270px] max-h-[calc(100vh-280px)]"
            >
              {/* Column Header */}
              <div
                className={`p-3 border-b-2 ${col.headerBorder} bg-slate-900/80 rounded-t-xl flex items-center justify-between`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${col.color}`}>
                      {col.label}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300 font-semibold">
                      {colDeals.length}
                    </span>
                  </div>
                  {colTotal > 0 && (
                    <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                      ${colTotal.toLocaleString()}
                    </span>
                  )}
                </div>
              </div>

              {/* Deals Cards List */}
              <div className="p-2.5 space-y-3 overflow-y-auto flex-1">
                {colDeals.length === 0 ? (
                  <div className="p-6 text-center text-slate-600 text-[11px] italic">
                    No deals in stage
                  </div>
                ) : (
                  colDeals.map((deal) => {
                    const contact = contactMap.get(deal.id);
                    const isUpdating = updatingId === deal.id;
                    const canAdvance =
                      STAGE_ORDER.includes(deal.dealStage) &&
                      deal.dealStage !== "CLOSED_WON";

                    return (
                      <div
                        key={deal.id}
                        className={`p-3 rounded-lg border bg-slate-950/70 text-xs space-y-2.5 transition-all shadow-sm ${
                          isUpdating
                            ? "opacity-60 border-slate-700 pointer-events-none"
                            : "border-slate-800 hover:border-slate-700"
                        }`}
                      >
                        {/* Company Name & Link */}
                        <div className="flex items-start justify-between gap-1.5">
                          <Link
                            href={`/company/${deal.id}`}
                            className="font-bold text-white hover:text-cyan-400 transition-colors line-clamp-1 flex items-center gap-1 group"
                          >
                            <span>{deal.name}</span>
                            <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 text-cyan-400 transition-opacity" />
                          </Link>
                          {isUpdating && (
                            <Loader2 className="w-3 h-3 text-cyan-400 animate-spin" />
                          )}
                        </div>

                        {/* Location */}
                        {(deal.city || deal.state) && (
                          <div className="flex items-center gap-1 text-[11px] text-slate-400">
                            <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                            <span className="truncate">
                              {deal.city ? `${deal.city}, ` : ""}
                              {deal.state || ""}
                            </span>
                          </div>
                        )}

                        {/* Best Contact */}
                        {contact ? (
                          <div className="p-2 rounded bg-slate-900/60 border border-slate-800/60 space-y-1">
                            <div className="flex items-center gap-1 text-slate-300 font-medium text-[11px]">
                              <User className="w-2.5 h-2.5 text-cyan-400" />
                              <span className="truncate">{contact.name || "Contact"}</span>
                              {contact.title && (
                                <span className="text-[10px] text-slate-500 truncate">
                                  ({contact.title})
                                </span>
                              )}
                            </div>
                            {(contact.phone || deal.phoneDisplay) && (
                              <div className="text-[10px] font-mono text-cyan-300 flex items-center gap-1">
                                <Phone className="w-2.5 h-2.5 text-slate-500" />
                                {contact.phone || deal.phoneDisplay}
                              </div>
                            )}
                          </div>
                        ) : deal.phoneDisplay ? (
                          <div className="text-[11px] font-mono text-cyan-300 flex items-center gap-1">
                            <Phone className="w-2.5 h-2.5 text-slate-500" />
                            {deal.phoneDisplay}
                          </div>
                        ) : null}

                        {/* Deal Value Section */}
                        <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-900">
                          <span className="text-slate-500 text-[10px]">Value:</span>
                          {editingValueId === deal.id ? (
                            <div className="flex items-center gap-1">
                              <span className="text-slate-400 text-xs">$</span>
                              <input
                                type="text"
                                autoFocus
                                value={editValueUsd}
                                onChange={(e) => setEditValueUsd(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveDealValue(deal.id);
                                  if (e.key === "Escape") setEditingValueId(null);
                                }}
                                placeholder="Value..."
                                className="w-16 bg-slate-900 border border-cyan-500 rounded px-1 py-0.5 text-xs text-white"
                              />
                              <button
                                onClick={() => handleSaveDealValue(deal.id)}
                                className="px-1.5 py-0.5 rounded bg-cyan-600 text-[10px] text-white font-bold"
                              >
                                ✓
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingValueId(deal.id);
                                setEditValueUsd(deal.dealValueUsd?.toString() || "");
                              }}
                              className="font-mono font-bold text-emerald-400 hover:underline cursor-pointer"
                              title="Click to edit deal value"
                            >
                              {deal.dealValueUsd != null
                                ? `$${deal.dealValueUsd.toLocaleString()}`
                                : "+ Set Value"}
                            </button>
                          )}
                        </div>

                        {/* Next Action / Follow-up */}
                        {deal.nextFollowUpAt && (
                          <div className="flex items-center gap-1 text-[10px] text-indigo-300 bg-indigo-950/30 px-2 py-1 rounded border border-indigo-900/40">
                            <Calendar className="w-2.5 h-2.5 text-indigo-400" />
                            <span>
                              Follow-up:{" "}
                              {new Date(deal.nextFollowUpAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          </div>
                        )}

                        {/* Quick Stage Controls */}
                        <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between gap-1.5">
                          {/* Dropdown selector */}
                          <select
                            value={deal.dealStage}
                            onChange={(e) =>
                              handleStageChange(deal.id, e.target.value as DealStage)
                            }
                            className="bg-slate-900 border border-slate-800 text-[10px] text-slate-300 rounded px-1.5 py-1 focus:outline-none focus:border-cyan-500 cursor-pointer"
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
                              className="px-2 py-1 rounded bg-slate-800 hover:bg-cyan-900/40 hover:text-cyan-300 text-slate-300 text-[10px] font-semibold flex items-center gap-0.5 transition-colors"
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
    </div>
  );
}

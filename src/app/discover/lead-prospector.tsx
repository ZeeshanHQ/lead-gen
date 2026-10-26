"use client";

import React, { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Zap,
  MapPin,
  ShieldCheck,
  Search,
  ExternalLink,
  Phone,
  User,
  CheckCircle,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Loader2,
  ArrowRight,
  Copy,
  Check,
  Building,
  FileText,
  AlertCircle,
  Users,
  Mail,
  Globe,
  Plus,
  X,
} from "lucide-react";
import {
  runLeadDiscoveryAction,
  getLatestReviewLeadsAction,
  quickApproveLeadAction,
  approveAllReviewLeadsAction,
  quickRejectLeadAction,
  updateRuleTargetingAction,
  getActiveRulesForDiscoveryAction,
} from "./actions";
import { switchMarketAction } from "@/app/actions/tenant";
import { autoDistributeLeadsAction } from "@/app/caller/actions";
import { CandidateForm } from "./candidate-form";
import { EvidenceDrawer } from "@/components/evidence-drawer";
import { GATE_FIELDS, GATE_META, resolveGate, type GateField, type LeadGate } from "@/server/domain/gate";
import type { TeamMember } from "@/server/domain/team";
import type { MarketView } from "@/server/repo/markets";

interface LeadItem {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  phoneDisplay: string | null;
  status?: string;
  icpScore: number | null;
  owner: { name: string | null; title: string | null; verified: boolean } | null;
  best?: {
    name: string | null;
    title: string | null;
    phone: string | null;
    email: string | null;
    grade: string;
  };
  facts: Record<string, { value: string } | undefined>;
  evidenceCount: number;
  researchSummary?: string | null;
  notes?: string | null;
  assignedMemberId?: string | null;
  assignedMemberName?: string | null;
}

interface RunSummary {
  totalScanned: number;
  qualifiedCount: number;
  rejectedCount: number;
  crmReadyCount: number;
}

export function LeadProspector({
  activeMarket,
  allMarkets = [],
  initialRule,
  initialGate,
  initialLeads = [],
  initialTotalCount = 0,
  initialCrmReadyCount = 0,
  canEditRules = true,
  allMembers = [],
}: {
  activeMarket?: {
    id: string;
    name: string;
    description: string;
    keywords: string[];
    category: string;
  };
  allMarkets?: MarketView[];
  initialRule?: any;
  initialGate?: LeadGate;
  initialLeads?: LeadItem[];
  initialTotalCount?: number;
  initialCrmReadyCount?: number;
  canEditRules?: boolean;
  allMembers?: TeamMember[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [targetCount, setTargetCount] = useState<number>(25);
  const [customCountInput, setCustomCountInput] = useState<string>("25");
  const [activeRule, setActiveRule] = useState<any>(initialRule ?? null);
  const [nicheInfo, setNicheInfo] = useState(activeMarket);
  const [gate, setGate] = useState<LeadGate>(() =>
    initialGate ? resolveGate(initialGate) : resolveGate(initialRule?.gate)
  );
  const [showCustomGateInput, setShowCustomGateInput] = useState(false);
  const [customGateText, setCustomGateText] = useState("");
  const [leads, setLeads] = useState<LeadItem[]>(initialLeads);
  const [totalReviewCount, setTotalReviewCount] = useState<number>(
    initialTotalCount || initialLeads.length
  );
  const [crmReadyCount, setCrmReadyCount] = useState<number>(
    initialCrmReadyCount || 0
  );
  const [copiedPhoneId, setCopiedPhoneId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [distributing, setDistributing] = useState(false);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [selectedCallerId, setSelectedCallerId] = useState<string>("");
  const [evidenceCompanyId, setEvidenceCompanyId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Quick targeting drawer/modal state
  const [isEditingFilters, setIsEditingFilters] = useState(false);
  const [editStates, setEditStates] = useState<string>(
    initialRule?.geography?.states?.length
      ? initialRule.geography.states.join(", ")
      : "TX"
  );
  const [editCities, setEditCities] = useState<string>(
    initialRule?.geography?.cities?.length
      ? initialRule.geography.cities.join(", ")
      : ""
  );
  const [editKeywords, setEditKeywords] = useState<string>(
    initialRule?.discovery?.keywords?.length
      ? initialRule.discovery.keywords.join(", ")
      : activeMarket?.keywords?.length
      ? activeMarket.keywords.join(", ")
      : activeMarket?.name
      ? `${activeMarket.name} companies, local specialists`
      : "Local businesses, official website"
  );
  const [editMinScore, setEditMinScore] = useState<number>(
    initialRule?.scoring?.minScore ?? 60
  );
  const [editMinEmployees, setEditMinEmployees] = useState<number | null>(
    initialRule?.size?.minEmployees ?? null
  );
  const [editMaxEmployees, setEditMaxEmployees] = useState<number | null>(
    initialRule?.size?.maxEmployees ?? null
  );
  const [savingFilters, setSavingFilters] = useState(false);

  // Manual URL accordion toggle
  const [showManualIntake, setShowManualIntake] = useState(false);

  // Sync when server-provided market or leads update, without ever flashing empty
  useEffect(() => {
    if (activeMarket) {
      setNicheInfo(activeMarket);
    }
    if (initialRule) {
      setActiveRule(initialRule);
      const savedStates = initialRule.geography?.states || ["TX"];
      const savedCities = initialRule.geography?.cities || [];
      setEditStates(savedStates.join(", "));
      setEditCities(savedCities.join(", "));
      if (initialRule.discovery?.keywords?.length > 0) {
        setEditKeywords(initialRule.discovery.keywords.join(", "));
      } else if (activeMarket?.keywords?.length) {
        setEditKeywords(activeMarket.keywords.join(", "));
      }
      setEditMinScore(initialRule.scoring?.minScore ?? 60);
      setEditMinEmployees(initialRule.size?.minEmployees ?? null);
      setEditMaxEmployees(initialRule.size?.maxEmployees ?? null);
      setGate(resolveGate(initialGate ?? initialRule.gate));
    }
    if (initialLeads) {
      setLeads(initialLeads);
      setTotalReviewCount(initialTotalCount ?? initialLeads.length);
      setCrmReadyCount(initialCrmReadyCount ?? initialLeads.length);
    }
  }, [activeMarket?.id, initialRule, initialGate, initialLeads, initialTotalCount, initialCrmReadyCount]);

  const handleSwitchNicheInline = (marketId: string) => {
    if (!marketId || marketId === nicheInfo?.id) return;
    const targetMarket = allMarkets.find((m) => m.id === marketId);
    if (targetMarket) {
      setNicheInfo(targetMarket);
      if (targetMarket.keywords?.length) {
        setEditKeywords(targetMarket.keywords.join(", "));
      }
    }
    startTransition(async () => {
      await switchMarketAction(marketId);
      router.refresh();
    });
  };

  // Fallback load only if no initialRule was supplied by the server
  useEffect(() => {
    if (initialRule) return;
    getActiveRulesForDiscoveryAction().then((res) => {
      if (res.ok && res.rule) {
        setActiveRule(res.rule);
        if ((res as any).market) {
          setNicheInfo((res as any).market);
        }
        const savedStates = res.rule.geography?.states || ["TX"];
        const savedCities = res.rule.geography?.cities || [];
        setEditStates(savedStates.join(", "));
        setEditCities(savedCities.join(", "));
        if (res.rule.discovery?.keywords && res.rule.discovery.keywords.length > 0) {
          setEditKeywords(res.rule.discovery.keywords.join(", "));
        } else if ((res as any).market?.keywords?.length > 0) {
          setEditKeywords((res as any).market.keywords.join(", "));
        }
        setEditMinScore(res.rule.scoring?.minScore ?? 60);
        setEditMinEmployees(res.rule.size?.minEmployees ?? null);
        setEditMaxEmployees(res.rule.size?.maxEmployees ?? null);
        setGate(resolveGate((res.rule as any).gate));
      }
    });

    getLatestReviewLeadsAction().then((res) => {
      if (res.ok && res.leads) {
        setLeads(res.leads as any);
        setTotalReviewCount(res.totalCount || res.leads.length);
        setCrmReadyCount((res as any).crmReadyCount ?? res.leads.length);
        if ((res as any).gate) {
          setGate(resolveGate((res as any).gate));
        }
      }
    });
  }, [initialRule]);

  // Toggle a Must-Have Quality Gate field and immediately save + re-filter
  const handleToggleGateField = async (field: GateField) => {
    if (!canEditRules) return;
    const nextGate: LeadGate = { ...gate, [field]: !gate[field] };
    setGate(nextGate);

    const statesArr = editStates.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const citiesArr = editCities.split(",").map((c) => c.trim()).filter(Boolean);
    const kwsArr = editKeywords.split(",").map((k) => k.trim()).filter(Boolean);

    const res = await updateRuleTargetingAction({
      states: statesArr.length > 0 ? statesArr : ["TX"],
      cities: citiesArr,
      minScore: editMinScore,
      keywords: kwsArr,
      gate: nextGate,
    });

    if (res.ok) {
      const refreshed = await getLatestReviewLeadsAction();
      if (refreshed.ok && refreshed.leads) {
        setLeads(refreshed.leads as any);
        setTotalReviewCount(refreshed.totalCount || refreshed.leads.length);
        setCrmReadyCount((refreshed as any).crmReadyCount ?? refreshed.leads.length);
      }
    }
  };

  const handleAddCustomGateRule = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = customGateText.trim();
    if (!trimmed) return;
    const currentCustom = gate.customMustHaves || [];
    if (currentCustom.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      setCustomGateText("");
      setShowCustomGateInput(false);
      return;
    }
    const nextCustom = [...currentCustom, trimmed];
    const nextGate: LeadGate = { ...gate, customMustHaves: nextCustom };
    setGate(nextGate);
    setCustomGateText("");
    setShowCustomGateInput(false);

    const statesArr = editStates.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const citiesArr = editCities.split(",").map((c) => c.trim()).filter(Boolean);
    const kwsArr = editKeywords.split(",").map((k) => k.trim()).filter(Boolean);
    if (!kwsArr.some((k) => k.toLowerCase() === trimmed.toLowerCase())) {
      kwsArr.push(trimmed);
      setEditKeywords(kwsArr.join(", "));
    }

    await updateRuleTargetingAction({
      states: statesArr.length > 0 ? statesArr : ["TX"],
      cities: citiesArr,
      minScore: editMinScore,
      keywords: kwsArr,
      gate: nextGate,
    });
  };

  const handleRemoveCustomGateRule = async (ruleText: string) => {
    const nextCustom = (gate.customMustHaves || []).filter((item) => item !== ruleText);
    const nextGate: LeadGate = { ...gate, customMustHaves: nextCustom };
    setGate(nextGate);

    const statesArr = editStates.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const citiesArr = editCities.split(",").map((c) => c.trim()).filter(Boolean);
    const kwsArr = editKeywords.split(",").map((k) => k.trim()).filter(Boolean);

    await updateRuleTargetingAction({
      states: statesArr.length > 0 ? statesArr : ["TX"],
      cities: citiesArr,
      minScore: editMinScore,
      keywords: kwsArr,
      gate: nextGate,
    });
  };

  const handlePresetCount = (count: number) => {
    setTargetCount(count);
    setCustomCountInput(String(count));
  };

  const handleCustomCountChange = (val: string) => {
    setCustomCountInput(val);
    const parsed = parseInt(val, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      setTargetCount(Math.min(Math.max(parsed, 1), 200));
    }
  };

  // Primary 1-Click Discovery Action
  const handleStartDiscovery = () => {
    setErrorMsg(null);
    setSuccessBanner(null);
    setRunSummary(null);

    const finalCount = Math.min(Math.max(parseInt(customCountInput, 10) || targetCount || 25, 1), 200);
    setTargetCount(finalCount);
    setCustomCountInput(String(finalCount));

    startTransition(async () => {
      try {
        const kwsArr = editKeywords.split(",").map((k) => k.trim()).filter(Boolean);
        const statesArr = editStates.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
        const citiesArr = editCities.split(",").map((c) => c.trim()).filter(Boolean);

        const res = await runLeadDiscoveryAction({
          targetCount: finalCount,
          keywords: kwsArr,
          states: statesArr.length > 0 ? statesArr : ["TX"],
          cities: citiesArr,
          minScore: editMinScore,
          gate,
          minEmployees: editMinEmployees,
          maxEmployees: editMaxEmployees,
        });

        if (res.ok) {
          const returnedLeads = (res.leads as any[]) || [];
          setLeads(returnedLeads);
          const totalQualified = res.totalReviewCount ?? returnedLeads.length;
          const readyInCrm = (res as any).crmReadyCount ?? totalQualified;
          setTotalReviewCount(totalQualified);
          setCrmReadyCount(readyInCrm);

          const scanned = res.counters?.totalCandidates ?? 0;
          const approvedNew = (res.counters as any)?.approvedCount ?? res.counters?.createdCompanies ?? 0;
          const rejectedNew = Math.max(0, scanned - approvedNew);

          setRunSummary({
            totalScanned: scanned,
            qualifiedCount: approvedNew,
            rejectedCount: rejectedNew,
            crmReadyCount: readyInCrm,
          });

          if (approvedNew > 0) {
            setSuccessBanner(
              `Discovery complete for ${nicheInfo?.name || "Active Niche"}: ${approvedNew} qualified leads passed your Must-Have Quality Gate.`
            );
          } else {
            setSuccessBanner(
              `Discovery scanned ${scanned} candidates. No new leads met all strict quality gate criteria in this run.`
            );
          }
        } else {
          setErrorMsg(res.error || "Discovery run encountered an issue. Please try again.");
        }
      } catch (err: any) {
        // If client network connection dropped or timed out while server finished, recover latest leads
        try {
          const latest = await getLatestReviewLeadsAction();
          if (latest.ok && latest.leads && latest.leads.length > 0) {
            setLeads(latest.leads);
            setSuccessBanner(`Discovery completed! Showing ${latest.leads.length} qualified leads in review.`);
            return;
          }
        } catch {}
        setErrorMsg(
          err?.message?.includes("unexpected response")
            ? "Discovery completed on server. Please refresh or check Leads to review newly discovered prospects."
            : err?.message || "Discovery run was interrupted. Please retry in a moment."
        );
      }
    });
  };

  const handleAutoDistributeFromDiscover = async () => {
    if (!nicheInfo?.id) return;
    setDistributing(true);
    const res = await autoDistributeLeadsAction({ marketId: nicheInfo.id });
    setDistributing(false);
    if (res.ok) {
      setSuccessBanner(
        res.distributedCount && res.distributedCount > 0
          ? `Assigned ${res.distributedCount} unassigned leads equally across your callers. Ready to dial in Leads CRM!`
          : "All qualified leads in this niche are already assigned to callers."
      );
    } else {
      setErrorMsg(res.error || "Failed to distribute leads");
    }
  };

  // Quick Approve Lead from this page: moves lead directly into Leads CRM and removes from staging
  const handleQuickApprove = async (id: string) => {
    setActionLoadingId(id);
    const caller = allMembers.find((m) => m.id === selectedCallerId);
    const targetLead = leads.find((l) => l.id === id);
    const res = await quickApproveLeadAction(id, {
      memberId: caller ? caller.id : null,
      memberName: caller ? caller.name : null,
    });
    setActionLoadingId(null);
    if (res.ok) {
      setLeads((prev) => prev.filter((l) => l.id !== id));
      setTotalReviewCount((prev) => Math.max(0, prev - 1));
      setCrmReadyCount((prev) => prev + 1);
      setSuccessBanner(
        caller
          ? `Moved "${targetLead?.name || "Lead"}" to Leads CRM (Assigned to ${caller.name})! Ready to dial.`
          : `Moved "${targetLead?.name || "Lead"}" to Leads CRM! Ready to dial.`
      );
    } else {
      setErrorMsg(res.error || "Failed to approve lead");
    }
  };

  // Bulk Approve All Pending Leads into CRM: moves all staged leads to CRM queue
  const handleBulkApproveAll = async () => {
    setBulkApproving(true);
    const caller = allMembers.find((m) => m.id === selectedCallerId);
    const pendingIds = leads.map((l) => l.id);
    const res = await approveAllReviewLeadsAction({
      leadIds: pendingIds,
      assignToMemberId: caller ? caller.id : null,
      assignToMemberName: caller ? caller.name : null,
    });
    setBulkApproving(false);
    if (res.ok) {
      const count = res.approvedCount || pendingIds.length;
      setLeads((prev) => prev.filter((l) => !pendingIds.includes(l.id)));
      setTotalReviewCount((prev) => Math.max(0, prev - count));
      setCrmReadyCount((prev) => prev + count);
      setSuccessBanner(
        caller
          ? `Moved ${count} leads to Leads CRM assigned to ${caller.name}! Ready for dialing.`
          : `Moved ${count} leads to Leads CRM queue! Ready for dialing.`
      );
    } else {
      setErrorMsg(res.error || "Failed to bulk approve leads");
    }
  };

  // Quick Reject / Discard Lead from this page
  const handleQuickReject = async (id: string) => {
    setActionLoadingId(id);
    const targetLead = leads.find((l) => l.id === id);
    const res = await quickRejectLeadAction(id);
    setActionLoadingId(null);
    if (res.ok) {
      setLeads((prev) => prev.filter((l) => l.id !== id));
      setTotalReviewCount((prev) => Math.max(0, prev - 1));
      setSuccessBanner(`Discarded "${targetLead?.name || "Lead"}" from staging.`);
    } else {
      setErrorMsg(res.error || "Failed to discard lead");
    }
  };

  // Save Quick Target Filters
  const handleSaveFilters = async () => {
    setSavingFilters(true);
    const statesArr = editStates.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const citiesArr = editCities.split(",").map((c) => c.trim()).filter(Boolean);
    const kwsArr = editKeywords.split(",").map((k) => k.trim()).filter(Boolean);

    const res = await updateRuleTargetingAction({
      states: statesArr.length > 0 ? statesArr : ["TX"],
      cities: citiesArr,
      minScore: editMinScore,
      keywords: kwsArr,
      gate,
      minEmployees: editMinEmployees,
      maxEmployees: editMaxEmployees,
    });
    setSavingFilters(false);

    if (res.ok && res.rule) {
      setActiveRule(res.rule);
      setIsEditingFilters(false);
      const refreshed = await getLatestReviewLeadsAction();
      if (refreshed.ok && refreshed.leads) {
        setLeads(refreshed.leads as any);
        setTotalReviewCount(refreshed.totalCount || refreshed.leads.length);
        setCrmReadyCount((refreshed as any).crmReadyCount ?? refreshed.leads.length);
      }
      setSuccessBanner(
        `Targeting & Quality Gate updated for ${nicheInfo?.name || "Active Niche"}. ${
          res.reScore ? `Re-evaluated ${res.reScore.reScoredCount} leads against your rules.` : ""
        }`
      );
    } else {
      setErrorMsg(res.error || "Failed to update targeting rules");
    }
  };

  const copyPhone = (phone: string, id: string) => {
    navigator.clipboard.writeText(phone);
    setCopiedPhoneId(id);
    setTimeout(() => setCopiedPhoneId(null), 2000);
  };

  const states: string[] = activeRule?.geography?.states?.length ? activeRule.geography.states : ["TX"];
  const cities: string[] = activeRule?.geography?.cities?.filter(Boolean) || [];
  const minScore = activeRule?.scoring?.minScore ?? 60;
  const activeNicheName = nicheInfo?.name || "Target Niche";
  const locationSummary =
    cities.length > 0
      ? `${states.join(", ")} • ${cities.slice(0, 3).join(", ")}${cities.length > 3 ? ` +${cities.length - 3}` : ""}`
      : `${states.join(", ")} (All Major Metro Areas)`;

  return (
    <div className="space-y-6">
      {/* Evidence Drawer Modal */}
      {evidenceCompanyId && (
        <EvidenceDrawer
          companyId={evidenceCompanyId}
          onClose={() => setEvidenceCompanyId(null)}
        />
      )}

      {/* Main Command Center Card */}
      <div className="rounded-2xl border border-zinc-800/80 bg-[#121215] p-6 md:p-8 shadow-2xl space-y-6 text-zinc-100">
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-800 text-zinc-200 border border-zinc-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                Live Web Discovery &bull; AI Verification Engine
              </span>
              {allMarkets.length > 1 ? (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-zinc-900 text-zinc-300 border border-zinc-700">
                  <span className="text-zinc-400">Active Niche:</span>
                  <select
                    value={nicheInfo?.id || ""}
                    onChange={(e) => handleSwitchNicheInline(e.target.value)}
                    disabled={isPending}
                    className="bg-transparent font-bold text-white focus:outline-none cursor-pointer"
                  >
                    {allMarkets.map((m) => (
                      <option key={m.id} value={m.id} className="bg-zinc-900 text-white">
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-zinc-900 text-zinc-400 border border-zinc-800">
                  Active Niche: <strong className="text-zinc-100 ml-1">{activeNicheName}</strong>
                </span>
              )}
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">
              Find &amp; Qualify {activeNicheName} Leads
            </h1>
            <p className="text-xs text-zinc-400 max-w-2xl leading-relaxed">
              Discovers real {activeNicheName} companies, crawls their live websites to extract verified phone numbers, decision makers, and emails, and strictly blocks any incomplete lead from entering your CRM.
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-start md:self-auto">
            <button
              type="button"
              onClick={() => setIsEditingFilters(!isEditingFilters)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-200 hover:text-white transition shadow-sm"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400" />
              <span>{isEditingFilters ? "Close Targeting" : "Edit Targeting & Team Size"}</span>
            </button>
            <Link
              href="/caller"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black text-xs font-bold transition shadow-sm"
            >
              <span>Open Leads CRM</span>
              <span className="px-1.5 py-0.5 rounded-full bg-zinc-900 text-white font-bold text-[10px]">
                {crmReadyCount}
              </span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Owner-Controlled Must-Have Quality Gate */}
        <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800/90 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Must-Have Quality Gate (Strict CRM Entry Requirements)</span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Select what every lead <strong className="text-zinc-200">must have</strong>. Any company missing a selected item is automatically rejected and never enters your CRM.
              </p>
            </div>
            <span className="text-[11px] text-emerald-400 font-semibold shrink-0">
              {GATE_FIELDS.filter((f) => gate[f]).length + (gate.customMustHaves?.length || 0)} Mandatory Rules Active
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {GATE_FIELDS.map((field) => {
              const active = gate[field];
              const meta = GATE_META[field];
              return (
                <button
                  key={field}
                  type="button"
                  disabled={isPending}
                  onClick={() => handleToggleGateField(field)}
                  title={meta.description}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    active
                      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 shadow-sm"
                      : "bg-zinc-900/90 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200"
                  }`}
                >
                  <span
                    className={`w-3.5 h-3.5 rounded flex items-center justify-center border ${
                      active
                        ? "bg-emerald-500 border-emerald-400 text-black"
                        : "border-zinc-600 bg-zinc-950"
                    }`}
                  >
                    {active && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </span>
                  <span>{meta.label}</span>
                  {active && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                      Must
                    </span>
                  )}
                </button>
              );
            })}

            {/* Custom Must-Have Rules */}
            {(gate.customMustHaves || []).map((customRule) => (
              <div
                key={customRule}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-emerald-500/15 text-emerald-300 border-emerald-500/40 shadow-sm"
              >
                <span className="w-3.5 h-3.5 rounded flex items-center justify-center border bg-emerald-500 border-emerald-400 text-black">
                  <Check className="w-2.5 h-2.5 stroke-[3]" />
                </span>
                <span>{customRule}</span>
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                  Must
                </span>
                {canEditRules && (
                  <button
                    type="button"
                    onClick={() => handleRemoveCustomGateRule(customRule)}
                    className="ml-0.5 text-emerald-300/70 hover:text-white transition"
                    title="Remove custom requirement"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}

            {/* Add Custom Requirement Trigger / Input */}
            {canEditRules && (
              showCustomGateInput ? (
                <form
                  onSubmit={handleAddCustomGateRule}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1"
                >
                  <input
                    type="text"
                    autoFocus
                    value={customGateText}
                    onChange={(e) => setCustomGateText(e.target.value)}
                    placeholder="e.g., Commercial Focus, Licensed..."
                    className="w-44 bg-transparent text-xs text-white placeholder-zinc-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded bg-white px-2 py-0.5 text-[11px] font-bold text-black hover:bg-zinc-200"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomGateInput(false);
                      setCustomGateText("");
                    }}
                    className="text-zinc-400 hover:text-white p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCustomGateInput(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-dashed border-zinc-700 bg-zinc-900/50 text-zinc-300 hover:border-zinc-500 hover:text-white transition"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Custom Requirement</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* Quick Filters Editor (Collapsible) */}
        {isEditingFilters && (
          <div className="p-5 rounded-xl bg-[#09090b] border border-zinc-800 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
              <span className="text-xs font-bold text-white flex items-center gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400" />
                Location &amp; Keyword Targeting ({activeNicheName})
              </span>
              <span className="text-[11px] text-zinc-500">
                Changes apply immediately to discovery &amp; existing leads.
              </span>
            </div>

            <div className="space-y-1.5 text-xs">
              <label className="text-zinc-300 font-medium block">
                Target Search Keywords for {activeNicheName} (Comma-separated)
              </label>
              <input
                type="text"
                value={editKeywords}
                onChange={(e) => setEditKeywords(e.target.value)}
                placeholder={`e.g. ${activeNicheName} company, property management, commercial brokerage`}
                className="w-full bg-[#121215] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="space-y-1.5">
                <label className="text-zinc-300 font-medium block">Target States (US State Codes)</label>
                <input
                  type="text"
                  value={editStates}
                  onChange={(e) => setEditStates(e.target.value)}
                  placeholder="e.g. TX, FL, GA, CA"
                  className="w-full bg-[#121215] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-zinc-300 font-medium block">
                  Target Cities <span className="text-zinc-500 font-normal">(Leave blank for state-wide metros)</span>
                </label>
                <input
                  type="text"
                  value={editCities}
                  onChange={(e) => setEditCities(e.target.value)}
                  placeholder="e.g. Dallas, Houston, Austin, Miami"
                  className="w-full bg-[#121215] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-zinc-300 font-medium block">
                  Min ICP Fit Score: <span className="text-white font-bold">{editMinScore} / 100</span>
                </label>
                <input
                  type="range"
                  min="40"
                  max="90"
                  step="5"
                  value={editMinScore}
                  onChange={(e) => setEditMinScore(Number(e.target.value))}
                  className="w-full accent-white mt-2"
                />
                <div className="flex justify-between text-[10px] text-zinc-500">
                  <span>40 (Broad)</span>
                  <span>60 (Balanced)</span>
                  <span>80 (Strict)</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-1 border-t border-zinc-800/60">
              <div className="space-y-1.5">
                <label className="text-zinc-300 font-medium flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Min Team Size / Staff</span>
                  </span>
                  <span className="text-zinc-500 font-normal">e.g. 5 (filter out 1-person solos)</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={editMinEmployees ?? ""}
                  onChange={(e) => setEditMinEmployees(e.target.value ? Number(e.target.value) : null)}
                  placeholder="e.g. 5"
                  className="w-full bg-[#121215] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-zinc-300 font-medium flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Max Team Size / Staff</span>
                  </span>
                  <span className="text-zinc-500 font-normal">e.g. 50 (boutique sweet-spot)</span>
                </label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={editMaxEmployees ?? ""}
                  onChange={(e) => setEditMaxEmployees(e.target.value ? Number(e.target.value) : null)}
                  placeholder="e.g. 50 (leave empty for no upper limit)"
                  className="w-full bg-[#121215] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-800/80">
              <button
                type="button"
                onClick={() => setIsEditingFilters(false)}
                className="px-3.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingFilters}
                onClick={handleSaveFilters}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold text-xs transition shadow-sm"
              >
                {savingFilters ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>Save Targeting Rules</span>
              </button>
            </div>
          </div>
        )}

        {/* Active Rules Snapshot Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 p-3.5 rounded-xl bg-[#09090b] border border-zinc-800 text-xs">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
              <MapPin className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Target Geography</div>
              <div className="text-zinc-200 font-medium truncate" title={locationSummary}>
                {locationSummary}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
              <Search className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Search Keywords</div>
              <div className="text-zinc-200 font-medium truncate" title={editKeywords}>
                {editKeywords.split(",")[0]?.trim() || activeNicheName}
                {editKeywords.split(",").filter(Boolean).length > 1
                  ? ` +${editKeywords.split(",").filter(Boolean).length - 1} more`
                  : ""}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
              <Building className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Active Vertical</div>
              <div className="text-zinc-200 font-medium truncate">{activeNicheName}</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">CRM Quality Gate</div>
              <div className="text-zinc-200 font-medium truncate">
                {GATE_FIELDS.filter((f) => gate[f])
                  .map((f) => GATE_META[f].shortLabel)
                  .join(" + ") || "Score"}{" "}
                &bull; &ge;{minScore}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
              <Users className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Target Team Size</div>
              <div className="text-zinc-200 font-medium truncate">
                {editMinEmployees ? `${editMinEmployees}+` : "1+"}
                {editMaxEmployees ? ` to ${editMaxEmployees}` : "+"} Staff
              </div>
            </div>
          </div>
        </div>

        {/* Action Controls: Presets + Custom Lead Count Input + Primary Launch Button */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 block">
              How many candidates should the engine scan &amp; qualify? (Presets or Custom Count)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl bg-[#09090b] p-1 border border-zinc-800">
                {[10, 25, 50, 100].map((count) => (
                  <button
                    key={count}
                    type="button"
                    disabled={isPending}
                    onClick={() => handlePresetCount(count)}
                    className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                      targetCount === count
                        ? "bg-zinc-800 text-white shadow-sm font-bold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 bg-[#09090b] border border-zinc-800 rounded-xl px-3 py-1.5">
                <span className="text-[11px] text-zinc-400 font-medium">Custom:</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  disabled={isPending}
                  value={customCountInput}
                  onChange={(e) => handleCustomCountChange(e.target.value)}
                  className="w-16 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs font-bold text-white text-center focus:outline-none focus:border-white"
                />
                <span className="text-[11px] text-zinc-500">leads (1–200)</span>
              </div>
            </div>
          </div>

          {/* Primary Solid Button */}
          <button
            type="button"
            disabled={isPending}
            onClick={handleStartDiscovery}
            className={`w-full lg:w-auto flex items-center justify-center gap-2.5 px-8 py-3.5 rounded-xl font-bold text-xs tracking-wide shadow-lg transition-all ${
              isPending
                ? "bg-zinc-800 text-zinc-400 cursor-not-allowed border border-zinc-700"
                : "bg-white hover:bg-zinc-200 text-black shadow-black/40 active:scale-[0.98]"
            }`}
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                <span>Scanning &amp; Verifying {targetCount} {activeNicheName} Leads...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 fill-black text-black" />
                <span>Find &amp; Qualify {targetCount} {activeNicheName} Leads</span>
              </>
            )}
          </button>
        </div>

        {/* Live Progress Card (Active Execution State — 100% Niche-Agnostic) */}
        {isPending && (
          <div className="p-5 rounded-2xl bg-[#09090b] border border-zinc-800 space-y-4 animate-pulse">
            <div className="flex items-center gap-3 text-zinc-200 text-sm font-bold">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
              <span>
                AI Lead Engine is actively discovering and verifying {activeNicheName} companies...
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-[11px] text-zinc-400">
              <div className="p-3 rounded-xl bg-[#121215] border border-zinc-800/80">
                <span className="text-zinc-100 font-bold block mb-1">1. Live Web Search</span>
                Querying Tavily across{" "}
                {cities.length > 0 ? cities.slice(0, 3).join(", ") : `${states.join(", ")} markets`} for active{" "}
                {activeNicheName} businesses.
              </div>
              <div className="p-3 rounded-xl bg-[#121215] border border-zinc-800/80">
                <span className="text-zinc-100 font-bold block mb-1">2. Directory &amp; Listicle Filter</span>
                Excluding aggregators (Yelp, Zillow, BBB, directories) &amp; blog listicles; keeping only real company domains.
              </div>
              <div className="p-3 rounded-xl bg-[#121215] border border-zinc-800/80">
                <span className="text-zinc-100 font-bold block mb-1">3. Deep Website Inspection</span>
                Crawling live company pages to extract dialable phone numbers, decision makers, emails &amp; services.
              </div>
              <div className="p-3 rounded-xl bg-[#121215] border border-zinc-800/80">
                <span className="text-zinc-100 font-bold block mb-1">4. Must-Have Quality Gate</span>
                Enforcing required fields (
                {GATE_FIELDS.filter((f) => gate[f])
                  .map((f) => GATE_META[f].shortLabel)
                  .join(", ") || "ICP Score"}
                ) before adding to CRM.
              </div>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {errorMsg && (
          <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/80 text-xs text-rose-200 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            <div className="flex-1">{errorMsg}</div>
            <button onClick={() => setErrorMsg(null)} className="text-rose-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Post-Discovery Summary & CRM Action Flow */}
        {(runSummary || successBanner) && (
          <div className="p-5 rounded-xl bg-emerald-950/25 border border-emerald-500/40 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-bold text-white">
                    {successBanner || "Lead Discovery Completed"}
                  </div>
                  <p className="text-xs text-zinc-300 mt-0.5">
                    Qualified leads are automatically placed in your <strong className="text-white">Leads CRM (Ready to Call)</strong> queue.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {allMembers.length > 0 && (
                  <button
                    type="button"
                    disabled={distributing}
                    onClick={handleAutoDistributeFromDiscover}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-zinc-700 font-semibold text-xs transition"
                  >
                    {distributing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Users className="w-3.5 h-3.5 text-emerald-400" />
                    )}
                    <span>Auto-Assign to Callers</span>
                  </button>
                )}

                <Link
                  href="/caller"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition shadow-sm"
                >
                  <span>Open Leads CRM &amp; Start Calling ({crmReadyCount})</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>

            {runSummary && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-emerald-500/20 text-xs">
                <div className="p-3 rounded-lg bg-[#09090b]/80 border border-zinc-800">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-400">Candidates Scanned</div>
                  <div className="text-lg font-extrabold text-white mt-0.5">{runSummary.totalScanned}</div>
                </div>
                <div className="p-3 rounded-lg bg-[#09090b]/80 border border-emerald-500/30">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-400">
                    Passed Gate &rarr; Added to CRM
                  </div>
                  <div className="text-lg font-extrabold text-emerald-300 mt-0.5">
                    {runSummary.qualifiedCount} Leads
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#09090b]/80 border border-zinc-800">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-400">
                    Blocked (Missing Must-Haves / Duplicate)
                  </div>
                  <div className="text-lg font-extrabold text-zinc-300 mt-0.5">
                    {runSummary.rejectedCount} Filtered Out
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Qualified Leads Stream */}
      <div className="space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-zinc-800 pb-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Building className="w-4 h-4 text-emerald-400" />
              <span>Qualified {activeNicheName} Leads (Passed Must-Have Gate)</span>
            </h2>
            <span className="px-2.5 py-0.5 rounded-full bg-zinc-800 text-zinc-200 text-xs font-semibold">
              {leads.length} shown
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {allMembers.length > 0 && (
              <div className="flex items-center gap-1.5 bg-[#09090b] border border-zinc-800 rounded-xl px-2.5 py-1.5 text-xs">
                <Users className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="text-zinc-400 font-medium">Assign Approved To:</span>
                <select
                  value={selectedCallerId}
                  onChange={(e) => setSelectedCallerId(e.target.value)}
                  className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs font-semibold text-white focus:outline-none focus:border-zinc-500"
                >
                  <option value="">Unassigned Pool (Auto-Distribute Later)</option>
                  {allMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.role})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {leads.length > 0 && (
              <button
                type="button"
                disabled={bulkApproving}
                onClick={handleBulkApproveAll}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs transition shadow-sm"
              >
                {bulkApproving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle className="w-3.5 h-3.5" />
                )}
                <span>
                  Approve All ({leads.length}) &amp; Move to CRM
                </span>
              </button>
            )}

            <Link
              href="/caller"
              className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors px-2 py-1"
            >
              <span>Open Leads CRM ({crmReadyCount})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {leads.length === 0 ? (
          <div className="p-12 rounded-2xl border border-zinc-800 bg-[#121215] text-center space-y-3">
            <Search className="w-8 h-8 text-zinc-600 mx-auto" />
            <h3 className="text-sm font-semibold text-zinc-200">
              No leads waiting in staging
            </h3>
            <p className="text-xs text-zinc-500 max-w-md mx-auto">
              {crmReadyCount > 0
                ? `All approved leads have been moved to your Leads CRM queue (${crmReadyCount} ready to dial). Find more leads above whenever you want.`
                : `Choose your desired lead quantity above and click "Find & Qualify Leads" to discover verified companies.`}
            </p>
            {crmReadyCount > 0 && (
              <div className="pt-2">
                <Link
                  href="/caller"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-zinc-200 text-black font-bold text-xs shadow-md transition"
                >
                  <span>Open Leads CRM ({crmReadyCount} Ready)</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {leads.map((lead) => {
              const score = lead.icpScore ?? 0;
              const isHigh = score >= 75;
              const phone = lead.best?.phone || lead.phoneDisplay;
              const email = lead.best?.email || null;
              const decisionMaker = lead.owner?.name || lead.best?.name || null;
              const isApprovedInCrm =
                lead.status === "APPROVED" ||
                lead.status === "CALLING" ||
                lead.status === "CONNECTED" ||
                lead.status === "MEETING_BOOKED";
              const assignedName = (lead as any).assignedMemberName || null;

              return (
                <div
                  key={lead.id}
                  className="rounded-xl border border-zinc-800 hover:border-zinc-700 bg-[#121215] p-4 space-y-3 shadow-md transition-all flex flex-col justify-between"
                >
                  <div className="space-y-2.5">
                    {/* Top Row: Name + Score Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-sm font-bold text-white truncate" title={lead.name}>
                            {lead.name}
                          </h4>
                        </div>
                        <div className="text-[11px] text-zinc-400 flex items-center gap-2 mt-0.5">
                          <span className="flex items-center gap-1 truncate">
                            <MapPin className="w-3 h-3 text-zinc-500 shrink-0" />
                            <span>
                              {[lead.city, lead.state].filter(Boolean).join(", ") || states[0] || "US"}
                            </span>
                          </span>
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                              `${lead.name} ${(lead as any).address || ""} ${lead.city || ""} ${lead.state || ""}`
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-zinc-300 hover:text-white hover:underline flex items-center gap-0.5 shrink-0"
                            title="Verify Google Maps Profile & Reviews"
                          >
                            <span>Maps</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        </div>
                      </div>

                      <div
                        className={`px-2 py-1 rounded-lg text-xs font-extrabold shrink-0 border ${
                          isHigh
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                            : "bg-zinc-800 text-zinc-200 border-zinc-700"
                        }`}
                        title="Deterministic ICP Fit Score"
                      >
                        {score}/100
                      </div>
                    </div>

                    {/* Website Link */}
                    {lead.website && (
                      <div className="text-xs">
                        <a
                          href={lead.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-zinc-300 hover:text-white hover:underline flex items-center gap-1.5 truncate text-[11px]"
                        >
                          <Globe className="w-3 h-3 text-zinc-500 shrink-0" />
                          <span className="truncate">{lead.website.replace(/^https?:\/\/(www\.)?/, "")}</span>
                        </a>
                      </div>
                    )}

                    {/* Phone Number (1-Click Copy, No External Dial Trigger) */}
                    {phone ? (
                      <button
                        type="button"
                        onClick={() => copyPhone(phone, lead.id)}
                        className="flex items-center justify-between w-full p-2.5 rounded-lg bg-[#09090b] hover:bg-zinc-900 border border-zinc-800 hover:border-emerald-500/40 text-xs transition cursor-pointer text-left group"
                        title="Click to copy phone number"
                      >
                        <div className="font-mono text-emerald-400 group-hover:text-emerald-300 font-bold flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span>{phone}</span>
                        </div>
                        <div className="text-zinc-400 group-hover:text-white flex items-center gap-1 text-[11px]">
                          {copiedPhoneId === lead.id ? (
                            <span className="text-emerald-400 font-semibold flex items-center gap-1">
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Copied!</span>
                            </span>
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </div>
                      </button>
                    ) : (
                      <div className="text-[11px] text-zinc-500 italic p-2 rounded bg-[#09090b]/60 border border-zinc-800/60">
                        No published phone number found
                      </div>
                    )}

                    {/* Verified Signals (Dynamic & Niche-Agnostic) */}
                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                      {phone && (
                        <span className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 font-medium inline-flex items-center gap-1">
                          <Check className="w-2.5 h-2.5" />
                          <span>Phone Verified</span>
                        </span>
                      )}
                      {lead.website && (
                        <span className="px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800 font-medium inline-flex items-center gap-1">
                          <Check className="w-2.5 h-2.5 text-emerald-400" />
                          <span>Website Live</span>
                        </span>
                      )}
                      {decisionMaker && (
                        <span className="px-2 py-0.5 rounded bg-zinc-900 text-zinc-200 border border-zinc-700 font-medium flex items-center gap-1">
                          <User className="w-2.5 h-2.5 text-emerald-400" />
                          {decisionMaker}
                        </span>
                      )}
                      {email && (
                        <span
                          className="px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800 font-medium flex items-center gap-1 truncate max-w-[180px]"
                          title={email}
                        >
                          <Mail className="w-2.5 h-2.5 text-zinc-400 shrink-0" />
                          <span className="truncate">{email}</span>
                        </span>
                      )}
                      {assignedName && (
                        <span className="px-2 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-800/60 font-semibold flex items-center gap-1">
                          <Users className="w-2.5 h-2.5 text-indigo-400" />
                          Assigned: {assignedName}
                        </span>
                      )}
                    </div>

                    {/* Cold Caller Intelligence Summary */}
                    {lead.researchSummary && (
                      <div className="text-[11px] text-zinc-300 bg-[#09090b] p-2.5 rounded-lg border border-zinc-800/80 line-clamp-2 leading-relaxed">
                        {lead.researchSummary}
                      </div>
                    )}
                  </div>

                  {/* Card Footer: Evidence + CRM Status / Actions */}
                  <div className="pt-2.5 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setEvidenceCompanyId(lead.id)}
                      className="text-[11px] font-semibold text-zinc-400 hover:text-zinc-200 flex items-center gap-1 transition-colors"
                    >
                      <FileText className="w-3 h-3 text-zinc-400" />
                      <span>{lead.evidenceCount || 0} Evidence Citations</span>
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={actionLoadingId === lead.id}
                        onClick={() => handleQuickReject(lead.id)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-zinc-900 hover:bg-rose-950/60 text-zinc-400 hover:text-rose-300 border border-zinc-800 hover:border-rose-800 transition-colors"
                        title="Discard lead from staging"
                      >
                        Discard
                      </button>

                      <button
                        type="button"
                        disabled={actionLoadingId === lead.id}
                        onClick={() => handleQuickApprove(lead.id)}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-black shadow-sm transition-colors flex items-center gap-1.5"
                        title="Approve and move lead into Leads CRM"
                      >
                        {actionLoadingId === lead.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CheckCircle className="w-3.5 h-3.5" />
                        )}
                        <span>Approve &amp; Move to CRM &rarr;</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Optional Manual Intake Accordion */}
      <div className="pt-4 border-t border-zinc-800/80">
        <button
          type="button"
          onClick={() => setShowManualIntake(!showManualIntake)}
          className="flex items-center justify-between w-full p-3 rounded-xl bg-[#121215] border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 font-semibold transition-colors"
        >
          <span className="flex items-center gap-2">
            <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
            <span>Have specific company websites to inspect? Paste domains or URLs manually</span>
          </span>
          {showManualIntake ? (
            <ChevronUp className="w-4 h-4 text-zinc-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          )}
        </button>

        {showManualIntake && (
          <div className="p-4 mt-2 rounded-xl bg-[#09090b] border border-zinc-800 animate-in fade-in duration-200">
            <CandidateForm />
          </div>
        )}
      </div>
    </div>
  );
}

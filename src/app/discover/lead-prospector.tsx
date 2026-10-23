"use client";

import React, { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import {
  Sparkles,
  Zap,
  MapPin,
  Flame,
  ShieldCheck,
  Search,
  ExternalLink,
  Phone,
  User,
  CheckCircle,
  XCircle,
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
  HelpCircle,
} from "lucide-react";
import {
  runLeadDiscoveryAction,
  getLatestReviewLeadsAction,
  quickApproveLeadAction,
  quickRejectLeadAction,
  updateRuleTargetingAction,
  getActiveRulesForDiscoveryAction,
} from "./actions";
import { CandidateForm } from "./candidate-form";
import { EvidenceDrawer } from "@/components/evidence-drawer";

interface LeadItem {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  phoneDisplay: string | null;
  icpScore: number | null;
  owner: { name: string | null; title: string | null; verified: boolean } | null;
  facts: {
    residentialFocus?: { value: string };
    replacement?: { value: string };
    financing?: { value: string };
  };
  evidenceCount: number;
  researchSummary?: string | null;
  notes?: string | null;
}

export function LeadProspector({
  activeMarket,
}: {
  activeMarket?: {
    id: string;
    name: string;
    description: string;
    keywords: string[];
    category: string;
  };
}) {
  const [isPending, startTransition] = useTransition();
  const [targetCount, setTargetCount] = useState<number>(25);
  const [activeRule, setActiveRule] = useState<any>(null);
  const [nicheInfo, setNicheInfo] = useState(activeMarket);
  const [leads, setLeads] = useState<LeadItem[]>([]);
  const [totalReviewCount, setTotalReviewCount] = useState<number>(0);
  const [copiedPhoneId, setCopiedPhoneId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [evidenceCompanyId, setEvidenceCompanyId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Quick targeting drawer/modal state
  const [isEditingFilters, setIsEditingFilters] = useState(false);
  const [editStates, setEditStates] = useState<string>("TX");
  const [editCities, setEditCities] = useState<string>("Dallas, Houston, Austin, Fort Worth");
  const [editKeywords, setEditKeywords] = useState<string>(
    activeMarket?.keywords?.length
      ? activeMarket.keywords.join(", ")
      : activeMarket?.name
      ? `${activeMarket.name} services, local companies`
      : "Commercial services, local companies"
  );
  const [editMinScore, setEditMinScore] = useState<number>(60);
  const [savingFilters, setSavingFilters] = useState(false);

  // Manual URL accordion toggle
  const [showManualIntake, setShowManualIntake] = useState(false);

  // Load active rule & existing review leads on mount
  useEffect(() => {
    getActiveRulesForDiscoveryAction().then((res) => {
      if (res.ok && res.rule) {
        setActiveRule(res.rule);
        if ((res as any).market) {
          setNicheInfo((res as any).market);
        }
        setEditStates((res.rule.geography?.states || ["TX"]).join(", "));
        setEditCities((res.rule.geography?.cities || ["Dallas", "Houston", "Austin", "Fort Worth"]).join(", "));
        if (res.rule.discovery?.keywords && res.rule.discovery.keywords.length > 0) {
          setEditKeywords(res.rule.discovery.keywords.join(", "));
        } else if ((res as any).market?.keywords?.length > 0) {
          setEditKeywords((res as any).market.keywords.join(", "));
        }
        setEditMinScore(res.rule.scoring?.minScore ?? 60);
      }
    });

    getLatestReviewLeadsAction().then((res) => {
      if (res.ok && res.leads) {
        setLeads(res.leads as any);
        setTotalReviewCount(res.totalCount || res.leads.length);
      }
    });
  }, [activeMarket?.id]);

  // Primary 1-Click Discovery Action
  const handleStartDiscovery = () => {
    setErrorMsg(null);
    setSuccessBanner(null);

    startTransition(async () => {
      const kwsArr = editKeywords.split(",").map((k) => k.trim()).filter(Boolean);
      const res = await runLeadDiscoveryAction({
        targetCount,
        keywords: kwsArr,
      });

      if (res.ok) {
        if (res.leads && res.leads.length > 0) {
          setLeads(res.leads as any);
        }
        setTotalReviewCount(res.totalReviewCount ?? leads.length);
        const count = res.counters?.createdCompanies || res.leads?.length || 0;
        setSuccessBanner(
          `Discovery Complete! Found and evaluated ${res.counters?.totalCandidates || targetCount} candidates. ${count} verified leads are ready in your pipeline.`
        );
      } else {
        setErrorMsg(res.error || "Discovery run failed. Please check your network or API keys in Sources tab.");
      }
    });
  };

  // Quick Approve Lead from this page
  const handleQuickApprove = async (id: string) => {
    setActionLoadingId(id);
    const res = await quickApproveLeadAction(id);
    setActionLoadingId(null);
    if (res.ok) {
      setLeads((prev) => prev.filter((l) => l.id !== id));
      setTotalReviewCount((prev) => Math.max(0, prev - 1));
    } else {
      alert(res.error || "Failed to approve lead");
    }
  };

  // Quick Reject Lead from this page
  const handleQuickReject = async (id: string) => {
    setActionLoadingId(id);
    const res = await quickRejectLeadAction(id);
    setActionLoadingId(null);
    if (res.ok) {
      setLeads((prev) => prev.filter((l) => l.id !== id));
      setTotalReviewCount((prev) => Math.max(0, prev - 1));
    }
  };

  // Save Quick Target Filters
  const handleSaveFilters = async () => {
    setSavingFilters(true);
    const statesArr = editStates.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    const citiesArr = editCities.split(",").map((c) => c.trim()).filter(Boolean);
    const kwsArr = editKeywords.split(",").map((k) => k.trim()).filter(Boolean);

    const res = await updateRuleTargetingAction({
      states: statesArr,
      cities: citiesArr,
      minScore: editMinScore,
      keywords: kwsArr,
    });
    setSavingFilters(false);

    if (res.ok && res.rule) {
      setActiveRule(res.rule);
      setIsEditingFilters(false);
      setSuccessBanner(
        `Active rules updated! Target: ${statesArr.join(", ")} (${citiesArr.join(", ")}), Keywords: ${kwsArr.length} terms, Min Score: ${editMinScore}/100. ${
          res.reScore ? `Re-scored ${res.reScore.reScoredCount} leads.` : ""
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

  const states = activeRule?.geography?.states || ["TX"];
  const cities = activeRule?.geography?.cities || ["Dallas", "Houston", "Austin", "Fort Worth"];
  const minScore = activeRule?.scoring?.minScore ?? 60;

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
                Live Search Active &bull; Tavily AI Engine
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-zinc-900 text-zinc-400 border border-zinc-800">
                Active Vertical: <strong className="text-zinc-200 ml-1">{nicheInfo?.name || "Active Niche"}</strong>
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">
              Lead Discovery &amp; Automated Verification
            </h1>
            <p className="text-xs text-zinc-400 max-w-2xl leading-relaxed">
              Discovers real companies matching your exact ICP rules &mdash; verifies published phone numbers and decision makers, scores fit, and routes call-ready leads to your CRM.
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-start md:self-auto">
            <button
              type="button"
              onClick={() => setIsEditingFilters(!isEditingFilters)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-200 hover:text-white transition shadow-sm"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400" />
              <span>{isEditingFilters ? "Close Filters" : "Targeting Settings"}</span>
            </button>
            <Link
              href="/caller"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-200 hover:text-white transition shadow-sm"
            >
              <span>Leads CRM</span>
              {totalReviewCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-300 font-bold text-[10px]">
                  {totalReviewCount}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* Quick Filters Editor (Collapsible) */}
        {isEditingFilters && (
          <div className="p-5 rounded-xl bg-[#09090b] border border-zinc-800 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
              <span className="text-xs font-bold text-white flex items-center gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-400" />
                Targeting &amp; ICP Criteria ({nicheInfo?.name || "Active Niche"})
              </span>
              <span className="text-[11px] text-zinc-500">
                Filters take effect immediately on next discovery run.
              </span>
            </div>

            <div className="space-y-1.5 text-xs">
              <label className="text-zinc-300 font-medium block">
                Discovery Keywords &amp; Search Niche (Comma-separated)
              </label>
              <input
                type="text"
                value={editKeywords}
                onChange={(e) => setEditKeywords(e.target.value)}
                placeholder="e.g. HVAC contractor, AC repair, residential heating"
                className="w-full bg-[#121215] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="space-y-1.5">
                <label className="text-zinc-300 font-medium block">Target States</label>
                <input
                  type="text"
                  value={editStates}
                  onChange={(e) => setEditStates(e.target.value)}
                  placeholder="e.g. TX, FL, GA"
                  className="w-full bg-[#121215] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-zinc-300 font-medium block">Target Cities</label>
                <input
                  type="text"
                  value={editCities}
                  onChange={(e) => setEditCities(e.target.value)}
                  placeholder="e.g. Dallas, Houston, Austin"
                  className="w-full bg-[#121215] border border-zinc-800 rounded-xl px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-zinc-300 font-medium block">
                  Min ICP Score: <span className="text-white font-bold">{editMinScore} / 100</span>
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
                  <span>60 (Standard)</span>
                  <span>80 (Strict)</span>
                </div>
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
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-[#09090b] border border-zinc-800 text-xs">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
              <MapPin className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Geography</div>
              <div className="text-zinc-200 font-medium truncate">
                {states.join(", ")} &bull; {cities.slice(0, 2).join(", ")}
                {cities.length > 2 ? ` +${cities.length - 2}` : ""}
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
                {editKeywords.split(",")[0] || nicheInfo?.name || "Target Niche"}
                {editKeywords.split(",").length > 1 ? ` +${editKeywords.split(",").length - 1}` : ""}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
              <Building className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Vertical</div>
              <div className="text-zinc-200 font-medium truncate">
                {nicheInfo?.name || "Active Niche"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">Qualification Gate</div>
              <div className="text-zinc-200 font-medium">
                Score &ge; <span className="text-white font-semibold">{minScore}/100</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Controls: Batch Selector + Primary Launch Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
          {/* Batch Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 block">
              Lead Target Quantity:
            </label>
            <div className="inline-flex rounded-xl bg-[#09090b] p-1 border border-zinc-800">
              {[25, 50, 100].map((count) => (
                <button
                  key={count}
                  type="button"
                  disabled={isPending}
                  onClick={() => setTargetCount(count)}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                    targetCount === count
                      ? "bg-zinc-800 text-white shadow-sm font-bold"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {count === 100 ? `${count}+ Leads` : `${count} Leads`}
                </button>
              ))}
            </div>
          </div>

          {/* Primary Solid Button */}
          <button
            type="button"
            disabled={isPending}
            onClick={handleStartDiscovery}
            className={`w-full sm:w-auto flex items-center justify-center gap-2.5 px-8 py-3 rounded-xl font-bold text-xs tracking-wide shadow-lg transition-all sm:self-end ${
              isPending
                ? "bg-zinc-800 text-zinc-400 cursor-not-allowed border border-zinc-700"
                : "bg-white hover:bg-zinc-200 text-black shadow-black/40 active:scale-[0.98]"
            }`}
          >
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                <span>Running Lead Discovery Pipeline...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 fill-black text-black" />
                <span>Find &amp; Qualify {targetCount} Leads</span>
              </>
            )}
          </button>
        </div>

        {/* Live Progress Card (Active Execution State) */}
        {isPending && (
          <div className="p-5 rounded-2xl bg-[#121215] border border-zinc-800 space-y-4 animate-pulse">
            <div className="flex items-center gap-3 text-zinc-300 text-sm font-bold">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>AI Lead Engine is actively discovering and vetting contractors...</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-[11px] text-slate-300">
              <div className="p-2.5 rounded-lg bg-slate-900/80 border border-zinc-800">
                <span className="text-zinc-200 font-bold block mb-0.5">1. Live Web Search</span>
                Querying Tavily across {cities.slice(0, 3).join(", ")} for active contractors.
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/80 border border-zinc-800">
                <span className="text-zinc-200 font-bold block mb-0.5">2. Smart Filtering</span>
                Excluding aggregators (Yelp, Angi, BBB) &amp; deduplicating against pipeline.
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/80 border border-zinc-800">
                <span className="text-zinc-200 font-bold block mb-0.5">3. Deep Web Inspection</span>
                Extracting published phones, owners, replacement services &amp; financing.
              </div>
              <div className="p-2.5 rounded-lg bg-slate-900/80 border border-zinc-800">
                <span className="text-zinc-200 font-bold block mb-0.5">4. ICP Scoring</span>
                Validating qualification gate and attaching evidence citations.
              </div>
            </div>
          </div>
        )}

        {/* Error Banner */}
        {errorMsg && (
          <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800/80 text-xs text-rose-200 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
            <div className="flex-1">{errorMsg}</div>
            <button
              onClick={() => setErrorMsg(null)}
              className="text-rose-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* Success Banner */}
        {successBanner && (
          <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/50 text-xs text-emerald-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
              <span>{successBanner}</span>
            </div>
            <Link
              href="/caller"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shrink-0 transition-colors"
            >
              <span>Open Leads CRM (Ready to Call)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}
      </div>

      {/* Leads Table / Card Stream (Direct Results for Employees!) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Building className="w-4 h-4 text-zinc-200" />
              Qualified Leads Stream (Ready to Call)
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-xs font-semibold">
              {leads.length} leads
            </span>
          </div>

          <Link
            href="/caller"
            className="text-xs font-semibold text-zinc-200 hover:text-zinc-300 flex items-center gap-1 transition-colors"
          >
            <span>Open Leads CRM ({totalReviewCount} leads)</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {leads.length === 0 ? (
          <div className="p-12 rounded-2xl border border-zinc-800 bg-[#121215] text-center space-y-3">
            <Search className="w-8 h-8 text-slate-600 mx-auto" />
            <h3 className="text-sm font-semibold text-slate-300">No leads in review queue right now</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Click &quot;Find &amp; Qualify Leads&quot; above to run a live discovery search across {cities[0] || "Dallas"} and surrounding cities.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {leads.map((lead) => {
              const score = lead.icpScore ?? 0;
              const isHigh = score >= 75;
              const hasPhone = Boolean(lead.phoneDisplay);

              return (
                <div
                  key={lead.id}
                  className="rounded-xl border border-zinc-800 hover:border-slate-700 bg-slate-900/70 p-4 space-y-3 shadow-md transition-all flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    {/* Top Row: Name + Score Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-bold text-white truncate" title={lead.name}>
                          {lead.name}
                        </h4>
                        <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                          <span className="flex items-center gap-1 truncate">
                            <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                            <span>
                              {lead.city || "Texas"}, {lead.state || "TX"}
                            </span>
                          </span>
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lead.name} ${(lead as any).address || ""} ${lead.city || ""} ${lead.state || ""}`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-zinc-200 hover:text-zinc-300 hover:underline flex items-center gap-0.5 shrink-0"
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
                            : "bg-cyan-500/15 text-zinc-200 border-cyan-500/30"
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
                          className="text-zinc-200 hover:underline flex items-center gap-1 truncate text-[11px]"
                        >
                          <ExternalLink className="w-3 h-3 shrink-0" />
                          <span className="truncate">{lead.website.replace(/^https?:\/\/(www\.)?/, "")}</span>
                        </a>
                      </div>
                    )}

                    {/* Phone Number */}
                    {hasPhone ? (
                      <div className="flex items-center justify-between p-2 rounded-lg bg-[#09090b]/70 border border-zinc-800/80 text-xs">
                        <a
                          href={`tel:${lead.phoneDisplay}`}
                          className="font-mono text-slate-200 hover:text-zinc-200 font-semibold flex items-center gap-1.5"
                        >
                          <Phone className="w-3.5 h-3.5 text-zinc-200 shrink-0" />
                          <span>{lead.phoneDisplay}</span>
                        </a>
                        <button
                          type="button"
                          onClick={() => copyPhone(lead.phoneDisplay!, lead.id)}
                          className="text-slate-400 hover:text-white p-1 rounded transition-colors"
                          title="Copy phone number"
                        >
                          {copiedPhoneId === lead.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500 italic p-1.5 rounded bg-[#09090b]/40">
                        Phone pending crawler verification
                      </div>
                    )}

                    {/* Key Signals Verified */}
                    <div className="flex flex-wrap gap-1.5 text-[10px]">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60 font-medium">
                        Residential ✓
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700/60 font-medium">
                        Replacement ✓
                      </span>
                      {lead.facts.financing?.value === "TRUE" && (
                        <span className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 font-medium">
                          Financing ✓
                        </span>
                      )}
                      {lead.owner?.name && (
                        <span className="px-2 py-0.5 rounded bg-cyan-950/60 text-zinc-300 border border-cyan-800/60 font-medium flex items-center gap-1">
                          <User className="w-2.5 h-2.5" />
                          {lead.owner.name}
                        </span>
                      )}
                    </div>

                    {/* Cold Caller Intelligence Tip */}
                    {lead.researchSummary && (
                      <div className="text-[11px] text-zinc-300/90 bg-cyan-950/40 p-2 rounded-lg border border-cyan-800/40 line-clamp-2 leading-relaxed">
                        💡 {lead.researchSummary}
                      </div>
                    )}
                  </div>

                  {/* Actions: Approve / Reject / Evidence */}
                  <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setEvidenceCompanyId(lead.id)}
                      className="text-[11px] font-semibold text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors"
                    >
                      <FileText className="w-3 h-3 text-zinc-200" />
                      <span>{lead.evidenceCount || 0} Facts</span>
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={actionLoadingId === lead.id}
                        onClick={() => handleQuickReject(lead.id)}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-700/60 hover:border-rose-800 transition-colors"
                        title="Reject lead"
                      >
                        ✕
                      </button>

                      <button
                        type="button"
                        disabled={actionLoadingId === lead.id}
                        onClick={() => handleQuickApprove(lead.id)}
                        className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-sm transition-colors flex items-center gap-1"
                        title="Approve lead for caller & Google Sheet sync"
                      >
                        {actionLoadingId === lead.id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <CheckCircle className="w-3 h-3" />
                        )}
                        <span>Approve</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Optional Manual Intake Accordion (Cleanly Tucked Away) */}
      <div className="pt-4 border-t border-zinc-800/80">
        <button
          type="button"
          onClick={() => setShowManualIntake(!showManualIntake)}
          className="flex items-center justify-between w-full p-3 rounded-xl bg-slate-900/60 border border-zinc-800 hover:border-slate-700 text-xs text-slate-300 font-semibold transition-colors"
        >
          <span className="flex items-center gap-2">
            <ExternalLink className="w-3.5 h-3.5 text-zinc-200" />
            <span>Need to research a custom company URL or paste specific domains?</span>
          </span>
          {showManualIntake ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
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

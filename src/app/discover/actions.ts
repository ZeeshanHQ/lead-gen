"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/server/db/client";
import { companies, contacts, leadScores, researchRuns } from "@/server/db/schema";
import { createCandidate, type CandidateInput } from "@/server/repo/companies";
import { getActor } from "@/server/repo/settings";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { resolveGate, type LeadGate } from "@/server/domain/gate";
import { POST_APPROVAL } from "@/server/domain/lifecycle";
import { audit } from "@/server/repo/audit";
import type { LeadRow } from "@/server/repo/queue";

function passesLeadRowGate(lead: LeadRow, gate: LeadGate): boolean {
  if (gate.requirePhone) {
    const phone = lead.best?.phone || lead.phoneDisplay || "";
    const digits = phone.replace(/\D/g, "");
    const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (national.length < 10) return false;
  }
  if (gate.requireWebsite) {
    if (!lead.website || !lead.website.trim()) return false;
  }
  if (gate.requireDecisionMaker) {
    if (!lead.owner?.name && !lead.hasDecisionMaker && !lead.best?.name) return false;
  }
  if (gate.requireEmail) {
    if (!lead.best?.email || !lead.best.email.includes("@")) return false;
  }
  if (gate.requireLocation) {
    if (!lead.city || !lead.state) return false;
  }
  return true;
}

export async function addCandidateAction(input: CandidateInput, force = false) {
  try {
    const db = await getDb();
    const [{ market }, { activeMember }] = await Promise.all([
      getActiveContext(db),
      getActiveTeamMember(db),
    ]);
    const actor = activeMember?.name || (await getActor(db));
    const result = await createCandidate(db, input, { actor, force, marketId: market.id });

    // If a Caller added a candidate manually, auto-assign to them
    const isOwnerOrManager =
      activeMember.role === "OWNER" || Boolean(activeMember.permissions.manageTeamAndSettings);
    if (!isOwnerOrManager && activeMember.id !== "guest" && result.kind === "created") {
      await db
        .update(companies)
        .set({
          assignedMemberId: activeMember.id,
          assignedMemberName: activeMember.name,
        })
        .where(eq(companies.id, result.id));
    }

    revalidatePath("/caller");
    revalidatePath("/leads");
    revalidatePath("/review");
    revalidatePath("/discover");
    revalidatePath("/usage");
    revalidatePath("/");
    return { ok: true, result };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to intake candidate" };
  }
}

export async function batchUrlsAction(urls: string[]) {
  try {
    const db = await getDb();
    const [{ market }, { activeMember }] = await Promise.all([
      getActiveContext(db),
      getActiveTeamMember(db),
    ]);
    const actor = activeMember?.name || (await getActor(db));
    const isOwnerOrManager =
      activeMember.role === "OWNER" || Boolean(activeMember.permissions.manageTeamAndSettings);

    const results = [];
    for (const rawUrl of urls) {
      const clean = rawUrl.trim();
      if (!clean) continue;
      let initialName = `${market.name} Prospect`;
      try {
        const u = new URL(clean.startsWith("http") ? clean : `https://${clean}`);
        initialName =
          u.hostname.replace(/^www\./, "").split(".")[0]?.replace(/[-_]/g, " ") || initialName;
        initialName = initialName.charAt(0).toUpperCase() + initialName.slice(1);
      } catch {}

      const res = await createCandidate(
        db,
        {
          name: initialName,
          website: clean,
          provider: "manual_entry",
        },
        { actor, marketId: market.id }
      );
      if (!isOwnerOrManager && activeMember.id !== "guest" && res.kind === "created") {
        await db
          .update(companies)
          .set({
            assignedMemberId: activeMember.id,
            assignedMemberName: activeMember.name,
          })
          .where(eq(companies.id, res.id));
      }
      results.push({ url: clean, res });
    }

    revalidatePath("/caller");
    revalidatePath("/leads");
    revalidatePath("/review");
    revalidatePath("/discover");
    revalidatePath("/usage");
    revalidatePath("/");
    return { ok: true, results };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to intake batch URLs" };
  }
}

export async function getActiveRulesForDiscoveryAction() {
  try {
    const db = await getDb();
    const { market, rule, tenant } = await getActiveContext(db);
    return { ok: true, rule: rule.config, market, tenant };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function runBulkDiscoveryAction(options: {
  targetCount: number;
  concurrency?: number;
  providerFilter?: string[];
  mode?: "full" | "test" | "small";
}) {
  return runLeadDiscoveryAction({
    targetCount: options.targetCount,
  });
}

export async function runLeadDiscoveryAction(
  options: {
    targetCount?: number;
    cities?: string[];
    states?: string[];
    keywords?: string[];
    minScore?: number;
    gate?: Partial<LeadGate>;
  } = {}
) {
  const startedAtMs = Date.now();
  try {
    const db = await getDb();
    const [{ market, rule: defaultRule }, { activeMember }] = await Promise.all([
      getActiveContext(db),
      getActiveTeamMember(db),
    ]);
    const actorName = activeMember?.name || (await getActor(db));
    const isOwnerOrManager =
      activeMember.role === "OWNER" || Boolean(activeMember.permissions.manageTeamAndSettings);
    const canEditRules =
      activeMember.role === "OWNER" || Boolean(activeMember.permissions.editRules);

    const { saveRule } = await import("@/server/repo/rules");
    const { createResearchRun, executeRun } = await import("@/server/research/runner");
    const { loadLeadRows } = await import("@/server/repo/queue");

    let ruleConfig = (defaultRule.config as any) || {};
    const mergedGate = resolveGate(options.gate ?? ruleConfig?.gate);

    const statesToUse: string[] =
      options.states && options.states.length > 0
        ? options.states
        : ruleConfig?.geography?.states?.length
        ? ruleConfig.geography.states
        : ["TX"];
    const citiesToUse: string[] =
      options.cities !== undefined ? options.cities : ruleConfig?.geography?.cities || [];
    const keywordsToUse: string[] =
      options.keywords && options.keywords.length > 0
        ? options.keywords
        : ruleConfig?.discovery?.keywords?.length
        ? ruleConfig.discovery.keywords
        : market.keywords?.length
        ? market.keywords
        : [market.name];
    const minScoreToUse: number =
      options.minScore !== undefined ? options.minScore : ruleConfig?.scoring?.minScore ?? 60;

    // Update rule config if user has permission
    if (
      canEditRules &&
      (options.cities !== undefined ||
        (options.states && options.states.length > 0) ||
        options.minScore !== undefined ||
        (options.keywords && options.keywords.length > 0) ||
        options.gate !== undefined)
    ) {
      ruleConfig = {
        ...ruleConfig,
        geography: {
          ...ruleConfig.geography,
          states: statesToUse,
          cities: citiesToUse,
        },
        discovery: {
          ...ruleConfig.discovery,
          keywords: keywordsToUse,
        },
        scoring: {
          ...ruleConfig.scoring,
          minScore: minScoreToUse,
        },
        gate: mergedGate,
      };
      try {
        await saveRule(db, defaultRule.id, { name: defaultRule.name, config: ruleConfig }, actorName);
      } catch {
        // Non-blocking if rule validation has minor defaults difference
      }
    }

    const requestedCount = Number(options.targetCount);
    const targetCount = Number.isFinite(requestedCount)
      ? Math.max(Math.min(Math.round(requestedCount), 200), 1)
      : 25;
    const mode = targetCount <= 25 ? "small" : "full";

    const runId = await createResearchRun(db, {
      mode,
      ruleId: defaultRule.id,
      marketId: market.id,
      actor: `${actorName} (${market.name})`,
      maxCandidates: targetCount,
      concurrency: 8,
      pagesPerCompany: 2,
      providerFilter: undefined,
    });

    const counters = await executeRun(db, runId, {
      timeoutMs: 2500,
      maxWallClockMs: 14000,
      autoEnrich: false,
    });

    // If a Caller initiated discovery, pre-assign the qualified leads to them, but leave in NEEDS_REVIEW
    // so they display the "Approve & Move to CRM" button awaiting user approval
    const assignMemberId = !isOwnerOrManager && activeMember.id !== "guest" ? activeMember.id : null;
    const assignMemberName =
      !isOwnerOrManager && activeMember.id !== "guest" ? activeMember.name : null;

    if (assignMemberId && counters.qualifiedCompanyIds && counters.qualifiedCompanyIds.length > 0) {
      await db
        .update(companies)
        .set({
          assignedMemberId: assignMemberId,
          assignedMemberName: assignMemberName,
        })
        .where(inArray(companies.id, counters.qualifiedCompanyIds));
    }

    // Count how many leads from this live pass strictly passed the Must-Have Quality Gate
    const liveQualifiedIds = counters.qualifiedCompanyIds || [];
    let livePassedGateCount = 0;
    if (liveQualifiedIds.length > 0) {
      const currentRows = await loadLeadRows(db, "all", market.id);
      const idSet = new Set(liveQualifiedIds);
      livePassedGateCount = currentRows.filter(
        (r) => idSet.has(r.id) && passesLeadRowGate(r, mergedGate)
      ).length;
    }

    // Real discovery only: never fabricate mock/dump leads when live yield is below target
    const finalQualifiedInRun = livePassedGateCount;
    const totalScannedInRun = counters.totalCandidates;

    const enrichedCounters = {
      ...counters,
      totalCandidates: totalScannedInRun,
      createdCompanies: counters.createdCompanies || 0,
      approvedCount: finalQualifiedInRun,
      targetCount,
      memberId: activeMember.id,
      memberName: activeMember.name,
      memberRole: activeMember.role,
      marketName: market.name,
      states: statesToUse,
      cities: citiesToUse,
      durationMs: Date.now() - startedAtMs,
    };

    await Promise.all([
      db
        .update(researchRuns)
        .set({
          status: "COMPLETED",
          counters: enrichedCounters as any,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(researchRuns.id, runId)),
      audit(db, {
        actor: activeMember.name,
        action: "discovery.completed",
        entityType: "research_run",
        entityId: runId,
        details: {
          memberId: activeMember.id,
          memberName: activeMember.name,
          memberEmail: activeMember.email,
          memberRole: activeMember.role,
          marketId: market.id,
          marketName: market.name,
          targetCount,
          qualifiedCount: finalQualifiedInRun,
          totalScanned: totalScannedInRun,
          states: statesToUse,
          cities: citiesToUse,
          keywords: keywordsToUse,
          durationMs: Date.now() - startedAtMs,
        },
      }),
    ]);

    // Fetch updated leads for this market in 1 fast query batch
    const allMarketRows = await loadLeadRows(db, "all", market.id);
    const scopedRows = isOwnerOrManager
      ? allMarketRows
      : allMarketRows.filter((l) => l.assignedMemberId === activeMember.id);

    const postApprovalSet = new Set<string>(POST_APPROVAL as readonly string[]);
    const qualifiedLeads = scopedRows.filter((l) => passesLeadRowGate(l, mergedGate));
    const pendingLeads = qualifiedLeads.filter((l) => !postApprovalSet.has(l.status));
    const crmReadyCount = qualifiedLeads.filter((l) => postApprovalSet.has(l.status)).length;

    revalidatePath("/caller");
    revalidatePath("/leads");
    revalidatePath("/review");
    revalidatePath("/discover");
    revalidatePath("/runs");
    revalidatePath("/usage");
    revalidatePath("/");

    return {
      ok: true,
      runId,
      counters: enrichedCounters,
      targetCount,
      gate: mergedGate,
      leads: pendingLeads.slice(0, 100),
      totalReviewCount: pendingLeads.length,
      crmReadyCount,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || "Lead discovery failed" };
  }
}

export async function getLatestReviewLeadsAction() {
  try {
    const db = await getDb();
    const [{ market, rule }, { activeMember }] = await Promise.all([
      getActiveContext(db),
      getActiveTeamMember(db),
    ]);
    const isOwnerOrManager =
      activeMember.role === "OWNER" || Boolean(activeMember.permissions.manageTeamAndSettings);
    const { loadLeadRows } = await import("@/server/repo/queue");
    const activeGate = resolveGate((rule.config as any)?.gate);

    const allMarketRows = await loadLeadRows(db, "all", market.id);
    const scopedRows = isOwnerOrManager
      ? allMarketRows
      : allMarketRows.filter((l) => l.assignedMemberId === activeMember.id);

    const postApprovalSet = new Set<string>(POST_APPROVAL as readonly string[]);
    const qualifiedLeads = scopedRows.filter((l) => passesLeadRowGate(l, activeGate));
    const pendingLeads = qualifiedLeads.filter((l) => !postApprovalSet.has(l.status));
    const crmReadyCount = qualifiedLeads.filter((l) => postApprovalSet.has(l.status)).length;

    return {
      ok: true,
      leads: pendingLeads.slice(0, 100),
      totalCount: pendingLeads.length,
      crmReadyCount,
      gate: activeGate,
    };
  } catch (err: any) {
    return { ok: false, error: err.message, leads: [], totalCount: 0, crmReadyCount: 0 };
  }
}

export async function quickApproveLeadAction(
  companyId: string,
  assignTo?: { memberId?: string | null; memberName?: string | null }
) {
  try {
    const db = await getDb();
    const { activeMember } = await getActiveTeamMember(db);
    const actor = activeMember?.name || (await getActor(db));
    const isOwnerOrManager =
      activeMember.role === "OWNER" || Boolean(activeMember.permissions.manageTeamAndSettings);

    const { approveCompany } = await import("@/server/repo/approvals");
    await approveCompany(db, companyId, {
      actor,
      note: "Approved via Lead Prospector",
      acknowledgeUnresearched: true,
      assignedMemberId:
        assignTo?.memberId ?? (!isOwnerOrManager && activeMember.id !== "guest" ? activeMember.id : undefined),
      assignedMemberName:
        assignTo?.memberName ?? (!isOwnerOrManager && activeMember.id !== "guest" ? activeMember.name : undefined),
    });

    revalidatePath("/review");
    revalidatePath("/discover");
    revalidatePath("/approved");
    revalidatePath("/caller");
    revalidatePath("/leads");
    revalidatePath("/usage");
    revalidatePath("/");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to approve lead" };
  }
}

export async function approveAllReviewLeadsAction(options?: {
  leadIds?: string[];
  assignToMemberId?: string | null;
  assignToMemberName?: string | null;
}) {
  try {
    const db = await getDb();
    const [{ market, rule }, { activeMember }] = await Promise.all([
      getActiveContext(db),
      getActiveTeamMember(db),
    ]);
    const actor = activeMember?.name || (await getActor(db));
    const isOwnerOrManager =
      activeMember.role === "OWNER" || Boolean(activeMember.permissions.manageTeamAndSettings);

    const { loadLeadRows } = await import("@/server/repo/queue");
    const { approveCompany } = await import("@/server/repo/approvals");
    const activeGate = resolveGate((rule.config as any)?.gate);

    let eligibleIds: string[] = [];
    if (options?.leadIds && options.leadIds.length > 0) {
      eligibleIds = options.leadIds;
    } else {
      const reviewRows = await loadLeadRows(db, "review", market.id);
      eligibleIds = reviewRows.filter((l) => passesLeadRowGate(l, activeGate)).map((l) => l.id);
    }

    const targetMemberId =
      options?.assignToMemberId ??
      (!isOwnerOrManager && activeMember.id !== "guest" ? activeMember.id : null);
    const targetMemberName =
      options?.assignToMemberName ??
      (!isOwnerOrManager && activeMember.id !== "guest" ? activeMember.name : null);

    let count = 0;
    for (const companyId of eligibleIds) {
      await approveCompany(db, companyId, {
        actor,
        note: "Bulk approved via Lead Prospector",
        acknowledgeUnresearched: true,
        assignedMemberId: targetMemberId,
        assignedMemberName: targetMemberName,
      });
      count++;
    }

    revalidatePath("/caller");
    revalidatePath("/discover");
    revalidatePath("/review");
    revalidatePath("/usage");
    revalidatePath("/");
    return { ok: true, approvedCount: count };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to approve leads" };
  }
}

export async function quickRejectLeadAction(companyId: string, reason?: string) {
  try {
    const db = await getDb();
    const { activeMember } = await getActiveTeamMember(db);
    const actor = activeMember?.name || (await getActor(db));
    const { rejectCompany } = await import("@/server/repo/approvals");
    await rejectCompany(db, companyId, { actor, reason: reason || "Rejected in Lead Prospector" });

    revalidatePath("/review");
    revalidatePath("/discover");
    revalidatePath("/caller");
    revalidatePath("/leads");
    revalidatePath("/");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to reject lead" };
  }
}

export async function updateRuleTargetingAction(params: {
  states: string[];
  cities: string[];
  minScore: number;
  keywords?: string[];
  gate?: Partial<LeadGate>;
}) {
  try {
    const db = await getDb();
    const [{ rule: defaultRule }, { activeMember }] = await Promise.all([
      getActiveContext(db),
      getActiveTeamMember(db),
    ]);
    const actor = activeMember?.name || (await getActor(db));
    const { saveRule, reEvaluateLeadsWithRule } = await import("@/server/repo/rules");
    const cfg = defaultRule.config as any;
    const mergedGate = resolveGate(params.gate ?? cfg?.gate);

    const newCfg = {
      ...cfg,
      geography: {
        ...cfg.geography,
        states: params.states,
        cities: params.cities,
      },
      discovery: {
        ...cfg.discovery,
        keywords:
          params.keywords && params.keywords.length > 0
            ? params.keywords
            : cfg.discovery?.keywords || [],
      },
      scoring: {
        ...cfg.scoring,
        minScore: params.minScore,
      },
      gate: mergedGate,
    };

    const updated = await saveRule(
      db,
      defaultRule.id,
      { name: defaultRule.name, config: newCfg },
      actor
    );
    const reScore = await reEvaluateLeadsWithRule(db, updated.id, actor);

    revalidatePath("/caller");
    revalidatePath("/leads");
    revalidatePath("/rules");
    revalidatePath("/discover");
    revalidatePath("/review");
    return { ok: true, rule: newCfg, reScore };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export const runTavilyTestDiscoveryAction = runLeadDiscoveryAction;

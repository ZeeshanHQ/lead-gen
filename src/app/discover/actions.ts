"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, type Db } from "@/server/db/client";
import { companies, contacts, leadScores, researchRuns } from "@/server/db/schema";
import { createCandidate, type CandidateInput } from "@/server/repo/companies";
import { getActor } from "@/server/repo/settings";
import { getActiveContext } from "@/server/repo/markets";
import { getActiveTeamMember } from "@/server/repo/team";
import { resolveGate, passesLeadRowGate, type LeadGate } from "@/server/domain/gate";
import { POST_APPROVAL } from "@/server/domain/lifecycle";
import { audit } from "@/server/repo/audit";
import type { LeadRow } from "@/server/repo/queue";

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

export async function getDiscoveryProgressAction(runId: string, sinceIso?: string) {
  try {
    const db = await getDb();
    let [runRow] = await db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.id, runId))
      .limit(1);

    if (!runRow) {
      return { ok: false, error: "Run not found" };
    }

    const { executeQueuedBatch } = await import("@/server/research/runner");

    // Serverless Driver: If run is RUNNING, execute the next batch of queued jobs in this cycle
    if (runRow.status === "RUNNING") {
      try {
        await executeQueuedBatch(db, runId, 2);
        const [refreshed] = await db
          .select()
          .from(researchRuns)
          .where(eq(researchRuns.id, runId))
          .limit(1);
        if (refreshed) {
          runRow = refreshed;
        }
      } catch (execErr) {
        console.error("Batch execution error in getDiscoveryProgressAction:", execErr);
      }
    }

    const { getRunTelemetry } = await import("@/server/research/telemetry");
    const memoryLogs = getRunTelemetry(runId, sinceIso);

    // Database-persisted telemetry synthesis: 0 dropped logs across serverless lambdas
    const { researchJobs } = await import("@/server/db/schema");
    const completedJobs = await db
      .select({
        id: researchJobs.id,
        status: researchJobs.status,
        result: researchJobs.result,
        finishedAt: researchJobs.finishedAt,
      })
      .from(researchJobs)
      .where(
        and(
          eq(researchJobs.runId, runId),
          inArray(researchJobs.status, ["COMPLETED", "FAILED"])
        )
      )
      .orderBy(desc(researchJobs.finishedAt))
      .limit(60);

    const dbLogs: any[] = [];
    const sinceTime = sinceIso ? new Date(sinceIso).getTime() : 0;

    for (const j of completedJobs) {
      if (!j.finishedAt) continue;
      const jobTime = j.finishedAt.getTime();
      if (sinceTime > 0 && jobTime <= sinceTime) continue;

      const res = j.result as any;
      if (j.status === "COMPLETED" && res) {
        const isApproved =
          (res.status === "APPROVED" || res.status === "NEEDS_REVIEW") &&
          res.icpScore >= 60;
        const timeStr = j.finishedAt.toTimeString().slice(0, 8);
        if (isApproved) {
          dbLogs.push({
            id: `job-app-${j.id}`,
            runId,
            timestamp: timeStr,
            isoTime: j.finishedAt.toISOString(),
            stage: "APPROVED",
            level: "success",
            companyName: res.companyName,
            domain: res.domain,
            message: `[ACCEPTED: ICP Qualified] "${res.companyName}" (${res.domain}) • Score: ${res.icpScore}/100 • Discovered ${res.contactsDiscovered} contacts & ${res.factsRecorded} verified facts.`,
          });
        } else {
          const reason =
            res.gateReasons?.length
              ? res.gateReasons.join("; ")
              : res.gateMissing?.length
              ? `Missing: ${res.gateMissing.join(", ")}`
              : res.summary || "Did not meet strict ICP thresholds";
          dbLogs.push({
            id: `job-gate-${j.id}`,
            runId,
            timestamp: timeStr,
            isoTime: j.finishedAt.toISOString(),
            stage: "GATE",
            level: "rejection",
            companyName: res.companyName,
            domain: res.domain,
            message: `[REJECTED: Quality Gate] "${res.companyName}" (${res.domain}) — ${reason}`,
          });
        }
      }
    }

    const logMap = new Map<string, any>();
    for (const l of memoryLogs) logMap.set(l.id, l);
    for (const l of dbLogs) {
      if (!logMap.has(l.id)) logMap.set(l.id, l);
    }
    const logs = Array.from(logMap.values()).sort((a, b) => a.isoTime.localeCompare(b.isoTime));

    const isFinished =
      runRow.status === "COMPLETED" ||
      runRow.status === "FAILED" ||
      runRow.status === "CANCELLED" ||
      runRow.status === "PARTIAL";

    let leads: any[] = [];
    let totalReviewCount = 0;
    let crmReadyCount = 0;

    if (isFinished && runRow.marketId) {
      const [{ activeMember }, { rule }] = await Promise.all([
        getActiveTeamMember(db),
        getActiveContext(db),
      ]);

      const isOwnerOrManager =
        activeMember.role === "OWNER" || Boolean(activeMember.permissions?.manageTeamAndSettings);
      const { loadLeadRows } = await import("@/server/repo/queue");
      const allMarketRows = await loadLeadRows(db, "all", runRow.marketId);
      const scopedRows = isOwnerOrManager
        ? allMarketRows
        : allMarketRows.filter((l) => l.assignedMemberId === activeMember.id);

      const activeRuleConfig = (rule.config as any) || null;
      const activeGate = resolveGate(activeRuleConfig?.gate);
      const postApprovalSet = new Set<string>(POST_APPROVAL as readonly string[]);

      const qualifiedLeads = scopedRows.filter((l) => passesLeadRowGate(l, activeGate, activeRuleConfig));
      const pendingLeads = qualifiedLeads.filter((l) => !postApprovalSet.has(l.status));
      crmReadyCount = qualifiedLeads.filter((l) => postApprovalSet.has(l.status)).length;
      totalReviewCount = pendingLeads.length;
      leads = JSON.parse(JSON.stringify(pendingLeads.slice(0, 60)));
    }

    return {
      ok: true,
      runId,
      status: runRow.status,
      counters: runRow.counters || {},
      logs,
      isFinished,
      lastError: runRow.lastError,
      leads,
      totalReviewCount,
      crmReadyCount,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to fetch run progress" };
  }
}

export async function startLeadDiscoveryAction(
  options: {
    targetCount?: number;
    cities?: string[];
    states?: string[];
    keywords?: string[];
    negativeKeywords?: string[];
    subNiche?: string;
    businessType?: "residential" | "commercial" | "both";
    minScore?: number;
    gate?: Partial<LeadGate>;
    minEmployees?: number | null;
    maxEmployees?: number | null;
    minDoors?: number | null;
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

    const { saveRule, reEvaluateLeadsWithRule } = await import("@/server/repo/rules");
    const { createResearchRun, prepareRunCandidates, executeQueuedBatch, executeRun } = await import("@/server/research/runner");
    const { recordRunTelemetry } = await import("@/server/research/telemetry");
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
    const negativeKeywordsToUse: string[] =
      options.negativeKeywords !== undefined
        ? options.negativeKeywords
        : ruleConfig?.discovery?.negativeKeywords || [];
    const subNicheToUse: string =
      options.subNiche !== undefined
        ? options.subNiche
        : ruleConfig?.discovery?.subNiche || "";
    const businessTypeToUse: "residential" | "commercial" | "both" =
      options.businessType !== undefined
        ? options.businessType
        : ruleConfig?.businessType || "both";
    const minScoreToUse: number =
      options.minScore !== undefined ? options.minScore : ruleConfig?.scoring?.minScore ?? 60;
    const minEmployeesToUse: number | null =
      options.minEmployees !== undefined
        ? options.minEmployees
        : ruleConfig?.size?.minEmployees ?? null;
    const maxEmployeesToUse: number | null =
      options.maxEmployees !== undefined
        ? options.maxEmployees
        : ruleConfig?.size?.maxEmployees ?? null;
    const minDoorsToUse: number | null =
      options.minDoors !== undefined
        ? options.minDoors
        : ruleConfig?.size?.minDoors ?? null;

    if (
      canEditRules &&
      (options.cities !== undefined ||
        (options.states && options.states.length > 0) ||
        options.minScore !== undefined ||
        (options.keywords && options.keywords.length > 0) ||
        options.negativeKeywords !== undefined ||
        options.subNiche !== undefined ||
        options.businessType !== undefined ||
        options.minEmployees !== undefined ||
        options.maxEmployees !== undefined ||
        options.minDoors !== undefined ||
        options.gate !== undefined)
    ) {
      const isHvacKw = keywordsToUse.some((k) =>
        /\b(hvac|air conditioning|heating|furnace|ac replacement)\b/i.test(k)
      );
      ruleConfig = {
        ...ruleConfig,
        businessType: businessTypeToUse,
        services: {
          ...ruleConfig.services,
          requiredAnyOf: isHvacKw ? ruleConfig.services?.requiredAnyOf || ["replacement", "installation"] : [],
        },
        geography: {
          ...ruleConfig.geography,
          states: statesToUse,
          cities: citiesToUse,
        },
        discovery: {
          ...ruleConfig.discovery,
          keywords: keywordsToUse,
          negativeKeywords: negativeKeywordsToUse,
          subNiche: subNicheToUse,
          strictNicheMatch: true,
        },
        scoring: {
          ...ruleConfig.scoring,
          minScore: minScoreToUse,
        },
        size: {
          ...ruleConfig.size,
          minEmployees: minEmployeesToUse,
          maxEmployees: maxEmployeesToUse,
          minDoors: minDoorsToUse,
        },
        gate: mergedGate,
      };
      try {
        await saveRule(db, defaultRule.id, { name: defaultRule.name, config: ruleConfig }, actorName);
        await reEvaluateLeadsWithRule(db, defaultRule.id, actorName);
      } catch {
        // Non-blocking
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
      concurrency: 10,
      pagesPerCompany: 4,
      providerFilter: undefined,
    });

    recordRunTelemetry(runId, {
      stage: "INIT",
      level: "info",
      message: `Lead discovery launched for ${market.name}. Target: ${targetCount} verified leads.`,
    });

    const assignMemberId = !isOwnerOrManager && activeMember.id !== "guest" ? activeMember.id : null;
    const assignMemberName = !isOwnerOrManager && activeMember.id !== "guest" ? activeMember.name : null;

    // Immediately prepare candidates in DB and run first batch synchronously
    try {
      await prepareRunCandidates(db, runId);
      await executeQueuedBatch(db, runId, 2);
    } catch (prepErr) {
      console.error("Initial candidate preparation/batch error:", prepErr);
    }

    // Execute in background so the client receives the runId instantly without timeouts
    (async () => {
      try {
        const counters = await executeRun(db, runId, {
          timeoutMs: 6000,
          maxWallClockMs: targetCount <= 25 ? 110000 : targetCount <= 50 ? 180000 : 260000,
          autoEnrich: true,
        });

        if (assignMemberId && counters.qualifiedCompanyIds && counters.qualifiedCompanyIds.length > 0) {
          await db
            .update(companies)
            .set({
              assignedMemberId: assignMemberId,
              assignedMemberName: assignMemberName,
            })
            .where(inArray(companies.id, counters.qualifiedCompanyIds));
        }

        const allMarketRows = await loadLeadRows(db, "all", market.id);
        const liveQualifiedIds = new Set(counters.qualifiedCompanyIds || []);
        const livePassedGateCount = liveQualifiedIds.size > 0
          ? allMarketRows.filter((r) => liveQualifiedIds.has(r.id) && passesLeadRowGate(r, mergedGate, ruleConfig)).length
          : 0;

        const enrichedCounters = {
          ...counters,
          totalCandidates: counters.totalCandidates,
          createdCompanies: counters.createdCompanies || 0,
          approvedCount: livePassedGateCount,
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
              marketId: market.id,
              marketName: market.name,
              targetCount,
              qualifiedCount: livePassedGateCount,
              totalScanned: counters.totalCandidates,
              durationMs: Date.now() - startedAtMs,
            },
          }),
        ]);
      } catch (err: any) {
        console.error("Background lead discovery failed:", err);
        recordRunTelemetry(runId, {
          stage: "FAILED",
          level: "error",
          message: `Discovery Run Failed: ${err?.message || String(err)}`,
        });
        await db
          .update(researchRuns)
          .set({
            status: "FAILED",
            lastError: err?.message || String(err),
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(researchRuns.id, runId));
      }
    })();

    return {
      ok: true,
      runId,
      targetCount,
      gate: mergedGate,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to start lead discovery" };
  }
}

export async function runLeadDiscoveryAction(
  options: {
    targetCount?: number;
    cities?: string[];
    states?: string[];
    keywords?: string[];
    negativeKeywords?: string[];
    subNiche?: string;
    businessType?: "residential" | "commercial" | "both";
    minScore?: number;
    gate?: Partial<LeadGate>;
    minEmployees?: number | null;
    maxEmployees?: number | null;
    minDoors?: number | null;
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

    const { saveRule, reEvaluateLeadsWithRule } = await import("@/server/repo/rules");
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
    const negativeKeywordsToUse: string[] =
      options.negativeKeywords !== undefined
        ? options.negativeKeywords
        : ruleConfig?.discovery?.negativeKeywords || [];
    const subNicheToUse: string =
      options.subNiche !== undefined
        ? options.subNiche
        : ruleConfig?.discovery?.subNiche || "";
    const businessTypeToUse: "residential" | "commercial" | "both" =
      options.businessType !== undefined
        ? options.businessType
        : ruleConfig?.businessType || "both";
    const minScoreToUse: number =
      options.minScore !== undefined ? options.minScore : ruleConfig?.scoring?.minScore ?? 60;
    const minEmployeesToUse: number | null =
      options.minEmployees !== undefined
        ? options.minEmployees
        : ruleConfig?.size?.minEmployees ?? null;
    const maxEmployeesToUse: number | null =
      options.maxEmployees !== undefined
        ? options.maxEmployees
        : ruleConfig?.size?.maxEmployees ?? null;
    const minDoorsToUse: number | null =
      options.minDoors !== undefined
        ? options.minDoors
        : ruleConfig?.size?.minDoors ?? null;

    // Update rule config if user has permission
    if (
      canEditRules &&
      (options.cities !== undefined ||
        (options.states && options.states.length > 0) ||
        options.minScore !== undefined ||
        (options.keywords && options.keywords.length > 0) ||
        options.negativeKeywords !== undefined ||
        options.subNiche !== undefined ||
        options.businessType !== undefined ||
        options.minEmployees !== undefined ||
        options.maxEmployees !== undefined ||
        options.minDoors !== undefined ||
        options.gate !== undefined)
    ) {
      const isHvacKw = keywordsToUse.some((k) =>
        /\b(hvac|air conditioning|heating|furnace|ac replacement)\b/i.test(k)
      );
      ruleConfig = {
        ...ruleConfig,
        businessType: businessTypeToUse,
        services: {
          ...ruleConfig.services,
          requiredAnyOf: isHvacKw ? ruleConfig.services?.requiredAnyOf || ["replacement", "installation"] : [],
        },
        geography: {
          ...ruleConfig.geography,
          states: statesToUse,
          cities: citiesToUse,
        },
        discovery: {
          ...ruleConfig.discovery,
          keywords: keywordsToUse,
          negativeKeywords: negativeKeywordsToUse,
          subNiche: subNicheToUse,
          strictNicheMatch: true,
        },
        scoring: {
          ...ruleConfig.scoring,
          minScore: minScoreToUse,
        },
        size: {
          ...ruleConfig.size,
          minEmployees: minEmployeesToUse,
          maxEmployees: maxEmployeesToUse,
          minDoors: minDoorsToUse,
        },
        gate: mergedGate,
      };
      try {
        await saveRule(db, defaultRule.id, { name: defaultRule.name, config: ruleConfig }, actorName);
        await reEvaluateLeadsWithRule(db, defaultRule.id, actorName);
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
      pagesPerCompany: 4,
      providerFilter: undefined,
    });

    const counters = await executeRun(db, runId, {
      timeoutMs: 6000,
      maxWallClockMs: targetCount <= 25 ? 75000 : targetCount <= 50 ? 130000 : 240000,
      autoEnrich: true,
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

    // Fetch updated leads for this market in 1 fast query batch
    const allMarketRows = await loadLeadRows(db, "all", market.id);

    // Count how many leads from this live pass strictly passed the Must-Have Quality Gate
    const liveQualifiedIds = new Set(counters.qualifiedCompanyIds || []);
    const livePassedGateCount = liveQualifiedIds.size > 0
      ? allMarketRows.filter((r) => liveQualifiedIds.has(r.id) && passesLeadRowGate(r, mergedGate, ruleConfig)).length
      : 0;

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

    // Use updated scoped leads for this market
    const scopedRows = isOwnerOrManager
      ? allMarketRows
      : allMarketRows.filter((l) => l.assignedMemberId === activeMember.id);

    const postApprovalSet = new Set<string>(POST_APPROVAL as readonly string[]);
    const qualifiedLeads = scopedRows.filter((l) => passesLeadRowGate(l, mergedGate, ruleConfig));
    const pendingLeads = qualifiedLeads.filter((l) => !postApprovalSet.has(l.status));
    const crmReadyCount = qualifiedLeads.filter((l) => postApprovalSet.has(l.status)).length;

    try {
      revalidatePath("/discover");
      revalidatePath("/leads");
      revalidatePath("/caller");
    } catch {
      // Non-blocking in non-request contexts or tests
    }

    const safeLeads = JSON.parse(JSON.stringify(pendingLeads.slice(0, 60)));
    const safeCounters = JSON.parse(JSON.stringify(enrichedCounters));

    return {
      ok: true,
      runId,
      counters: safeCounters,
      targetCount,
      gate: mergedGate,
      leads: safeLeads,
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
    const activeRuleConfig = (rule.config as any) || null;
    const activeGate = resolveGate(activeRuleConfig?.gate);

    const allMarketRows = await loadLeadRows(db, "all", market.id);
    const scopedRows = isOwnerOrManager
      ? allMarketRows
      : allMarketRows.filter((l) => l.assignedMemberId === activeMember.id);

    const postApprovalSet = new Set<string>(POST_APPROVAL as readonly string[]);
    const qualifiedLeads = scopedRows.filter((l) => passesLeadRowGate(l, activeGate, activeRuleConfig));
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
    const activeRuleConfig = (rule.config as any) || null;
    const activeGate = resolveGate(activeRuleConfig?.gate);

    let eligibleIds: string[] = [];
    if (options?.leadIds && options.leadIds.length > 0) {
      eligibleIds = options.leadIds;
    } else {
      const reviewRows = await loadLeadRows(db, "review", market.id);
      eligibleIds = reviewRows.filter((l) => passesLeadRowGate(l, activeGate, activeRuleConfig)).map((l) => l.id);
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
  negativeKeywords?: string[];
  subNiche?: string;
  businessType?: "residential" | "commercial" | "both";
  gate?: Partial<LeadGate>;
  minEmployees?: number | null;
  maxEmployees?: number | null;
  minDoors?: number | null;
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

    const finalKeywords =
      params.keywords && params.keywords.length > 0
        ? params.keywords
        : cfg.discovery?.keywords || [];
    const isHvacKw = finalKeywords.some((k: string) =>
      /\b(hvac|air conditioning|heating|furnace|ac replacement)\b/i.test(k)
    );

    const newCfg = {
      ...cfg,
      businessType: params.businessType !== undefined ? params.businessType : cfg.businessType || "both",
      services: {
        ...cfg.services,
        requiredAnyOf: isHvacKw ? cfg.services?.requiredAnyOf || ["replacement", "installation"] : [],
      },
      geography: {
        ...cfg.geography,
        states: params.states,
        cities: params.cities,
      },
      discovery: {
        ...cfg.discovery,
        keywords: finalKeywords,
        negativeKeywords:
          params.negativeKeywords !== undefined
            ? params.negativeKeywords
            : cfg.discovery?.negativeKeywords || [],
        subNiche:
          params.subNiche !== undefined
            ? params.subNiche
            : cfg.discovery?.subNiche || "",
        strictNicheMatch: true,
      },
      scoring: {
        ...cfg.scoring,
        minScore: params.minScore,
        signalPoints: {
          ...cfg.scoring?.signalPoints,
          bleeding_ad_spend: cfg.scoring?.signalPoints?.bleeding_ad_spend ?? 15,
          high_volume_doors: cfg.scoring?.signalPoints?.high_volume_doors ?? 10,
          high_ticket_property: cfg.scoring?.signalPoints?.high_ticket_property ?? 10,
        },
      },
      size: {
        ...cfg.size,
        minEmployees: params.minEmployees !== undefined ? params.minEmployees : cfg.size?.minEmployees ?? null,
        maxEmployees: params.maxEmployees !== undefined ? params.maxEmployees : cfg.size?.maxEmployees ?? null,
        minDoors: params.minDoors !== undefined ? params.minDoors : cfg.size?.minDoors ?? null,
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

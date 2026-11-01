import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  companies,
  markets,
  researchJobs,
  researchRules,
  researchRuns,
} from "../db/schema";
import { defaultHvacRuleConfig, type RuleConfig } from "../domain/rules";
import { createCandidate, createCandidatesBatch } from "../repo/companies";
import { audit } from "../repo/audit";
import { executeDiscovery } from "../providers/registry";
import { researchCompany, type ResearchResult } from "./engine";
import { getStaleDays } from "../repo/settings";
import { recordRunTelemetry } from "./telemetry";

export type RunMode = "test" | "small" | "full" | "stale" | "rejected" | "retry";
export { getRunTelemetry, recordRunTelemetry, type TelemetryLogEntry } from "./telemetry";

export interface CreateRunOptions {
  mode: RunMode;
  ruleId?: string | null;
  marketId?: string | null;
  actor: string;
  dryRun?: boolean;
  providerFilter?: string[];
  maxCandidates?: number;
  concurrency?: number;
  pagesPerCompany?: number;
  stopOnError?: boolean;
}

export interface RunCounters {
  totalCandidates: number;
  createdCompanies: number;
  duplicatesMerged: number;
  excludedCount: number;
  completedJobs: number;
  failedJobs: number;
  factsRecorded: number;
  contactsDiscovered: number;
  approvedCount?: number;
  qualifiedCompanyIds?: string[];
  memberId?: string;
  memberName?: string;
  memberRole?: string;
  marketName?: string;
  targetCount?: number;
}

export async function createResearchRun(
  db: Db,
  opts: CreateRunOptions
): Promise<string> {
  // 1. Resolve rule & market
  let ruleId = opts.ruleId ?? null;
  let marketId = opts.marketId ?? null;
  let ruleConfig: RuleConfig;

  if (ruleId) {
    const [row] = await db
      .select()
      .from(researchRules)
      .where(eq(researchRules.id, ruleId))
      .limit(1);
    ruleConfig = (row?.config as RuleConfig) || defaultHvacRuleConfig();
    if (row?.marketId && !marketId) {
      marketId = row.marketId;
    }
  } else if (marketId) {
    const [def] = await db
      .select()
      .from(researchRules)
      .where(and(eq(researchRules.marketId, marketId), eq(researchRules.isDefault, true)))
      .limit(1);
    ruleId = def?.id ?? null;
    ruleConfig = (def?.config as RuleConfig) || defaultHvacRuleConfig();
  } else {
    const [def] = await db
      .select()
      .from(researchRules)
      .where(eq(researchRules.isDefault, true))
      .limit(1);
    ruleId = def?.id ?? null;
    marketId = def?.marketId ?? null;
    ruleConfig = (def?.config as RuleConfig) || defaultHvacRuleConfig();
  }

  // 2. Fallback resolve market if still null
  if (!marketId) {
    const [market] = await db
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.key, "hvac"))
      .limit(1);
    marketId = market?.id ?? null;
  }

  // 3. Candidate limit based on mode
  let limit = ruleConfig.discovery.limits.maxCandidates || 50;
  if (opts.mode === "test") limit = 3;
  else if (opts.mode === "small") limit = 15;
  if (opts.maxCandidates && opts.maxCandidates > 0) {
    limit = opts.maxCandidates;
  }

  const limits = {
    maxCandidates: limit,
    concurrency: opts.concurrency ?? ruleConfig.discovery.limits.concurrency ?? 2,
    pagesPerCompany: opts.pagesPerCompany ?? ruleConfig.discovery.limits.pagesPerCompany ?? 12,
    stopOnError: opts.stopOnError ?? ruleConfig.discovery.limits.stopOnError ?? false,
    providerFilter: opts.providerFilter ?? null,
  };

  const initialCounters: RunCounters = {
    totalCandidates: 0,
    createdCompanies: 0,
    duplicatesMerged: 0,
    excludedCount: 0,
    completedJobs: 0,
    failedJobs: 0,
    factsRecorded: 0,
    contactsDiscovered: 0,
  };

  const [run] = await db
    .insert(researchRuns)
    .values({
      marketId,
      ruleId,
      mode: opts.mode,
      dryRun: opts.dryRun ?? false,
      limits,
      counters: initialCounters as any,
      actor: opts.actor,
      status: "QUEUED",
    })
    .returning({ id: researchRuns.id });

  if (!run) throw new Error("Failed to create research run");

  await audit(db, {
    actor: opts.actor,
    action: "research_run.created",
    entityType: "research_run",
    entityId: run.id,
    details: { mode: opts.mode, limits, marketId },
  });

  return run.id;
}

export interface ExecuteRunOptions {
  timeoutMs?: number;
  maxWallClockMs?: number;
  mockPages?: any[];
  autoEnrich?: boolean;
}

export interface PrepareCandidatesResult {
  candidatesCount: number;
  jobsCount: number;
}

export async function prepareRunCandidates(
  db: Db,
  runId: string,
  runOpts?: ExecuteRunOptions
): Promise<PrepareCandidatesResult> {
  const [run] = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.id, runId))
    .limit(1);

  if (!run) throw new Error(`Run ${runId} not found`);

  // Check if jobs are already queued or created for this run
  const existingJobs = await db
    .select({ id: researchJobs.id })
    .from(researchJobs)
    .where(eq(researchJobs.runId, runId))
    .limit(1);

  if (existingJobs.length > 0) {
    const totalJobs = await db
      .select({ id: researchJobs.id })
      .from(researchJobs)
      .where(eq(researchJobs.runId, runId));
    return {
      candidatesCount: (run.counters as any)?.totalCandidates || totalJobs.length,
      jobsCount: totalJobs.length,
    };
  }

  // Update status to RUNNING
  await db
    .update(researchRuns)
    .set({ status: "RUNNING", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(researchRuns.id, runId));

  const limits = (run.limits as Record<string, any>) || {};
  const maxCandidates = limits.maxCandidates || 25;

  let ruleConfig: RuleConfig = defaultHvacRuleConfig();
  if (run.ruleId) {
    const [r] = await db
      .select()
      .from(researchRules)
      .where(eq(researchRules.id, run.ruleId))
      .limit(1);
    if (r?.config) ruleConfig = r.config as RuleConfig;
  }

  const companyIdsToResearch: string[] = [];
  let baseQueryOffset = 0;
  let totalDiscoveredCount = 0;

  recordRunTelemetry(runId, {
    stage: "INIT",
    level: "info",
    message: `Discovery Engine initialized (Mode: ${run.mode}, Target: ${maxCandidates} qualified leads).`,
  });

  // Step 1: Candidate intake according to mode
  if (run.mode === "stale") {
    const staleDays = await getStaleDays(db);
    const cutoff = new Date(Date.now() - staleDays * 86400 * 1000);
    const staleCond = or(isNull(companies.lastVerifiedAt), lt(companies.lastVerifiedAt, cutoff));
    const staleRows = await db
      .select({ id: companies.id })
      .from(companies)
      .where(run.marketId ? and(eq(companies.marketId, run.marketId), staleCond) : staleCond)
      .limit(maxCandidates);
    companyIdsToResearch.push(...staleRows.map((r) => r.id));
    totalDiscoveredCount = staleRows.length;
    recordRunTelemetry(runId, {
      stage: "INIT",
      level: "info",
      message: `Selected ${companyIdsToResearch.length} stale leads for re-verification.`,
    });
  } else if (run.mode === "rejected") {
    const rejCond = inArray(companies.status, ["REJECTED", "DISQUALIFIED"]);
    const rejectedRows = await db
      .select({ id: companies.id })
      .from(companies)
      .where(run.marketId ? and(eq(companies.marketId, run.marketId), rejCond) : rejCond)
      .limit(maxCandidates);
    companyIdsToResearch.push(...rejectedRows.map((r) => r.id));
    totalDiscoveredCount = rejectedRows.length;
    recordRunTelemetry(runId, {
      stage: "INIT",
      level: "info",
      message: `Selected ${companyIdsToResearch.length} previously rejected leads for re-evaluation.`,
    });
  } else if (run.mode === "retry") {
    const failedJobs = await db
      .select({ companyId: researchJobs.companyId })
      .from(researchJobs)
      .where(and(eq(researchJobs.runId, runId), eq(researchJobs.status, "FAILED")));
    for (const j of failedJobs) {
      if (j.companyId) companyIdsToResearch.push(j.companyId);
    }
    totalDiscoveredCount = failedJobs.length;
    recordRunTelemetry(runId, {
      stage: "INIT",
      level: "info",
      message: `Retrying ${companyIdsToResearch.length} previously failed jobs.`,
    });
  } else {
    // Pull a larger candidate pool so filtering/deduping yields target qualified count
    const poolLimit = runOpts?.mockPages
      ? maxCandidates
      : Math.min(Math.max(Math.ceil(maxCandidates * 3.0), 40), 300);

    const [existingDomainRows, priorRunRows] = await Promise.all([
      db
        .select({ domain: companies.domain })
        .from(companies)
        .where(run.marketId ? eq(companies.marketId, run.marketId) : undefined),
      db
        .select({ id: researchRuns.id })
        .from(researchRuns)
        .where(run.marketId ? eq(researchRuns.marketId, run.marketId) : undefined),
    ]);

    const excludeDomains = existingDomainRows
      .map((r) => r.domain?.toLowerCase())
      .filter(Boolean) as string[];

    baseQueryOffset = Math.max(0, (priorRunRows.length - 1) * 3);

    const kwSample = (ruleConfig.discovery.keywords || []).slice(0, 3).join(", ");
    const geoSample = (ruleConfig.geography.states || ["TX"]).join(", ");
    recordRunTelemetry(runId, {
      stage: "SEARCH",
      level: "info",
      message: `Formulating search query plan: [${kwSample || "Target ICP"}] across [${geoSample}] (pool target: ${poolLimit} candidates)...`,
    });

    const discovered = await executeDiscovery(
      db,
      {
        rule: ruleConfig,
        keywords: ruleConfig.discovery.keywords,
        states: ruleConfig.geography.states,
        cities: ruleConfig.geography.cities,
        zips: ruleConfig.geography.zips,
        limit: poolLimit,
        excludeDomains,
        queryOffset: baseQueryOffset,
      },
      limits.providerFilter
    );

    totalDiscoveredCount = discovered.length;

    recordRunTelemetry(runId, {
      stage: "SEARCH",
      level: "info",
      message: `Tavily Search completed: Discovered ${discovered.length} raw website candidates. Now running anti-dump exclusions & deduplication...`,
    });

    const intakeResult = await createCandidatesBatch(
      db,
      discovered.map((d) => ({
        name: d.name,
        website: d.website,
        phone: d.phone,
        address: d.street,
        city: d.city,
        state: d.state,
        zip: d.zip,
        provider: d.provider,
        providerRef: d.providerRef,
      })),
      { actor: run.actor || "Discovery Runner", marketId: run.marketId ?? undefined }
    );

    recordRunTelemetry(runId, {
      stage: "SEARCH",
      level: "info",
      message: `Intake Complete: ${intakeResult.createdCount} new websites queued for live deep-crawl, ${intakeResult.duplicateCount} deduplicated, ${intakeResult.excludedCount} blocked by negative filters.`,
    });

    companyIdsToResearch.push(...intakeResult.createdIds);
    for (const dupId of intakeResult.duplicateIds) {
      if (companyIdsToResearch.length >= poolLimit) break;
      companyIdsToResearch.push(dupId);
    }

    const currentCounters = (run.counters as any) || {};
    await db
      .update(researchRuns)
      .set({
        counters: {
          ...currentCounters,
          totalCandidates: totalDiscoveredCount,
          createdCompanies: intakeResult.createdCount,
          duplicatesMerged: intakeResult.duplicateCount,
          excludedCount: intakeResult.excludedCount,
          targetCount: maxCandidates,
        } as any,
        updatedAt: new Date(),
      })
      .where(eq(researchRuns.id, runId));
  }

  // Deduplicate target company IDs
  const maxPoolToInspect = runOpts?.mockPages
    ? maxCandidates
    : Math.min(Math.max(Math.ceil(maxCandidates * 3.0), 40), 300);
  const uniqueCompanyIds = Array.from(new Set(companyIdsToResearch)).slice(0, maxPoolToInspect);

  // Bulk insert research jobs in DB as QUEUED
  if (uniqueCompanyIds.length > 0) {
    await db.insert(researchJobs).values(
      uniqueCompanyIds.map((cid) => ({
        runId,
        companyId: cid,
        kind: "research",
        status: "QUEUED",
      }))
    );
  }

  return { candidatesCount: totalDiscoveredCount, jobsCount: uniqueCompanyIds.length };
}

export interface ExecuteBatchOptions {
  mockPages?: any[];
  autoEnrich?: boolean;
}

export async function executeQueuedBatch(
  db: Db,
  runId: string,
  batchSize = 5,
  batchOpts?: ExecuteBatchOptions
): Promise<{ processed: number; approvedCount: number; isFinished: boolean }> {
  const [run] = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.id, runId))
    .limit(1);

  if (!run) return { processed: 0, approvedCount: 0, isFinished: true };

  const limits = (run.limits as Record<string, any>) || {};
  const maxCandidates = limits.maxCandidates || 25;
  const currentCounters: RunCounters = {
    totalCandidates: 0,
    createdCompanies: 0,
    duplicatesMerged: 0,
    excludedCount: 0,
    completedJobs: 0,
    failedJobs: 0,
    factsRecorded: 0,
    contactsDiscovered: 0,
    approvedCount: 0,
    qualifiedCompanyIds: [],
    ...((run.counters as any) || {}),
  };

  // If already reached target or previously finished
  if ((currentCounters.approvedCount || 0) >= maxCandidates) {
    if (run.status !== "COMPLETED") {
      await db
        .update(researchRuns)
        .set({ status: "COMPLETED", finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(researchRuns.id, runId));
    }
    return { processed: 0, approvedCount: currentCounters.approvedCount || 0, isFinished: true };
  }

  // Atomically claim next batch of QUEUED jobs
  const queuedCandidates = await db
    .select({ id: researchJobs.id, companyId: researchJobs.companyId })
    .from(researchJobs)
    .where(and(eq(researchJobs.runId, runId), eq(researchJobs.status, "QUEUED")))
    .limit(batchSize);

  if (queuedCandidates.length === 0) {
    // Check if any jobs are currently marked RUNNING
    const [runningJob] = await db
      .select({ id: researchJobs.id })
      .from(researchJobs)
      .where(and(eq(researchJobs.runId, runId), eq(researchJobs.status, "RUNNING")))
      .limit(1);

    if (runningJob) {
      return { processed: 0, approvedCount: currentCounters.approvedCount || 0, isFinished: false };
    }

    // Try dynamic replenishment if approved < target and mode is search discovery
    const currentReplenish = Number((run.counters as any)?.replenishRound || 0);
    if (
      (currentCounters.approvedCount || 0) < maxCandidates &&
      currentReplenish < 5 &&
      run.mode !== "test" &&
      run.mode !== "stale" &&
      run.mode !== "rejected" &&
      run.mode !== "retry"
    ) {
      const nextRound = currentReplenish + 1;
      const needed = maxCandidates - (currentCounters.approvedCount || 0);
      const replenishLimit = Math.min(Math.max(Math.ceil(needed * 3.2), 30), 120);

      let ruleConfig: RuleConfig = defaultHvacRuleConfig();
      if (run.ruleId) {
        const [r] = await db
          .select()
          .from(researchRules)
          .where(eq(researchRules.id, run.ruleId))
          .limit(1);
        if (r?.config) ruleConfig = r.config as RuleConfig;
      }

      const freshDomainRows = await db
        .select({ domain: companies.domain })
        .from(companies)
        .where(run.marketId ? eq(companies.marketId, run.marketId) : undefined);
      const freshExcludes = freshDomainRows.map((r) => r.domain?.toLowerCase()).filter(Boolean) as string[];

      recordRunTelemetry(runId, {
        stage: "REPLENISH",
        level: "info",
        message: `Dynamic Replenishment Round ${nextRound}: Have ${currentCounters.approvedCount || 0}/${maxCandidates} leads. Fetching next pool of up to ${replenishLimit} candidates...`,
      });

      const replenishDiscovered = await executeDiscovery(
        db,
        {
          rule: ruleConfig,
          keywords: ruleConfig.discovery.keywords,
          states: ruleConfig.geography.states,
          cities: ruleConfig.geography.cities,
          zips: ruleConfig.geography.zips,
          limit: replenishLimit,
          excludeDomains: freshExcludes,
          queryOffset: nextRound * 6,
        },
        limits.providerFilter
      );

      if (replenishDiscovered.length > 0) {
        const replenishIntake = await createCandidatesBatch(
          db,
          replenishDiscovered.map((d) => ({
            name: d.name,
            website: d.website,
            phone: d.phone,
            address: d.street,
            city: d.city,
            state: d.state,
            zip: d.zip,
            provider: d.provider,
            providerRef: d.providerRef,
          })),
          { actor: run.actor || "Discovery Runner", marketId: run.marketId ?? undefined }
        );

        const newTargetIds = Array.from(new Set([...replenishIntake.createdIds, ...replenishIntake.duplicateIds]));
        if (newTargetIds.length > 0) {
          await db.insert(researchJobs).values(
            newTargetIds.map((cid) => ({
              runId,
              companyId: cid,
              kind: "research",
              status: "QUEUED",
            }))
          );

          await db
            .update(researchRuns)
            .set({
              counters: {
                ...currentCounters,
                totalCandidates: (currentCounters.totalCandidates || 0) + replenishDiscovered.length,
                createdCompanies: (currentCounters.createdCompanies || 0) + replenishIntake.createdCount,
                duplicatesMerged: (currentCounters.duplicatesMerged || 0) + replenishIntake.duplicateCount,
                excludedCount: (currentCounters.excludedCount || 0) + replenishIntake.excludedCount,
                replenishRound: nextRound,
              } as any,
              updatedAt: new Date(),
            })
            .where(eq(researchRuns.id, runId));

          return executeQueuedBatch(db, runId, batchSize, batchOpts);
        }
      }
    }

    // No more jobs and cannot replenish
    const finalStatus = (currentCounters.completedJobs || 0) > 0 ? "COMPLETED" : "FAILED";
    await db
      .update(researchRuns)
      .set({ status: finalStatus, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(researchRuns.id, runId));

    return { processed: 0, approvedCount: currentCounters.approvedCount || 0, isFinished: true };
  }

  const idsToClaim = queuedCandidates.map((j) => j.id);
  const claimedJobs = await db
    .update(researchJobs)
    .set({ status: "RUNNING", startedAt: new Date() })
    .where(and(inArray(researchJobs.id, idsToClaim), eq(researchJobs.status, "QUEUED")))
    .returning({ id: researchJobs.id, companyId: researchJobs.companyId });

  if (claimedJobs.length === 0) {
    return { processed: 0, approvedCount: currentCounters.approvedCount || 0, isFinished: false };
  }

  let ruleConfig: RuleConfig = defaultHvacRuleConfig();
  if (run.ruleId) {
    const [r] = await db
      .select()
      .from(researchRules)
      .where(eq(researchRules.id, run.ruleId))
      .limit(1);
    if (r?.config) ruleConfig = r.config as RuleConfig;
  }

  const pagesPerCompany = Math.min(limits.pagesPerCompany || 4, 6);
  const timeoutMs = limits.timeoutMs || 2800;
  const runActor = run.actor || "Discovery Runner";
  const minScoreTarget = Math.min(ruleConfig?.scoring?.minScore ?? 60, 65);

  let batchApproved = 0;
  let batchCompleted = 0;
  let batchFailed = 0;
  let batchFacts = 0;
  let batchContacts = 0;
  const newQualifiedIds: string[] = [];

  await Promise.allSettled(
    claimedJobs.map(async (job) => {
      if (!job.companyId) return;
      try {
        const result: ResearchResult = await researchCompany(db, job.companyId, {
          runId,
          ruleConfig,
          maxPages: pagesPerCompany,
          timeoutMs,
          mockPages: batchOpts?.mockPages,
          actor: runActor,
        });

        batchCompleted++;
        batchFacts += result.factsRecorded;
        batchContacts += result.contactsDiscovered;

        const isApproved =
          (result.status === "APPROVED" || result.status === "NEEDS_REVIEW") &&
          result.icpScore >= minScoreTarget;

        if (isApproved) {
          batchApproved++;
          newQualifiedIds.push(job.companyId);
          recordRunTelemetry(runId, {
            stage: "APPROVED",
            level: "success",
            companyName: result.companyName,
            domain: result.domain,
            message: `[ACCEPTED: ICP Qualified] "${result.companyName}" (${result.domain}) • Score: ${result.icpScore}/100 • Discovered ${result.contactsDiscovered} contacts & ${result.factsRecorded} verified facts.`,
          });
        } else {
          const reason = result.gateReasons?.length
            ? result.gateReasons.join("; ")
            : result.gateMissing?.length
            ? `Missing: ${result.gateMissing.join(", ")}`
            : result.summary || "Did not meet strict ICP thresholds";
          recordRunTelemetry(runId, {
            stage: "GATE",
            level: "rejection",
            companyName: result.companyName,
            domain: result.domain,
            message: `[REJECTED: Quality Gate] "${result.companyName}" (${result.domain}) — ${reason}`,
          });
        }

        // Auto-enrich if qualified
        if (batchOpts?.autoEnrich !== false && isApproved) {
          try {
            const { enrichCompany } = await import("../enrichment/pipeline");
            await enrichCompany(db, job.companyId, { actor: `${runActor} (Auto-Enrich)` });
          } catch {
            // non-blocking
          }
        }

        await db
          .update(researchJobs)
          .set({
            status: "COMPLETED",
            finishedAt: new Date(),
            result: result as any,
          })
          .where(eq(researchJobs.id, job.id));
      } catch (err: any) {
        batchFailed++;
        const msg = err.message || String(err);
        await db
          .update(researchJobs)
          .set({
            status: "FAILED",
            finishedAt: new Date(),
            lastError: msg,
          })
          .where(eq(researchJobs.id, job.id));
      }
    })
  );

  const updatedApprovedCount = (currentCounters.approvedCount || 0) + batchApproved;
  const updatedQualifiedIds = [
    ...(currentCounters.qualifiedCompanyIds || []),
    ...newQualifiedIds,
  ];

  const updatedCounters: RunCounters = {
    ...currentCounters,
    completedJobs: (currentCounters.completedJobs || 0) + batchCompleted,
    failedJobs: (currentCounters.failedJobs || 0) + batchFailed,
    factsRecorded: (currentCounters.factsRecorded || 0) + batchFacts,
    contactsDiscovered: (currentCounters.contactsDiscovered || 0) + batchContacts,
    approvedCount: updatedApprovedCount,
    qualifiedCompanyIds: updatedQualifiedIds,
  };

  const isFinished = updatedApprovedCount >= maxCandidates;

  await db
    .update(researchRuns)
    .set({
      counters: updatedCounters as any,
      status: isFinished ? "COMPLETED" : "RUNNING",
      finishedAt: isFinished ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(researchRuns.id, runId));

  if (isFinished) {
    recordRunTelemetry(runId, {
      stage: "COMPLETED",
      level: "success",
      message: `Discovery Run COMPLETED: Target of ${maxCandidates} leads met with ${updatedApprovedCount} verified prospects!`,
    });
  }

  return {
    processed: claimedJobs.length,
    approvedCount: updatedApprovedCount,
    isFinished,
  };
}

export async function executeRun(
  db: Db,
  runId: string,
  runOpts?: ExecuteRunOptions
): Promise<RunCounters> {
  await prepareRunCandidates(db, runId, runOpts);

  const [run] = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.id, runId))
    .limit(1);

  if (!run) throw new Error(`Run ${runId} not found`);

  const limits = (run.limits as Record<string, any>) || {};
  const concurrency = Math.min(Math.max(limits.concurrency || 10, 1), 12);
  const maxWallClockMs = runOpts?.maxWallClockMs ?? (run.mode === "test" ? 6_000 : 180_000);
  const deadline = Date.now() + maxWallClockMs;

  while (Date.now() < deadline) {
    const res = await executeQueuedBatch(db, runId, concurrency, {
      mockPages: runOpts?.mockPages,
      autoEnrich: runOpts?.autoEnrich ?? true,
    });
    if (res.isFinished || res.processed === 0) break;
  }

  const [finalRun] = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.id, runId))
    .limit(1);

  const finalCounters = ((finalRun?.counters as unknown) as RunCounters) || {
    totalCandidates: 0,
    createdCompanies: 0,
    duplicatesMerged: 0,
    excludedCount: 0,
    completedJobs: 0,
    failedJobs: 0,
    factsRecorded: 0,
    contactsDiscovered: 0,
    approvedCount: 0,
  };

  await audit(db, {
    actor: run.actor || "Research Runner",
    action: "research_run.finished",
    entityType: "research_run",
    entityId: runId,
    details: { status: finalRun?.status || "COMPLETED", counters: finalCounters },
  });

  return finalCounters;
}

export async function pauseRun(db: Db, runId: string, actor: string): Promise<void> {
  await db
    .update(researchRuns)
    .set({ status: "QUEUED", updatedAt: new Date() })
    .where(eq(researchRuns.id, runId));

  await audit(db, {
    actor,
    action: "research_run.paused",
    entityType: "research_run",
    entityId: runId,
  });
}

export async function cancelRun(db: Db, runId: string, actor: string): Promise<void> {
  await db
    .update(researchRuns)
    .set({ status: "CANCELLED", finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(researchRuns.id, runId));

  await db
    .update(researchJobs)
    .set({ status: "CANCELLED", finishedAt: new Date() })
    .where(and(eq(researchJobs.runId, runId), eq(researchJobs.status, "QUEUED")));

  await audit(db, {
    actor,
    action: "research_run.cancelled",
    entityType: "research_run",
    entityId: runId,
  });
}

export async function getRecentRuns(db: Db, limit = 20, marketId?: string) {
  if (marketId) {
    return await db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.marketId, marketId))
      .orderBy(desc(researchRuns.createdAt))
      .limit(limit);
  }
  return await db
    .select()
    .from(researchRuns)
    .orderBy(desc(researchRuns.createdAt))
    .limit(limit);
}

export async function getRunDetails(db: Db, runId: string) {
  const [run] = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.id, runId))
    .limit(1);

  if (!run) return null;

  const jobs = await db
    .select()
    .from(researchJobs)
    .where(eq(researchJobs.runId, runId))
    .orderBy(desc(researchJobs.createdAt));

  return { run, jobs };
}

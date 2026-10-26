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

export type RunMode = "test" | "small" | "full" | "stale" | "rejected" | "retry";

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

export async function executeRun(
  db: Db,
  runId: string,
  runOpts?: ExecuteRunOptions
): Promise<RunCounters> {
  const [run] = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.id, runId))
    .limit(1);

  if (!run) throw new Error(`Run ${runId} not found`);

  // Update status to RUNNING
  await db
    .update(researchRuns)
    .set({ status: "RUNNING", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(researchRuns.id, runId));

  const limits = (run.limits as Record<string, any>) || {};
  const maxCandidates = limits.maxCandidates || 25;
  const concurrency = Math.min(Math.max(limits.concurrency || 8, 1), 10);
  const pagesPerCompany = Math.min(limits.pagesPerCompany || 3, 6);
  const stopOnError = !!limits.stopOnError;
  const timeoutMs = runOpts?.timeoutMs ?? limits.timeoutMs ?? (run.mode === "test" ? 1000 : 2800);
  const maxWallClockMs = runOpts?.maxWallClockMs ?? 15_000;
  const deadline = Date.now() + maxWallClockMs;
  const runActor = run.actor || "Research Runner";

  let ruleConfig: RuleConfig = defaultHvacRuleConfig();
  if (run.ruleId) {
    const [r] = await db
      .select()
      .from(researchRules)
      .where(eq(researchRules.id, run.ruleId))
      .limit(1);
    if (r?.config) ruleConfig = r.config as RuleConfig;
  }

  const counters: RunCounters = {
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
    targetCount: maxCandidates,
  };

  const companyIdsToResearch: string[] = [];
  let baseQueryOffset = 0;

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
  } else if (run.mode === "rejected") {
    const rejCond = inArray(companies.status, ["REJECTED", "DISQUALIFIED"]);
    const rejectedRows = await db
      .select({ id: companies.id })
      .from(companies)
      .where(run.marketId ? and(eq(companies.marketId, run.marketId), rejCond) : rejCond)
      .limit(maxCandidates);
    companyIdsToResearch.push(...rejectedRows.map((r) => r.id));
  } else if (run.mode === "retry") {
    const failedJobs = await db
      .select({ companyId: researchJobs.companyId })
      .from(researchJobs)
      .where(and(eq(researchJobs.runId, runId), eq(researchJobs.status, "FAILED")));
    for (const j of failedJobs) {
      if (j.companyId) companyIdsToResearch.push(j.companyId);
    }
  } else {
    // Pull a larger candidate pool so filtering/deduping still yields the requested qualified count
    const poolLimit = runOpts?.mockPages
      ? maxCandidates
      : Math.min(Math.max(Math.ceil(maxCandidates * 3.0), 40), 300);

    // Query existing domains for this market and past run count for query plan rotation
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

    counters.totalCandidates = discovered.length;

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

    counters.createdCompanies = intakeResult.createdCount;
    counters.duplicatesMerged = intakeResult.duplicateCount;
    counters.excludedCount = intakeResult.excludedCount;

    companyIdsToResearch.push(...intakeResult.createdIds);
    for (const dupId of intakeResult.duplicateIds) {
      if (companyIdsToResearch.length >= poolLimit) break;
      companyIdsToResearch.push(dupId);
    }
  }

  // Deduplicate target company IDs
  const maxPoolToInspect = runOpts?.mockPages
    ? maxCandidates
    : Math.min(Math.max(Math.ceil(maxCandidates * 3.0), 40), 300);
  const uniqueCompanyIds = Array.from(new Set(companyIdsToResearch)).slice(0, maxPoolToInspect);

  // Step 2: Create research jobs in DB in a single bulk insert
  const jobIds: string[] = [];
  if (uniqueCompanyIds.length > 0) {
    const insertedJobs = await db
      .insert(researchJobs)
      .values(
        uniqueCompanyIds.map((cid) => ({
          runId,
          companyId: cid,
          kind: "research",
          status: "QUEUED",
        }))
      )
      .returning({ id: researchJobs.id });
    for (const j of insertedJobs) {
      jobIds.push(j.id);
    }
  }

  // Step 3: Run jobs with concurrency pool bounded to remaining wall clock time
  const remainingMs = Math.max(0, deadline - Date.now());
  const jobDeadline = Date.now() + Math.max(remainingMs, 50_000);
  let activeIndex = 0;
  let encounteredError: string | null = null;

  async function worker() {
    while (activeIndex < uniqueCompanyIds.length) {
      if (stopOnError && encounteredError) break;
      if (!runOpts?.mockPages && (counters.approvedCount || 0) >= maxCandidates) break;
      if (!runOpts?.mockPages && Date.now() >= jobDeadline) break;

      const idx = activeIndex++;
      const companyId = uniqueCompanyIds[idx];
      const jobId = jobIds[idx];
      if (!companyId || !jobId) continue;

      await db
        .update(researchJobs)
        .set({ status: "RUNNING", startedAt: new Date() })
        .where(eq(researchJobs.id, jobId));

      try {
        const result: ResearchResult = await researchCompany(db, companyId, {
          runId,
          ruleConfig,
          maxPages: pagesPerCompany,
          timeoutMs,
          mockPages: runOpts?.mockPages,
          actor: runActor,
        });

        counters.completedJobs++;
        counters.factsRecorded += result.factsRecorded;
        counters.contactsDiscovered += result.contactsDiscovered;

        if (result.status === "APPROVED" || result.status === "NEEDS_REVIEW") {
          counters.approvedCount = (counters.approvedCount || 0) + 1;
          counters.qualifiedCompanyIds?.push(companyId);
        }

        if (
          runOpts?.autoEnrich &&
          result.status !== "DISQUALIFIED" &&
          (runOpts?.mockPages || Date.now() + 2000 < jobDeadline)
        ) {
          try {
            const { enrichCompany } = await import("../enrichment/pipeline");
            await enrichCompany(db, companyId, { actor: `${runActor} (Auto-Enrich)` });
          } catch {
            // Non-blocking enrichment: discoveries and primary facts are preserved
          }
        }

        await db
          .update(researchJobs)
          .set({
            status: "COMPLETED",
            finishedAt: new Date(),
            result: result as any,
          })
          .where(eq(researchJobs.id, jobId));
      } catch (err: any) {
        counters.failedJobs++;
        const msg = err.message || String(err);
        encounteredError = msg;

        await db
          .update(researchJobs)
          .set({
            status: "FAILED",
            finishedAt: new Date(),
            lastError: msg,
          })
          .where(eq(researchJobs.id, jobId));
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  // Step 4: Dynamic replenishment loop — if qualified leads < target, pull next batches until target reached
  let replenishRound = 1;
  while (
    (counters.approvedCount || 0) < maxCandidates &&
    Date.now() + 15_000 < jobDeadline &&
    !runOpts?.mockPages &&
    run.mode !== "stale" &&
    run.mode !== "rejected" &&
    run.mode !== "retry"
  ) {
    const needed = maxCandidates - (counters.approvedCount || 0);
    const replenishLimit = Math.min(Math.max(Math.ceil(needed * 2.8), 25), 120);
    const roundQueryOffset = baseQueryOffset + replenishRound * 4;
    replenishRound++;

    const freshDomainRows = await db
      .select({ domain: companies.domain })
      .from(companies)
      .where(run.marketId ? eq(companies.marketId, run.marketId) : undefined);
    const freshExcludes = freshDomainRows.map((r) => r.domain?.toLowerCase()).filter(Boolean) as string[];

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
        queryOffset: roundQueryOffset,
      },
      limits.providerFilter
    );

    if (replenishDiscovered.length === 0) break;
    counters.totalCandidates += replenishDiscovered.length;

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

    counters.createdCompanies += replenishIntake.createdCount;
    counters.duplicatesMerged += replenishIntake.duplicateCount;
    counters.excludedCount += replenishIntake.excludedCount;

    const roundCompanyIds = Array.from(new Set([...replenishIntake.createdIds, ...replenishIntake.duplicateIds]));
    if (roundCompanyIds.length === 0) break;

    const roundJobIds: string[] = [];
    const insertedRound = await db
      .insert(researchJobs)
      .values(
        roundCompanyIds.map((cid) => ({
          runId,
          companyId: cid,
          kind: "research",
          status: "QUEUED",
        }))
      )
      .returning({ id: researchJobs.id });
    for (const j of insertedRound) {
      roundJobIds.push(j.id);
    }

    let roundActiveIndex = 0;
    async function roundWorker() {
      while (roundActiveIndex < roundCompanyIds.length) {
        if (stopOnError && encounteredError) break;
        if ((counters.approvedCount || 0) >= maxCandidates) break;
        if (Date.now() >= jobDeadline) break;

        const idx = roundActiveIndex++;
        const companyId = roundCompanyIds[idx];
        const jobId = roundJobIds[idx];
        if (!companyId || !jobId) continue;

        await db
          .update(researchJobs)
          .set({ status: "RUNNING", startedAt: new Date() })
          .where(eq(researchJobs.id, jobId));

        try {
          const result: ResearchResult = await researchCompany(db, companyId, {
            runId,
            ruleConfig,
            maxPages: pagesPerCompany,
            timeoutMs,
            actor: runActor,
          });

          counters.completedJobs++;
          counters.factsRecorded += result.factsRecorded;
          counters.contactsDiscovered += result.contactsDiscovered;

          if (result.status === "APPROVED" || result.status === "NEEDS_REVIEW") {
            counters.approvedCount = (counters.approvedCount || 0) + 1;
            counters.qualifiedCompanyIds?.push(companyId);
          }

          if (runOpts?.autoEnrich && result.status !== "DISQUALIFIED" && Date.now() + 2000 < jobDeadline) {
            try {
              const { enrichCompany } = await import("../enrichment/pipeline");
              await enrichCompany(db, companyId, { actor: `${runActor} (Auto-Enrich)` });
            } catch {
              // Non-blocking
            }
          }

          await db
            .update(researchJobs)
            .set({
              status: "COMPLETED",
              finishedAt: new Date(),
              result: result as any,
            })
            .where(eq(researchJobs.id, jobId));
        } catch (err: any) {
          counters.failedJobs++;
          encounteredError = err.message || String(err);
          await db
            .update(researchJobs)
            .set({
              status: "FAILED",
              finishedAt: new Date(),
              lastError: encounteredError,
            })
            .where(eq(researchJobs.id, jobId));
        }
      }
    }

    const roundWorkers = Array.from({ length: concurrency }, () => roundWorker());
    await Promise.all(roundWorkers);
  }

  // Finalize run
  const finalStatus =
    counters.failedJobs === 0
      ? "COMPLETED"
      : counters.completedJobs > 0
      ? "PARTIAL"
      : "FAILED";

  await db
    .update(researchRuns)
    .set({
      status: finalStatus,
      finishedAt: new Date(),
      lastError: encounteredError,
      counters: counters as any,
      updatedAt: new Date(),
    })
    .where(eq(researchRuns.id, runId));

  await audit(db, {
    actor: run.actor || "Research Runner",
    action: "research_run.finished",
    entityType: "research_run",
    entityId: runId,
    details: { status: finalStatus, counters },
  });

  return counters;
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

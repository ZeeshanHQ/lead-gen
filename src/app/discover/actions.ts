"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { createCandidate, type CandidateInput } from "@/server/repo/companies";
import { getActor } from "@/server/repo/settings";
import { getActiveContext } from "@/server/repo/markets";

export async function addCandidateAction(input: CandidateInput, force = false) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { market } = await getActiveContext(db);
    const result = await createCandidate(db, input, { actor, force, marketId: market.id });
    revalidatePath("/caller");
    revalidatePath("/leads");
    revalidatePath("/review");
    revalidatePath("/discover");
    revalidatePath("/");
    return { ok: true, result };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to intake candidate" };
  }
}

export async function batchUrlsAction(urls: string[]) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { market } = await getActiveContext(db);
    const results = [];
    for (const rawUrl of urls) {
      const clean = rawUrl.trim();
      if (!clean) continue;
      // Derive initial display name from host until website research agent runs
      let initialName = `${market.name} Prospect`;
      try {
        const u = new URL(clean.startsWith("http") ? clean : `https://${clean}`);
        initialName = u.hostname.replace(/^www\./, "").split(".")[0]?.replace(/[-_]/g, " ") || initialName;
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
      results.push({ url: clean, res });
    }

    revalidatePath("/review");
    revalidatePath("/discover");
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
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { market, rule } = await getActiveContext(db);
    const { createResearchRun, executeRun } = await import("@/server/research/runner");

    const targetCount = Math.max(Math.min(options.targetCount || 100, 200), 3);
    const concurrency = Math.max(Math.min(options.concurrency || 4, 6), 1);
    const mode = options.mode || (targetCount <= 20 ? "test" : "full");

    const runId = await createResearchRun(db, {
      mode,
      ruleId: rule.id,
      marketId: market.id,
      actor,
      maxCandidates: targetCount,
      concurrency,
      pagesPerCompany: 8,
      providerFilter: options.providerFilter,
    });

    const counters = await executeRun(db, runId, { timeoutMs: 5000, autoEnrich: true });

    revalidatePath("/review");
    revalidatePath("/discover");
    revalidatePath("/runs");
    revalidatePath("/sources");
    revalidatePath("/");

    return {
      ok: true,
      runId,
      counters,
      targetCount,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || "Bulk discovery failed" };
  }
}

export async function runLeadDiscoveryAction(options: {
  targetCount?: number;
  cities?: string[];
  states?: string[];
  keywords?: string[];
  minScore?: number;
} = {}) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { market, rule: defaultRule } = await getActiveContext(db);
    const { saveRule } = await import("@/server/repo/rules");
    const { createResearchRun, executeRun } = await import("@/server/research/runner");
    const { loadLeadRows } = await import("@/server/repo/queue");

    let ruleConfig = defaultRule.config as any;

    // If custom targeting overrides are provided, update rule config
    if ((options.cities && options.cities.length > 0) || (options.states && options.states.length > 0) || options.minScore !== undefined || (options.keywords && options.keywords.length > 0)) {
      ruleConfig = {
        ...ruleConfig,
        geography: {
          ...ruleConfig.geography,
          states: options.states && options.states.length > 0 ? options.states : ruleConfig.geography.states,
          cities: options.cities && options.cities.length > 0 ? options.cities : ruleConfig.geography.cities,
        },
        discovery: {
          ...ruleConfig.discovery,
          keywords: options.keywords && options.keywords.length > 0 ? options.keywords : ruleConfig.discovery.keywords,
        },
        scoring: {
          ...ruleConfig.scoring,
          minScore: options.minScore !== undefined ? options.minScore : ruleConfig.scoring.minScore,
        },
      };
      await saveRule(db, defaultRule.id, { name: defaultRule.name, config: ruleConfig }, actor);
    }

    const targetCount = Math.max(Math.min(options.targetCount || 25, 100), 5);
    const mode = targetCount <= 25 ? "test" : "full";

    const runId = await createResearchRun(db, {
      mode,
      ruleId: defaultRule.id,
      marketId: market.id,
      actor: `${actor} (${market.name} AI Discovery)`,
      maxCandidates: targetCount,
      concurrency: 4,
      pagesPerCompany: 8,
      providerFilter: undefined, // uses configured providers for this niche
    });

    const counters = await executeRun(db, runId, { timeoutMs: 6500, autoEnrich: true });

    // Fetch freshly qualified review leads for this active niche
    const [approved, review] = await Promise.all([
      loadLeadRows(db, "approved", market.id),
      loadLeadRows(db, "review", market.id),
    ]);
    const allLeads = [...approved, ...review];
    const topLeads = allLeads.slice(0, 20);

    revalidatePath("/review");
    revalidatePath("/discover");
    revalidatePath("/runs");
    revalidatePath("/sources");
    revalidatePath("/");

    return {
      ok: true,
      runId,
      counters,
      targetCount,
      leads: topLeads,
      totalReviewCount: allLeads.length,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || "Lead discovery failed" };
  }
}

export async function getLatestReviewLeadsAction() {
  try {
    const db = await getDb();
    const { market } = await getActiveContext(db);
    const { loadLeadRows } = await import("@/server/repo/queue");
    const [approved, review] = await Promise.all([
      loadLeadRows(db, "approved", market.id),
      loadLeadRows(db, "review", market.id),
    ]);
    const leads = [...approved, ...review];
    return { ok: true, leads: leads.slice(0, 20), totalCount: leads.length };
  } catch (err: any) {
    return { ok: false, error: err.message, leads: [], totalCount: 0 };
  }
}

export async function quickApproveLeadAction(companyId: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { approveCompany } = await import("@/server/repo/approvals");
    await approveCompany(db, companyId, { actor, note: "Approved via Lead Prospector" });

    revalidatePath("/review");
    revalidatePath("/discover");
    revalidatePath("/approved");
    revalidatePath("/caller");
    revalidatePath("/");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to approve lead" };
  }
}

export async function quickRejectLeadAction(companyId: string, reason?: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { rejectCompany } = await import("@/server/repo/approvals");
    await rejectCompany(db, companyId, { actor, reason: reason || "Rejected in Lead Prospector" });

    revalidatePath("/review");
    revalidatePath("/discover");
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
}) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { rule: defaultRule } = await getActiveContext(db);
    const { saveRule, reEvaluateLeadsWithRule } = await import("@/server/repo/rules");
    const cfg = defaultRule.config as any;

    const newCfg = {
      ...cfg,
      geography: {
        ...cfg.geography,
        states: params.states,
        cities: params.cities,
      },
      discovery: {
        ...cfg.discovery,
        keywords: params.keywords && params.keywords.length > 0 ? params.keywords : cfg.discovery?.keywords || [],
      },
      scoring: {
        ...cfg.scoring,
        minScore: params.minScore,
      },
    };

    const updated = await saveRule(db, defaultRule.id, { name: defaultRule.name, config: newCfg }, actor);
    const reScore = await reEvaluateLeadsWithRule(db, updated.id, actor);

    revalidatePath("/rules");
    revalidatePath("/discover");
    revalidatePath("/review");
    return { ok: true, rule: newCfg, reScore };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// Backward-compatible alias for legacy references
export const runTavilyTestDiscoveryAction = runLeadDiscoveryAction;



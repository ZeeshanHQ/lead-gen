import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { markets, researchRules, companies, leadScores } from "../db/schema";
import {
  type RuleConfig,
  type EvalCompany,
  ruleConfigSchema,
  evaluateRule,
  calculateLeadScore,
  defaultHvacRuleConfig,
} from "../domain/rules";
import { type FactMap } from "../domain/facts";
import { evaluateGate, passesLeadRowGate, resolveGate } from "../domain/gate";
import { getContactsForCompanies, toContactInput } from "./contacts";
import { audit } from "./audit";

export async function listRules(db: Db, marketId?: string) {
  if (marketId) {
    return db
      .select()
      .from(researchRules)
      .where(eq(researchRules.marketId, marketId))
      .orderBy(desc(researchRules.isDefault), desc(researchRules.updatedAt));
  }
  return db.select().from(researchRules).orderBy(desc(researchRules.isDefault), desc(researchRules.updatedAt));
}

export async function getRule(db: Db, id: string) {
  const [r] = await db.select().from(researchRules).where(eq(researchRules.id, id)).limit(1);
  return r ?? null;
}

/** The default rule of the specified market (or default market if omitted). */
export async function getDefaultRule(db: Db, marketId?: string) {
  let targetMarketId = marketId;
  if (!targetMarketId) {
    const [hvacMarket] = await db
      .select({ id: markets.id })
      .from(markets)
      .where(eq(markets.key, "hvac"))
      .limit(1);
    if (hvacMarket) targetMarketId = hvacMarket.id;
  }

  if (targetMarketId) {
    const [r] = await db
      .select()
      .from(researchRules)
      .where(and(eq(researchRules.marketId, targetMarketId), eq(researchRules.isDefault, true)))
      .orderBy(desc(researchRules.updatedAt))
      .limit(1);
    if (r) return r;

    const [anyRule] = await db
      .select()
      .from(researchRules)
      .where(eq(researchRules.marketId, targetMarketId))
      .orderBy(desc(researchRules.updatedAt))
      .limit(1);
    if (anyRule) return anyRule;
  }

  const [r] = await db
    .select()
    .from(researchRules)
    .where(eq(researchRules.isDefault, true))
    .orderBy(desc(researchRules.updatedAt))
    .limit(1);
  if (!r) throw new Error("No default research rule exists. Bootstrap did not run.");
  return r;
}

export async function getMarketForRule(db: Db, marketId: string) {
  const [m] = await db.select().from(markets).where(eq(markets.id, marketId)).limit(1);
  return m ?? null;
}

export class RuleValidationError extends Error {
  constructor(public issues: string[]) {
    super(issues.join("; "));
    this.name = "RuleValidationError";
  }
}

export function parseRuleConfig(input: unknown): RuleConfig {
  let normalizedInput = input;
  if (input && typeof input === "object") {
    const raw = { ...(input as any) };
    if (raw.scoring) {
      raw.scoring = {
        ...raw.scoring,
        signalPoints: {
          ...defaultHvacRuleConfig().scoring.signalPoints,
          ...(raw.scoring.signalPoints || {}),
        },
      };
      normalizedInput = raw;
    }
  }

  const result = ruleConfigSchema.safeParse(normalizedInput);
  if (!result.success) {
    throw new RuleValidationError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const cfg = result.data;
  const { minEmployees, maxEmployees } = cfg.size;
  if (minEmployees !== null && maxEmployees !== null && minEmployees > maxEmployees) {
    throw new RuleValidationError(["size: minimum employees cannot exceed maximum employees"]);
  }
  const capSum = Object.values(cfg.scoring.categoryCaps).reduce((a, b) => a + b, 0);
  if (capSum !== 100) {
    throw new RuleValidationError([`scoring: category caps must add up to 100 (currently ${capSum})`]);
  }
  return cfg;
}

export async function saveRule(
  db: Db,
  id: string,
  update: { name: string; config: unknown },
  actor: string,
) {
  const config = parseRuleConfig(update.config);
  const name = update.name.trim();
  if (!name) throw new RuleValidationError(["name: required"]);
  return db.transaction(async (tx) => {
    const existing = await getRule(tx, id);
    if (!existing) throw new RuleValidationError(["rule not found"]);
    const [row] = await tx
      .update(researchRules)
      .set({ name, config, version: existing.version + 1, updatedAt: new Date() })
      .where(eq(researchRules.id, id))
      .returning();
    await audit(tx, {
      actor,
      action: "rule.updated",
      entityType: "research_rule",
      entityId: id,
      oldValue: { name: existing.name, version: existing.version, config: existing.config },
      newValue: { name, version: existing.version + 1, config },
    });
    return row!;
  });
}

export async function duplicateRule(db: Db, id: string, newName: string, actor: string) {
  const existing = await getRule(db, id);
  if (!existing) throw new RuleValidationError(["rule not found"]);
  const name = newName.trim();
  if (!name) throw new RuleValidationError(["name: required"]);
  const [row] = await db
    .insert(researchRules)
    .values({ marketId: existing.marketId, name, config: existing.config, isDefault: false })
    .returning();
  await audit(db, {
    actor,
    action: "rule.created",
    entityType: "research_rule",
    entityId: row!.id,
    newValue: { name, copiedFrom: id },
  });
  return row!;
}

export async function reEvaluateLeadsWithRule(
  db: Db,
  ruleId: string,
  actor: string,
): Promise<{ reScoredCount: number; qualifiedCount: number; disqualifiedCount: number }> {
  const rule = await getRule(db, ruleId);
  if (!rule || !rule.config) throw new RuleValidationError(["Rule not found"]);
  const ruleConfig = rule.config as RuleConfig;

  // Fetch all leads in active review/pipeline stages for this rule's market
  const candidateRows = await db
    .select()
    .from(companies)
    .where(
      and(
        eq(companies.marketId, rule.marketId),
        inArray(companies.status, ["DISCOVERED", "RESEARCHED", "NEEDS_REVIEW", "DISQUALIFIED", "APPROVED"])
      )
    );

  if (candidateRows.length === 0) {
    return { reScoredCount: 0, qualifiedCount: 0, disqualifiedCount: 0 };
  }

  const ids = candidateRows.map((r) => r.id);
  const [contactMap, existingScoreRows] = await Promise.all([
    getContactsForCompanies(db, ids),
    db.select().from(leadScores).where(inArray(leadScores.companyId, ids)),
  ]);

  const existingScoreByCompanyId = new Map<string, (typeof existingScoreRows)[number]>();
  for (const sr of existingScoreRows) {
    if (!existingScoreByCompanyId.has(sr.companyId)) {
      existingScoreByCompanyId.set(sr.companyId, sr);
    }
  }

  let qualifiedCount = 0;
  let disqualifiedCount = 0;
  const resolvedGate = resolveGate(ruleConfig.gate);

  const toDisqualifyIds: string[] = [];
  const toNeedsReviewIds: string[] = [];
  const scoreInserts: Array<typeof leadScores.$inferInsert> = [];
  const scoreUpdates: Array<{ id: string; data: Partial<typeof leadScores.$inferInsert> }> = [];

  for (const c of candidateRows) {
    const rawContacts = contactMap.get(c.id) ?? [];
    const contactInputs = rawContacts.map(toContactInput);

    const evalCompany: EvalCompany = {
      name: c.name,
      website: c.website,
      state: c.state,
      city: c.city,
      zip: c.zip,
      facts: (c.facts as FactMap) || {},
      contacts: contactInputs,
      contactResearchDone: true,
    };

    const evaluation = evaluateRule(evalCompany, ruleConfig);
    const scoreBreakdown = calculateLeadScore(evalCompany, ruleConfig);

    const gateResult = evaluateGate(ruleConfig.gate, {
      phone: c.phoneDisplay || c.phoneE164,
      website: c.website,
      websiteAlive: ((c.facts as FactMap) || {}).website_alive?.value === "NO" ? false : null,
      city: c.city,
      state: c.state,
      contacts: contactInputs,
      facts: evalCompany.facts,
      searchText: `${c.name} ${c.website || ""} ${c.researchSummary || ""}`,
    });

    const primaryContact = contactInputs[0];
    const rowGatePassed = passesLeadRowGate(
      {
        name: c.name,
        website: c.website,
        city: c.city,
        state: c.state,
        status: c.status === "DISQUALIFIED" ? "NEEDS_REVIEW" : c.status,
        phoneDisplay: c.phoneDisplay || c.phoneE164,
        icpScore: scoreBreakdown.icpScore,
        hasDecisionMaker: contactInputs.some((ci) => Boolean(ci.name)),
        hasDirectContact: contactInputs.some(
          (ci) => ci.phoneType === "PROFESSIONAL_MOBILE" || ci.phoneType === "PUBLISHED_DIRECT"
        ),
        owner: primaryContact ? { name: primaryContact.name, title: primaryContact.title, verified: primaryContact.verified } : null,
        best: primaryContact
          ? { name: primaryContact.name, phone: primaryContact.phone, email: primaryContact.email }
          : { name: null, phone: c.phoneDisplay || c.phoneE164, email: null },
        facts: evalCompany.facts,
        researchSummary: c.researchSummary,
      },
      resolvedGate,
      ruleConfig
    );

    const isHardOffNiche =
      evalCompany.facts.off_niche_vendor?.value === "YES" ||
      evalCompany.facts.niche_verified?.value === "NO" ||
      evalCompany.facts.casual_host_only?.value === "YES";
    const passed = gateResult.passed && rowGatePassed && evaluation.verdict !== "FAIL" && !isHardOffNiche;

    let nextStatus = c.status;
    if (!passed) {
      if (c.status === "DISCOVERED" || c.status === "RESEARCHED" || c.status === "NEEDS_REVIEW" || c.status === "APPROVED") {
        nextStatus = "DISQUALIFIED";
      }
    } else {
      if (c.status === "DISQUALIFIED" || c.status === "DISCOVERED" || c.status === "RESEARCHED") {
        nextStatus = "NEEDS_REVIEW";
      }
    }

    if (nextStatus !== c.status) {
      if (nextStatus === "DISQUALIFIED") toDisqualifyIds.push(c.id);
      else if (nextStatus === "NEEDS_REVIEW") toNeedsReviewIds.push(c.id);
    }

    if (passed) qualifiedCount++;
    else disqualifiedCount++;

    const existingScore = existingScoreByCompanyId.get(c.id);
    if (existingScore) {
      scoreUpdates.push({
        id: existingScore.id,
        data: {
          ruleId,
          icpScore: scoreBreakdown.icpScore,
          researchConfidence: Math.round(scoreBreakdown.researchConfidence * 100),
          grade: scoreBreakdown.grade,
          breakdown: scoreBreakdown as any,
          scoredAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } else {
      scoreInserts.push({
        companyId: c.id,
        ruleId,
        icpScore: scoreBreakdown.icpScore,
        researchConfidence: Math.round(scoreBreakdown.researchConfidence * 100),
        grade: scoreBreakdown.grade,
        breakdown: scoreBreakdown as any,
        scoredAt: new Date(),
      });
    }
  }

  const now = new Date();
  await Promise.all([
    toDisqualifyIds.length > 0
      ? db.update(companies).set({ status: "DISQUALIFIED", updatedAt: now }).where(inArray(companies.id, toDisqualifyIds))
      : Promise.resolve(),
    toNeedsReviewIds.length > 0
      ? db.update(companies).set({ status: "NEEDS_REVIEW", updatedAt: now }).where(inArray(companies.id, toNeedsReviewIds))
      : Promise.resolve(),
    scoreInserts.length > 0
      ? db.insert(leadScores).values(scoreInserts)
      : Promise.resolve(),
  ]);

  // Execute score updates in parallel batches of 30
  for (let i = 0; i < scoreUpdates.length; i += 30) {
    const chunk = scoreUpdates.slice(i, i + 30);
    await Promise.all(
      chunk.map((u) => db.update(leadScores).set(u.data).where(eq(leadScores.id, u.id)))
    );
  }

  await audit(db, {
    actor,
    action: "rules.leads_re_evaluated",
    entityType: "research_rule",
    entityId: ruleId,
    details: {
      reScoredCount: candidateRows.length,
      qualifiedCount,
      disqualifiedCount,
      minScore: ruleConfig.scoring.minScore,
    },
  });

  return {
    reScoredCount: candidateRows.length,
    qualifiedCount,
    disqualifiedCount,
  };
}

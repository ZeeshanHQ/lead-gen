import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { markets, researchRules, companies, leadScores } from "../db/schema";
import {
  type RuleConfig,
  type EvalCompany,
  ruleConfigSchema,
  evaluateRule,
  calculateLeadScore,
} from "../domain/rules";
import { type FactMap } from "../domain/facts";
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
  const result = ruleConfigSchema.safeParse(input);
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
  const contactMap = await getContactsForCompanies(db, ids);

  let qualifiedCount = 0;
  let disqualifiedCount = 0;

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

    const passed = evaluation.verdict !== "FAIL" && scoreBreakdown.icpScore >= ruleConfig.scoring.minScore;

    // Respect human approval: if already APPROVED, keep status; otherwise update
    let nextStatus = c.status;
    if (c.status === "NEEDS_REVIEW" || c.status === "DISQUALIFIED" || c.status === "RESEARCHED" || c.status === "DISCOVERED") {
      nextStatus = passed ? "NEEDS_REVIEW" : "DISQUALIFIED";
      if (nextStatus !== c.status) {
        await db
          .update(companies)
          .set({ status: nextStatus, updatedAt: new Date() })
          .where(eq(companies.id, c.id));
      }
    }

    if (passed) qualifiedCount++;
    else disqualifiedCount++;

    // Update or insert lead score
    const [existingScore] = await db
      .select()
      .from(leadScores)
      .where(eq(leadScores.companyId, c.id))
      .limit(1);

    if (existingScore) {
      await db
        .update(leadScores)
        .set({
          ruleId,
          icpScore: scoreBreakdown.icpScore,
          researchConfidence: Math.round(scoreBreakdown.researchConfidence * 100),
          grade: scoreBreakdown.grade,
          breakdown: scoreBreakdown as any,
          scoredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(leadScores.id, existingScore.id));
    } else {
      await db.insert(leadScores).values({
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

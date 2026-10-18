/**
 * "Fully qualified" decision. A lead is FULLY QUALIFIED only when ALL hold:
 *   1. every required rule check PASSES (no FAIL, nothing UNKNOWN),
 *   2. ICP score >= rule.scoring.minScore,
 *   3. every required data field is present (see completeness.ts).
 *
 * Contact-related rule checks (owner / DM name / direct phone / email) are
 * treated as MISSING DATA, not as a rejection: such a lead is "ALMOST" and can
 * be completed. Everything else that fails is a real rejection by the rules.
 */
import {
  type CompletenessResult,
  COMPLETENESS_LABEL,
  checkCompleteness,
  resolveCompleteness,
} from "./completeness";
import { type EvalCompany, type RuleConfig, calculateLeadScore, evaluateRule } from "./rules";

export type QualificationTier = "QUALIFIED" | "ALMOST" | "REJECTED";

export interface QualifyCompany extends EvalCompany {
  phone: string | null;
  address: string | null;
}

export interface QualificationResult {
  tier: QualificationTier;
  score: number;
  grade: "A" | "B" | "C" | "D";
  minScore: number;
  /** Human-readable list of every missing required piece of data. */
  missing: string[];
  /** Why a REJECTED lead was rejected (failed checks / low score). */
  rejectReasons: string[];
  /** Rule requirements still UNKNOWN: more research would resolve them. */
  needsResearch: string[];
  completeness: CompletenessResult;
}

const CONTACT_CHECK_IDS = new Set(["owner", "dm_name", "direct_phone", "email"]);

export function qualifyLead(company: QualifyCompany, ruleIn: RuleConfig): QualificationResult {
  const rule: RuleConfig = { ...ruleIn, completeness: resolveCompleteness(ruleIn.completeness) };
  // Contact research is considered done: absent contact data is "missing", never "unknown".
  const evalCompany: EvalCompany = { ...company, contactResearchDone: true };

  const evaluation = evaluateRule(evalCompany, rule);
  const score = calculateLeadScore(evalCompany, rule);
  const completeness = checkCompleteness(
    {
      website: company.website,
      phone: company.phone,
      address: company.address,
      city: company.city,
      state: company.state,
      zip: company.zip,
      employees: company.facts.employees?.value ?? null,
      contacts: company.contacts,
    },
    rule.completeness,
  );

  const required = evaluation.checks.filter((c) => c.required);
  const hardFails = required.filter((c) => c.status === "FAIL" && !CONTACT_CHECK_IDS.has(c.id));
  const contactGaps = required.filter((c) => c.status === "FAIL" && CONTACT_CHECK_IDS.has(c.id));
  const unknowns = required.filter((c) => c.status === "UNKNOWN");

  const missing = [
    ...completeness.missing.map((f) => COMPLETENESS_LABEL[f]),
    ...contactGaps.map((c) => c.label).filter((l) => !completeness.missing.some((f) => COMPLETENESS_LABEL[f] === l)),
  ];

  const minScore = rule.scoring.minScore;
  const scoreOk = score.icpScore >= minScore;
  // Contact-driven categories can still grow once the missing contact data is found.
  const caps = score.categoryScores;
  const potential =
    score.icpScore +
    (caps.decision_maker.cap - caps.decision_maker.points) +
    (caps.contactability.cap - caps.contactability.points);

  const rejectReasons = hardFails.map((c) => `${c.label}: ${c.detail}`);
  const needsResearch = unknowns.map((c) => `${c.label}: ${c.detail}`);

  let tier: QualificationTier;
  if (hardFails.length === 0 && unknowns.length === 0 && scoreOk && missing.length === 0) {
    tier = "QUALIFIED";
  } else if (hardFails.length === 0 && potential >= minScore) {
    tier = "ALMOST";
  } else {
    tier = "REJECTED";
    if (hardFails.length === 0 && potential < minScore) {
      rejectReasons.push(`Score ${score.icpScore}/${minScore} cannot reach the minimum even with complete contact data`);
    }
  }
  if (tier === "ALMOST" && !scoreOk && missing.length === 0 && unknowns.length === 0) {
    // Defensive: score short but nothing missing is not completable by data entry.
    tier = "REJECTED";
    rejectReasons.push(`Score ${score.icpScore} is below the minimum ${minScore}`);
  }

  return {
    tier,
    score: score.icpScore,
    grade: score.grade,
    minScore,
    missing,
    rejectReasons,
    needsResearch,
    completeness,
  };
}

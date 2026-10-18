import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies, leadScores, markets, researchRules } from "../db/schema";
import {
  calculateLeadScore,
  defaultHvacRuleConfig,
  evaluateRule,
  type EvalCompany,
  type RuleConfig,
  type ScoreBreakdown,
} from "../domain/rules";
import { toContactInput } from "../repo/contacts";
import { getContactsForCompanies, addContact } from "../repo/contacts";
import { setFact } from "../repo/facts";
import { audit } from "../repo/audit";
import { crawlWebsite, type CrawledPage } from "./crawler";
import { extractAllFacts } from "./extractors";
import type { FactMap } from "../domain/facts";
import { isDecisionMaker } from "../domain/contact";

export interface ResearchOptions {
  actor?: string;
  runId?: string | null;
  ruleConfig?: RuleConfig;
  mockPages?: CrawledPage[]; // For testing or simulated runs
  maxPages?: number;
  timeoutMs?: number;
}

export function buildColdCallerBattlecard(params: {
  companyName: string;
  city: string | null;
  state: string | null;
  primaryContact: { name: string; title: string | null } | null;
  facts: FactMap;
  score: number;
  nicheName?: string;
}): { summary: string; notes: string } {
  const dmName = params.primaryContact?.name;
  const dmTitle = params.primaryContact?.title || "Owner / Managing Principal";
  const city = params.city || "local market";
  const state = params.state || "";
  const location = state ? `${city}, ${state}` : city;
  const nicheName = params.nicheName || "US Residential HVAC";
  const isHvac = /hvac|heating|air conditioning|cooling/i.test(nicheName);

  const f = params.facts;
  const hasReplacement = f.replacement?.value === "YES" || f.installation?.value === "YES";
  const hasFinancing = f.financing?.value === "YES";
  const isHiring = f.hiring?.value === "YES";
  const software = f.software?.value && f.software.value !== "UNKNOWN" ? f.software.value : null;
  const brandSnippet = f.strong_presence?.value === "YES" ? "Premier Verified Presence" : null;

  // Synthesize executive bullet points for caller screen
  const bullets: string[] = [];
  if (dmName) bullets.push(`🎯 Target Decision Maker: ${dmName} (${dmTitle})`);
  else bullets.push(`🎯 Gatekeeper Strategy: Ask directly for the Owner or Managing Partner`);

  bullets.push(`📍 Local Market: ${location} (${nicheName})`);
  const hasStrongPresence = f.strong_presence?.value === "YES";
  if (hasStrongPresence) {
    bullets.push(`⭐ Reputation: Verified Strong Public Presence & Local Reviews`);
  }

  if (isHvac) {
    if (hasReplacement) bullets.push(`🔥 Focus: Residential HVAC Replacement & Installs (High average ticket)`);
  } else {
    if (hasReplacement) bullets.push(`🔥 Focus: Verified High-Value Core Services (${nicheName})`);
  }
  if (hasFinancing) bullets.push(`💳 Financing / Plans: Active client financing or payment plans verified`);
  if (isHiring) bullets.push(`🚨 Operational Pressure: Actively recruiting staff / expanding team`);
  if (software) bullets.push(`💻 Tech Stack: Uses ${software} for operations / scheduling`);
  if (brandSnippet) bullets.push(`🏅 Authority: ${brandSnippet}`);

  // Synthesize the 15-second opening pitch script tailored to this exact business & niche!
  const targetGreeting = dmName ? `Hey ${dmName.split(" ")[0]}` : "Hey there";
  const repHook = hasStrongPresence ? " and solid local reputation" : "";

  let script: string;
  if (isHvac) {
    const hookService = hasReplacement ? "residential system replacements" : "residential HVAC";
    const hookPain = isHiring
      ? "with lead techs swamped in the field, open replacement quotes take days before dispatchers follow up, losing big-ticket installs"
      : software
      ? `using ${software}, inbound quote triage and after-hours estimate follow-ups often fall through the cracks`
      : "after-hours replacement estimates sit idle before dispatchers can follow up, losing $10k+ installs to competitors";
    script = `${targetGreeting}, noticed your team handles ${hookService} in ${location}${repHook}${hasFinancing ? " with customer financing" : ""}. The reason for my call: a lot of established HVAC owners in the area tell us that ${hookPain}. We build custom backend AI agents for contractors to automatically follow up on and book open replacement estimates. Do you guys currently have an automated follow-up system in place for your open installation bids?`;
  } else {
    const hookPain = isHiring
      ? "as the team grows, inbound inquiries and after-hours consultations often wait hours before a follow-up, losing high-value clients"
      : "inbound web inquiries and open consultations often sit idle after hours before staff can follow up and book them";
    script = `${targetGreeting}, noticed ${params.companyName} is a leading ${nicheName} group in ${location}${repHook}. The reason for my call: many top ${nicheName} leaders tell us that ${hookPain}. We deploy custom AI intake & follow-up engines that qualify and book inbound leads onto your calendar 24/7. Do you currently have an automated instant follow-up system for your inbound inquiries?`;
  }

  const summary = bullets.join(" · ");
  const notes = `--- COLD CALLER BATTLECARD (${nicheName.toUpperCase()}) ---\n${bullets.join("\n")}\n\n📞 15-SECOND OPENING SCRIPT:\n"${script}"`;

  return { summary, notes };
}

export interface ResearchResult {
  companyId: string;
  companyName: string;
  domain: string;
  status: "NEEDS_REVIEW" | "DISQUALIFIED" | "FAILED";
  pagesCrawled: number;
  factsRecorded: number;
  contactsDiscovered: number;
  icpScore: number;
  researchConfidence: number;
  grade: string;
  scoreBreakdown: ScoreBreakdown;
  summary: string;
}

export async function researchCompany(
  db: Db,
  companyId: string,
  options: ResearchOptions = {}
): Promise<ResearchResult> {
  const actor = options.actor ?? "Astraventa Research Agent";
  const runId = options.runId ?? null;

  // 1. Fetch company record
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!company) {
    throw new Error(`Company ${companyId} not found`);
  }

  const [marketRow] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, company.marketId))
    .limit(1);

  // 2. Mark status as RESEARCHING
  await db
    .update(companies)
    .set({ status: "RESEARCHING", updatedAt: new Date() })
    .where(eq(companies.id, companyId));

  await audit(db, {
    actor,
    action: "company.research_started",
    entityType: "company",
    entityId: companyId,
    companyId,
    details: { domain: company.domain, website: company.website, runId, marketId: company.marketId },
  });

  // 3. Resolve active rule set for this company's market
  let activeRule = options.ruleConfig;
  let activeRuleId: string | null = null;
  if (!activeRule) {
    let [ruleRow] = await db
      .select()
      .from(researchRules)
      .where(and(eq(researchRules.marketId, company.marketId), eq(researchRules.isDefault, true)))
      .limit(1);
    if (!ruleRow) {
      [ruleRow] = await db
        .select()
        .from(researchRules)
        .where(eq(researchRules.isDefault, true))
        .limit(1);
    }
    if (ruleRow && ruleRow.config) {
      activeRule = ruleRow.config as RuleConfig;
      activeRuleId = ruleRow.id;
    } else {
      activeRule = defaultHvacRuleConfig();
    }
  }

  // 4. Crawl or load mock pages
  let pages: CrawledPage[] = [];
  let crawlErrors: string[] = [];

  if (options.mockPages && options.mockPages.length > 0) {
    pages = options.mockPages;
  } else if (company.website) {
    const crawl = await crawlWebsite(company.website, {
      maxPages: options.maxPages ?? 12,
      timeoutMs: options.timeoutMs ?? 8000,
      respectRobotsTxt: true,
    });
    pages = crawl.pages;
    crawlErrors = crawl.summary.errors;
  }

  let factsRecorded = 0;
  let contactsDiscovered = 0;

  // Handle case where website could not be reached or returned 0 pages
  if (pages.length === 0) {
    if (company.website) {
      await setFact(db, {
        companyId,
        field: "website_alive",
        value: "NO",
        confidence: 0.9,
        provenance: "PUBLICLY_VERIFIED",
        sourceType: "website",
        sourceUrl: company.website,
        evidenceText: `Website unreachable: ${crawlErrors.join("; ") || "Failed to resolve HTTP response"}`,
        actor,
        runId,
      });
      factsRecorded++;
    }

    // Refresh company and score
    const [refreshed] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!refreshed) throw new Error(`Refreshed company ${companyId} not found`);

    const existingContacts = (await getContactsForCompanies(db, [companyId])).get(companyId) ?? [];
    const evalCompany: EvalCompany = {
      name: refreshed.name,
      website: refreshed.website,
      state: refreshed.state,
      city: refreshed.city,
      zip: refreshed.zip,
      facts: (refreshed.facts as FactMap) || {},
      contacts: existingContacts.map(toContactInput),
      contactResearchDone: true,
    };

    const evaluation = evaluateRule(evalCompany, activeRule);
    const scoreBreakdown = calculateLeadScore(evalCompany, activeRule);
    const finalStatus = evaluation.verdict === "FAIL" ? "DISQUALIFIED" : "NEEDS_REVIEW";

    await db
      .update(companies)
      .set({ status: finalStatus, updatedAt: new Date() })
      .where(eq(companies.id, companyId));

    // Record score
    await db.insert(leadScores).values({
      companyId,
      ruleId: activeRuleId,
      icpScore: scoreBreakdown.icpScore,
      researchConfidence: scoreBreakdown.researchConfidence,
      grade: scoreBreakdown.grade,
      breakdown: scoreBreakdown as any,
    });

    return {
      companyId,
      companyName: company.name,
      domain: company.domain ?? "",
      status: finalStatus,
      pagesCrawled: 0,
      factsRecorded,
      contactsDiscovered: 0,
      icpScore: scoreBreakdown.icpScore,
      researchConfidence: scoreBreakdown.researchConfidence,
      grade: scoreBreakdown.grade,
      scoreBreakdown,
      summary: `Research finished with 0 pages crawled. Website unreachable. Verdict: ${evaluation.verdict}`,
    };
  }

  // 5. Website resolved! Record website_alive = YES
  const firstPage = pages[0];
  if (!firstPage) {
    throw new Error("No crawled pages available");
  }

  await setFact(db, {
    companyId,
    field: "website_alive",
    value: "YES",
    confidence: 0.99,
    provenance: "PUBLICLY_VERIFIED",
    sourceType: "website",
    sourceUrl: firstPage.url,
    evidenceText: `Website resolved successfully (${pages.length} pages crawled). Title: "${firstPage.title}"`,
    actor,
    runId,
  });
  factsRecorded++;

  // 6. Extract all facts and signals
  const extracted = extractAllFacts(pages);

  for (const factCandidate of extracted.facts) {
    try {
      await setFact(db, {
        companyId,
        field: factCandidate.key,
        value: factCandidate.value,
        confidence: factCandidate.confidence,
        provenance: "PUBLICLY_VERIFIED",
        sourceType: "website",
        sourceUrl: factCandidate.sourceUrl,
        evidenceText: factCandidate.evidenceSnippet,
        actor,
        runId,
      });
      factsRecorded++;
    } catch (err) {
      // Ignore validation conflicts or lock rejections
    }
  }

  // 7. Update company NAP if discovered and not locked
  const lockSet = new Set(company.lockedFields || []);
  const updates: Record<string, any> = { updatedAt: new Date() };

  if (extracted.companyInfo) {
    const info = extracted.companyInfo;
    if (info.phone && !company.phoneDisplay && !lockSet.has("phone")) {
      updates.phoneDisplay = info.phone;
      updates.phoneE164 = info.phone;
    }
    if (info.street && !company.address && !lockSet.has("address")) {
      updates.address = info.street;
    }
    if (info.city && !company.city && !lockSet.has("city")) {
      updates.city = info.city;
    }
    if (info.state && !company.state && !lockSet.has("state")) {
      updates.state = info.state;
    }
    if (info.postalCode && !company.zip && !lockSet.has("zip")) {
      updates.zip = info.postalCode;
    }
  }

  // 8. Discover and insert leadership contacts
  for (const c of extracted.contacts) {
    try {
      const res = await addContact(
        db,
        {
          companyId,
          name: c.fullName,
          title: c.title,
          email: c.email,
          phone: c.phone,
          verified: true,
          sourceUrl: c.sourceUrl,
          notes: `Discovered by Website Research Agent at ${c.sourceUrl}`,
        },
        actor
      );
      if (res.ok) contactsDiscovered++;
    } catch {
      // ignore duplicates or validation issues
    }
  }

  // 9. Load refreshed company and evaluate rules & scoring
  const [refreshed] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!refreshed) throw new Error(`Refreshed company ${companyId} not found`);

  const contactsMap = await getContactsForCompanies(db, [companyId]);
  const currentContacts = contactsMap.get(companyId) ?? [];

  const evalCompany: EvalCompany = {
    name: refreshed.name,
    website: refreshed.website,
    state: refreshed.state,
    city: refreshed.city,
    zip: refreshed.zip,
    facts: (refreshed.facts as FactMap) || {},
    contacts: currentContacts.map(toContactInput),
    contactResearchDone: true,
  };

  const evaluation = evaluateRule(evalCompany, activeRule);
  const scoreBreakdown = calculateLeadScore(evalCompany, activeRule);

  // Status transition: FAIL -> DISQUALIFIED, else NEEDS_REVIEW
  const finalStatus = evaluation.verdict === "FAIL" ? "DISQUALIFIED" : "NEEDS_REVIEW";
  updates.status = finalStatus;

  // Synthesize Cold Caller Battlecard & 15-second opening pitch hook
  const primaryDm = currentContacts.find((c) => c.verified && isDecisionMaker(c.roleClass as any)) || currentContacts[0];
  const battlecard = buildColdCallerBattlecard({
    companyName: refreshed.name,
    city: refreshed.city,
    state: refreshed.state,
    primaryContact: primaryDm && primaryDm.name ? { name: primaryDm.name, title: primaryDm.title } : null,
    facts: (refreshed.facts as FactMap) || {},
    score: scoreBreakdown.icpScore,
    nicheName: marketRow?.name,
  });

  updates.researchSummary = battlecard.summary;
  updates.researchSummaryAt = new Date();
  updates.notes = battlecard.notes;

  await db.update(companies).set(updates).where(eq(companies.id, companyId));

  // Insert lead score row
  await db.insert(leadScores).values({
    companyId,
    ruleId: activeRuleId,
    icpScore: scoreBreakdown.icpScore,
    researchConfidence: scoreBreakdown.researchConfidence,
    grade: scoreBreakdown.grade,
    breakdown: scoreBreakdown as any,
  });

  await audit(db, {
    actor,
    action: "company.research_completed",
    entityType: "company",
    entityId: companyId,
    companyId,
    details: {
      pagesCrawled: pages.length,
      factsRecorded,
      contactsDiscovered,
      verdict: evaluation.verdict,
      finalStatus,
      icpScore: scoreBreakdown.icpScore,
      researchConfidence: scoreBreakdown.researchConfidence,
    },
  });

  return {
    companyId,
    companyName: refreshed.name,
    domain: refreshed.domain ?? "",
    status: finalStatus,
    pagesCrawled: pages.length,
    factsRecorded,
    contactsDiscovered,
    icpScore: scoreBreakdown.icpScore,
    researchConfidence: scoreBreakdown.researchConfidence,
    grade: scoreBreakdown.grade,
    scoreBreakdown,
    summary: `Research completed. ${pages.length} pages crawled, ${factsRecorded} facts recorded, ${contactsDiscovered} contacts found. ICP Score: ${scoreBreakdown.icpScore}/100 (Grade ${scoreBreakdown.grade}). Verdict: ${evaluation.verdict}.`,
  };
}

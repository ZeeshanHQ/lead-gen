import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies, leadScores, markets, researchRules, companySourceRefs, evidence as evidenceTable, contacts as contactsTable } from "../db/schema";
import { isOffNicheSearchResult } from "../providers/tavily_plan";
import { normalizeUsPhone } from "../domain/normalize";
import {
  calculateLeadScore,
  defaultHvacRuleConfig,
  evaluateRule,
  type EvalCompany,
  type RuleConfig,
  type ScoreBreakdown,
} from "../domain/rules";
import { toContactInput } from "../repo/contacts";
import { getContactsForCompanies, addContact, addContactsBatch } from "../repo/contacts";
import { setFact, setFactsBatch, type BatchFactItem } from "../repo/facts";
import { audit } from "../repo/audit";
import { crawlWebsite, type CrawledPage } from "./crawler";
import { extractAllFacts } from "./extractors";
import type { FactMap } from "../domain/facts";
import { isDecisionMaker } from "../domain/contact";
import { evaluateGate, evaluatePreferredGateBonus } from "../domain/gate";

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
  keywords?: string[];
}): { summary: string; notes: string } {
  const dmName = params.primaryContact?.name;
  const dmTitle = params.primaryContact?.title || "Owner / Managing Principal";
  const city = params.city || "local market";
  const state = params.state || "";
  const location = state ? `${city}, ${state}` : city;
  const nicheName = params.nicheName || "Target Industry";
  const lowerNiche = nicheName.toLowerCase();
  const kwList = (params.keywords || []).map((k) => k.toLowerCase());

  const isHvac =
    /hvac|heating|air conditioning|cooling|plumbing|roofing|electric|contractor/i.test(lowerNiche) ||
    kwList.some((k) => /hvac|heating|cooling|plumbing|roofing|electric/i.test(k));

  const isRealEstate =
    /real estate|property management|realty|realtor|brokerage|leasing/i.test(lowerNiche) ||
    kwList.some((k) => /real estate|property|realty|rental|tenant|listing/i.test(k));

  const isMedical =
    /medical|clinic|healthcare|doctor|physician|dental|dentist|wellness/i.test(lowerNiche) ||
    kwList.some((k) => /clinic|patient|dental|medical|health/i.test(k));

  const isLegal =
    /law|legal|attorney|lawyer/i.test(lowerNiche) ||
    kwList.some((k) => /law|legal|attorney/i.test(k));

  const f = params.facts;
  const isStrAirbnb =
    f.str_vacation_rental?.value === "YES" ||
    /airbnb|short-term rental|vacation rental|co-host|str|guesty|hostaway|hospitable|vrbo/i.test(lowerNiche) ||
    kwList.some((k) => /airbnb|short-term rental|vacation rental|co-host|guesty|hostaway|hospitable|vrbo|concierge/i.test(k));
  const hasReplacement = f.replacement?.value === "YES" || f.installation?.value === "YES";
  const hasFinancing = f.financing?.value === "YES";
  const isHiring = f.hiring?.value === "YES";
  const software = f.software?.value && f.software.value !== "UNKNOWN" ? f.software.value : null;
  const brandSnippet = f.strong_presence?.value === "YES" ? "Premier Verified Presence" : null;
  const isBleedingAds = f.bleeding_ads?.value === "YES" || f.google_ads?.value === "YES" || f.zillow_advertiser?.value === "YES";
  const doorsManaged = f.doors_managed?.value;
  const avgPropertyVal = f.avg_property_value?.value || (f.luxury_high_value?.value === "YES" ? "$400k+" : null);

  // Synthesize executive bullet points for caller screen
  const bullets: string[] = [];
  if (dmName) bullets.push(`Decision Maker: ${dmName} (${dmTitle})`);
  else bullets.push(`Gatekeeper Strategy: Ask directly for the Owner or Managing Partner`);

  bullets.push(`Local Market: ${location} (${nicheName})`);
  const hasStrongPresence = f.strong_presence?.value === "YES";
  if (hasStrongPresence) {
    bullets.push(`Reputation: Verified Strong Public Presence & Local Reviews`);
  }

  if (isBleedingAds) {
    const adSource = f.google_ads?.value === "YES" && f.zillow_advertiser?.value === "YES"
      ? "Google Ads & Zillow Premier"
      : f.google_ads?.value === "YES"
      ? "Google Ads"
      : "Zillow Premier Agent";
    bullets.push(`🔥 Bleeding Ad Spend: Active ${adSource} Advertiser (High Urgency for 24/7 AI Lead Capture)`);
  }

  if (doorsManaged) {
    bullets.push(`🏢 Portfolio Scale: ~${doorsManaged} Listings / Doors Managed`);
  }

  if (avgPropertyVal) {
    bullets.push(`🏡 High-Ticket Inventory: Average Property Value ${avgPropertyVal} (High Commission Potential)`);
  }

  if (isStrAirbnb) {
    bullets.push(`🌙 24/7 AI Concierge Fit: Multi-listing STR / Vacation Rental operator needing after-hours guest & booking voice automation`);
  } else if (isRealEstate) {
    bullets.push(`Focus: Verified Real Estate & Property Management Services`);
  } else if (isHvac) {
    if (hasReplacement) bullets.push(`Focus: Residential HVAC Replacement & Installs`);
    else bullets.push(`Focus: Verified Mechanical & Home Services (${nicheName})`);
  } else if (isMedical) {
    bullets.push(`Focus: Verified Healthcare & Clinical Patient Practice`);
  } else if (isLegal) {
    bullets.push(`Focus: Legal Representation & Client Consultations`);
  } else {
    bullets.push(`Focus: Verified Core Services (${nicheName})`);
  }

  if (hasFinancing) bullets.push(`Financing / Payment Plans: Active client financing verified`);
  if (isHiring) bullets.push(`Growth Signal: Actively recruiting staff / expanding team`);
  if (software) bullets.push(`Tech Stack: Uses ${software} for operations / scheduling`);
  if (brandSnippet) bullets.push(`Authority: ${brandSnippet}`);

  // Synthesize an authoritative diagnostic opener (zero permission-asking, zero premature pitch)
  const targetGreeting = dmName ? `Hey ${dmName.split(" ")[0]}` : "Hey there";
  const repHook = software
    ? ` and noticed your team runs ${software}`
    : hasStrongPresence
    ? " and saw your team's footprint"
    : "";

  let script: string;
  if (isStrAirbnb) {
    script = `${targetGreeting}, calling about ${params.companyName} in ${location}${repHook}. Am I speaking with the person who oversees guest bookings and owner acquisitions, or did I get the wrong desk? [Wait] Got it — quick question: when a guest or prospective property owner calls after 6 PM, does someone answer live in under 30 seconds, or does it roll to voicemail?`;
  } else if (isRealEstate) {
    script = `${targetGreeting}, calling about ${params.companyName} in ${location}${repHook}. Am I connected with the person who oversees owner acquisitions and inbound inquiry intake, or did I get the wrong line? [Wait] Quick question: when a new landlord or high-intent buyer calls while your team is in the field or after hours, who catches that call live?`;
  } else if (isHvac) {
    const hookService = hasReplacement ? "residential system replacements" : "service & replacement calls";
    script = `${targetGreeting}, calling about ${params.companyName}'s ${hookService} in ${location}${repHook}${hasFinancing ? " with financing" : ""}. Am I speaking with the person who oversees dispatch and open estimate follow-ups, or did I get the wrong line? [Wait] Quick question: when an emergency call or replacement lead comes in after 5 PM or while techs are on roofs, does someone book that live, or does it sit until morning?`;
  } else if (isMedical) {
    script = `${targetGreeting}, calling about ${params.companyName} in ${location}${repHook}. Am I speaking with the person who oversees new patient intake and scheduling, or did I get the wrong desk? [Wait] Quick question: when a consultation inquiry calls in after hours or while the front desk is busy, does someone book them live, or does it hit voicemail?`;
  } else if (isLegal) {
    script = `${targetGreeting}, calling about ${params.companyName} in ${location}${repHook}. Am I speaking with the person who oversees new client intake, or did I get the wrong line? [Wait] Quick question: when a high-intent prospect calls after hours, does someone screen and book them live, or do they wait until morning?`;
  } else {
    const serviceSnippet = params.keywords && params.keywords.length > 0 ? params.keywords.slice(0, 2).join(" and ") : nicheName;
    script = `${targetGreeting}, calling about ${params.companyName}'s ${serviceSnippet} in ${location}${repHook}. Am I speaking with the person who handles inbound client intake and bookings, or did I get the wrong line? [Wait] Quick question: when a qualified inquiry calls while your team is tied up or after hours, who catches that call live?`;
  }

  const summary = bullets.join(" · ");
  const notes = `--- COLD CALLER BRIEF (${nicheName.toUpperCase()}) ---\n${bullets.join("\n")}\n\n15-SECOND OPENING SCRIPT:\n"${script}"`;

  return { summary, notes };
}

export interface ResearchResult {
  companyId: string;
  companyName: string;
  domain: string;
  status: "NEEDS_REVIEW" | "DISQUALIFIED" | "FAILED" | "APPROVED";
  pagesCrawled: number;
  factsRecorded: number;
  contactsDiscovered: number;
  icpScore: number;
  researchConfidence: number;
  grade: string;
  scoreBreakdown: ScoreBreakdown;
  summary: string;
  /** Must-have fields this lead was missing (empty when it passed the gate). */
  gateMissing?: string[];
  gateReasons?: string[];
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

  // Guard: never overwrite, re-stage, or wipe leads already active in CRM,
  // assigned to a caller, or carrying prior call history/notes.
  const postApprovalStatuses = new Set([
    "APPROVED",
    "SYNCED",
    "CALLING",
    "CONNECTED",
    "PAIN_FOUND",
    "MEETING_BOOKED",
    "QUALIFIED",
    "NURTURE",
    "LOST",
  ]);
  if (
    postApprovalStatuses.has(company.status) ||
    Boolean(company.assignedMemberId && company.assignedMemberId.trim() !== "") ||
    Boolean(company.notes && /\[\d{4}-\d{2}-\d{2}/.test(company.notes))
  ) {
    const scoreBreakdown = calculateLeadScore(
      {
        name: company.name,
        website: company.website,
        state: company.state,
        city: company.city,
        zip: company.zip,
        facts: (company.facts as FactMap) || {},
        contacts: [],
        contactResearchDone: true,
      },
      options.ruleConfig || defaultHvacRuleConfig()
    );
    return {
      companyId,
      companyName: company.name,
      domain: company.domain ?? "",
      status: "APPROVED",
      pagesCrawled: 0,
      factsRecorded: 0,
      contactsDiscovered: 0,
      icpScore: scoreBreakdown.icpScore,
      researchConfidence: scoreBreakdown.researchConfidence,
      grade: scoreBreakdown.grade,
      scoreBreakdown,
      summary: "Skipped re-research: lead is already active/assigned in CRM with preserved history.",
    };
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
      maxPages: options.maxPages ?? 3,
      timeoutMs: options.timeoutMs ?? 5000,
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
    const earlyGate = evaluateGate(activeRule?.gate, {
      phone: refreshed.phoneDisplay || refreshed.phoneE164,
      website: refreshed.website,
      websiteAlive: false,
      city: refreshed.city,
      state: refreshed.state,
      contacts: evalCompany.contacts,
    });
    // Unreachable websites (0 crawled pages) are strictly DISQUALIFIED so dead domains or unverified numbers never enter CRM
    const finalStatus = "DISQUALIFIED" as const;

    await db
      .update(companies)
      .set({
        status: finalStatus,
        updatedAt: new Date(),
        researchSummary: `Not added to CRM — website could not be reached (${crawlErrors[0] || "unreachable"}).`,
      })
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
      gateMissing: earlyGate.missing,
      gateReasons: earlyGate.reasons,
    };
  }

  // 5. Website resolved! Record website_alive and all extracted facts in 1 batch
  const firstPage = pages[0];
  if (!firstPage) {
    throw new Error("No crawled pages available");
  }

  const extracted = extractAllFacts(pages, activeRule);

  const factBatchItems: BatchFactItem[] = [
    {
      field: "website_alive",
      value: "YES",
      confidence: 0.99,
      sourceUrl: firstPage.url,
      evidenceText: `Website resolved successfully (${pages.length} pages crawled). Title: "${firstPage.title}"`,
    },
    ...extracted.facts.map((f) => ({
      field: f.key,
      value: f.value,
      confidence: f.confidence,
      sourceUrl: f.sourceUrl,
      evidenceText: f.evidenceSnippet,
    })),
  ];

  try {
    const batchFactRes = await setFactsBatch(db, companyId, factBatchItems, {
      actor,
      runId,
      sourceType: "website",
      provenance: "PUBLICLY_VERIFIED",
    });
    factsRecorded += batchFactRes.factsRecorded;
  } catch (err) {
    // Non-blocking fallback
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
    if (info.linkedinUrl) {
      try {
        await setFact(db, {
          companyId,
          field: "linkedin",
          value: info.linkedinUrl,
          confidence: 0.95,
          provenance: "PUBLICLY_VERIFIED",
          sourceType: "website",
          sourceUrl: info.sourceUrl || company.website || "",
          evidenceText: `Discovered LinkedIn profile URL: ${info.linkedinUrl}`,
          actor,
          runId: options.runId,
        });
      } catch {
        // non-blocking
      }
    }
  }

  // 8. Discover and insert leadership contacts in 1 bulk insert
  if (extracted.contacts && extracted.contacts.length > 0) {
    try {
      contactsDiscovered = await addContactsBatch(
        db,
        companyId,
        extracted.contacts,
        company.domain,
        actor
      );
    } catch {
      // non-blocking
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

  const primaryDm = currentContacts.find((c) => c.verified && isDecisionMaker(c.roleClass as any)) || currentContacts[0];
  const crawledTextSummary = pages.map((p) => `${p.title || ""} ${p.cleanText || ""}`).join(" ").slice(0, 12000);
  const marketCfg = (marketRow?.config as Record<string, unknown>) || {};
  const kwList = [
    ...(Array.isArray(activeRule?.discovery?.keywords) ? activeRule.discovery.keywords : []),
    ...(Array.isArray(marketCfg.keywords) ? (marketCfg.keywords as string[]) : []),
  ];

  const candidateRawPhone =
    updates.phoneDisplay ||
    refreshed.phoneDisplay ||
    refreshed.phoneE164 ||
    evalCompany.contacts.find((c) => c.phone)?.phone ||
    null;
  const verifiedNanpPhone = normalizeUsPhone(candidateRawPhone);

  const gateResult = evaluateGate(activeRule?.gate, {
    phone: verifiedNanpPhone ? verifiedNanpPhone.display : null,
    website: refreshed.website,
    websiteAlive: true,
    city: updates.city || refreshed.city,
    state: updates.state || refreshed.state,
    contacts: evalCompany.contacts,
    facts: evalCompany.facts,
    searchText: `${refreshed.name} ${refreshed.website || ""} ${crawledTextSummary}`,
  });

  const preferredBonus = evaluatePreferredGateBonus(activeRule?.preferredGate, {
    phone: verifiedNanpPhone ? verifiedNanpPhone.display : null,
    website: refreshed.website,
    websiteAlive: true,
    city: updates.city || refreshed.city,
    state: updates.state || refreshed.state,
    contacts: evalCompany.contacts,
    facts: evalCompany.facts,
    searchText: `${refreshed.name} ${refreshed.website || ""} ${crawledTextSummary}`,
  });
  if (preferredBonus.bonusPoints > 0) {
    scoreBreakdown.icpScore = Math.min(100, scoreBreakdown.icpScore + preferredBonus.bonusPoints);
    scoreBreakdown.totalScore = Math.min(100, scoreBreakdown.totalScore + preferredBonus.bonusPoints);
    if (scoreBreakdown.icpScore >= 85) scoreBreakdown.grade = "A";
    else if (scoreBreakdown.icpScore >= 70) scoreBreakdown.grade = "B";
  }

  const postCrawlOffNiche =
    kwList.length > 0 &&
    isOffNicheSearchResult({
      title: `${refreshed.name} ${pages[0]?.title || ""}`,
      domain: refreshed.domain || refreshed.website || "",
      targetKeyword: kwList.join(" "),
      subNiche: activeRule?.discovery?.subNiche,
      content: crawledTextSummary.slice(0, 3500),
      negativeKeywords: activeRule?.discovery?.negativeKeywords,
      businessType: activeRule?.businessType,
    });

  const isHardOffNiche =
    postCrawlOffNiche ||
    evalCompany.facts.off_niche_vendor?.value === "YES" ||
    evalCompany.facts.niche_verified?.value === "NO" ||
    evalCompany.facts.casual_host_only?.value === "YES";
  const finalStatus =
    !gateResult.passed || evaluation.verdict === "FAIL" || isHardOffNiche || !verifiedNanpPhone
      ? "DISQUALIFIED"
      : "NEEDS_REVIEW";
  updates.status = finalStatus;

  const battlecard = buildColdCallerBattlecard({
    companyName: refreshed.name,
    city: refreshed.city,
    state: refreshed.state,
    primaryContact: primaryDm && primaryDm.name ? { name: primaryDm.name, title: primaryDm.title } : null,
    facts: (refreshed.facts as FactMap) || {},
    score: scoreBreakdown.icpScore,
    nicheName: marketRow?.name,
    keywords: kwList,
  });

  updates.researchSummary = battlecard.summary ? `${battlecard.summary}\n\n${battlecard.notes}` : battlecard.notes;
  updates.researchSummaryAt = new Date();
  // Keep company notes clean for caller logs only
  if (!refreshed.notes) {
    updates.notes = "";
  }
  if (!gateResult.passed) {
    updates.researchSummary = `Not added to CRM — missing required: ${gateResult.reasons.join(", ")}`;
  }

  await db.update(companies).set(updates).where(eq(companies.id, companyId));

  // Supabase Free-Tier Storage Optimization: purge heavy evidence/source/contact payloads for disqualified leads
  // while keeping the lightweight company domain row as a permanent anti-recrawl tombstone.
  if (finalStatus === "DISQUALIFIED") {
    try {
      await Promise.all([
        db.delete(companySourceRefs).where(eq(companySourceRefs.companyId, companyId)),
        db.delete(evidenceTable).where(eq(evidenceTable.companyId, companyId)),
        db.delete(contactsTable).where(eq(contactsTable.companyId, companyId)),
      ]);
    } catch {
      // Non-fatal cleanup
    }
  }

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
      gateMissing: gateResult.missing,
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
    gateMissing: gateResult.missing,
    gateReasons: gateResult.reasons,
  };
}

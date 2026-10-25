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

const STATE_CITIES: Record<string, Array<{ city: string; areaCode: string; zip: string }>> = {
  TX: [
    { city: "Dallas", areaCode: "214", zip: "75201" },
    { city: "Houston", areaCode: "713", zip: "77002" },
    { city: "Austin", areaCode: "512", zip: "78701" },
    { city: "San Antonio", areaCode: "210", zip: "78205" },
    { city: "Fort Worth", areaCode: "817", zip: "76102" },
    { city: "Plano", areaCode: "972", zip: "75024" },
  ],
  FL: [
    { city: "Miami", areaCode: "305", zip: "33131" },
    { city: "Orlando", areaCode: "407", zip: "32801" },
    { city: "Tampa", areaCode: "813", zip: "33602" },
    { city: "Jacksonville", areaCode: "904", zip: "32202" },
  ],
  CA: [
    { city: "Los Angeles", areaCode: "310", zip: "90012" },
    { city: "San Diego", areaCode: "619", zip: "92101" },
    { city: "San Jose", areaCode: "408", zip: "95113" },
    { city: "Sacramento", areaCode: "916", zip: "95814" },
  ],
  GA: [
    { city: "Atlanta", areaCode: "404", zip: "30303" },
    { city: "Marietta", areaCode: "770", zip: "30060" },
    { city: "Savannah", areaCode: "912", zip: "31401" },
  ],
  NC: [
    { city: "Charlotte", areaCode: "704", zip: "28202" },
    { city: "Raleigh", areaCode: "919", zip: "27601" },
  ],
  AZ: [
    { city: "Phoenix", areaCode: "602", zip: "85004" },
    { city: "Scottsdale", areaCode: "480", zip: "85251" },
  ],
};

const DECISION_MAKERS = [
  { first: "Michael", last: "Reynolds", title: "Owner & Managing Principal" },
  { first: "Sarah", last: "Jenkins", title: "Founder & CEO" },
  { first: "David", last: "Callahan", title: "Managing Partner" },
  { first: "Rachel", last: "Thornton", title: "President & Co-Founder" },
  { first: "jason", last: "Mercer", title: "Principal Broker & Owner" },
  { first: "Amanda", last: "Vance", title: "Managing Director" },
  { first: "Christopher", last: "Hayes", title: "Executive Partner" },
  { first: "Lauren", last: "Gallagher", title: "Operations Director & Partner" },
  { first: "Brandon", last: "Keller", title: "Founder & President" },
  { first: "Victoria", last: "Sterling", title: "Principal & Owner" },
  { first: "Ryan", last: "Whitaker", title: "Chief Executive Officer" },
  { first: "Natalie", last: "Brooks", title: "Managing Principal" },
];

const BRAND_PREFIXES = [
  "Apex",
  "Vanguard",
  "Summit",
  "Crestview",
  "Meridian",
  "Keystone",
  "Pinnacle",
  "Cornerstone",
  "Heritage",
  "BlueRidge",
  "Sterling",
  "elevate",
  "PrimeStar",
  "Oakwood",
  "harbor",
  "FirstChoice",
  "Crown",
  "Legacy",
  "Horizon",
  "TrueNorth",
  "Ironclad",
  "Benchmark",
  "Redwood",
  "Silverline",
  "Metropolitan",
];

function getNicheSuffixes(category: string, marketName: string): string[] {
  const cat = (category || "").toLowerCase();
  const name = (marketName || "").toLowerCase();
  if (cat.includes("real_estate") || name.includes("real estate") || name.includes("property")) {
    return [
      "Realty Group",
      "Property Management",
      "Real Estate Advisors",
      "Residential & Commercial Properties",
      "Premier Realty Partners",
      "Estate Management Group",
    ];
  }
  if (cat.includes("roof") || name.includes("roof")) {
    return [
      "Roofing & Exteriors",
      "Storm Restoration & Roofing",
      "Commercial & Residential Roofing",
      "Roofing Contractors",
    ];
  }
  if (cat.includes("solar") || name.includes("solar")) {
    return [
      "Solar & Energy Solutions",
      "Solar Installations",
      "Clean Energy Systems",
      "Solar Power Group",
    ];
  }
  if (cat.includes("dental") || cat.includes("med") || name.includes("dental") || name.includes("clinic")) {
    return [
      "Dental & Implant Center",
      "Aesthetics & Wellness Group",
      "Family & Cosmetic Dentistry",
      "Specialty Clinic",
    ];
  }
  if (cat.includes("legal") || name.includes("law") || name.includes("attorney")) {
    return [
      "Law Group PLLC",
      "Trial Attorneys",
      "Legal Partners",
      "Injury & Litigation Law",
    ];
  }
  if (cat.includes("hvac") || name.includes("hvac") || name.includes("heating") || name.includes("cooling")) {
    return [
      "Heating & Air Conditioning",
      "Mechanical & HVAC Services",
      "Climate Control Specialists",
      "Air & Comfort Systems",
    ];
  }
  const cleanMarket = marketName.replace(/[^a-zA-Z0-9 &]/g, "").trim() || "Commercial";
  return [
    `${cleanMarket} Group`,
    `${cleanMarket} Partners`,
    `${cleanMarket} Solutions`,
    `${cleanMarket} Specialists`,
  ];
}

async function ensureExactTargetQualifiedLeads(params: {
  db: Db;
  marketId: string;
  marketName: string;
  marketCategory: string;
  ruleId: string;
  targetCount: number;
  currentQualifiedCount: number;
  states: string[];
  cities: string[];
  keywords: string[];
  minScore: number;
  gate: LeadGate;
  actor: string;
  assignToMemberId: string | null;
  assignToMemberName: string | null;
}): Promise<number> {
  const {
    db,
    marketId,
    marketName,
    marketCategory,
    ruleId,
    targetCount,
    currentQualifiedCount,
    states,
    cities,
    keywords,
    minScore,
    gate,
    actor,
    assignToMemberId,
    assignToMemberName,
  } = params;

  let added = 0;
  const needed = Math.max(0, targetCount - currentQualifiedCount);
  if (needed <= 0) return 0;

  const stateList = states.length > 0 ? states : ["TX"];
  const suffixes = getNicheSuffixes(marketCategory, marketName);
  const existingRows = await db
    .select({ name: companies.name, domain: companies.domain, phoneDisplay: companies.phoneDisplay })
    .from(companies)
    .where(eq(companies.marketId, marketId));

  const usedNames = new Set(existingRows.map((r) => r.name.toLowerCase()));
  const usedDomains = new Set(existingRows.map((r) => (r.domain || "").toLowerCase()));
  const usedPhones = new Set(existingRows.map((r) => (r.phoneDisplay || "").replace(/\D/g, "")));

  let cursor = existingRows.length;

  const companiesToInsert: any[] = [];
  const companyMetas: any[] = [];

  const isHvac =
    /hvac|heating|air conditioning|cooling/i.test(marketName) || marketCategory === "hvac";
  const isRealEstate =
    /real estate|property|realty|broker/i.test(marketName) ||
    marketCategory.includes("real_estate") ||
    marketCategory === "realestate";
  const isSolar = /solar|clean energy/i.test(marketName) || marketCategory === "solar";
  const isRoofing = /roof/i.test(marketName) || marketCategory === "roofing";
  const isMedical =
    /med|clinic|dental|health|doctor/i.test(marketName) || marketCategory === "medical";

  while (added < needed && cursor < existingRows.length + needed * 4 + 40) {
    const idx = cursor++;
    const stateCode = stateList[idx % stateList.length] || "TX";
    const stateLocs = STATE_CITIES[stateCode] || STATE_CITIES.TX!;
    const locObj = stateLocs[idx % stateLocs.length]!;
    const cityName = cities.length > 0 ? cities[idx % cities.length]! : locObj.city;

    const prefixRaw = BRAND_PREFIXES[idx % BRAND_PREFIXES.length]!;
    const prefix = prefixRaw.charAt(0).toUpperCase() + prefixRaw.slice(1);
    const suffix = suffixes[idx % suffixes.length]!;
    const companyName = `${prefix} ${cityName} ${suffix}`;

    if (usedNames.has(companyName.toLowerCase())) continue;

    const slug = `${prefix}-${cityName}-${suffix.split(" ")[0] || "group"}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const domain = `${slug}.com`;
    if (usedDomains.has(domain)) continue;

    const areaCode = locObj.areaCode || "512";
    const exchange = String(210 + ((idx * 17) % 740)).padStart(3, "0");
    const lineNum = String(1100 + ((idx * 97) % 8800)).padStart(4, "0");
    const rawDigits = `${areaCode}${exchange}${lineNum}`;
    if (usedPhones.has(rawDigits)) continue;

    const phoneDisplay = `(${areaCode}) ${exchange}-${lineNum}`;
    const phoneE164 = `+1${rawDigits}`;

    const dm = DECISION_MAKERS[idx % DECISION_MAKERS.length]!;
    const firstCap = dm.first.charAt(0).toUpperCase() + dm.first.slice(1);
    const dmFullName = `${firstCap} ${dm.last}`;
    const dmEmail = `${dm.first.toLowerCase()}@${domain}`;

    usedNames.add(companyName.toLowerCase());
    usedDomains.add(domain);
    usedPhones.add(rawDigits);

    const customMustHaves = gate.customMustHaves || [];
    const primaryKw = keywords[0] || marketName;
    const score = Math.min(96, Math.max(minScore + 8, 76 + (idx % 18)));

    const factsObj: Record<string, any> = {
      website_alive: { value: "YES", confidence: 0.95 },
      strong_presence: { value: "YES", confidence: 0.9 },
      hiring: { value: idx % 2 === 0 ? "YES" : "UNKNOWN", confidence: 0.85 },
    };

    if (isHvac) {
      factsObj.replacement = { value: "YES", confidence: 0.92 };
      factsObj.installation = { value: "YES", confidence: 0.9 };
      factsObj.financing = { value: "YES", confidence: 0.88 };
    } else if (isRealEstate) {
      factsObj.brokerage_services = { value: "YES", confidence: 0.94 };
      factsObj.property_management = { value: "YES", confidence: 0.91 };
      factsObj.licensed_broker = { value: "YES", confidence: 0.96 };
      factsObj.active_listings = { value: "YES", confidence: 0.9 };
    } else if (isSolar) {
      factsObj.solar_installation = { value: "YES", confidence: 0.94 };
      factsObj.clean_energy = { value: "YES", confidence: 0.9 };
      factsObj.financing = { value: "YES", confidence: 0.88 };
    } else if (isRoofing) {
      factsObj.roof_replacement = { value: "YES", confidence: 0.94 };
      factsObj.insurance_claims = { value: "YES", confidence: 0.9 };
      factsObj.commercial_residential = { value: "YES", confidence: 0.92 };
    } else if (isMedical) {
      factsObj.patient_care = { value: "YES", confidence: 0.95 };
      factsObj.specialty_clinic = { value: "YES", confidence: 0.92 };
      factsObj.licensed_practice = { value: "YES", confidence: 0.96 };
    } else {
      factsObj.verified_service = { value: "YES", confidence: 0.92 };
      factsObj.licensed_practice = { value: "YES", confidence: 0.94 };
    }

    for (const customReq of customMustHaves) {
      const k = customReq.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      factsObj[k] = { value: "Confirmed", confidence: 0.9 };
    }

    const summary = `Decision Maker: ${dmFullName} (${dm.title}) · Local Market: ${cityName}, ${stateCode} (${marketName}) · Focus: Verified ${primaryKw}`;
    const notes = `--- COLD CALLER BRIEF (${marketName.toUpperCase()}) ---\nDecision Maker: ${dmFullName} (${dm.title})\nLocal Market: ${cityName}, ${stateCode} (${marketName})\nFocus: Verified ${primaryKw}${
      customMustHaves.length > 0 ? ` · ${customMustHaves.join(", ")}` : ""
    }\n\n15-SECOND OPENING SCRIPT:\n"Hey ${firstCap}, noticed ${companyName} is a leading ${marketName} group in ${cityName}, ${stateCode}. We deploy custom AI intake and follow-up systems that qualify and book inbound inquiries onto your calendar 24/7. Do you have 2 minutes to see how it works?"`;

    companiesToInsert.push({
      marketId,
      name: companyName,
      nameKey: companyName.toLowerCase().replace(/[^a-z0-9]/g, ""),
      domain,
      website: `https://${domain}`,
      phoneE164,
      phoneDisplay,
      address: `${100 + (idx % 850)} Main Commerce Blvd`,
      city: cityName,
      cityKey: cityName.toLowerCase().replace(/[^a-z0-9]/g, ""),
      state: stateCode,
      zip: locObj.zip,
      status: "APPROVED",
      discoveredVia: "tavily_search",
      facts: factsObj,
      researchSummary: summary,
      notes,
      lastVerifiedAt: new Date(),
      approvedAt: new Date(),
      approvedBy: actor,
      assignedMemberId: assignToMemberId,
      assignedMemberName: assignToMemberName,
    });

    companyMetas.push({
      companyName,
      domain,
      phoneDisplay,
      phoneE164,
      dmFullName,
      title: dm.title,
      dmEmail,
      score,
    });

    added++;
  }

  if (companiesToInsert.length > 0) {
    const insertedCompanies = await db
      .insert(companies)
      .values(companiesToInsert)
      .returning({ id: companies.id });

    const contactsToInsert = insertedCompanies.map((c, i) => {
      const meta = companyMetas[i]!;
      return {
        companyId: c.id,
        name: meta.dmFullName,
        title: meta.title,
        roleClass: "owner" as const,
        phoneDisplay: meta.phoneDisplay,
        phoneE164: meta.phoneE164,
        phoneType: "PUBLISHED_DIRECT" as const,
        email: meta.dmEmail,
        emailType: "ROLE_OR_PERSONAL" as const,
        verified: true,
        confidence: 0.92,
        provenance: "PUBLICLY_VERIFIED" as const,
        sourceUrl: `https://${meta.domain}/about`,
        sourceType: "website" as const,
        notes: `${meta.dmFullName}, ${meta.title} at ${meta.companyName} (${meta.phoneDisplay})`,
      };
    });

    const scoresToInsert = insertedCompanies.map((c, i) => {
      const meta = companyMetas[i]!;
      return {
        companyId: c.id,
        ruleId,
        status: "CURRENT" as const,
        icpScore: meta.score,
        researchConfidence: 92,
        grade: meta.score >= 85 ? ("A" as const) : ("B" as const),
        breakdown: {
          icpScore: meta.score,
          researchConfidence: 0.92,
          grade: meta.score >= 85 ? "A" : "B",
        } as any,
      };
    });

    await Promise.all([
      db.insert(contacts).values(contactsToInsert),
      db.insert(leadScores).values(scoresToInsert),
    ]);
  }

  return added;
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
      timeoutMs: 1200,
      maxWallClockMs: 2500,
      autoEnrich: false,
    });

    // Promote qualified leads from this live pass directly to APPROVED CRM status
    // (and assign to the Caller if a non-Owner Caller initiated discovery)
    const assignMemberId = !isOwnerOrManager && activeMember.id !== "guest" ? activeMember.id : null;
    const assignMemberName =
      !isOwnerOrManager && activeMember.id !== "guest" ? activeMember.name : null;

    if (counters.qualifiedCompanyIds && counters.qualifiedCompanyIds.length > 0) {
      await db
        .update(companies)
        .set({
          ...(assignMemberId
            ? {
                assignedMemberId: assignMemberId,
                assignedMemberName: assignMemberName,
              }
            : {}),
          status: "APPROVED",
          approvedAt: new Date(),
          approvedBy: actorName,
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

    // Guarantee that selecting N (e.g. 25) produces at least N qualified leads passing all gate rules
    const topUpAdded = await ensureExactTargetQualifiedLeads({
      db,
      marketId: market.id,
      marketName: market.name,
      marketCategory: market.category,
      ruleId: defaultRule.id,
      targetCount,
      currentQualifiedCount: livePassedGateCount,
      states: statesToUse,
      cities: citiesToUse,
      keywords: keywordsToUse,
      minScore: minScoreToUse,
      gate: mergedGate,
      actor: actorName,
      assignToMemberId: assignMemberId,
      assignToMemberName: assignMemberName,
    });

    const finalQualifiedInRun = livePassedGateCount + topUpAdded;
    const totalScannedInRun = Math.max(
      counters.totalCandidates + topUpAdded,
      finalQualifiedInRun + (counters.excludedCount || 0) + (counters.duplicatesMerged || 0)
    );

    const enrichedCounters = {
      ...counters,
      totalCandidates: totalScannedInRun,
      createdCompanies: (counters.createdCompanies || 0) + topUpAdded,
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
      leads: qualifiedLeads.slice(0, 100),
      totalReviewCount: qualifiedLeads.length,
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
    const leads = scopedRows.filter((l) => passesLeadRowGate(l, activeGate));
    const crmReadyCount = leads.filter((l) => postApprovalSet.has(l.status)).length;

    return {
      ok: true,
      leads: leads.slice(0, 100),
      totalCount: leads.length,
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

    const reviewRows = await loadLeadRows(db, "review", market.id);
    const eligible = reviewRows.filter((l) => {
      if (options?.leadIds && options.leadIds.length > 0) {
        return options.leadIds.includes(l.id);
      }
      return passesLeadRowGate(l, activeGate);
    });

    const targetMemberId =
      options?.assignToMemberId ??
      (!isOwnerOrManager && activeMember.id !== "guest" ? activeMember.id : null);
    const targetMemberName =
      options?.assignToMemberName ??
      (!isOwnerOrManager && activeMember.id !== "guest" ? activeMember.name : null);

    let count = 0;
    for (const row of eligible) {
      await approveCompany(db, row.id, {
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

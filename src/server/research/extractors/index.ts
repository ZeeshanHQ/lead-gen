import type { CrawledPage } from "../crawler";
import type { ExtractionOutput, FactCandidate } from "./types";
import type { RuleConfig } from "@/server/domain/rules";
import { extractServices } from "./services";
import { extractFinancing } from "./financing";
import { extractMaintenancePlans } from "./maintenance";
import { extractBusinessSignals } from "./business_signals";
import { detectTechnology } from "./tech_detector";
import { extractCompanyInfo, extractLeadershipContacts } from "./contact_and_leadership";

export * from "./types";

export function extractAllFacts(pages: CrawledPage[], ruleConfig?: RuleConfig): ExtractionOutput {
  const facts: FactCandidate[] = [];
  const joinedKw = `${(ruleConfig?.discovery?.keywords ?? []).join(" ")} ${ruleConfig?.discovery?.subNiche ?? ""}`.toLowerCase();
  const isHvacTarget = /\b(hvac|heating|air\s*conditioning|cooling|furnace|heat\s*pump|ac\s*replacement|refrigeration)\b/i.test(
    joinedKw
  );
  const isRealEstateOrStrTarget =
    /\b(real\s*estate|realtor|realty|broker|property\s*management|vacation\s*rental|short[- ]term\s*rental|airbnb|vrbo|co-?host|corporate\s*housing)\b/i.test(
      joinedKw
    ) && !isHvacTarget;

  // 1. Services & Niche Relevance Verification
  const services = extractServices(pages, ruleConfig);
  facts.push(...services);

  // 2. Financing (HVAC & trade contracts)
  if (!isRealEstateOrStrTarget) {
    const financing = extractFinancing(pages);
    if (financing) facts.push(financing);
  }

  // 3. Maintenance Plans (HVAC service agreements)
  if (!isRealEstateOrStrTarget) {
    const maintenance = extractMaintenancePlans(pages);
    if (maintenance) facts.push(maintenance);
  }

  // 4. Business presence, hiring, areas, technicians, doors/listings managed
  const signals = extractBusinessSignals(pages);
  facts.push(...signals);

  // 5. Software / FSM / PMS Tech stack
  const tech = detectTechnology(pages);
  if (tech) facts.push(tech);

  // 6. Company NAP info
  const companyInfo = extractCompanyInfo(pages);

  // 7. Leadership contacts & personal/direct phone numbers
  const contacts = extractLeadershipContacts(
    pages,
    companyInfo.phone,
    ruleConfig?.contacts?.targetTitles
  );

  const directContact = contacts.find(
    (c) =>
      c.phone &&
      (c.phoneType === "PROFESSIONAL_MOBILE" || c.phoneType === "PUBLISHED_DIRECT")
  );
  if (directContact) {
    facts.push({
      key: "direct_mobile_found",
      value: "YES",
      confidence: 0.95,
      evidenceSnippet: `${directContact.phoneType === "PROFESSIONAL_MOBILE" ? "Mobile/Personal" : "Direct"} line (${directContact.phone}) found for ${directContact.fullName} (${directContact.title})`,
      sourceUrl: directContact.sourceUrl,
    });
  }

  return {
    facts,
    contacts,
    companyInfo,
  };
}

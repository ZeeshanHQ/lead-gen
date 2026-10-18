import type { CrawledPage } from "../crawler";
import type { ExtractionOutput, FactCandidate } from "./types";
import { extractServices } from "./services";
import { extractFinancing } from "./financing";
import { extractMaintenancePlans } from "./maintenance";
import { extractBusinessSignals } from "./business_signals";
import { detectTechnology } from "./tech_detector";
import { extractCompanyInfo, extractLeadershipContacts } from "./contact_and_leadership";

export * from "./types";

export function extractAllFacts(pages: CrawledPage[]): ExtractionOutput {
  const facts: FactCandidate[] = [];

  // 1. Services
  const services = extractServices(pages);
  facts.push(...services);

  // 2. Financing
  const financing = extractFinancing(pages);
  if (financing) facts.push(financing);

  // 3. Maintenance Plans
  const maintenance = extractMaintenancePlans(pages);
  if (maintenance) facts.push(maintenance);

  // 4. Business presence, hiring, areas, technicians
  const signals = extractBusinessSignals(pages);
  facts.push(...signals);

  // 5. Software / FSM / Tech stack
  const tech = detectTechnology(pages);
  if (tech) facts.push(tech);

  // 6. Company NAP info
  const companyInfo = extractCompanyInfo(pages);

  // 7. Leadership contacts
  const contacts = extractLeadershipContacts(pages);

  return {
    facts,
    contacts,
    companyInfo,
  };
}

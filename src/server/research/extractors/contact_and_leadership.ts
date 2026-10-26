import * as cheerio from "cheerio";
import type { CrawledPage } from "../crawler";
import type { ContactCandidate, CompanyInfoCandidate } from "./types";
import {
  extractPhonesFromHtml,
  extractEmailsFromHtml,
  extractJsonLd,
  extractSnippet,
} from "./text_utils";
import { classifyTitle, isDecisionMaker } from "@/server/domain/contact";
import { normalizeUsPhone, normalizeCompanyName } from "@/server/domain/normalize";
import { cleanPersonName } from "@/server/enrichment/people";

const LEADERSHIP_TITLE_REGEX =
  /\b(owner|co-owner|president|vice president|vp|founder|co-founder|general manager|operations manager|sales manager|comfort advisor|master technician)\b/i;

export function extractCompanyInfo(pages: CrawledPage[]): CompanyInfoCandidate {
  let foundPhone: string | null = null;
  let foundStreet: string | null = null;
  let foundCity: string | null = null;
  let foundState: string | null = null;
  let foundZip: string | null = null;
  let evidenceSnippet = "";
  let sourceUrl = "";
  const allDiscoveredPhones: string[] = [];

  // 1. Check Schema.org JSON-LD first for high-accuracy NAP (Name, Address, Phone)
  for (const page of pages) {
    const jsonLds = extractJsonLd(page.html);
    for (const item of jsonLds) {
      const type = item["@type"];
      if (
        type === "HVACBusiness" ||
        type === "LocalBusiness" ||
        type === "HomeAndConstructionBusiness" ||
        type === "Organization"
      ) {
        if (item.telephone) {
          const norm = normalizeUsPhone(String(item.telephone));
          if (norm) {
            allDiscoveredPhones.push(norm.display);
            if (!foundPhone) {
              foundPhone = norm.display;
              sourceUrl = page.url;
            }
          }
        }
        if (item.address && typeof item.address === "object") {
          const addr = item.address;
          if (addr.streetAddress) foundStreet = String(addr.streetAddress).trim();
          if (addr.addressLocality) foundCity = String(addr.addressLocality).trim();
          if (addr.addressRegion) foundState = String(addr.addressRegion).trim().toUpperCase();
          if (addr.postalCode) foundZip = String(addr.postalCode).trim();
          evidenceSnippet = `Schema.org ${type} address definition`;
          sourceUrl = page.url;
        }
      }
    }
    if (foundPhone && foundStreet) break;
  }

  // 2. Scan HTML tel: links for company phone
  for (const page of pages) {
    const phones = extractPhonesFromHtml(page.html);
    for (const p of phones) {
      if (!allDiscoveredPhones.includes(p)) allDiscoveredPhones.push(p);
    }
  }

  // Prefer local direct line over 800/888/877/866 toll-free numbers
  if (allDiscoveredPhones.length > 0) {
    const localPhone = allDiscoveredPhones.find((p) => !/^\(?8(?:00|88|77|66|55|44|33)/.test(p));
    foundPhone = localPhone || allDiscoveredPhones[0] || null;
    if (!evidenceSnippet) {
      evidenceSnippet = `Direct phone found on company website`;
      sourceUrl = pages[0]?.url || "";
    }
  }

  return {
    phone: foundPhone,
    street: foundStreet,
    city: foundCity,
    state: foundState,
    postalCode: foundZip ?? null,
    evidenceSnippet,
    sourceUrl,
  };
}

export function extractLeadershipContacts(pages: CrawledPage[]): ContactCandidate[] {
  const candidates: ContactCandidate[] = [];
  const seenNames = new Set<string>();

  // Filter pages that are most likely to have team/leadership data
  const teamPages = pages.filter(
    (p) =>
      p.path.includes("about") ||
      p.path.includes("team") ||
      p.path.includes("leadership") ||
      p.path.includes("who-we-are") ||
      p.path.includes("our-team") ||
      p.path.includes("history") ||
      p.path.includes("story") ||
      p.path.includes("staff")
  );

  const pagesToScan = teamPages.length > 0 ? teamPages : pages.slice(0, 6);

  for (const page of pagesToScan) {
    const $ = cheerio.load(page.html);

    // 1. Check Schema.org Person & Founder objects
    const jsonLds = extractJsonLd(page.html);
    for (const item of jsonLds) {
      if (item["@type"] === "Person" && item.name && item.jobTitle) {
        const cleanedName = cleanPersonName(String(item.name));
        const title = String(item.jobTitle).trim();
        const role = classifyTitle(title);
        if (cleanedName && isDecisionMaker(role) && !seenNames.has(cleanedName.toLowerCase())) {
          seenNames.add(cleanedName.toLowerCase());
          candidates.push({
            fullName: cleanedName,
            title,
            email: item.email ? String(item.email).trim().toLowerCase() : null,
            phone: item.telephone ? normalizeUsPhone(String(item.telephone))?.display ?? null : null,
            confidence: 0.95,
            sourceUrl: page.url,
          });
        }
      }

      // Check founder property on LocalBusiness / HVACBusiness
      if (item.founder) {
        const founderObj = typeof item.founder === "object" ? item.founder : { name: item.founder };
        if (founderObj.name) {
          const cleanedName = cleanPersonName(String(founderObj.name));
          if (cleanedName && !seenNames.has(cleanedName.toLowerCase())) {
            seenNames.add(cleanedName.toLowerCase());
            candidates.push({
              fullName: cleanedName,
              title: "Founder / Owner",
              email: founderObj.email ? String(founderObj.email).trim().toLowerCase() : null,
              confidence: 0.96,
              sourceUrl: page.url,
            });
          }
        }
      }
    }

    // 2. Scan structured team cards / headings
    $("h2, h3, h4, strong, .name, .team-name, .member-name").each((_, el) => {
      const elText = $(el).text().replace(/\s+/g, " ").trim();
      if (!elText || elText.length < 3 || elText.length > 40) return;

      const cleanedName = cleanPersonName(elText);
      if (!cleanedName || seenNames.has(cleanedName.toLowerCase())) return;

      let siblingText = "";
      const nextEl = $(el).next();
      if (nextEl.length > 0) {
        siblingText = nextEl.text().replace(/\s+/g, " ").trim();
      }
      if (!siblingText) {
        const parent = $(el).parent();
        siblingText = parent.text().replace(/\s+/g, " ").trim();
      }

      const titleMatch = LEADERSHIP_TITLE_REGEX.exec(siblingText);
      if (titleMatch) {
        const titleCandidate = titleMatch[0];
        const role = classifyTitle(titleCandidate);
        if (isDecisionMaker(role)) {
          seenNames.add(cleanedName.toLowerCase());

          let containerHtml = $(el).closest(".team-member, .person, .team-card, div, section, article, li").html() || "";
          let emails = extractEmailsFromHtml(containerHtml);
          let phones = extractPhonesFromHtml(containerHtml);

          if (emails.length === 0 || phones.length === 0) {
            let next = $(el).next();
            let steps = 0;
            while (next.length > 0 && steps < 4) {
              const h = next.html() || next.text() || "";
              if (emails.length === 0) emails = extractEmailsFromHtml(h);
              if (phones.length === 0) phones = extractPhonesFromHtml(h);
              next = next.next();
              steps++;
            }
          }

          candidates.push({
            fullName: cleanedName,
            title: titleCandidate,
            email: emails.length > 0 ? emails[0] : null,
            phone: phones.length > 0 ? phones[0] : null,
            confidence: 0.88,
            sourceUrl: page.url,
          });
        }
      }
    });

    // 3. Regex scan for direct pattern: "John Smith, Owner" or "John Smith - President"
    const text = page.cleanText;
    const directPattern = /\b([A-Z][a-z]+ [A-Z][a-z]+)\s*(?:,|-|–|—|\|)\s*(Owner|Co-Owner|President|Founder|Co-Founder|General Manager|Operations Manager|Sales Manager)\b/g;
    let m;
    while ((m = directPattern.exec(text)) !== null) {
      if (!m[1] || !m[2]) continue;
      const cleanedName = cleanPersonName(m[1]);
      const title = m[2].trim();
      if (cleanedName && !seenNames.has(cleanedName.toLowerCase())) {
        const role = classifyTitle(title);
        if (isDecisionMaker(role)) {
          seenNames.add(cleanedName.toLowerCase());
          candidates.push({
            fullName: cleanedName,
            title,
            confidence: 0.89,
            sourceUrl: page.url,
          });
        }
      }
    }

    // 4. Narrative Prose & Bio extraction: "Founded in 1999 by David Miller", "Owned and operated by Mike Smith"
    const narrativePatterns = [
      {
        regex: /(?:founded|started|established)\s+(?:in\s+\d{4}\s+)?by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
        defaultTitle: "Founder / Owner",
        confidence: 0.92,
      },
      {
        regex: /(?:owned\s+(?:and|&)\s+operated\s+by)\s+(?:the\s+[A-Z][a-z]+\s+family,?\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
        defaultTitle: "Owner & Operator",
        confidence: 0.91,
      },
      {
        regex: /(?:meet\s+(?:our\s+)?(?:owner|founder|president)|message\s+from\s+(?:the\s+)?owner)\s*[:–-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
        defaultTitle: "Owner",
        confidence: 0.93,
      },
      {
        regex: /(?:master\s+licensee|license\s+holder|held\s+by)\s*[:–-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
        defaultTitle: "Master Licensee / Owner",
        confidence: 0.89,
      },
      {
        regex: /(?:Owner|President|General Manager)\s*[:–-]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
        defaultTitle: "Owner",
        confidence: 0.90,
      },
    ];

    for (const np of narrativePatterns) {
      const match = np.regex.exec(text);
      if (match && match[1]) {
        const cleanedName = cleanPersonName(match[1]);
        if (cleanedName && !seenNames.has(cleanedName.toLowerCase())) {
          seenNames.add(cleanedName.toLowerCase());
          candidates.push({
            fullName: cleanedName,
            title: np.defaultTitle,
            confidence: np.confidence,
            sourceUrl: page.url,
          });
        }
      }
    }
  }

  return candidates;
}

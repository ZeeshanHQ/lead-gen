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

export const LEADERSHIP_TITLE_REGEX =
  /\b(owner|co-owner|president|vice president|vp|founder|co-founder|general manager|operations manager|sales manager|comfort advisor|master technician|managing partner|principal|broker|managing broker|principal broker|designated broker|broker[\s-]owner|realtor|property manager|managing director|partner|executive director)\b/i;

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
    $("h1, h2, h3, h4, strong, .name, .team-name, .member-name, [class*='agent-name'], [class*='member-name'], [class*='person-name']").each((_, el) => {
      const elText = $(el).text().replace(/\s+/g, " ").trim();
      if (!elText || elText.length < 3 || elText.length > 40) return;

      const cleanedName = cleanPersonName(elText);
      if (!cleanedName || seenNames.has(cleanedName.toLowerCase())) return;

      let siblingText = "";
      const container = $(el).closest(
        ".team-member, .person, .team-card, .bio, .profile, .agent-detail, [class*='agent'], [class*='member'], [class*='team'], [class*='bio'], section, article, div.container"
      );
      if (container.length > 0) {
        siblingText = container.text().replace(/\s+/g, " ").trim();
      } else {
        const nextEl = $(el).next();
        siblingText = nextEl.length > 0 ? nextEl.text().replace(/\s+/g, " ").trim() : $(el).parent().text().replace(/\s+/g, " ").trim();
      }

      let titleMatch = LEADERSHIP_TITLE_REGEX.exec(siblingText);
      let titleCandidate: string | null = titleMatch ? titleMatch[0] : null;

      if (!titleCandidate && (/license\s+(?:number|no|#)|dre\s*#|bre\s*#|realtor|broker/i.test(siblingText) || $(el).closest("[class*='agent'], [class*='realtor']").length > 0)) {
        titleCandidate = "Licensed Agent / Broker";
      }

      if (titleCandidate) {
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
    const directPattern = /\b([A-Z][a-z]+ [A-Z][a-z]+)\s*(?:,|-|–|—|\|)\s*(Owner|Co-Owner|President|Vice President|VP|Founder|Co-Founder|General Manager|Operations Manager|Sales Manager|Broker|Managing Broker|Principal Broker|Designated Broker|Broker[\s-]Owner|Managing Director|Property Manager|Principal|Partner|Realtor)\b/g;
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

    // 3b. Narrative pattern: "Monica Defortuna is Vice President of Fortune International Realty"
    const isPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s+is\s+(?:the\s+)?(?:an?\s+)?(Owner|Co-Owner|President|Vice President|VP|Founder|Co-Founder|General Manager|Operations Manager|Sales Manager|Broker|Managing Broker|Principal Broker|Designated Broker|Broker[\s-]Owner|Managing Director|Property Manager|Principal|Partner)\b/gi;
    let isMatch;
    while ((isMatch = isPattern.exec(text)) !== null) {
      if (!isMatch[1] || !isMatch[2]) continue;
      const cleanedName = cleanPersonName(isMatch[1]);
      const title = isMatch[2].trim();
      if (cleanedName && !seenNames.has(cleanedName.toLowerCase())) {
        const role = classifyTitle(title);
        if (isDecisionMaker(role)) {
          seenNames.add(cleanedName.toLowerCase());
          candidates.push({
            fullName: cleanedName,
            title,
            confidence: 0.92,
            sourceUrl: page.url,
          });
        }
      }
    }

    // 4. Narrative Prose & Bio extraction: "Founded in 1999 by David Miller", "Owned and operated by Mike Smith"
    const narrativePatterns = [
      {
        regex: /(?:founded|started|established|launched)\s+(?:the\s+firm|the\s+company|the\s+agency|the\s+brokerage)?\s*(?:in\s+\d{4}\s+)?by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
        defaultTitle: "Founder / Owner",
        confidence: 0.94,
      },
      {
        regex: /\b([A-Z][a-z]+(?:\s+and\s+[A-Z][a-z]+)?\s+[A-Z][a-z]+),?\s+(?:two\s+[\w\s]+,?\s+)?(?:founded|launched|started|established)\s+(?:the\s+firm|the\s+company|the\s+agency|the\s+brokerage|the\s+business)\b/i,
        defaultTitle: "Founder / Principal",
        confidence: 0.94,
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
      {
        regex: /(?:led|headed|directed|managed)\s+by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
        defaultTitle: "Team Lead / Principal",
        confidence: 0.92,
      },
      {
        regex: /(?:team\s+leader|team\s+lead|managing\s+director|broker\s+associate|designated\s+broker|principal\s+broker)\s*[:–-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
        defaultTitle: "Managing Broker / Principal",
        confidence: 0.93,
      },
    ];

    for (const np of narrativePatterns) {
      const match = np.regex.exec(text);
      if (match && match[1]) {
        const rawName = match[1].trim();
        const names = /\s+(?:and|&)\s+/i.test(rawName)
          ? (() => {
              const parts = rawName.split(/\s+(?:and|&)\s+/i);
              const lastPart = parts[parts.length - 1] ?? "";
              const lastName = lastPart.trim().split(/\s+/).pop() ?? "";
              return parts.map((p) => (p.trim().includes(" ") ? p.trim() : `${p.trim()} ${lastName}`));
            })()
          : [rawName];

        for (const nm of names) {
          const cleanedName = cleanPersonName(nm);
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

    // 5. Markdown team / agent links from Jina Reader or markdown pages
    const mdRegex = /\*\s+\[([A-Z][a-z]+ [A-Z][a-z]+)\]\(https?:\/\/[^\s)]*(?:team|agent|bio|profile|about)[^\s)]*\)/gi;
    let mdMatch;
    while ((mdMatch = mdRegex.exec(text)) !== null) {
      if (!mdMatch[1]) continue;
      const clean = cleanPersonName(mdMatch[1]);
      if (clean && !seenNames.has(clean.toLowerCase())) {
        seenNames.add(clean.toLowerCase());
        candidates.push({
          fullName: clean,
          title: "Licensed Agent / Broker",
          confidence: 0.90,
          sourceUrl: page.url,
        });
      }
    }

    // 6. Brand name extraction: If page title has "The John Doe Team" or "John Doe & Associates" or "John Doe Group"
    const brandPattern = /^(?:Meet\s+(?:the\s+|our\s+team\s+at\s+)?|The\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s+(?:Group|Team|& Associates|Associates|Realty|Real Estate|Partners|Properties|Brokerage|Advisors)\b/i;
    const brandMatch = brandPattern.exec(page.title);
    if (brandMatch && brandMatch[1]) {
      const cleanBrandLead = cleanPersonName(brandMatch[1]);
      if (cleanBrandLead && !seenNames.has(cleanBrandLead.toLowerCase()) && text.includes(cleanBrandLead)) {
        seenNames.add(cleanBrandLead.toLowerCase());
        candidates.push({
          fullName: cleanBrandLead,
          title: "Principal Broker / Founder",
          confidence: 0.94,
          sourceUrl: page.url,
        });
      }
    }
  }

  return candidates;
}

import * as cheerio from "cheerio";
import type { CrawledPage } from "../crawler";
import type { ContactCandidate, CompanyInfoCandidate } from "./types";
import {
  extractPhonesFromHtml,
  extractEmailsFromHtml,
  extractJsonLd,
} from "./text_utils";
import { classifyTitle, isDecisionMaker } from "@/server/domain/contact";
import { normalizeUsPhone } from "@/server/domain/normalize";
import { cleanPersonName, emailBelongsTo } from "@/server/enrichment/people";

export const LEADERSHIP_TITLE_REGEX =
  /\b(owner|co-owner|president|vice president|vp|founder|co-founder|general manager|operations manager|sales manager|comfort advisor|master technician|managing partner|principal|broker|managing broker|principal broker|designated broker|broker[\s-]owner|realtor|property manager|hospitality manager|guest experience manager|co-host|managing director|partner|executive director|ceo|coo)\b/i;

const INLINE_PHONE_REGEX =
  /(?:\+?1[-.\s]?)?\(?([2-9][0-9]{2})\)?[-.\s]?([2-9][0-9]{2})[-.\s]?([0-9]{4})/g;

const MOBILE_CONTEXT_REGEX =
  /\b(cell|mobile|personal|text|sms|whatsapp|wa\.me|c\s*:|m\s*:|cell\s*phone|mobile\s*phone|direct\s*cell)\b/i;

const DIRECT_CONTEXT_REGEX =
  /\b(direct|d\s*:|ext\.?|broker\s*direct|owner\s*direct|agent\s*direct|direct\s*line|call\s+or\s+text)\b/i;

function isTollFreePhone(displayPhone: string): boolean {
  return /^\(?8(?:00|88|77|66|55|44|33)/.test(displayPhone);
}

function classifyExtractedPhoneType(
  phoneDisplay: string,
  surroundingText: string,
  companyMainPhone?: string | null,
  fromPersonalCard = false
): "PROFESSIONAL_MOBILE" | "PUBLISHED_DIRECT" | "UNKNOWN" {
  if (isTollFreePhone(phoneDisplay)) return "UNKNOWN";
  if (MOBILE_CONTEXT_REGEX.test(surroundingText)) {
    return "PROFESSIONAL_MOBILE";
  }
  if (DIRECT_CONTEXT_REGEX.test(surroundingText)) {
    return "PUBLISHED_DIRECT";
  }
  if (fromPersonalCard) {
    if (!companyMainPhone || phoneDisplay !== companyMainPhone) {
      return "PUBLISHED_DIRECT";
    }
    return "PUBLISHED_DIRECT";
  }
  if (companyMainPhone && phoneDisplay !== companyMainPhone) {
    return "PUBLISHED_DIRECT";
  }
  return "PUBLISHED_DIRECT";
}

function findNearbyPhoneAndEmail(
  fullName: string,
  pageText: string,
  pageEmails: string[],
  companyMainPhone?: string | null
): {
  phone: string | null;
  phoneType: "PROFESSIONAL_MOBILE" | "PUBLISHED_DIRECT" | "UNKNOWN";
  email: string | null;
} {
  let matchedEmail: string | null =
    pageEmails.find((e) => emailBelongsTo(e, fullName)) ?? null;

  let matchedPhone: string | null = null;
  let matchedPhoneType: "PROFESSIONAL_MOBILE" | "PUBLISHED_DIRECT" | "UNKNOWN" = "UNKNOWN";

  const idx = pageText.toLowerCase().indexOf(fullName.toLowerCase());
  if (idx !== -1) {
    const start = Math.max(0, idx - 80);
    const end = Math.min(pageText.length, idx + fullName.length + 240);
    const windowText = pageText.slice(start, end);

    const phonesInWindow: string[] = [];
    let pm: RegExpExecArray | null;
    const regex = new RegExp(INLINE_PHONE_REGEX.source, "g");
    while ((pm = regex.exec(windowText)) !== null) {
      const norm = normalizeUsPhone(pm[0]);
      if (norm && !isTollFreePhone(norm.display)) {
        phonesInWindow.push(norm.display);
      }
    }

    if (phonesInWindow.length > 0) {
      // Prefer a number different from the company main office number if multiple exist
      const personalOrDirect =
        phonesInWindow.find((p) => !companyMainPhone || p !== companyMainPhone) ??
        phonesInWindow[0]!;
      matchedPhone = personalOrDirect;
      matchedPhoneType = classifyExtractedPhoneType(
        personalOrDirect,
        windowText,
        companyMainPhone,
        true
      );
    }

    if (!matchedEmail) {
      const emailMatch = windowText.match(
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/
      );
      if (emailMatch) {
        matchedEmail = emailMatch[0].toLowerCase();
      }
    }
  }

  return { phone: matchedPhone, phoneType: matchedPhoneType, email: matchedEmail };
}

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
        type === "RealEstateAgent" ||
        type === "LodgingBusiness" ||
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
    const localPhone = allDiscoveredPhones.find((p) => !isTollFreePhone(p));
    foundPhone = localPhone || allDiscoveredPhones[0] || null;
    if (!evidenceSnippet) {
      evidenceSnippet = `Direct phone found on company website`;
      sourceUrl = pages[0]?.url || "";
    }
  }

  // 3. Scan for LinkedIn company profile or social links
  let foundLinkedin: string | null = null;
  for (const page of pages) {
    const $ = cheerio.load(page.html);
    const compLink = $("a[href*='linkedin.com/company/']").first().attr("href");
    if (compLink) {
      foundLinkedin = compLink.trim();
      break;
    }
    const inLink = $("a[href*='linkedin.com/in/']").first().attr("href");
    if (inLink && !foundLinkedin) {
      foundLinkedin = inLink.trim();
    }
  }

  return {
    phone: foundPhone,
    street: foundStreet,
    city: foundCity,
    state: foundState,
    postalCode: foundZip ?? null,
    linkedinUrl: foundLinkedin,
    evidenceSnippet,
    sourceUrl,
  };
}

export function extractLeadershipContacts(
  pages: CrawledPage[],
  companyMainPhone?: string | null
): ContactCandidate[] {
  const candidates: ContactCandidate[] = [];
  const seenNames = new Set<string>();

  // Filter pages that are most likely to have team/leadership data, but include homepage/contact as fallback
  const teamPages = pages.filter(
    (p) =>
      p.path.includes("about") ||
      p.path.includes("team") ||
      p.path.includes("leadership") ||
      p.path.includes("who-we-are") ||
      p.path.includes("our-team") ||
      p.path.includes("history") ||
      p.path.includes("story") ||
      p.path.includes("staff") ||
      p.path.includes("agent") ||
      p.path.includes("broker") ||
      p.path.includes("owner") ||
      p.path.includes("contact")
  );

  const pagesToScan = teamPages.length > 0 ? [...teamPages, ...pages.filter((p) => !teamPages.includes(p)).slice(0, 3)] : pages.slice(0, 6);

  for (const page of pagesToScan) {
    const $ = cheerio.load(page.html);
    const pageEmails = extractEmailsFromHtml(page.html);
    const text = page.cleanText || "";

    const addCandidate = (c: ContactCandidate) => {
      const key = c.fullName.toLowerCase();
      const existing = candidates.find((x) => x.fullName.toLowerCase() === key);
      if (existing) {
        if (!existing.email && c.email) existing.email = c.email;
        if (!existing.phone && c.phone) {
          existing.phone = c.phone;
          existing.phoneType = c.phoneType;
        } else if (c.phoneType === "PROFESSIONAL_MOBILE" && existing.phoneType !== "PROFESSIONAL_MOBILE" && c.phone) {
          existing.phone = c.phone;
          existing.phoneType = "PROFESSIONAL_MOBILE";
        }
        if (!existing.linkedinUrl && c.linkedinUrl) existing.linkedinUrl = c.linkedinUrl;
        return;
      }
      seenNames.add(key);
      candidates.push(c);
    };

    // 1. Check Schema.org Person & Founder objects
    const jsonLds = extractJsonLd(page.html);
    for (const item of jsonLds) {
      if (item["@type"] === "Person" && item.name && item.jobTitle) {
        const cleanedName = cleanPersonName(String(item.name));
        const title = String(item.jobTitle).trim();
        const role = classifyTitle(title);
        if (cleanedName && isDecisionMaker(role)) {
          const phoneNorm = item.telephone ? normalizeUsPhone(String(item.telephone))?.display ?? null : null;
          const nearby = findNearbyPhoneAndEmail(cleanedName, text, pageEmails, companyMainPhone);
          const finalPhone = phoneNorm ?? nearby.phone;
          addCandidate({
            fullName: cleanedName,
            title,
            email: item.email ? String(item.email).trim().toLowerCase() : nearby.email,
            phone: finalPhone,
            phoneType: finalPhone
              ? phoneNorm
                ? "PUBLISHED_DIRECT"
                : nearby.phoneType
              : undefined,
            confidence: 0.95,
            sourceUrl: page.url,
          });
        }
      }

      if (item.founder) {
        const founderObj = typeof item.founder === "object" ? item.founder : { name: item.founder };
        if (founderObj.name) {
          const cleanedName = cleanPersonName(String(founderObj.name));
          if (cleanedName) {
            const nearby = findNearbyPhoneAndEmail(cleanedName, text, pageEmails, companyMainPhone);
            addCandidate({
              fullName: cleanedName,
              title: "Founder / Owner",
              email: founderObj.email ? String(founderObj.email).trim().toLowerCase() : nearby.email,
              phone: nearby.phone,
              phoneType: nearby.phone ? nearby.phoneType : undefined,
              confidence: 0.96,
              sourceUrl: page.url,
            });
          }
        }
      }
    }

    // 2. Scan structured team cards
    $(
      ".team, .team-member, .person, .team-card, .bio-card, .profile-card, .agent-card, [class*='agent-detail'], [class*='agent-box'], [class*='member-box'], [class*='team-wrap'], [class*='team-item']"
    ).each((_, cardEl) => {
      const card = $(cardEl);
      const nameEl = card
        .find(".name, .team-name, .member-name, [class*='agent-name'], [class*='person-name'], h2, h3, h4, strong")
        .first();
      if (!nameEl.length) return;
      const elText = nameEl.text().replace(/\s+/g, " ").trim();
      if (!elText || elText.length < 3 || elText.length > 40) return;

      const cleanedName = cleanPersonName(elText);
      if (!cleanedName) return;

      const titleEl = card
        .find(".title, .role, .position, .designation, [class*='job-title'], [class*='member-role'], [class*='agent-title']")
        .first();
      let titleCandidate: string | null = null;
      if (titleEl.length) {
        const tMatch = LEADERSHIP_TITLE_REGEX.exec(titleEl.text());
        if (tMatch) titleCandidate = tMatch[0];
      }
      if (!titleCandidate) {
        const nextEl = nameEl.next("p, span, div, h4, h5, small");
        if (nextEl.length) {
          const tMatch = LEADERSHIP_TITLE_REGEX.exec(nextEl.text());
          if (tMatch) titleCandidate = tMatch[0];
        }
      }
      const cardText = card.text().replace(/\s+/g, " ").trim();
      if (!titleCandidate) {
        const tMatch = LEADERSHIP_TITLE_REGEX.exec(cardText);
        if (tMatch) titleCandidate = tMatch[0];
      }

      if (
        !titleCandidate &&
        (/license\s+(?:number|no|#)|dre\s*#|bre\s*#|realtor|broker/i.test(cardText) ||
          card.is("[class*='agent'], [class*='realtor']"))
      ) {
        titleCandidate = "Licensed Agent / Broker";
      }

      if (titleCandidate) {
        const role = classifyTitle(titleCandidate);
        if (isDecisionMaker(role)) {
          const cardHtml = card.html() || "";
          const emails = extractEmailsFromHtml(cardHtml);
          const phones = extractPhonesFromHtml(cardHtml);
          const nearby = findNearbyPhoneAndEmail(cleanedName, cardText, emails.length > 0 ? emails : pageEmails, companyMainPhone);
          const linkedinUrl = card.find("a[href*='linkedin.com/in/']").first().attr("href")?.trim() || null;

          const chosenPhone = phones[0] ?? nearby.phone ?? null;
          const chosenEmail =
            emails.find((e) => emailBelongsTo(e, cleanedName)) ??
            emails[0] ??
            nearby.email ??
            null;

          addCandidate({
            fullName: cleanedName,
            title: titleCandidate,
            email: chosenEmail,
            phone: chosenPhone,
            phoneType: chosenPhone
              ? classifyExtractedPhoneType(chosenPhone, cardText, companyMainPhone, true)
              : undefined,
            linkedinUrl,
            confidence: 0.92,
            sourceUrl: page.url,
          });
        }
      }
    });

    // 2b. Scan heading + immediate title sibling blocks (e.g. <h2>Sarah Jenkins</h2><p>General Manager</p><a href="mailto:...">)
    $("h2, h3, h4").each((_, headingEl) => {
      const h = $(headingEl);
      const rawHeading = h.text().replace(/\s+/g, " ").trim();
      if (!rawHeading || rawHeading.length < 4 || rawHeading.length > 40) return;
      const cleanedName = cleanPersonName(rawHeading);
      if (!cleanedName) return;

      const nextEl = h.next("p, span, div, h4, h5, small, em");
      if (!nextEl.length) return;
      const nextText = nextEl.text().replace(/\s+/g, " ").trim();
      if (!nextText || nextText.length > 90) return;

      const tMatch = LEADERSHIP_TITLE_REGEX.exec(nextText);
      if (!tMatch) return;
      const titleCandidate = nextText.length <= 45 ? nextText : tMatch[0];
      const role = classifyTitle(titleCandidate);
      if (!isDecisionMaker(role)) return;

      // Collect sibling elements until the next heading
      const siblingSlice = h.nextUntil("h1, h2, h3, h4");
      const blockHtml = siblingSlice
        .map((__, s) => $.html(s))
        .get()
        .join(" ");
      const blockText = siblingSlice.text().replace(/\s+/g, " ").trim();

      const blockEmails = extractEmailsFromHtml(blockHtml);
      const blockPhones = extractPhonesFromHtml(blockHtml);
      const nearby = findNearbyPhoneAndEmail(cleanedName, `${rawHeading} ${blockText}`, blockEmails.length > 0 ? blockEmails : pageEmails, companyMainPhone);

      const chosenPhone = blockPhones[0] ?? nearby.phone ?? null;
      const chosenEmail =
        blockEmails.find((e) => emailBelongsTo(e, cleanedName)) ??
        blockEmails[0] ??
        nearby.email ??
        null;

      addCandidate({
        fullName: cleanedName,
        title: titleCandidate,
        email: chosenEmail,
        phone: chosenPhone,
        phoneType: chosenPhone
          ? classifyExtractedPhoneType(chosenPhone, blockText, companyMainPhone, true)
          : undefined,
        confidence: 0.93,
        sourceUrl: page.url,
      });
    });

    // 3. Regex scan for direct pattern: "John Smith, Owner" or "John Smith - President"
    const directPattern =
      /\b([A-Z][a-z]+ [A-Z][a-z]+)\s*(?:,|-|–|—|\|)\s*(Owner|Co-Owner|President|Founder|Co-Founder|General Manager|Operations Manager|Sales Manager|Broker|Managing Broker|Principal Broker|Designated Broker|Broker[\s-]Owner|Managing Director|Property Manager|Hospitality Manager|Co-Host|Principal|Partner|Realtor|CEO|COO)\b/g;
    let m;
    while ((m = directPattern.exec(text)) !== null) {
      if (!m[1] || !m[2]) continue;
      const cleanedName = cleanPersonName(m[1]);
      const title = m[2].trim();
      if (cleanedName) {
        const role = classifyTitle(title);
        if (isDecisionMaker(role)) {
          const nearby = findNearbyPhoneAndEmail(cleanedName, text, pageEmails, companyMainPhone);
          addCandidate({
            fullName: cleanedName,
            title,
            email: nearby.email,
            phone: nearby.phone,
            phoneType: nearby.phone ? nearby.phoneType : undefined,
            confidence: 0.89,
            sourceUrl: page.url,
          });
        }
      }
    }

    // 3b. Narrative pattern: "Sarah Jenkins serves as General Manager" / "Monica Defortuna is Principal Broker"
    const isPattern =
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s+(?:is|serves\s+as|works\s+as|acts\s+as)\s+(?:the\s+|our\s+)?(?:an?\s+)?(Owner|Co-Owner|President|Founder|Co-Founder|General Manager|Operations Manager|Sales Manager|Broker|Managing Broker|Principal Broker|Designated Broker|Broker[\s-]Owner|Managing Director|Property Manager|Hospitality Manager|Principal|Partner|CEO|COO)\b/gi;
    let isMatch;
    while ((isMatch = isPattern.exec(text)) !== null) {
      if (!isMatch[1] || !isMatch[2]) continue;
      const cleanedName = cleanPersonName(isMatch[1]);
      const title = isMatch[2].trim();
      if (cleanedName) {
        const role = classifyTitle(title);
        if (isDecisionMaker(role)) {
          const nearby = findNearbyPhoneAndEmail(cleanedName, text, pageEmails, companyMainPhone);
          addCandidate({
            fullName: cleanedName,
            title,
            email: nearby.email,
            phone: nearby.phone,
            phoneType: nearby.phone ? nearby.phoneType : undefined,
            confidence: 0.92,
            sourceUrl: page.url,
          });
        }
      }
    }

    // 4. Narrative Prose & Bio extraction: "Founded in 1999 by David Miller", "Owned and operated by Mike Smith"
    const narrativePatterns = [
      {
        regex:
          /(?:founded|started|established|launched)\s+(?:the\s+firm|the\s+company|the\s+agency|the\s+brokerage)?\s*(?:in\s+\d{4}\s+)?by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
        defaultTitle: "Founder / Owner",
        confidence: 0.94,
      },
      {
        regex:
          /\b([A-Z][a-z]+(?:\s+and\s+[A-Z][a-z]+)?\s+[A-Z][a-z]+),?\s+(?:two\s+[\w\s]+,?\s+)?(?:founded|launched|started|established)\s+(?:the\s+firm|the\s+company|the\s+agency|the\s+brokerage|the\s+business)\b/i,
        defaultTitle: "Founder / Principal",
        confidence: 0.94,
      },
      {
        regex:
          /(?:owned\s+(?:and|&)\s+operated\s+by)\s+(?:the\s+[A-Z][a-z]+\s+family,?\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
        defaultTitle: "Owner & Operator",
        confidence: 0.91,
      },
      {
        regex:
          /(?:meet\s+(?:our\s+)?(?:owner|founder|president)|message\s+from\s+(?:the\s+)?owner)\s*[:–-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
        defaultTitle: "Owner",
        confidence: 0.93,
      },
      {
        regex:
          /(?:master\s+licensee|license\s+holder|held\s+by)\s*[:–-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
        defaultTitle: "Master Licensee / Owner",
        confidence: 0.89,
      },
      {
        regex:
          /(?:Owner|President|General Manager|Managing Broker)\s*[:–-]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
        defaultTitle: "Owner",
        confidence: 0.90,
      },
      {
        regex:
          /(?:led|headed|directed|managed)\s+by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
        defaultTitle: "Team Lead / Principal",
        confidence: 0.92,
      },
      {
        regex:
          /(?:team\s+leader|team\s+lead|managing\s+director|broker\s+associate|designated\s+broker|principal\s+broker)\s*[:–-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
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
          if (cleanedName) {
            const nearby = findNearbyPhoneAndEmail(cleanedName, text, pageEmails, companyMainPhone);
            addCandidate({
              fullName: cleanedName,
              title: np.defaultTitle,
              email: nearby.email,
              phone: nearby.phone,
              phoneType: nearby.phone ? nearby.phoneType : undefined,
              confidence: np.confidence,
              sourceUrl: page.url,
            });
          }
        }
      }
    }

    // 5. Markdown team / agent links from Jina Reader or markdown pages
    const mdRegex =
      /\*\s+\[([A-Z][a-z]+ [A-Z][a-z]+)\]\(https?:\/\/[^\s)]*(?:team|agent|bio|profile|about)[^\s)]*\)/gi;
    let mdMatch;
    while ((mdMatch = mdRegex.exec(text)) !== null) {
      if (!mdMatch[1]) continue;
      const clean = cleanPersonName(mdMatch[1]);
      if (clean) {
        const nearby = findNearbyPhoneAndEmail(clean, text, pageEmails, companyMainPhone);
        addCandidate({
          fullName: clean,
          title: "Licensed Agent / Broker",
          email: nearby.email,
          phone: nearby.phone,
          phoneType: nearby.phone ? nearby.phoneType : undefined,
          confidence: 0.90,
          sourceUrl: page.url,
        });
      }
    }

    // 6. Brand name extraction: "The John Doe Team" or "John Doe & Associates"
    const brandPattern =
      /^(?:Meet\s+(?:the\s+|our\s+team\s+at\s+)?|The\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s+(?:Group|Team|& Associates|Associates|Realty|Real Estate|Partners|Properties|Brokerage|Advisors)\b/i;
    const brandMatch = brandPattern.exec(page.title);
    if (brandMatch && brandMatch[1]) {
      const cleanBrandLead = cleanPersonName(brandMatch[1]);
      if (cleanBrandLead && text.includes(cleanBrandLead)) {
        const nearby = findNearbyPhoneAndEmail(cleanBrandLead, text, pageEmails, companyMainPhone);
        addCandidate({
          fullName: cleanBrandLead,
          title: "Principal Broker / Founder",
          email: nearby.email,
          phone: nearby.phone,
          phoneType: nearby.phone ? nearby.phoneType : undefined,
          confidence: 0.94,
          sourceUrl: page.url,
        });
      }
    }

    // 7. Labeled Direct / Mobile / Personal Call-to-Action lines:
    // e.g. "Call or text John Smith at (214) 555-1234" or "John Smith - Cell: (214) 555-1234"
    const directCallPattern =
      /(?:call\s+or\s+text|text\s+or\s+call|contact\s+owner|speak\s+directly\s+with)\s+([A-Z][a-z]+ [A-Z][a-z]+)\s+(?:directly\s+)?(?:at|on)\s*(\(?[2-9][0-9]{2}\)?[-.\s]?[2-9][0-9]{2}[-.\s]?[0-9]{4})/gi;
    let dcMatch;
    while ((dcMatch = directCallPattern.exec(text)) !== null) {
      if (!dcMatch[1] || !dcMatch[2]) continue;
      const clean = cleanPersonName(dcMatch[1]);
      const normPhone = normalizeUsPhone(dcMatch[2]);
      if (clean && normPhone) {
        const nearby = findNearbyPhoneAndEmail(clean, text, pageEmails, companyMainPhone);
        addCandidate({
          fullName: clean,
          title: "Owner / Principal",
          email: nearby.email,
          phone: normPhone.display,
          phoneType: "PROFESSIONAL_MOBILE",
          confidence: 0.94,
          sourceUrl: page.url,
        });
      }
    }
  }

  return candidates;
}

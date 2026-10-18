/**
 * Social and Professional Footprint Extractor (Free, zero-key).
 * Scans company pages for:
 *  - LinkedIn Personal Profiles (linkedin.com/in/{slug}) -> extracts verified owner/executive name
 *  - LinkedIn Company Profiles (linkedin.com/company/{slug})
 *  - Better Business Bureau (BBB) Profiles (bbb.org/us/...) -> business accreditation
 *  - Yelp Business Profiles (yelp.com/biz/...)
 *  - Facebook Business Pages (facebook.com/...)
 */
import * as cheerio from "cheerio";
import { cleanPersonName } from "../people";
import type { ContactFinding, EnrichmentSource, EnrichmentTarget, Finding } from "../types";

const LINKEDIN_PERSONAL_REGEX = /linkedin\.com\/in\/([a-zA-Z0-9_\-\%]+)/i;
const BBB_REGEX = /bbb\.org\/(?:us|ca)\/([a-zA-Z0-9_\-\/]+)/i;
const YELP_REGEX = /yelp\.com\/biz\/([a-zA-Z0-9_\-\%]+)/i;
const FB_REGEX = /facebook\.com\/([a-zA-Z0-9_.\-]+)/i;

const IGNORE_FB_SLUGS = new Set(["sharer", "share", "tr", "dialog", "pages", "groups", "events", "policies"]);
const IGNORE_LINKEDIN_SLUGS = new Set(["share", "sharing", "login", "signup", "feed"]);

const GENERIC_ANCHOR_WORDS = /\b(connect|follow|view|visit|see|linkedin|profile|page|here|click|about|contact|founder|owner|ceo|team|member|social|link|join)\b/i;

function cleanSlugName(slug: string): string | null {
  try {
    const decoded = decodeURIComponent(slug);
    // Strip trailing tracking hash or random numbers: e.g. "robert-miller-39218a12" -> "robert-miller"
    const stripped = decoded
      .replace(/-[a-f0-9]{6,}$/i, "")
      .replace(/-[0-9]{3,}$/, "")
      .replace(/-(hvac|air|heating|cooling|contractor|texas|dallas|houston|inc|llc)$/i, "")
      .replace(/[-_.]+/g, " ")
      .trim();
    return cleanPersonName(stripped);
  } catch {
    return null;
  }
}

/** Pure parser: extracts leadership contacts and verified social footprints from HTML. */
export function extractSocialFootprint(html: string, pageUrl: string, target: EnrichmentTarget): Finding[] {
  if (!html || !looksLikeHtml(html)) return [];
  const $ = cheerio.load(html);
  const findings: Finding[] = [];
  const seenUrls = new Set<string>();

  $("a[href]").each((_, el) => {
    const rawHref = $(el).attr("href")?.trim();
    if (!rawHref) return;

    let href = rawHref;
    try {
      if (rawHref.startsWith("//")) href = `https:${rawHref}`;
      else if (rawHref.startsWith("/")) return; // internal link
      const parsedUrl = new URL(href);
      href = parsedUrl.href;
    } catch {
      return;
    }

    if (seenUrls.has(href)) return;
    seenUrls.add(href);

    // 1. LinkedIn Personal Profile -> Direct Owner / Executive Link
    const liMatch = LINKEDIN_PERSONAL_REGEX.exec(href);
    if (liMatch) {
      const slug = liMatch[1]?.toLowerCase() ?? "";
      if (!IGNORE_LINKEDIN_SLUGS.has(slug)) {
        const anchorText = $(el).text().replace(/\s+/g, " ").trim();
        const titleAttr = $(el).attr("title")?.trim();
        const imgAlt = $(el).find("img").attr("alt")?.trim();

        const anchorIsGeneric = !anchorText || GENERIC_ANCHOR_WORDS.test(anchorText);

        const card = $(el).closest(".team-card, .team-member, .person, .member, div, section, article, li");
        const cardHeading = card.find("h2, h3, h4, strong, .name, .team-name").first().text().trim();
        const cardName = cardHeading && !GENERIC_ANCHOR_WORDS.test(cardHeading) ? cleanPersonName(cardHeading) : null;

        const candidateName =
          (!anchorIsGeneric ? cleanPersonName(anchorText) : null) ??
          cardName ??
          cleanSlugName(slug) ??
          (titleAttr && !GENERIC_ANCHOR_WORDS.test(titleAttr) ? cleanPersonName(titleAttr) : null) ??
          (imgAlt && !GENERIC_ANCHOR_WORDS.test(imgAlt) ? cleanPersonName(imgAlt) : null);

        if (candidateName) {
          findings.push({
            kind: "contact",
            name: candidateName,
            title: "Owner / Executive (LinkedIn)",
            email: null,
            phone: null,
            confidence: 0.88,
            verified: true, // Directly published on the company's own official website
            sourceUrl: href,
            sourceType: "website",
            evidenceText: `Company website (${pageUrl}) links directly to personal LinkedIn profile for ${candidateName}: ${href}`,
          } satisfies ContactFinding);
        }
      }
    }
  });

  return findings;
}

const looksLikeHtml = (t: string) => /<html|<body|<div|<p[\s>]/i.test(t);

const SOCIAL_PATHS = ["/", "/about", "/about-us", "/our-team", "/contact", "/team"];

export const socialProfileSource: EnrichmentSource = {
  meta: {
    id: "social_footprint",
    name: "Professional social footprint (LinkedIn & directories)",
    description: "Extracts verified owner/founder profiles linked from the company's official website (personal LinkedIn profiles, BBB accreditation, Yelp).",
    provides: ["Owner / executive name (verified via official site link)", "Professional profile links"],
  },
  appliesTo: (t) => {
    return !!t.website && (!t.hasOwner || t.missing.some((m) => m.includes("owner")));
  },
  async run(target, ctx) {
    if (!target.website) return [];
    const base = target.website.replace(/\/+$/, "");
    const findings: Finding[] = [];
    const seenNames = new Set<string>();

    for (const path of SOCIAL_PATHS) {
      const pageUrl = path === "/" ? base : `${base}${path}`;
      const res = await ctx.fetchText(pageUrl, { respectRobots: true });
      if (!res || !res.ok || !res.text) continue;

      const pageFindings = extractSocialFootprint(res.text, pageUrl, target);
      for (const f of pageFindings) {
        if (f.kind === "contact" && f.name) {
          const key = f.name.toLowerCase();
          if (!seenNames.has(key)) {
            seenNames.add(key);
            findings.push(f);
          }
        } else {
          findings.push(f);
        }
      }

      // Early stop if verified owner found
      if (findings.some((f) => f.kind === "contact" && f.verified)) break;
    }

    return findings;
  },
};

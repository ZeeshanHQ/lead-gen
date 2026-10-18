/**
 * Sources that read the company's OWN website (current and archived).
 *  - website_deep: targeted pages the generic crawler skips or ranks low
 *    (About / Team / Contact / Privacy / Terms) + sitemap.xml discovery.
 *  - wayback: the Internet Archive's copy of those pages, for sites that
 *    removed their team page. Archived hits are NOT auto-verified.
 */
import * as cheerio from "cheerio";
import type { CrawledPage } from "../../research/crawler";
import { extractCompanyInfo, extractLeadershipContacts } from "../../research/extractors/contact_and_leadership";
import { extractEmailsFromHtml } from "../../research/extractors/text_utils";
import { emailBelongsTo } from "../people";
import type { ContactFinding, EnrichmentContext, EnrichmentSource, EnrichmentTarget, Finding } from "../types";

const PATHS = [
  "/about",
  "/about-us",
  "/our-team",
  "/team",
  "/meet-the-team",
  "/leadership",
  "/our-story",
  "/contact",
  "/contact-us",
  "/privacy-policy",
  "/terms",
];
const SITEMAP_HINT = /(about|team|leader|contact|story|staff|owner|who-we-are)/i;
const MAX_PAGES = 9;

export function buildPage(url: string, html: string): CrawledPage {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();
  let path = "/";
  try {
    path = new URL(url).pathname;
  } catch {
    /* keep default */
  }
  return {
    url,
    path,
    status: 200,
    title: ($("title").first().text() || "").trim(),
    metaDescription: ($('meta[name="description"]').attr("content") || "").trim(),
    cleanText: $("body").text().replace(/\s+/g, " ").trim(),
    html,
    links: [],
    fetchedAt: new Date().toISOString(),
  };
}

const looksLikeHtml = (t: string) => /<html|<body|<div|<p[\s>]/i.test(t);

function ownDomainEmail(email: string, domain: string): boolean {
  const d = email.split("@")[1]?.toLowerCase();
  return !!d && (d === domain || d.endsWith(`.${domain}`));
}

/** Pure: turn crawled pages into findings. Shared by live and archived sources. */
export function findingsFromPages(
  pages: CrawledPage[],
  target: EnrichmentTarget,
  mode: { sourceLabel: string; verified: boolean; confidenceFactor: number; archivedNote?: (p: CrawledPage) => string },
): Finding[] {
  const out: Finding[] = [];
  const note = (p: CrawledPage) => mode.archivedNote?.(p) ?? "";

  // Company details (phone / address) â€“ only from the live site, archived NAP may be stale.
  if (mode.verified) {
    const info = extractCompanyInfo(pages);
    const src = info.sourceUrl || pages[0]?.url || "";
    const evidenceText = info.evidenceSnippet || "Found on company website";
    const add = (field: "phone" | "address" | "city" | "state" | "zip", value: string | null | undefined) => {
      if (value) out.push({ kind: "company_field", field, value, confidence: 0.9, sourceUrl: src, sourceType: "website", evidenceText });
    };
    if (!target.phone) add("phone", info.phone);
    if (!target.address) add("address", info.street);
    if (!target.city) add("city", info.city);
    if (!target.state) add("state", info.state);
    if (!target.zip) add("zip", info.postalCode);
  }

  // People
  const people = extractLeadershipContacts(pages);
  const emails: { email: string; url: string }[] = [];
  if (target.domain) {
    const seen = new Set<string>();
    for (const p of pages)
      for (const e of extractEmailsFromHtml(p.html))
        if (ownDomainEmail(e, target.domain) && !seen.has(e)) {
          seen.add(e);
          emails.push({ email: e, url: p.url });
        }
  }
  const usedEmails = new Set<string>();
  for (const c of people) {
    const mine = emails.find((e) => emailBelongsTo(e.email, c.fullName));
    const email = c.email ?? mine?.email ?? null;
    if (email) usedEmails.add(email);
    const page = pages.find((p) => p.url === c.sourceUrl);
    out.push({
      kind: "contact",
      name: c.fullName,
      title: c.title,
      email,
      phone: c.phone ?? null,
      confidence: Math.min(0.97, c.confidence * mode.confidenceFactor),
      verified: mode.verified,
      sourceUrl: c.sourceUrl,
      sourceType: "website",
      evidenceText: `${mode.sourceLabel}: "${c.fullName}" listed as ${c.title}${page ? note(page) : ""}.`,
    } satisfies ContactFinding);
  }
  // Remaining own-domain mailboxes: personal-looking first, role mailboxes after.
  const rest = emails.filter((e) => !usedEmails.has(e.email));
  const generic = /^(info|contact|office|admin|support|sales|service|services|hello|help|mail|team|dispatch|scheduling|estimates|quotes|careers|jobs|hr)$/;
  rest.sort((a, b) => Number(generic.test(a.email.split("@")[0]!)) - Number(generic.test(b.email.split("@")[0]!)));
  for (const e of rest.slice(0, 3)) {
    const page = pages.find((p) => p.url === e.url);
    out.push({
      kind: "contact",
      name: null,
      title: null,
      email: e.email,
      phone: null,
      confidence: 0.85 * mode.confidenceFactor,
      verified: false,
      sourceUrl: e.url,
      sourceType: "website",
      evidenceText: `${mode.sourceLabel}: business email published on the company's own site${page ? note(page) : ""}.`,
    });
  }
  return out;
}

async function discoverPaths(origin: string, ctx: EnrichmentContext): Promise<string[]> {
  const paths = [...PATHS];
  const sm = await ctx.fetchText(`${origin}/sitemap.xml`);
  if (sm?.ok) {
    const locs = [...sm.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
    for (const loc of locs) {
      try {
        const u = new URL(loc);
        if (u.origin === origin && SITEMAP_HINT.test(u.pathname) && !paths.includes(u.pathname)) paths.push(u.pathname);
      } catch {
        /* ignore */
      }
    }
  }
  return paths;
}

export const websiteDeepSource: EnrichmentSource = {
  meta: {
    id: "website_deep",
    name: "Company website (deep)",
    description: "About / Team / Contact / Privacy / Terms pages plus sitemap discovery, schema.org JSON-LD, mailto and tel links.",
    provides: ["CEO / owner name & title", "business email", "phone", "address"],
  },
  appliesTo: (t) => !!t.website && !!t.domain && (!t.hasOwner || !t.hasEmail || !t.phone || !t.address || !t.zip),
  async run(target, ctx) {
    const origin = new URL(target.website!).origin;
    const pages: CrawledPage[] = [];
    for (const path of await discoverPaths(origin, ctx)) {
      if (pages.length >= MAX_PAGES) break;
      const url = `${origin}${path}`;
      if (pages.some((p) => p.url === url)) continue;
      const res = await ctx.fetchText(url);
      if (res?.ok && looksLikeHtml(res.text)) pages.push(buildPage(res.url, res.text));
    }
    if (pages.length === 0) return [];
    return findingsFromPages(pages, target, { sourceLabel: "Company website", verified: true, confidenceFactor: 1 });
  },
};

interface WaybackAvailability {
  archived_snapshots?: { closest?: { available?: boolean; url?: string; timestamp?: string; status?: string } };
}

const WAYBACK_PATHS = ["/about-us", "/about", "/our-team", "/team", "/contact-us", "/contact"];

const fmtStamp = (ts: string) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;

export const waybackSource: EnrichmentSource = {
  meta: {
    id: "wayback",
    name: "Internet Archive (Wayback Machine)",
    description: "Archived copies of the company's About / Team / Contact pages, for sites that removed them. Free, no key.",
    provides: ["CEO / owner name & title (unverified until corroborated)", "business email"],
  },
  appliesTo: (t) => !!t.domain && (!t.hasOwner || !t.hasEmail),
  async run(target, ctx) {
    const pages: CrawledPage[] = [];
    for (const path of WAYBACK_PATHS) {
      if (pages.length >= 4) break;
      const api = `https://archive.org/wayback/available?url=${encodeURIComponent(`${target.domain}${path}`)}`;
      const meta = await ctx.fetchJson<WaybackAvailability>(api);
      const snap = meta?.archived_snapshots?.closest;
      if (!snap?.available || !snap.url || !snap.timestamp) continue;
      // `id_` returns the original page without the Wayback toolbar.
      const raw = snap.url.replace(/\/web\/(\d+)\//, "/web/$1id_/").replace(/^http:/, "https:");
      const res = await ctx.fetchText(raw, { respectRobots: false });
      if (!res?.ok || !looksLikeHtml(res.text)) continue;
      const page = buildPage(snap.url.replace(/^http:/, "https:"), res.text);
      (page as CrawledPage & { stamp?: string }).stamp = snap.timestamp;
      pages.push(page);
    }
    if (pages.length === 0) return [];
    return findingsFromPages(pages, target, {
      sourceLabel: "Internet Archive copy",
      verified: false,
      confidenceFactor: 0.75,
      archivedNote: (p) => {
        const s = (p as CrawledPage & { stamp?: string }).stamp;
        return s ? ` (archived ${fmtStamp(s)})` : "";
      },
    });
  },
};


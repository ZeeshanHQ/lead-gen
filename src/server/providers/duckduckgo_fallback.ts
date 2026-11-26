import * as cheerio from "cheerio";
import type { DiscoveredCandidate } from "./types";
import { EXCLUDED_AGGREGATOR_DOMAINS } from "./tavily_adapter";
import { companyNameFrom, isOffNicheSearchResult, type PlannedQuery } from "./tavily_plan";

function decodeDuckDuckGoUrl(rawHref: string): string | null {
  if (!rawHref) return null;
  try {
    if (rawHref.startsWith("//")) {
      rawHref = `https:${rawHref}`;
    } else if (rawHref.startsWith("/")) {
      rawHref = `https://html.duckduckgo.com${rawHref}`;
    }
    const parsed = new URL(rawHref);
    const uddg = parsed.searchParams.get("uddg");
    if (uddg && uddg.startsWith("http")) {
      return uddg;
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      if (!parsed.hostname.includes("duckduckgo.com")) {
        return parsed.toString();
      }
    }
  } catch {
    return null;
  }
  return null;
}

function isExcludedUrl(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    const domain = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!domain || !domain.includes(".")) return null;
    if (EXCLUDED_AGGREGATOR_DOMAINS.some((ex) => domain === ex || domain.endsWith(`.${ex}`))) {
      return null;
    }
    return domain;
  } catch {
    return null;
  }
}

/**
 * Free, card-free fallback search using DuckDuckGo HTML when Tavily is unconfigured
 * or hits quota/rate limits. Uses the exact same query plan & domain filters.
 */
export async function runDuckDuckGoFallback(
  plan: PlannedQuery[],
  options: {
    limit: number;
    excludeDomains?: string[];
    negativeKeywords?: string[];
    businessType?: "residential" | "commercial" | "both";
  }
): Promise<DiscoveredCandidate[]> {
  const seenDomains = new Set<string>(
    (options.excludeDomains ?? []).map((d) => d.toLowerCase().replace(/^www\./, ""))
  );
  const candidates: DiscoveredCandidate[] = [];
  const maxQueries = Math.min(plan.length, 6);

  for (let i = 0; i < maxQueries; i++) {
    if (candidates.length >= options.limit) break;
    const q = plan[i]!;

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q.queryText)}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(9000),
      });

      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);

      $(".result").each((_, el) => {
        if (candidates.length >= options.limit) return;
        const link = $(el).find("a.result__a").first();
        const rawHref = link.attr("href") || "";
        const targetUrl = decodeDuckDuckGoUrl(rawHref);
        if (!targetUrl) return;

        const domain = isExcludedUrl(targetUrl);
        if (!domain || seenDomains.has(domain)) return;

        const title = link.text().trim();
        const snippet = $(el).find(".result__snippet").text().trim();

        if (
          isOffNicheSearchResult({
            url: targetUrl,
            title,
            content: snippet,
            negativeKeywords: options.negativeKeywords,
            businessType: options.businessType,
          })
        ) {
          return;
        }

        seenDomains.add(domain);
        const name = companyNameFrom(title, domain);
        const rootWebsite = `https://${domain}`;

        candidates.push({
          name,
          website: rootWebsite,
          city: q.city,
          state: q.state,
          provider: "duckduckgo_fallback",
          providerRef: `ddg_${domain}`,
          sourceUrl: targetUrl,
          rawPayload: {
            title,
            content: snippet,
            query: q.queryText,
            fallbackSource: "duckduckgo_html",
          },
        });
      });
    } catch {
      // Non-fatal: move to next planned query
    }
  }

  return candidates;
}

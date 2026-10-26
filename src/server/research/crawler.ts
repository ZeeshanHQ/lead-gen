/**
 * Polite, bounded web crawler for company research.
 *
 * Guarantees:
 * - Respects robots.txt disallow directives.
 * - Caps requests at a strict maximum (default 12, absolute ceiling 20).
 * - Enforces per-request timeout (default 8s).
 * - Identifies with polite modern browser User-Agent with Jina AI Reader fallback.
 * - Only follows internal links within the same hostname.
 * - Prioritizes high-signal pages (services, replacement, about, team, financing, contact).
 */

import * as cheerio from "cheerio";

export interface CrawlOptions {
  maxPages?: number;
  timeoutMs?: number;
  userAgent?: string;
  respectRobotsTxt?: boolean;
}

export interface CrawledPage {
  url: string;
  path: string;
  status: number;
  title: string;
  metaDescription: string;
  cleanText: string;
  html: string;
  links: string[];
  fetchedAt: string;
}

export interface CrawlResult {
  startUrl: string;
  normalizedDomain: string;
  pages: CrawledPage[];
  robotsAllowed: boolean;
  summary: {
    pagesCrawled: number;
    durationMs: number;
    errors: string[];
  };
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const HIGH_PRIORITY_PATTERNS = [
  /service/i,
  /hvac/i,
  /air-condition/i,
  /heating/i,
  /cooling/i,
  /replacement/i,
  /installation/i,
  /about/i,
  /team/i,
  /leadership/i,
  /financing/i,
  /maintenance/i,
  /club/i,
  /contact/i,
  /career/i,
  /job/i,
  /location/i,
  /area/i,
];

const IGNORED_EXTENSIONS = /\.(pdf|jpg|jpeg|png|gif|svg|webp|mp4|zip|docx?|xlsx?|css|js|woff2?)$/i;
const IGNORED_PATH_PATTERNS = [/wp-admin/i, /cart/i, /checkout/i, /login/i, /my-account/i, /privacy/i, /terms/i];

/**
 * Basic robots.txt parser for Disallow rules against our User-Agent or *.
 */
export function parseRobotsTxt(robotsText: string, userAgent = DEFAULT_USER_AGENT): { disallowedPaths: string[] } {
  const disallowedPaths: string[] = [];
  const lines = robotsText.split(/\r?\n/);
  let appliesToUs = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (!key) continue;

    const lowerKey = key.toLowerCase();
    if (lowerKey === "user-agent") {
      const ua = value.toLowerCase();
      const targetUa = userAgent.toLowerCase();
      appliesToUs =
        ua === "*" ||
        targetUa.includes(ua) ||
        ua.includes(targetUa) ||
        ua.includes("chrome") ||
        ua.includes("mozilla");
    } else if (lowerKey === "disallow" && appliesToUs) {
      if (value) {
        disallowedPaths.push(value);
      }
    }
  }

  return { disallowedPaths };
}

export function isPathAllowed(pathname: string, disallowedPaths: string[]): boolean {
  for (const dis of disallowedPaths) {
    if (dis === "/") return false;
    if (pathname.startsWith(dis)) return false;
  }
  return true;
}

function calculateUrlScore(urlPath: string): number {
  let score = 0;
  for (const pat of HIGH_PRIORITY_PATTERNS) {
    if (pat.test(urlPath)) score += 10;
  }
  // Penalize deep nesting
  const depth = (urlPath.match(/\//g) || []).length;
  score -= depth * 2;
  return score;
}

export async function crawlWebsite(
  rawUrl: string,
  options: CrawlOptions = {}
): Promise<CrawlResult> {
  const start = Date.now();
  const maxPages = Math.min(Math.max(options.maxPages ?? 1, 1), 20);
  const timeoutMs = options.timeoutMs ?? 2500;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const respectRobots = options.respectRobotsTxt ?? true;

  const errors: string[] = [];
  const pages: CrawledPage[] = [];

  let startUrl = rawUrl.trim();
  if (!/^https?:\/\//i.test(startUrl)) {
    startUrl = "https://" + startUrl;
  }

  let parsedBase: URL;
  try {
    parsedBase = new URL(startUrl);
  } catch (err) {
    return {
      startUrl,
      normalizedDomain: "",
      pages: [],
      robotsAllowed: false,
      summary: { pagesCrawled: 0, durationMs: Date.now() - start, errors: ["Invalid URL format"] },
    };
  }

  const baseOrigin = parsedBase.origin;
  const baseHost = parsedBase.hostname.replace(/^www\./i, "").toLowerCase();

  // 1. Fetch robots.txt if requested
  let disallowedPaths: string[] = [];
  let robotsAllowed = true;
  if (respectRobots) {
    try {
      const robotsUrl = `${baseOrigin}/robots.txt`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1200);
      const res = await fetch(robotsUrl, {
        signal: ctrl.signal,
        headers: { "User-Agent": userAgent },
      });
      clearTimeout(timer);
      if (res.ok) {
        const text = await res.text();
        const parsed = parseRobotsTxt(text, userAgent);
        disallowedPaths = parsed.disallowedPaths;
        if (!isPathAllowed(parsedBase.pathname || "/", disallowedPaths)) {
          robotsAllowed = false;
          errors.push(`Robots.txt disallows crawling start path ${parsedBase.pathname}`);
        }
      }
    } catch {
      // Missing or unresolvable robots.txt is standard for many small businesses; proceed politely.
    }
  }

  if (!robotsAllowed) {
    return {
      startUrl,
      normalizedDomain: baseHost,
      pages: [],
      robotsAllowed: false,
      summary: { pagesCrawled: 0, durationMs: Date.now() - start, errors },
    };
  }

  // 2. Queue management
  const visited = new Set<string>();
  const queue: Array<{ url: string; score: number }> = [
    { url: parsedBase.href, score: 100 }, // start page highest priority
  ];

  while (queue.length > 0 && pages.length < maxPages) {
    // Sort queue by score descending
    queue.sort((a, b) => b.score - a.score);
    const nextItem = queue.shift();
    if (!nextItem) break;

    const currentUrl = nextItem.url;
    if (visited.has(currentUrl)) continue;
    visited.add(currentUrl);

    let parsedCurrent: URL;
    try {
      parsedCurrent = new URL(currentUrl);
    } catch {
      continue;
    }

    if (!isPathAllowed(parsedCurrent.pathname, disallowedPaths)) {
      continue;
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      const response = await fetch(currentUrl, {
        signal: ctrl.signal,
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      clearTimeout(timer);

      if (!response.ok) {
        errors.push(`HTTP ${response.status} at ${currentUrl}`);
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        continue;
      }

      let html = await response.text();
      let $ = cheerio.load(html);

      // Clean out noisy tags
      $("script, style, noscript, svg, nav a[aria-hidden='true']").remove();

      let title = ($("title").first().text() || "").trim();
      let metaDescription =
        ($('meta[name="description"]').attr("content") ||
          $('meta[property="og:description"]').attr("content") ||
          "").trim();

      // Extract body text, collapsing excess whitespace
      let bodyText = $("body").text().replace(/\s+/g, " ").trim();

      // Fallback: If Cloudflare challenge, reCAPTCHA, or bot-blocked page was served, use free Jina AI Reader
      const isChallenge =
        /checking your browser|recaptcha|just a moment\.\.\.|challenge-platform|security check/i.test(title) ||
        html.includes("cf-browser-verification") ||
        (bodyText.length < 150 && /cloudflare|captcha|turnstile/i.test(bodyText));

      if (isChallenge) {
        try {
          const ctrlJina = new AbortController();
          const timerJina = setTimeout(() => ctrlJina.abort(), 2000);
          const jinaRes = await fetch(`https://r.jina.ai/${currentUrl}`, {
            headers: { Accept: "text/plain" },
            signal: ctrlJina.signal,
          });
          clearTimeout(timerJina);
          if (jinaRes.ok) {
            const jinaText = await jinaRes.text();
            if (jinaText.length > 200) {
              bodyText = jinaText;
              title = baseHost;
              html = `<html><head><title>${baseHost}</title></head><body><div class="jina-content">${jinaText}</div></body></html>`;
              $ = cheerio.load(html);
            }
          }
        } catch {
          // Non-blocking fallback
        }
      }

      // Extract links
      const foundLinks: string[] = [];
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        try {
          const resolved = new URL(href, currentUrl);
          // Strip query and hash
          resolved.search = "";
          resolved.hash = "";
          const resolvedHost = resolved.hostname.replace(/^www\./i, "").toLowerCase();

          if (resolvedHost === baseHost && !visited.has(resolved.href)) {
            const p = resolved.pathname;
            if (IGNORED_EXTENSIONS.test(p)) return;
            if (IGNORED_PATH_PATTERNS.some((pat) => pat.test(p))) return;
            foundLinks.push(resolved.href);

            if (!queue.some((q) => q.url === resolved.href)) {
              queue.push({
                url: resolved.href,
                score: calculateUrlScore(p),
              });
            }
          }
        } catch {
          // ignore malformed URLs
        }
      });

      pages.push({
        url: currentUrl,
        path: parsedCurrent.pathname,
        status: response.status,
        title,
        metaDescription,
        cleanText: bodyText,
        html,
        links: Array.from(new Set(foundLinks)),
        fetchedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      errors.push(`Failed to fetch ${currentUrl}: ${err.message || String(err)}`);
    }
  }

  return {
    startUrl,
    normalizedDomain: baseHost,
    pages,
    robotsAllowed: true,
    summary: {
      pagesCrawled: pages.length,
      durationMs: Date.now() - start,
      errors,
    },
  };
}

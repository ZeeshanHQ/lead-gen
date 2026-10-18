import { isPathAllowed, parseRobotsTxt } from "../research/crawler";
import type { EnrichmentContext, HttpResult } from "./types";

const USER_AGENT = "AstraventaResearchBot/1.0 (+https://astraventa.ai/bot; research@astraventa.ai)";
const MAX_BYTES = 1_500_000;

async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Polite, bounded network layer. Failures return null; sources treat that as "no data". */
export function createHttpContext(opts: { timeoutMs?: number } = {}): EnrichmentContext {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const robotsCache = new Map<string, string[]>();

  async function robotsFor(origin: string): Promise<string[]> {
    const hit = robotsCache.get(origin);
    if (hit) return hit;
    const res = await timedFetch(`${origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT } }, 4000);
    let disallowed: string[] = [];
    if (res?.ok) disallowed = parseRobotsTxt(await res.text(), USER_AGENT).disallowedPaths;
    robotsCache.set(origin, disallowed);
    return disallowed;
  }

  return {
    async fetchText(url, o): Promise<HttpResult | null> {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return null;
      }
      if (o?.respectRobots !== false && !isPathAllowed(parsed.pathname, await robotsFor(parsed.origin))) return null;
      const res = await timedFetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5" } }, timeoutMs);
      if (!res) return null;
      const text = (await res.text()).slice(0, MAX_BYTES);
      return { ok: res.ok, status: res.status, url: res.url || url, text };
    },
    async fetchJson<T>(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<T | null> {
      const res = await timedFetch(
        url,
        { method: init?.method ?? "GET", body: init?.body, headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...(init?.headers ?? {}) } },
        timeoutMs * 2,
      );
      if (!res?.ok) return null;
      try {
        return (await res.json()) as T;
      } catch {
        return null;
      }
    },
  };
}

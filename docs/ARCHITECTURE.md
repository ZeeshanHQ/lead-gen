# Architecture & Build Plan

## Phase 0 findings

| Item | Finding |
|---|---|
| Repository | Empty folder, so this is greenfield. Nothing was overwritten. |
| Git | The folder is not its own git repo. Git resolves to the user home directory. |
| Runtime | Node 24.9, npm 11.6. |
| Not installed | pnpm, PostgreSQL, Docker, Ollama. |
| Decision | npm, Next.js (App Router), TypeScript, Tailwind 4, Drizzle ORM, Zod, Vitest, Playwright. |

### Database decision
No PostgreSQL is installed and Docker is unavailable.
- **Default for local dev:** PGlite, which is real PostgreSQL 17 compiled to WASM and persisted to `./.data/pglite`.
- **Production and any multi-process setup:** set `DATABASE_URL=postgresql://…` (Supabase works). The same Drizzle schema and migrations run on both.
- **Limitation:** PGlite allows one process per data directory. A separate worker process therefore needs real Postgres. Until then (Phases 2–3) the job runner runs inside the Next server process.

## Layers

```
src/server/domain     pure logic, no I/O, unit tested
                      normalize, dedupe, rules, lifecycle, contact, facts, markets
src/server/db         Drizzle schema, client (pglite | pg), bootstrap
src/server/repo       persistence and use-cases: every write goes through audit()
src/server/env.ts     zod env validation (fails fast on malformed values)
src/server/secrets.ts secret abstraction; values never leave the server
src/app               Next.js UI (server components + server actions)
src/components        UI primitives and feature components
```

Rules that shape the code:
1. **One write path for facts.** `setFact()` writes the current value, an evidence row, and an audit row together. It never overwrites a `HUMAN_CONFIRMED` value. Instead it files a `field_suggestions` row for the user to accept or reject.
2. **Three provenance labels, never mixed.** `PUBLICLY_VERIFIED`, `RESEARCH_INFERENCE`, `HUMAN_CONFIRMED`.
3. **Unknown stays unknown.** Fact values are `YES | NO | UNKNOWN | CONFLICTING`. Absence of evidence is `UNKNOWN`, never `NO`.
4. **Sync eligibility is one function** (`isSyncEligible`). It is true only for leads with an explicit approval record.
5. **Niche is data, not code.** `markets` rows hold keywords, service taxonomy and hard negatives. HVAC is the first seeded market.
6. **Providers are adapters** registered in the `sources` table, each with an enable switch, quota and cost. Adapters arrive in Phase 3.

## Phase 1 file list

**Config and docs:** `package.json`, `tsconfig.json`, `next.config.ts`, `drizzle.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `.env.example`, `.gitignore`, `README.md`, `docs/ARCHITECTURE.md`

**Domain (pure):** `normalize.ts`, `dedupe.ts`, `facts.ts`, `rules.ts`, `lifecycle.ts`, `contact.ts`, `markets.ts`

**DB and server:** `db/schema.ts` (all tables in the spec plus `markets`, `research_rules`, `company_source_refs`, `field_suggestions`), `db/client.ts`, `db/bootstrap.ts`, `env.ts`, `secrets.ts`, `repo/{audit,companies,facts,rules,approvals,exclusions,settings,contacts,stats}.ts`

**UI:** dashboard shell with 13 tabs. Built in Phase 1:
- Overview
- Research Rules (full builder)
- Discover Leads (manual entry)
- Review Queue (filters, approval modal, evidence drawer)
- Approved Leads
- Contacts
- Exclusions
- Settings
- Audit Log
- Company page

Tabs for later phases (Research Runs, Google Sheets, Sources, Usage & Costs) are visible and say plainly which phase builds them.

**Tests:**
- `tests/unit/*`: normalization, dedupe, rules, lifecycle, contact, and the repository layer against in-memory PGlite
- `tests/e2e/review-flow.spec.ts`: Playwright against a separate throwaway DB

## Blockers and risks
- **No authentication yet** (Phase 8). The dashboard must not be exposed publicly until then. The actor is recorded as `local-user`.
- **Google OAuth credentials** are needed from you for Phase 6 (Cloud project, OAuth client, test user).
- **No search or enrichment API key is configured.** Discovery in Phase 3 starts with CSV upload, user URLs and the website adapter. Paid or keyed providers stay disabled until you add keys.
- **Demo data vs. no fake data.** Phase 1 ships no seeded companies. "Test Research" in Phase 2 runs on real URLs you enter, and the e2e suite uses a throwaway DB.

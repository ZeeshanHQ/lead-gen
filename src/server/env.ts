/**
 * Environment validation. Server-only.
 *
 * - Malformed values fail fast at startup.
 * - Missing optional provider keys are NOT fatal; they are reported by
 *   `providerRequirements()` so the UI can say plainly what each provider needs.
 */
import { z } from "zod";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());

const LLM_PROVIDERS = ["none", "local", "openai", "gemini", "anthropic"] as const;

const envSchema = z.object({
  DATABASE_URL: z
    .preprocess(emptyToUndefined, z.string().optional())
    .default("pglite://./.data/pglite")
    .refine((v) => /^(pglite:\/\/|postgres(ql)?:\/\/|memory:\/\/)/.test(v), {
      message: "DATABASE_URL must start with pglite://, memory://, postgres:// or postgresql://",
    }),

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: optionalString,
  GOOGLE_SHEETS_SCOPES: z
    .preprocess(emptyToUndefined, z.string().optional())
    .default("https://www.googleapis.com/auth/spreadsheets"),
  SECRETS_ENCRYPTION_KEY: optionalString,

  LLM_PROVIDER: z.preprocess(emptyToUndefined, z.enum(LLM_PROVIDERS).default("none")),
  LLM_API_KEY: optionalString,
  LLM_MODEL: optionalString,
  OLLAMA_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().default("http://localhost:11434")),

  SEARCH_PROVIDER: z.preprocess(emptyToUndefined, z.string().default("none")),
  SEARCH_API_KEY: optionalString,
  TAVILY_API_KEY: optionalString,
  PLACES_API_KEY: optionalString,

  ENRICHMENT_PROVIDER: z.preprocess(emptyToUndefined, z.string().default("none")),
  ENRICHMENT_API_KEY: optionalString,

  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,

  MAX_RUN_COST: z.preprocess(emptyToUndefined, z.coerce.number().nonnegative().default(5)),
  MAX_REQUESTS_RUN: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(500)),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export class EnvValidationError extends Error {
  constructor(public issues: string[]) {
    super(`Invalid environment configuration:\n - ${issues.join("\n - ")}`);
    this.name = "EnvValidationError";
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Auto-detect LLM_PROVIDER if LLM_API_KEY is provided without explicit provider
  const rawProvider = source.LLM_PROVIDER?.trim();
  const rawKey = source.LLM_API_KEY?.trim();
  let effectiveProvider = rawProvider;
  if ((!rawProvider || rawProvider === "none") && rawKey) {
    if (rawKey.startsWith("AIzaSy")) effectiveProvider = "gemini";
    else if (rawKey.startsWith("sk-ant-")) effectiveProvider = "anthropic";
    else if (rawKey.startsWith("sk-")) effectiveProvider = "openai";
    else effectiveProvider = "gemini";
  }

  const modifiedSource = {
    ...source,
    LLM_PROVIDER: effectiveProvider || source.LLM_PROVIDER,
  };

  const result = envSchema.safeParse(modifiedSource);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`),
    );
  }
  return result.data;
}

export function getEnv(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

/** Test helper. */
export function resetEnvCache() {
  cached = null;
}

export interface ProviderRequirement {
  provider: string;
  kind: "llm" | "search" | "places" | "enrichment" | "google";
  configured: boolean;
  /** Human-readable explanation shown in Settings. */
  message: string;
}

/** Tells the user, per provider, whether it needs a key and whether it has one. */
export function providerRequirements(env: Env = getEnv()): ProviderRequirement[] {
  const out: ProviderRequirement[] = [];

  if (env.LLM_PROVIDER === "none") {
    out.push({ provider: "LLM", kind: "llm", configured: true, message: "Disabled. All extraction uses deterministic rules." });
  } else if (env.LLM_PROVIDER === "local") {
    out.push({ provider: "LLM (local / Ollama)", kind: "llm", configured: true, message: `Uses Ollama at ${env.OLLAMA_BASE_URL}. No API key. Reachability is not tested until the first use.` });
  } else {
    out.push({
      provider: `LLM (${env.LLM_PROVIDER})`,
      kind: "llm",
      configured: !!env.LLM_API_KEY,
      message: env.LLM_API_KEY ? "API key present (not yet tested)." : "Requires LLM_API_KEY.",
    });
  }

  const tavilyConfigured = !!(env.TAVILY_API_KEY || (env.SEARCH_PROVIDER === "tavily" && env.SEARCH_API_KEY));
  out.push({
    provider: "Tavily Search API",
    kind: "search",
    configured: tavilyConfigured,
    message: tavilyConfigured
      ? "API key present. Real-time web discovery active (1,000 free credits/mo)."
      : "Not configured. Set TAVILY_API_KEY in .env.local or configure in Sources tab.",
  });

  out.push({
    provider: "Google Places (optional)",
    kind: "places",
    configured: !!env.PLACES_API_KEY,
    message: env.PLACES_API_KEY ? "API key present. Adapter arrives in Phase 3, disabled by default." : "Not configured. Optional; the system does not depend on it.",
  });

  out.push(
    env.ENRICHMENT_PROVIDER === "none"
      ? { provider: "B2B enrichment", kind: "enrichment", configured: true, message: "None (valid default). No credits are ever spent." }
      : { provider: `Enrichment (${env.ENRICHMENT_PROVIDER})`, kind: "enrichment", configured: !!env.ENRICHMENT_API_KEY, message: env.ENRICHMENT_API_KEY ? "API key present (not yet tested)." : "Requires ENRICHMENT_API_KEY." },
  );

  const g = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
  out.push({
    provider: "Google OAuth / Sheets",
    kind: "google",
    configured: g,
    message: g ? "OAuth client configured (connection arrives in Phase 6)." : "Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.",
  });
  return out;
}

/**
 * Secret-management abstraction. Server-only.
 *
 * All secret reads go through here so that (a) there is one place to swap in a
 * vault later and (b) secret VALUES can never be returned to UI code by accident:
 * the describe* helpers expose only presence and a masked preview.
 */
import "server-only";

export type SecretName =
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "SECRETS_ENCRYPTION_KEY"
  | "LLM_API_KEY"
  | "SEARCH_API_KEY"
  | "PLACES_API_KEY"
  | "ENRICHMENT_API_KEY"
  | "DATABASE_URL";

export class SecretMissingError extends Error {
  constructor(public secret: SecretName) {
    super(`Required secret ${secret} is not configured. Set it in .env.local (server-side only).`);
    this.name = "SecretMissingError";
  }
}

export function getSecret(name: SecretName): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : undefined;
}

export function requireSecret(name: SecretName): string {
  const v = getSecret(name);
  if (!v) throw new SecretMissingError(name);
  return v;
}

/** "sk-abcd1234efgh" → "sk-a…efgh". Short values are fully hidden. */
export function maskSecret(value: string): string {
  if (value.length <= 10) return "••••••";
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

export interface SecretStatus {
  name: SecretName;
  present: boolean;
  /** Masked preview only; never the value. Not provided for DATABASE_URL (contains passwords). */
  preview: string | null;
}

export function describeSecret(name: SecretName): SecretStatus {
  const v = getSecret(name);
  return {
    name,
    present: !!v,
    preview: v && name !== "DATABASE_URL" ? maskSecret(v) : null,
  };
}

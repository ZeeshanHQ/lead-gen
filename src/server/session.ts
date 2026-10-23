/**
 * Signed session cookies. Uses Web Crypto only so it runs in both the Node
 * runtime (server actions / pages) and the Proxy (edge-style) runtime.
 */
export const SESSION_COOKIE = "astraventa_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  const explicit = process.env.SESSION_SECRET?.trim();
  if (explicit) return explicit;
  // Fallback: derived from DATABASE_URL which is already a private secret.
  return `astraventa::${process.env.DATABASE_URL ?? "local-dev-secret"}`;
}

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

export async function signSession(memberId: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = `${memberId}.${exp}`;
  return `${payload}.${await hmac(payload)}`;
}

/** Returns the member id if the token is authentic and unexpired. */
export async function verifySession(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [memberId, expStr, sig] = parts as [string, string, string];
  const exp = Number(expStr);
  if (!memberId || !Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  const expected = await hmac(`${memberId}.${expStr}`);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? memberId : null;
}

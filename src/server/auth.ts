/**
 * Password credentials + current-session helpers (Node runtime only).
 * Hashes live under the `auth_credentials` system setting, deliberately NOT
 * inside the team registry, which is sent to the browser.
 */
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import type { Db } from "./db/client";
import { systemSettings } from "./db/schema";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession, verifySession } from "./session";

type Credentials = Record<string, { salt: string; hash: string }>;
const KEY = "auth_credentials";

async function readCreds(db: Db): Promise<Credentials> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, KEY)).limit(1);
  return (row?.value as Credentials) ?? {};
}

async function writeCreds(db: Db, creds: Credentials): Promise<void> {
  await db
    .insert(systemSettings)
    .values({ key: KEY, value: creds as never })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: creds as never, updatedAt: new Date() } });
}

export function validatePassword(pw: string): string | null {
  if (pw.length < 8) return "Password kam az kam 8 characters ka hona chahiye.";
  return null;
}

export async function setPassword(db: Db, memberId: string, password: string): Promise<void> {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  const creds = await readCreds(db);
  creds[memberId] = { salt, hash };
  await writeCreds(db, creds);
}

export async function verifyPassword(db: Db, memberId: string, password: string): Promise<boolean> {
  const c = (await readCreds(db))[memberId];
  if (!c) return false;
  const expected = Buffer.from(c.hash, "hex");
  const actual = scryptSync(password, c.salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function hasAnyCredentials(db: Db): Promise<boolean> {
  return Object.keys(await readCreds(db)).length > 0;
}

export async function hasCredential(db: Db, memberId: string): Promise<boolean> {
  return Boolean((await readCreds(db))[memberId]);
}

export async function removeCredential(db: Db, memberId: string): Promise<void> {
  const creds = await readCreds(db);
  if (creds[memberId]) {
    delete creds[memberId];
    await writeCreds(db, creds);
  }
}

export async function startSession(memberId: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await signSession(memberId), {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getSessionMemberId(): Promise<string | null> {
  try {
    const jar = await cookies();
    return await verifySession(jar.get(SESSION_COOKIE)?.value);
  } catch {
    return null;
  }
}

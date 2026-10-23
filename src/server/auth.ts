/**
 * Authentication, credentials, Email OTP, and session management.
 * Credentials live under `auth_credentials` and OTPs under `auth_email_otps`
 * in system_settings, keeping sensitive hashes isolated from client payloads.
 */
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import type { Db } from "./db/client";
import { systemSettings } from "./db/schema";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession, verifySession } from "./session";
import { sendOtpEmail } from "./services/email";
import { findMemberByEmail } from "./repo/team";

type Credentials = Record<string, { salt: string; hash: string }>;
type OtpRecord = {
  salt: string;
  hash: string;
  expiresAt: number;
  attempts: number;
};
type OtpMap = Record<string, OtpRecord>;

const CREDS_KEY = "auth_credentials";
const OTPS_KEY = "auth_email_otps";

async function readCreds(db: Db): Promise<Credentials> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, CREDS_KEY)).limit(1);
  return (row?.value as Credentials) ?? {};
}

async function writeCreds(db: Db, creds: Credentials): Promise<void> {
  await db
    .insert(systemSettings)
    .values({ key: CREDS_KEY, value: creds as never })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: creds as never, updatedAt: new Date() } });
}

async function readOtps(db: Db): Promise<OtpMap> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, OTPS_KEY)).limit(1);
  return (row?.value as OtpMap) ?? {};
}

async function writeOtps(db: Db, otps: OtpMap): Promise<void> {
  await db
    .insert(systemSettings)
    .values({ key: OTPS_KEY, value: otps as never })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: otps as never, updatedAt: new Date() } });
}

export function validatePassword(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters long.";
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

/**
 * Generate and dispatch a 6-digit OTP code to the requested email.
 */
export async function requestEmailOtp(
  db: Db,
  email: string
): Promise<{ ok: boolean; codePreview?: string; directSent?: boolean; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const member = await findMemberByEmail(db, cleanEmail);
  const needsInitialOwner = !(await hasAnyCredentials(db));

  if (!member && !needsInitialOwner) {
    return {
      ok: false,
      error: "No account found for this email. Please request an invitation from your workspace administrator.",
    };
  }

  if (member && member.status === "SUSPENDED") {
    return {
      ok: false,
      error: "This account has been deactivated. Please contact your workspace administrator.",
    };
  }

  // Generate cryptographic 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(code, salt, 64).toString("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  const otps = await readOtps(db);
  otps[cleanEmail] = { salt, hash, expiresAt, attempts: 0 };
  await writeOtps(db, otps);

  const dispatch = await sendOtpEmail({
    to: cleanEmail,
    recipientName: member?.name || "Workspace User",
    code,
    workspaceName: "Astraventa",
  });

  return {
    ok: true,
    directSent: dispatch.directSent,
    codePreview: dispatch.directSent ? undefined : code,
  };
}

/**
 * Verify a 6-digit OTP code against the stored hash.
 */
export async function verifyEmailOtp(
  db: Db,
  email: string,
  code: string
): Promise<{ ok: boolean; memberId?: string; isNewOwner?: boolean; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanCode = code.trim();

  if (!cleanEmail || cleanCode.length !== 6) {
    return { ok: false, error: "Please enter the complete 6-digit verification code." };
  }

  const otps = await readOtps(db);
  const record = otps[cleanEmail];

  if (!record) {
    return { ok: false, error: "No verification code requested for this email, or it has expired." };
  }

  if (Date.now() > record.expiresAt) {
    delete otps[cleanEmail];
    await writeOtps(db, otps);
    return { ok: false, error: "Verification code has expired. Please request a new code." };
  }

  if (record.attempts >= 5) {
    delete otps[cleanEmail];
    await writeOtps(db, otps);
    return { ok: false, error: "Too many incorrect attempts. Please request a new code." };
  }

  const expected = Buffer.from(record.hash, "hex");
  const actual = scryptSync(cleanCode, record.salt, 64);
  const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!matches) {
    record.attempts += 1;
    await writeOtps(db, otps);
    return { ok: false, error: "Incorrect verification code. Please check your email and try again." };
  }

  // Code verified successfully! Consume OTP
  delete otps[cleanEmail];
  await writeOtps(db, otps);

  const member = await findMemberByEmail(db, cleanEmail);
  if (member) {
    return { ok: true, memberId: member.id, isNewOwner: false };
  }

  const needsInitialOwner = !(await hasAnyCredentials(db));
  if (needsInitialOwner) {
    return { ok: true, isNewOwner: true };
  }

  return {
    ok: false,
    error: "Account not found. Please contact your workspace administrator for an invite link.",
  };
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

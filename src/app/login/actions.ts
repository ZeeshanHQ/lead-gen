"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import {
  endSession,
  hasAnyCredentials,
  requestEmailOtp,
  setPassword,
  startSession,
  validatePassword,
  verifyEmailOtp,
  verifyPassword,
} from "@/server/auth";
import { findMemberByEmail, registerUser, setupOwner } from "@/server/repo/team";

export async function requestOtpAction(email: string): Promise<{
  ok: boolean;
  codePreview?: string;
  directSent?: boolean;
  error?: string;
}> {
  try {
    const db = await getDb();
    const res = await requestEmailOtp(db, email);
    return res;
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to send verification code." };
  }
}

export async function verifyOtpAction(input: {
  email: string;
  code: string;
  ownerName?: string;
  ownerPassword?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = await getDb();
    const res = await verifyEmailOtp(db, input.email, input.code);

    if (!res.ok) {
      return { ok: false, error: res.error || "Verification failed." };
    }

    if (res.isNewOwner) {
      const name = input.ownerName?.trim() || "Workspace Owner";
      const pw = input.ownerPassword?.trim() || "";
      if (pw) {
        const pwErr = validatePassword(pw);
        if (pwErr) return { ok: false, error: pwErr };
      }

      const owner = await setupOwner(db, { name, email: input.email.trim() });
      if (pw) {
        await setPassword(db, owner.id, pw);
      }
      await startSession(owner.id);
      return { ok: true };
    }

    if (res.memberId) {
      await startSession(res.memberId);
      return { ok: true };
    }

    return { ok: false, error: "Unable to start session for this account." };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to verify code." };
  }
}

export async function registerAction(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = await getDb();
    const hasCreds = await hasAnyCredentials(db);
    if (hasCreds) {
      return {
        ok: false,
        error: "Public registration is disabled. You must be invited by the Workspace Owner to access this workspace.",
      };
    }

    const pwErr = validatePassword(input.password);
    if (pwErr) return { ok: false, error: pwErr };

    const member = await registerUser(db, {
      name: input.name,
      email: input.email,
    });

    await setPassword(db, member.id, input.password);
    await startSession(member.id);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to initialize workspace." };
  }
}

export async function loginWithPasswordAction(input: {
  email: string;
  password: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = await getDb();
    const cleanEmail = input.email.trim().toLowerCase();
    const member = await findMemberByEmail(db, cleanEmail);

    if (!member) {
      return {
        ok: false,
        error: "Access Restricted: This email has not been invited to Astraventa Workspace. Please contact your Workspace Owner.",
      };
    }

    if (member.status === "SUSPENDED") {
      return {
        ok: false,
        error: "This account has been paused. Please contact your Workspace Owner.",
      };
    }

    const valid = await verifyPassword(db, member.id, input.password);
    if (!valid) {
      return { ok: false, error: "Incorrect password. Please try again or use email verification code." };
    }

    if (member.status === "INVITED") {
      const { activateMember } = await import("@/server/repo/team");
      await activateMember(db, member.id);
    }

    await startSession(member.id);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Sign in failed." };
  }
}

export async function setupOwnerAction(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = await getDb();
    const pwErr = validatePassword(input.password);
    if (pwErr) return { ok: false, error: pwErr };

    const owner = await setupOwner(db, { name: input.name, email: input.email });
    await setPassword(db, owner.id, input.password);
    await startSession(owner.id);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Owner setup failed." };
  }
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

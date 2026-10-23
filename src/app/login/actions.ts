"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import {
  endSession,
  hasAnyCredentials,
  setPassword,
  startSession,
  validatePassword,
  verifyPassword,
} from "@/server/auth";
import { findMemberByEmail, setupOwner } from "@/server/repo/team";

export async function setupOwnerAction(input: { name: string; email: string; password: string }) {
  try {
    const db = await getDb();
    if (await hasAnyCredentials(db)) {
      return { ok: false, error: "Owner account pehle se bana hua hai. Login karein." };
    }
    const pwErr = validatePassword(input.password);
    if (pwErr) return { ok: false, error: pwErr };
    const owner = await setupOwner(db, { name: input.name, email: input.email });
    await setPassword(db, owner.id, input.password);
    await startSession(owner.id);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Setup fail ho gaya" };
  }
}

export async function loginAction(input: { email: string; password: string }) {
  try {
    const db = await getDb();
    const member = await findMemberByEmail(db, input.email);
    // Same message for unknown email / wrong password / suspended: no account probing.
    const generic = { ok: false, error: "Email ya password galat hai." };
    if (!member || member.status === "SUSPENDED") return generic;
    if (!(await verifyPassword(db, member.id, input.password))) return generic;
    await startSession(member.id);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Login fail ho gaya" };
  }
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

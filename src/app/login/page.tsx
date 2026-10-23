import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { hasAnyCredentials, getSessionMemberId } from "@/server/auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const db = await getDb();
  if (await getSessionMemberId()) redirect("/");
  const needsSetup = !(await hasAnyCredentials(db));
  return <LoginForm needsSetup={needsSetup} />;
}

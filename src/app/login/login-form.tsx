"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loginAction, setupOwnerAction } from "./actions";

export function LoginForm({ needsSetup }: { needsSetup: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = needsSetup
        ? await setupOwnerAction({ name, email, password })
        : await loginAction({ email, password });
      if (!res.ok) {
        setError(res.error || "Kuch masla aa gaya");
        return;
      }
      router.replace("/");
      router.refresh();
    });
  }

  const input =
    "mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:border-sky-500 focus:outline-none";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-7 shadow-2xl"
      >
        <div className="space-y-1 text-center">
          <img src="/logo.png" alt="Astraventa" className="mx-auto mb-2 h-10 w-10 object-contain" />
          <h1 className="text-lg font-semibold text-white">
            {needsSetup ? "Apna Owner account banayein" : "Astraventa mein login karein"}
          </h1>
          <p className="text-xs text-slate-400">
            {needsSetup
              ? "Ye pehli dafa ka setup hai. Is account ke paas poora control hoga."
              : "Apni email aur password se andar aayein."}
          </p>
        </div>

        {needsSetup && (
          <div>
            <label className="text-xs font-medium text-slate-300">Aapka naam</label>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-slate-300">Email</label>
          <input
            type="email"
            className={input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-300">
            Password {needsSetup && <span className="text-slate-500">(kam az kam 8 characters)</span>}
          </label>
          <input
            type="password"
            className={input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={needsSetup ? "new-password" : "current-password"}
            required
          />
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-white py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:opacity-50"
        >
          {pending ? "Ek second..." : needsSetup ? "Account banayein" : "Login"}
        </button>
      </form>
    </div>
  );
}

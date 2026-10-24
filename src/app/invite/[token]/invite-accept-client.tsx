"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInviteWithPasswordAction } from "./actions";
import { getDefaultRouteForMember, type TeamMember } from "@/server/domain/team";
import { CheckCircle2, UserCheck, Layers, ArrowRight, ShieldCheck, Lock } from "lucide-react";

interface InviteAcceptClientProps {
  token: string;
  member: TeamMember;
  workspaceName: string;
  roleLabel: string;
  assignedNiches: string[];
  enabledPermissions: string[];
}

export function InviteAcceptClient({
  token,
  member,
  workspaceName,
  roleLabel,
  assignedNiches,
  enabledPermissions,
}: InviteAcceptClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  const handleAccept = () => {
    setError(null);
    startTransition(async () => {
      const res = await acceptInviteWithPasswordAction(token, password);
      if (!res.ok) {
        setError(res.error || "Could not accept invitation.");
        return;
      }
      router.push(getDefaultRouteForMember(member));
      router.refresh();
    });
  };

  return (
    <div className="max-w-lg mx-auto py-12 px-4">
      <div className="p-7 rounded-2xl border border-zinc-800/80 bg-[#121215] shadow-2xl space-y-6 text-zinc-100">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800/80 pb-5">
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Workspace Invitation
            </span>
            <h1 className="text-xl font-bold text-white tracking-tight">
              Join {workspaceName}
            </h1>
            <p className="text-xs text-zinc-400">
              Invited by <span className="text-zinc-200 font-medium">{member.invitedBy || "Workspace Administrator"}</span>
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-[#09090b] border border-zinc-800 text-xs font-semibold text-zinc-200">
            {roleLabel}
          </span>
        </div>

        {/* Member Profile Card */}
        <div className="p-4 rounded-xl bg-[#09090b] border border-zinc-800/80 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-white">{member.name}</div>
            <div className="text-xs text-zinc-400">{member.email}</div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                member.status === "ACTIVE" ? "bg-emerald-400" : "bg-amber-400"
              }`}
            />
            {member.status === "ACTIVE" ? "Active" : "Ready to Activate"}
          </span>
        </div>

        {/* Assigned Niches */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-zinc-400" />
            <span>Assigned Vertical Access ({member.nicheScope === "ALL" ? "All Niches" : assignedNiches.length})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {assignedNiches.length > 0 ? (
              assignedNiches.map((niche) => (
                <span
                  key={niche}
                  className="px-2.5 py-1 rounded-lg bg-[#09090b] border border-zinc-800 text-xs text-zinc-300 font-medium"
                >
                  {niche}
                </span>
              ))
            ) : (
              <span className="text-xs text-zinc-500">Full workspace access</span>
            )}
          </div>
        </div>

        {/* Permissions */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-zinc-300">
            Included Capabilities
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {enabledPermissions.map((label) => (
              <div
                key={label}
                className="px-3 py-2 rounded-xl bg-[#09090b] border border-zinc-800/80 flex items-center gap-2 text-xs text-zinc-300"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 text-xs text-rose-200">
            {error}
          </div>
        )}

        {/* Password Setup */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-300 flex items-center justify-between">
            <span>Create Account Password</span>
            <span className="text-zinc-500 text-[11px]">8+ characters</span>
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="••••••••"
              className="w-full rounded-xl border border-zinc-800 bg-[#09090b] pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:border-zinc-500 focus:outline-none transition"
            />
          </div>
          <p className="text-[11px] text-zinc-500">
            Sign in with <strong className="text-zinc-400">{member.email}</strong> and this password.
          </p>
        </div>

        {/* Action Button */}
        <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-end">
          <button
            type="button"
            onClick={handleAccept}
            disabled={isPending || password.length < 8}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-white hover:bg-zinc-200 disabled:opacity-50 text-black font-bold text-xs transition shadow-sm"
          >
            <UserCheck className="w-4 h-4" />
            <span>
              {isPending ? "Activating Account..." : "Accept & Launch CRM"}
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptTeamInviteAction } from "@/app/settings/actions";
import type { TeamMember } from "@/server/domain/team";
import { CheckCircle2, UserCheck, Layers, ArrowRight } from "lucide-react";

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

  const handleAccept = () => {
    setError(null);
    startTransition(async () => {
      const res = await acceptTeamInviteAction(token);
      if (!res.ok) {
        setError(res.error || "Could not accept invitation.");
        return;
      }
      router.push("/");
      router.refresh();
    });
  };

  return (
    <div className="max-w-lg mx-auto py-10">
      <div className="p-6 rounded-xl border border-slate-800/80 bg-slate-900/40 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="space-y-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Team Workspace Invitation
            </span>
            <h1 className="text-lg font-semibold text-white">
              Join {workspaceName}
            </h1>
            <p className="text-xs text-slate-400">
              Invited by <span className="text-slate-200 font-medium">{member.invitedBy || "Workspace Owner"}</span>
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 text-xs font-medium text-slate-200">
            {roleLabel}
          </span>
        </div>

        {/* Member Summary */}
        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">{member.name}</div>
            <div className="text-xs text-slate-400">{member.email}</div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                member.status === "ACTIVE" ? "bg-emerald-400" : "bg-amber-400"
              }`}
            />
            {member.status === "ACTIVE" ? "Active Member" : "Ready to Activate"}
          </span>
        </div>

        {/* Assigned Niches */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span>Assigned Niches ({member.nicheScope === "ALL" ? "All Niches" : assignedNiches.length})</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {assignedNiches.length > 0 ? (
              assignedNiches.map((niche) => (
                <span
                  key={niche}
                  className="px-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 text-xs text-slate-200"
                >
                  {niche}
                </span>
              ))
            ) : (
              <span className="text-xs text-slate-500">All workspace niches</span>
            )}
          </div>
        </div>

        {/* Enabled Access */}
        <div className="space-y-2">
          <div className="text-xs font-medium text-slate-300">
            Included Access &amp; Features
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {enabledPermissions.map((label) => (
              <div
                key={label}
                className="px-3 py-2 rounded-lg bg-slate-950/50 border border-slate-800/80 flex items-center gap-2 text-xs text-slate-200"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900/60 text-xs text-rose-200">
            {error}
          </div>
        )}

        {/* Action Button */}
        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-end gap-3">
          <button
            onClick={handleAccept}
            disabled={isPending}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-white hover:bg-slate-200 disabled:opacity-50 text-slate-950 font-semibold text-xs transition-colors"
          >
            <UserCheck className="w-4 h-4" />
            <span>
              {isPending
                ? "Activating Account..."
                : member.status === "ACTIVE"
                  ? `Continue as ${member.name}`
                  : "Accept Invitation & Open Dashboard"}
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

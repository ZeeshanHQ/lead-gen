import React from "react";
import { cn } from "@/lib/utils";
import type { Provenance, FactDisplay } from "@/server/domain/facts";
import type { ContactLabel, ContactGrade } from "@/server/domain/contact";
import type { LifecycleStatus } from "@/server/domain/lifecycle";
import { CheckCircle2, ShieldCheck, UserCheck, AlertTriangle, HelpCircle, XCircle } from "lucide-react";

export function ProvenanceBadge({
  provenance,
  className,
}: {
  provenance: Provenance | string;
  className?: string;
}) {
  if (provenance === "PUBLICLY_VERIFIED") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-900 text-slate-200 border border-slate-700/80",
          className
        )}
      >
        <ShieldCheck className="w-3 h-3 text-emerald-400" />
        Verified Source
      </span>
    );
  }
  if (provenance === "HUMAN_CONFIRMED") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-900 text-slate-200 border border-slate-700/80",
          className
        )}
      >
        <UserCheck className="w-3 h-3 text-sky-400" />
        Confirmed by Team
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-900/70 text-slate-400 border border-slate-800",
        className
      )}
    >
      <HelpCircle className="w-3 h-3 text-slate-500" />
      Estimated
    </span>
  );
}

export function ContactQualityBadge({
  label,
  className,
}: {
  label: ContactLabel | string;
  className?: string;
}) {
  const friendlyMap: Record<string, string> = {
    "DIRECT PROFESSIONAL": "Direct Phone",
    "PROFESSIONAL MOBILE": "Mobile Line",
    "COMPANY MAIN LINE": "Main Office Line",
    "PUBLIC BUSINESS EMAIL": "Business Email",
    "GENERAL EMAIL": "General Email",
    "NOT FOUND": "Not Found",
  };
  const isMissing = label === "NOT FOUND";
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border",
        isMissing
          ? "bg-slate-950 text-slate-500 border-slate-800"
          : "bg-slate-900 text-slate-200 border-slate-700/80",
        className
      )}
    >
      {friendlyMap[label] || label}
    </span>
  );
}

export function ContactGradeBadge({ grade }: { grade: ContactGrade | string | null }) {
  if (!grade) return <span className="text-slate-500 text-xs">--</span>;
  const colors: Record<string, string> = {
    A: "bg-slate-800 text-white border-slate-600",
    B: "bg-slate-900 text-slate-200 border-slate-700",
    C: "bg-slate-900 text-slate-400 border-slate-800",
    D: "bg-slate-950 text-slate-500 border-slate-800",
  };
  return (
    <span
      className={cn(
        "w-6 h-6 inline-flex items-center justify-center rounded-full text-xs font-semibold border",
        colors[grade] ?? colors.D
      )}
    >
      {grade}
    </span>
  );
}

export function LifecycleBadge({
  status,
  className,
}: {
  status: LifecycleStatus | string;
  className?: string;
}) {
  const labelMap: Record<string, string> = {
    DISCOVERED: "New Lead",
    RESEARCHING: "Scanning",
    RESEARCHED: "Scanned",
    NEEDS_REVIEW: "Needs Review",
    APPROVED: "Approved",
    SYNCED: "Synced",
    CALLING: "In Dialer",
    CONNECTED: "Connected",
    PAIN_FOUND: "Interested",
    QUALIFIED: "Qualified",
    MEETING_BOOKED: "Meeting Booked",
    REJECTED: "Rejected",
  };

  const dotColors: Record<string, string> = {
    DISCOVERED: "bg-slate-400",
    RESEARCHING: "bg-sky-400",
    RESEARCHED: "bg-slate-300",
    NEEDS_REVIEW: "bg-amber-400",
    APPROVED: "bg-emerald-400",
    SYNCED: "bg-sky-400",
    CALLING: "bg-sky-400",
    CONNECTED: "bg-emerald-400",
    PAIN_FOUND: "bg-emerald-400",
    QUALIFIED: "bg-emerald-400",
    MEETING_BOOKED: "bg-emerald-400",
    REJECTED: "bg-rose-400",
  };

  const pillStyles: Record<string, string> = {
    MEETING_BOOKED: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
    APPROVED: "bg-slate-900 text-slate-200 border-slate-700/80",
    NEEDS_REVIEW: "bg-slate-900 text-slate-200 border-slate-700/80",
    REJECTED: "bg-slate-950 text-slate-400 border-slate-800",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-medium border",
        pillStyles[status] ?? "bg-slate-900 text-slate-200 border-slate-800",
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotColors[status] ?? "bg-slate-400")} />
      {labelMap[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

export function FactBadge({ display, label }: { display: FactDisplay | string; label: string }) {
  if (display === "VERIFIED") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-slate-900 text-slate-200 border border-slate-700/80"
        title={`${label}: Verified`}
      >
        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
        {label}
      </span>
    );
  }
  if (display === "LOW_CONFIDENCE") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-slate-900 text-slate-300 border border-slate-800"
        title={`${label}: Partial info`}
      >
        <AlertTriangle className="w-3 h-3 text-amber-400" />
        {label}
      </span>
    );
  }
  if (display === "CONFLICTING") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-slate-900 text-slate-300 border border-slate-800"
        title={`${label}: Needs check`}
      >
        <AlertTriangle className="w-3 h-3 text-amber-400" />
        {label}
      </span>
    );
  }
  if (display === "NO") {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] bg-slate-950 text-slate-500 border border-slate-800/80 line-through"
        title={`${label}: No`}
      >
        <XCircle className="w-3 h-3 text-slate-600" />
        {label}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] bg-slate-950 text-slate-500 border border-slate-800/60"
      title={`${label}: Not listed`}
    >
      {label}
    </span>
  );
}

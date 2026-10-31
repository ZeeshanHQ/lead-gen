import React from "react";
import {
  CALL_STATUS_DEFS,
  OUTCOME_GROUPS,
  deriveCallStatus,
  type CallOutcomeKey,
  type CallStatusKey,
} from "@/server/domain/call-outcomes";

/** Colored pill for a call status. One component, used by the CRM table, cards and funnel. */
export function CallStatusBadge({
  statusKey,
  lead,
  attempts,
  showAttempts = true,
  showLastCalled = false,
  className = "",
  onClick,
  title,
}: {
  statusKey?: CallStatusKey;
  lead?: { notes?: string | null; status?: string | null };
  attempts?: number;
  showAttempts?: boolean;
  showLastCalled?: boolean;
  className?: string;
  onClick?: () => void;
  title?: string;
}) {
  const derived = lead ? deriveCallStatus(lead) : null;
  const key = statusKey || derived?.key || "UNTOUCHED";
  const finalAttempts = attempts !== undefined ? attempts : derived?.attempts;
  const def = CALL_STATUS_DEFS[key];

  const body = (
    <>
      <span className={`h-2 w-2 rounded-full ${def.dot}`} />
      <span>{def.label}</span>
      {showAttempts && finalAttempts !== undefined && finalAttempts > 0 && (
        <span className="rounded bg-black/30 px-1 text-[9px] font-bold text-zinc-300">
          {finalAttempts}x
        </span>
      )}
    </>
  );
  const base = `inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${def.badge} ${className}`;
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title || `${def.meaning} Click to log a new call.`}
        className={`${base} transition hover:brightness-125 cursor-pointer`}
      >
        {body}
      </button>
    );
  }
  return (
    <span className={base} title={title || def.meaning}>
      {body}
    </span>
  );
}

/** Grouped, color-coded outcome buttons for the Log Call dialog. No default: caller must choose. */
export function CallOutcomePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: CallOutcomeKey | null;
  onChange: (key: CallOutcomeKey) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      {OUTCOME_GROUPS.map((group) => (
        <div key={group.id}>
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              {group.title}
            </span>
            <span className="text-[10px] text-zinc-600">{group.hint}</span>
          </div>
          <div
            className={`grid gap-2 ${
              group.keys.length >= 3 ? "grid-cols-3" : group.keys.length === 2 ? "grid-cols-2" : "grid-cols-1"
            }`}
          >
            {group.keys.map((key) => {
              const def = CALL_STATUS_DEFS[key];
              const active = value === key;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(key)}
                  title={`${def.meaning} ${def.whenToUse}`}
                  className={`flex flex-col items-start gap-0.5 rounded-lg border p-2.5 text-left text-xs transition disabled:opacity-50 disabled:cursor-not-allowed ${
                    active
                      ? `${def.selected} text-white font-bold`
                      : "border-zinc-800 bg-[#09090b] text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${def.dot}`} />
                    <span>{def.label}</span>
                  </span>
                  <span className="text-[10px] font-normal leading-tight text-zinc-500">
                    {def.whenToUse}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Color key. Same colors everywhere (CRM table, filters, funnel, charts). */
export function CallStatusLegend({
  className = "",
  showMeaning = false,
}: {
  className?: string;
  showMeaning?: boolean;
}) {
  const order: CallStatusKey[] = [
    "UNTOUCHED",
    "NO_ANSWER",
    "CALL_COMPLETED",
    "WRONG_NUMBER",
    "GATEKEEPER_BLOCKED",
    "CONNECTED",
    "NOT_INTERESTED",
    "MEETING_BOOKED",
  ];
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
          Color key
        </span>
        {order.map((key) => {
          const def = CALL_STATUS_DEFS[key];
          return (
            <span
              key={key}
              title={`${def.meaning} ${def.whenToUse}`}
              className="inline-flex items-center gap-1.5 text-[11px] text-zinc-300"
            >
              <span className={`h-2.5 w-2.5 rounded-full ${def.dot}`} />
              {def.label}
            </span>
          );
        })}
      </div>
      {showMeaning && (
        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {order.map((key) => {
            const def = CALL_STATUS_DEFS[key];
            return (
              <div key={key} className="flex items-start gap-2 text-[11px] leading-snug">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${def.dot}`} />
                <span className="text-zinc-400">
                  <strong className="text-zinc-200">{def.label}:</strong> {def.meaning}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

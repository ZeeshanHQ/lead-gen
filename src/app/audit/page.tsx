import React from "react";
import { getDb } from "@/server/db/client";
import { listAudit, distinctAuditActions } from "@/server/repo/detail";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; q?: string }>;
}) {
  const { action, q } = await searchParams;
  const db = await getDb();
  const entries = await listAudit(db, { action, q });
  const distinctActions = await distinctAuditActions(db);

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-white">
            Activity Log
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Recent team actions, approvals, dialer pushes, and settings updates.
          </p>
        </div>

        <span className="text-xs px-3 py-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 font-medium">
          {entries.length} Entries
        </span>
      </div>

      {/* Filter bar */}
      <form method="GET" className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/30 flex flex-wrap items-center gap-3 text-xs">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by team member, action, or details..."
          className="flex-1 min-w-[200px] bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-600"
        />

        <select
          name="action"
          defaultValue={action ?? ""}
          className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-slate-600"
        >
          <option value="">All Actions ({distinctActions.length})</option>
          {distinctActions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium border border-slate-700/80 transition-colors"
        >
          Filter
        </button>
      </form>

      {/* Audit table */}
      {entries.length === 0 ? (
        <div className="p-12 text-center rounded-xl border border-slate-800/80 bg-slate-900/30 text-slate-400 text-xs">
          No activity entries match your filter.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-900/30">
          <table className="w-full text-left text-xs text-slate-300 divide-y divide-slate-800/80">
            <thead className="bg-slate-950/60 text-[11px] font-medium uppercase text-slate-400">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-3 py-3">Action</th>
                <th className="px-3 py-3">Member</th>
                <th className="px-3 py-3">Item</th>
                <th className="px-3 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-800/20 transition-colors">
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap font-sans text-xs">
                    {formatDateTime(entry.createdAt)}
                  </td>
                  <td className="px-3 py-3 font-medium text-slate-200 whitespace-nowrap">
                    {entry.action}
                  </td>
                  <td className="px-3 py-3 text-slate-300 whitespace-nowrap font-sans text-xs">
                    {entry.actor}
                  </td>
                  <td className="px-3 py-3 text-slate-400">
                    <span className="text-slate-300">{entry.entityType}</span>
                    {entry.entityId && (
                      <span className="text-slate-500 block truncate max-w-[140px]">
                        {entry.entityId}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-400 max-w-sm truncate">
                    {entry.oldValue != null ? (
                      <span className="line-through text-slate-500 mr-2">
                        {JSON.stringify(entry.oldValue)}
                      </span>
                    ) : null}
                    {entry.newValue != null ? (
                      <span className="text-slate-200">
                        {JSON.stringify(entry.newValue)}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

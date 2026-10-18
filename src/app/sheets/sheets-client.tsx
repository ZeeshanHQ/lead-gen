"use client";

import React, { useState, useTransition } from "react";
import {
  Sheet,
  CheckCircle2,
  RefreshCw,
  Unlink,
  Download,
} from "lucide-react";
import { connectSheetAction, disconnectSheetAction, triggerSyncAction } from "./actions";

interface SheetsClientProps {
  connection: {
    id: string;
    status: string;
    accountId: string | null;
    spreadsheetId: string | null;
    spreadsheetTitle: string | null;
    worksheet: string | null;
    syncEnabled: boolean;
    lastSuccessAt: string | null;
  } | null;
  approvedCount: number;
  syncedCount: number;
  mappings: Array<{ systemField: string; sheetColumn: string }>;
}

export function SheetsClient({
  connection,
  approvedCount,
  syncedCount,
  mappings,
}: SheetsClientProps) {
  const [isPending, startTransition] = useTransition();
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

  const isConnected = connection?.status === "CONNECTED";

  const handleConnect = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await connectSheetAction(fd);
      setShowConnectModal(false);
    });
  };

  const handleDisconnect = () => {
    if (!confirm("Disconnect this Google Sheet?")) return;
    startTransition(async () => {
      await disconnectSheetAction();
    });
  };

  const handleSync = (dryRun: boolean) => {
    setSyncFeedback(null);
    startTransition(async () => {
      const res = await triggerSyncAction(dryRun);
      if (res.ok && res.result) {
        setSyncFeedback(
          dryRun
            ? `Preview complete: ${res.result.syncedCount} approved leads are ready to sync.`
            : `Synced ${res.result.syncedCount} approved leads to "${res.result.spreadsheetTitle}".`
        );
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Sync Status Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/40 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Google Sheet Status
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-emerald-400" : "bg-slate-600"
              }`}
            />
            <span className="text-base font-semibold text-white">
              {isConnected ? "Connected" : "Not Connected"}
            </span>
          </div>
          <div className="text-xs text-slate-500">
            {isConnected ? connection?.accountId : "No Google Sheet linked yet"}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/40 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Ready to Sync
          </div>
          <div className="text-xl font-semibold text-white">
            {approvedCount} Leads
          </div>
          <div className="text-xs text-slate-500">
            Approved leads waiting to be exported
          </div>
        </div>

        <div className="p-4 rounded-xl border border-slate-800/80 bg-slate-900/40 space-y-1">
          <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
            Synced Leads
          </div>
          <div className="text-xl font-semibold text-white">
            {syncedCount} Leads
          </div>
          <div className="text-xs text-slate-500">
            Already exported to your sheet
          </div>
        </div>
      </div>

      {syncFeedback && (
        <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            {syncFeedback}
          </div>
          <button
            onClick={() => setSyncFeedback(null)}
            className="text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Connection Card */}
      <div className="p-6 rounded-xl border border-slate-800/80 bg-slate-900/30 space-y-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300">
              <Sheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {connection?.spreadsheetTitle || "Google Sheet Export"}
              </h3>
              <p className="text-xs text-slate-400">
                Tab: <span className="text-slate-200 font-mono">{connection?.worksheet || "Approved Leads"}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/export/csv"
              download
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs text-slate-200 font-medium border border-slate-700/80 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-slate-400" />
              <span>Download CSV</span>
            </a>

            {isConnected ? (
              <>
                <button
                  onClick={() => handleSync(true)}
                  disabled={isPending || approvedCount === 0}
                  className="px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 disabled:opacity-40 text-xs text-slate-200 font-medium border border-slate-700/80 transition-colors"
                >
                  Preview Sync
                </button>
                <button
                  onClick={() => handleSync(false)}
                  disabled={isPending || approvedCount === 0}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white hover:bg-slate-200 disabled:opacity-40 text-slate-950 font-semibold text-xs transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isPending ? "animate-spin" : ""}`} />
                  Sync {approvedCount} Leads
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={isPending}
                  title="Disconnect Sheet"
                  className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-rose-300 border border-slate-700/80 transition-colors"
                >
                  <Unlink className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowConnectModal(true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white hover:bg-slate-200 text-slate-950 font-semibold text-xs transition-colors"
              >
                <Sheet className="w-3.5 h-3.5" />
                Connect Google Sheet
              </button>
            )}
          </div>
        </div>

        {/* Column Mappings Table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-slate-300">
              Exported Columns ({mappings.length})
            </h4>
            <span className="text-[11px] text-slate-500">
              Only approved leads are exported
            </span>
          </div>

          <div className="rounded-lg border border-slate-800/80 overflow-hidden">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/60 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="px-4 py-2.5">Lead Field</th>
                  <th className="px-4 py-2.5">Sheet Column Name</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-[11px]">
                {mappings.map((m) => (
                  <tr key={m.systemField} className="hover:bg-slate-800/20">
                    <td className="px-4 py-2 text-slate-300">{m.systemField}</td>
                    <td className="px-4 py-2 text-slate-200 font-mono">{m.sheetColumn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Connect Modal */}
      {showConnectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-white">
                Connect Google Sheet
              </h3>
              <button
                onClick={() => setShowConnectModal(false)}
                className="text-slate-400 hover:text-white text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleConnect} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Account Email
                </label>
                <input
                  type="email"
                  name="accountId"
                  defaultValue="team@company.com"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-slate-600"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Sheet Name
                </label>
                <input
                  type="text"
                  name="spreadsheetTitle"
                  defaultValue="Outbound Leads"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-slate-600"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Tab Name
                </label>
                <input
                  type="text"
                  name="worksheet"
                  defaultValue="Approved Leads"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-slate-600"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Spreadsheet ID or Webhook URL
                </label>
                <input
                  type="text"
                  name="spreadsheetId"
                  placeholder="Spreadsheet ID or Apps Script URL"
                  defaultValue="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-slate-600 font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowConnectModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="px-4 py-1.5 rounded-lg bg-white hover:bg-slate-200 disabled:opacity-50 text-slate-950 font-semibold text-xs"
                >
                  {isPending ? "Connecting..." : "Save Connection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

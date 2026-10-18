import React from "react";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import {
  googleSheetConnections,
  googleSheetMappings,
  companies,
} from "@/server/db/schema";
import { getActiveContext } from "@/server/repo/markets";
import { DEFAULT_COLUMN_MAPPINGS } from "@/server/sheets/sync";
import { SheetsClient } from "./sheets-client";

export const dynamic = "force-dynamic";

export default async function SheetsPage() {
  const db = await getDb();
  const { market } = await getActiveContext(db);

  const [conn] = await db.select().from(googleSheetConnections).limit(1);

  const approvedRows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.status, "APPROVED"), eq(companies.marketId, market.id)));

  const syncedRows = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.status, "SYNCED"), eq(companies.marketId, market.id)));

  let mappings: Array<{ systemField: string; sheetColumn: string }> = [];
  if (conn) {
    const mapRows = await db
      .select()
      .from(googleSheetMappings)
      .where(eq(googleSheetMappings.connectionId, conn.id));
    mappings = mapRows.map((m) => ({
      systemField: m.systemField,
      sheetColumn: m.sheetColumn,
    }));
  }

  if (mappings.length === 0) {
    mappings = Object.entries(DEFAULT_COLUMN_MAPPINGS).map(([k, v]) => ({
      systemField: k,
      sheetColumn: v,
    }));
  }

  const connectionView = conn
    ? {
        id: conn.id,
        status: conn.status,
        accountId: conn.accountId,
        spreadsheetId: conn.spreadsheetId,
        spreadsheetTitle: conn.spreadsheetTitle,
        worksheet: conn.worksheet,
        syncEnabled: conn.syncEnabled,
        lastSuccessAt: conn.lastSuccessAt ? conn.lastSuccessAt.toISOString() : null,
      }
    : null;

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800/80 pb-4">
        <h1 className="text-lg font-semibold text-white">
          Sheets &amp; Export — {market.name}
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Export approved leads for <strong className="text-slate-200">{market.name}</strong> to Google Sheets or CSV.
        </p>
      </div>

      <SheetsClient
        key={market.id}
        connection={connectionView}
        approvedCount={approvedRows.length}
        syncedCount={syncedRows.length}
        mappings={mappings}
      />
    </div>
  );
}

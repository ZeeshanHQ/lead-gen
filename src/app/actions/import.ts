"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import {
  parseDelimitedText,
  mapRowsToLeads,
  executeBulkImport,
} from "@/server/repo/bulk-import";
import { getActiveTeamMember } from "@/server/repo/team";

export async function importLeadsAction(
  rawText: string,
  options: {
    targetStage?: "APPROVED" | "NEEDS_REVIEW";
    actor?: string;
    sourceName?: string;
  }
) {
  try {
    if (!rawText || !rawText.trim()) {
      return { success: false, error: "No data provided. Please paste rows or upload a file." };
    }

    const matrix = parseDelimitedText(rawText);
    if (matrix.length < 2) {
      return {
        success: false,
        error: "At least one header row and one data row are required.",
      };
    }

    const leads = mapRowsToLeads(matrix);
    if (leads.length === 0) {
      return {
        success: false,
        error: "Could not detect valid lead rows. Please ensure company names are present.",
      };
    }

    const db = await getDb();
    const { activeMember } = await getActiveTeamMember(db);
    if (activeMember.id === "guest" || activeMember.status !== "ACTIVE") {
      return { success: false, error: "Unauthorized. Please sign in to import leads." };
    }

    const { getActiveContext } = await import("@/server/repo/markets");
    const { market } = await getActiveContext(db);

    const assignToCaller =
      activeMember.role !== "OWNER" && !activeMember.permissions.manageTeamAndSettings;

    const result = await executeBulkImport(db, leads, {
      actor: activeMember.name || options.actor || "CRM User",
      targetStage: options.targetStage || "APPROVED",
      sourceName: options.sourceName || "sheet_upload",
      marketId: market.id,
      assignedMemberId: assignToCaller ? activeMember.id : undefined,
      assignedMemberName: assignToCaller ? activeMember.name : undefined,
    });

    revalidatePath("/");
    revalidatePath("/approved");
    revalidatePath("/caller");
    revalidatePath("/review");
    revalidatePath("/sheets");

    return {
      success: true,
      totalRows: result.totalRows,
      importedCount: result.importedCount,
      duplicatesCount: result.duplicatesCount,
      invalidCount: result.invalidCount,
      errors: result.errors,
    };
  } catch (error: any) {
    console.error("Bulk import failed:", error);
    return { success: false, error: error.message || "Failed to import leads." };
  }
}

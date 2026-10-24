import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { loadLeadRows } from "@/server/repo/queue";
import { factValue } from "@/server/domain/facts";

function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

export async function GET() {
  try {
    const db = await getDb();
    const { getActiveTeamMember } = await import("@/server/repo/team");
    const { activeMember } = await getActiveTeamMember(db);

    if (activeMember.role !== "OWNER" && !activeMember.permissions.exportAndSync) {
      return NextResponse.json(
        {
          error:
            "Export access is restricted. Only the Workspace Owner or authorized members can export CSV files.",
        },
        { status: 403 }
      );
    }

    const { getActiveContext } = await import("@/server/repo/markets");
    const { market } = await getActiveContext(db);
    const allApproved = await loadLeadRows(db, "approved", market.id);
    const isOwnerOrManager =
      activeMember.role === "OWNER" || Boolean(activeMember.permissions.manageTeamAndSettings);
    const leads = isOwnerOrManager
      ? allApproved
      : allApproved.filter((l) => l.assignedMemberId === activeMember.id);

    const headers = [
      "Company Name",
      "Website",
      "Phone",
      "Address",
      "City",
      "State",
      "ICP Score",
      "Confidence (%)",
      "Decision Maker Name",
      "Decision Maker Title",
      "Direct Phone",
      "Work Email",
      "Replacement Service",
      "Installation Service",
      "Financing Available",
      "Tech Stack / FSM",
      "Google Maps URL",
      "Lifecycle Status",
      "Assigned Caller",
      "Next Follow-Up Scheduled",
      "Caller Conversation Notes",
      "Approved At",
    ];

    const rows = leads.map((l) => {
      const dm = l.owner || l.best;
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${l.name} ${l.address || ""} ${l.city || ""} ${l.state || ""}`
      )}`;
      const nextFollowUp =
        l.notes?.match(/\[Next Follow-up Scheduled:\s*([^\]]+)\]/i)?.[1] || "";

      return [
        escapeCsvCell(l.name),
        escapeCsvCell(l.website || ""),
        escapeCsvCell(l.phoneDisplay || ""),
        escapeCsvCell(l.address || ""),
        escapeCsvCell(l.city || ""),
        escapeCsvCell(l.state || ""),
        escapeCsvCell(l.icpScore ?? 0),
        escapeCsvCell(Math.round((l.researchConfidence ?? 0) * 100)),
        escapeCsvCell(dm?.name || ""),
        escapeCsvCell(dm?.title || ""),
        escapeCsvCell(l.best?.phone || ""),
        escapeCsvCell(l.best?.email || ""),
        escapeCsvCell(factValue(l.facts, "replacement")),
        escapeCsvCell(factValue(l.facts, "installation")),
        escapeCsvCell(factValue(l.facts, "financing")),
        escapeCsvCell(factValue(l.facts, "software")),
        escapeCsvCell(mapsUrl),
        escapeCsvCell(l.status),
        escapeCsvCell(l.assignedMemberName || "Unassigned"),
        escapeCsvCell(nextFollowUp),
        escapeCsvCell(l.notes || l.researchSummary || ""),
        escapeCsvCell(l.approvedAt ? new Date(l.approvedAt).toISOString().slice(0, 10) : ""),
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\r\n");
    const today = new Date().toISOString().slice(0, 10);

    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="astraventa-approved-leads-${today}.csv"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to generate CSV" },
      { status: 500 }
    );
  }
}

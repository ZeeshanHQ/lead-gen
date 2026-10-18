import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { loadQualificationReport } from "@/server/repo/qualification";

export const dynamic = "force-dynamic";

function cell(val: unknown): string {
  if (val === null || val === undefined) return '""';
  return `"${String(val).replace(/"/g, '""')}"`;
}

/** Downloads ONLY fully qualified leads: every required field is present by construction. */
export async function GET() {
  try {
    const db = await getDb();
    const { getActiveContext } = await import("@/server/repo/markets");
    const { market } = await getActiveContext(db);
    const { leads } = await loadQualificationReport(db, market.id);
    const qualified = leads.filter((l) => l.tier === "QUALIFIED");

    const headers = [
      "Company Name",
      "Website",
      "Company Phone",
      "Street Address",
      "City",
      "State",
      "ZIP",
      "CEO / Owner Name",
      "CEO / Owner Title",
      "CEO / Owner Phone",
      "CEO / Owner Email",
      "Business Email",
      "Employees",
      "Owner Verified",
      "Owner Source URL",
      "ICP Score",
      "Grade",
      "Lifecycle Status",
    ];

    const rows = qualified.map((l) =>
      [
        l.name,
        l.website,
        l.phone,
        l.address,
        l.city,
        l.state,
        l.zip,
        l.ownerName,
        l.ownerTitle,
        l.ownerPhone,
        l.ownerEmail,
        l.ownerEmail ?? l.anyEmail,
        l.employees,
        l.ownerVerified ? "YES" : "NO",
        l.ownerSourceUrl,
        l.qualification.score,
        l.qualification.grade,
        l.status,
      ]
        .map(cell)
        .join(","),
    );

    const today = new Date().toISOString().slice(0, 10);
    return new Response([headers.map(cell).join(","), ...rows].join("\r\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="astraventa-fully-qualified-leads-${today}.csv"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate CSV";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import type { Db } from "../db/client";
import { createCandidate } from "./companies";
import { addContact } from "./contacts";
import { approveCompany } from "./approvals";
import { setFact } from "./facts";
import { leadScores, companies } from "../db/schema";
import { eq } from "drizzle-orm";
import { audit } from "./audit";
import { cleanPhone } from "../domain/normalize";

export interface RawLeadRow {
  name: string;
  website?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  contactName?: string | null;
  contactTitle?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
  replacement?: string | null;
  financing?: string | null;
}

export interface BulkImportOptions {
  actor: string;
  targetStage: "APPROVED" | "NEEDS_REVIEW";
  sourceName?: string;
  marketId?: string;
}

export interface BulkImportResult {
  totalRows: number;
  importedCount: number;
  duplicatesCount: number;
  invalidCount: number;
  importedIds: string[];
  errors: { row: number; error: string; data?: any }[];
}

/**
 * Checks whether a cell string matches phone number characteristics.
 */
export function isPhoneValue(val: string | null | undefined): boolean {
  if (!val) return false;
  const s = String(val).trim();
  if (!s || s.length < 7 || s.length > 30) return false;
  if (s.includes("@") || s.includes("http") || s.includes(".com") || s.includes(".org")) return false;
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 7 && digits.length <= 15) {
    if (/[\(\)\-.\+\s]/.test(s) || digits.length === 10 || digits.length === 11) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a cell string looks like a web address or domain.
 */
export function isUrlValue(val: string | null | undefined): boolean {
  if (!val) return false;
  const s = String(val).trim().toLowerCase();
  if (!s || s.includes(" ") || s.length < 4) return false;
  return (
    s.startsWith("http://") ||
    s.startsWith("https://") ||
    s.startsWith("www.") ||
    /\.(com|org|net|io|co|biz|us|info|app|cc)(\/|$)/.test(s)
  );
}

/**
 * Checks whether a cell string looks like an email address.
 */
export function isEmailValue(val: string | null | undefined): boolean {
  if (!val) return false;
  const s = String(val).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
  "TEXAS","CALIFORNIA","FLORIDA","NEW YORK","GEORGIA","OHIO","ILLINOIS","NORTH CAROLINA"
]);

export function isStateValue(val: string | null | undefined): boolean {
  if (!val) return false;
  const s = String(val).trim().toUpperCase();
  return US_STATES.has(s);
}

export function isZipValue(val: string | null | undefined): boolean {
  if (!val) return false;
  const s = String(val).trim();
  return /^\d{5}(-\d{4})?$/.test(s);
}

/**
 * Determines whether row 0 is a header row or already contains data.
 */
function isLikelyHeaderRow(row: string[]): boolean {
  if (!row || row.length === 0) return false;
  let headerKeywordScore = 0;
  let dataSignalScore = 0;

  const headerKeywords = [
    "company", "business", "contractor", "account", "name",
    "phone", "tel", "mobile", "cell", "contact",
    "website", "url", "domain", "web", "site",
    "address", "street", "city", "state", "zip",
    "email", "mail", "title", "role", "owner", "notes", "status"
  ];

  for (const cell of row) {
    const clean = cell.toLowerCase().trim().replace(/[^a-z0-9]/g, "");
    if (!clean) continue;
    if (headerKeywords.some((k) => clean.includes(k))) {
      headerKeywordScore++;
    }
    if (isUrlValue(cell) || isEmailValue(cell) || isPhoneValue(cell)) {
      dataSignalScore++;
    }
  }

  if (dataSignalScore > 0 && headerKeywordScore <= dataSignalScore) {
    return false;
  }
  return headerKeywordScore >= 1;
}

/**
 * Intelligent CSV / TSV string parser.
 * Handles quoted cells with commas, quotes, and newlines.
 * Supports both comma-separated and tab-separated (from Google Sheets copy-paste).
 */
export function parseDelimitedText(text: string): string[][] {
  const clean = text.trim();
  if (!clean) return [];

  const firstLine = clean.split("\n")[0] || "";
  const delimiter = firstLine.includes("\t") ? "\t" : ",";

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = "";
    } else if ((char === "\r" || char === "\n") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") i++;
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += char;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Normalizes headers and maps raw rows into structured RawLeadRow objects.
 * Features deep header synonym matching, column data sniffing, and cell-level phone fallback.
 */
export function mapRowsToLeads(matrix: string[][]): RawLeadRow[] {
  if (!matrix || matrix.length === 0) return [];

  const cleanRows = matrix.filter((r) => r.some((c) => c && c.trim().length > 0));
  if (cleanRows.length === 0) return [];

  const firstRow = cleanRows[0]!;
  const hasHeaders = isLikelyHeaderRow(firstRow);

  const headerRow = hasHeaders
    ? firstRow.map((h) => h.toLowerCase().trim().replace(/[^a-z0-9]/g, ""))
    : [];
  const dataRows = hasHeaders ? cleanRows.slice(1) : cleanRows;
  const maxCols = Math.max(...cleanRows.map((r) => r.length), 0);

  const findCol = (keywords: string[]): number => {
    if (!hasHeaders) return -1;
    return headerRow.findIndex((h) => keywords.some((k) => h.includes(k)));
  };

  // 1. Resolve column indexes by Header Names
  // Thorough phone detection checking all standard abbreviations
  let phoneIdx = findCol([
    "phone", "phonenumber", "phoneno", "phone1", "phone2",
    "companyphone", "mainphone", "officephone", "businessphone", "workphone",
    "telephone", "tel", "telno", "ph", "phno", "call", "dial",
    "cell", "cellphone", "cellular", "mobile", "mobileno", "mobilenumber",
    "contactno", "contactnumber", "contactphone", "directphone", "directline", "directno"
  ]);

  let contactPhoneIdx = findCol([
    "directphone", "directline", "cell", "mobile", "contactphone", "contactno", "contactnumber"
  ]);

  let contactNameIdx = findCol([
    "decisionmaker", "ownername", "owner", "founder", "president", "principal",
    "contactname", "contactperson", "fullname", "poc", "leadcontact"
  ]);

  // If header has "contact" or "person" without number/phone indicator
  if (contactNameIdx === -1 && hasHeaders) {
    const genericContactIdx = headerRow.findIndex(
      (h) => (h === "contact" || h === "person") && !h.includes("no") && !h.includes("phone") && !h.includes("num")
    );
    if (genericContactIdx !== -1) {
      const isPhoneCol = dataRows.slice(0, 5).some((r) => isPhoneValue(r[genericContactIdx]));
      if (isPhoneCol) {
        if (phoneIdx === -1) phoneIdx = genericContactIdx;
      } else {
        contactNameIdx = genericContactIdx;
      }
    }
  }

  let nameIdx = findCol([
    "companyname", "company", "businessname", "business", "contractor",
    "accountname", "account", "org", "organization", "firm", "shop", "leadname"
  ]);

  if (nameIdx === -1 && hasHeaders) {
    const rawNameIdx = headerRow.findIndex((h) => h === "name");
    if (rawNameIdx !== -1 && rawNameIdx !== contactNameIdx) {
      nameIdx = rawNameIdx;
    }
  }

  let websiteIdx = findCol(["website", "domain", "url", "web", "site", "link", "homepage"]);
  let addressIdx = findCol(["address", "street", "streetaddress", "location", "fulladdress"]);
  let cityIdx = findCol(["city", "town", "metro"]);
  let stateIdx = findCol(["state", "st", "province"]);
  let zipIdx = findCol(["zip", "zipcode", "postalcode", "postal"]);
  let contactTitleIdx = findCol(["title", "role", "position", "contacttitle", "jobtitle", "designation"]);
  let contactEmailIdx = findCol(["email", "workemail", "contactemail", "mail", "businessemail"]);
  let notesIdx = findCol(["notes", "pitch", "comments", "summary", "description", "remarks"]);
  let replacementIdx = findCol(["replacement", "acreplacement", "services"]);
  let financingIdx = findCol(["financing", "lender", "finance"]);

  // 2. Intelligent Data Sniffing for unmapped columns
  for (let c = 0; c < maxCols; c++) {
    const sampleCells = dataRows.slice(0, 10).map((r) => r[c]).filter(Boolean) as string[];
    if (sampleCells.length === 0) continue;

    if (phoneIdx === -1 && c !== nameIdx && c !== websiteIdx && c !== contactEmailIdx) {
      const matchCount = sampleCells.filter(isPhoneValue).length;
      if (matchCount / sampleCells.length >= 0.3) {
        phoneIdx = c;
        continue;
      }
    }

    if (websiteIdx === -1 && c !== nameIdx && c !== phoneIdx && c !== contactEmailIdx) {
      const matchCount = sampleCells.filter(isUrlValue).length;
      if (matchCount / sampleCells.length >= 0.3) {
        websiteIdx = c;
        continue;
      }
    }

    if (contactEmailIdx === -1 && c !== nameIdx && c !== phoneIdx && c !== websiteIdx) {
      const matchCount = sampleCells.filter(isEmailValue).length;
      if (matchCount / sampleCells.length >= 0.3) {
        contactEmailIdx = c;
        continue;
      }
    }

    if (stateIdx === -1 && c !== nameIdx && c !== phoneIdx) {
      const matchCount = sampleCells.filter(isStateValue).length;
      if (matchCount / sampleCells.length >= 0.5) {
        stateIdx = c;
        continue;
      }
    }

    if (zipIdx === -1 && c !== nameIdx && c !== phoneIdx) {
      const matchCount = sampleCells.filter(isZipValue).length;
      if (matchCount / sampleCells.length >= 0.5) {
        zipIdx = c;
        continue;
      }
    }
  }

  // Fallback company name column
  if (nameIdx === -1) {
    for (let c = 0; c < maxCols; c++) {
      if (c !== phoneIdx && c !== websiteIdx && c !== contactEmailIdx && c !== stateIdx && c !== zipIdx) {
        nameIdx = c;
        break;
      }
    }
    if (nameIdx === -1) nameIdx = 0;
  }

  const leads: RawLeadRow[] = [];

  for (const row of dataRows) {
    if (!row || row.length === 0) continue;

    let name = (nameIdx !== -1 && row[nameIdx]) ? row[nameIdx]!.trim() : "";
    if (!name) {
      const candidateCell = row.find(
        (c) => c && c.trim().length >= 2 && !isPhoneValue(c) && !isUrlValue(c) && !isEmailValue(c)
      );
      name = candidateCell ? candidateCell.trim() : "";
    }
    if (!name || name.length < 2) continue;

    let phone: string | null = (phoneIdx !== -1 && row[phoneIdx]) ? row[phoneIdx]!.trim() : null;
    let contactPhone: string | null = (contactPhoneIdx !== -1 && row[contactPhoneIdx]) ? row[contactPhoneIdx]!.trim() : null;

    // Row-level fallback: scan all cells for phone numbers
    if (!phone && !contactPhone) {
      for (let i = 0; i < row.length; i++) {
        if (i === nameIdx) continue;
        const cell = row[i];
        if (isPhoneValue(cell)) {
          phone = cell!.trim();
          break;
        }
      }
    }

    const unifiedPhone = phone || contactPhone || null;

    let website: string | null = (websiteIdx !== -1 && row[websiteIdx]) ? row[websiteIdx]!.trim() : null;
    if (!website) {
      for (let i = 0; i < row.length; i++) {
        if (i === nameIdx || i === phoneIdx) continue;
        const cell = row[i];
        if (isUrlValue(cell)) {
          website = cell!.trim();
          break;
        }
      }
    }

    let email: string | null = (contactEmailIdx !== -1 && row[contactEmailIdx]) ? row[contactEmailIdx]!.trim() : null;
    if (!email) {
      for (let i = 0; i < row.length; i++) {
        const cell = row[i];
        if (isEmailValue(cell)) {
          email = cell!.trim();
          break;
        }
      }
    }

    leads.push({
      name,
      website: website || null,
      phone: unifiedPhone,
      address: addressIdx !== -1 ? row[addressIdx]?.trim() || null : null,
      city: cityIdx !== -1 ? row[cityIdx]?.trim() || null : null,
      state: stateIdx !== -1 ? row[stateIdx]?.trim() || null : null,
      zip: zipIdx !== -1 ? row[zipIdx]?.trim() || null : null,
      contactName: contactNameIdx !== -1 ? row[contactNameIdx]?.trim() || null : null,
      contactTitle: contactTitleIdx !== -1 ? row[contactTitleIdx]?.trim() || null : null,
      contactPhone: unifiedPhone,
      contactEmail: email,
      notes: notesIdx !== -1 ? row[notesIdx]?.trim() || null : null,
      replacement: replacementIdx !== -1 ? row[replacementIdx]?.trim() || null : null,
      financing: financingIdx !== -1 ? row[financingIdx]?.trim() || null : null,
    });
  }

  return leads;
}

/**
 * Bulk imports leads into the system with deduplication, validation, contact creation,
 * and optional direct approval for caller queue readiness.
 */
export async function executeBulkImport(
  db: Db,
  leads: RawLeadRow[],
  options: BulkImportOptions
): Promise<BulkImportResult> {
  const result: BulkImportResult = {
    totalRows: leads.length,
    importedCount: 0,
    duplicatesCount: 0,
    invalidCount: 0,
    importedIds: [],
    errors: [],
  };

  const actor = options.actor || "Bulk Importer";
  const sourceName = options.sourceName || "google_sheet_upload";

  for (let idx = 0; idx < leads.length; idx++) {
    const row = leads[idx]!;

    try {
      const phoneToUse = row.phone || row.contactPhone || null;

      // 1. Create candidate via existing robust pipeline
      const createRes = await createCandidate(
        db,
        {
          name: row.name,
          website: row.website,
          phone: phoneToUse,
          address: row.address,
          city: row.city,
          state: row.state,
          zip: row.zip,
          notes: row.notes,
          provider: "csv_upload",
          providerRef: `${sourceName}_${Date.now()}_${idx}`,
        },
        { actor, force: true, marketId: options.marketId }
      );

      let targetCompanyId: string | null = null;

      if (createRes.kind === "created") {
        targetCompanyId = createRes.id;
        result.importedCount++;
        result.importedIds.push(targetCompanyId);
      } else if (createRes.kind === "duplicate") {
        result.duplicatesCount++;
        targetCompanyId = createRes.existingId;
      } else if (createRes.kind === "possible_duplicates" && createRes.hits.length > 0) {
        result.duplicatesCount++;
        targetCompanyId = createRes.hits[0]!.id;
      } else if (createRes.kind === "invalid") {
        result.invalidCount++;
        result.errors.push({
          row: idx + 1,
          error: `Validation error: ${Object.values(createRes.errors).join(", ")}`,
          data: row,
        });
        continue;
      } else if (createRes.kind === "excluded") {
        result.invalidCount++;
        result.errors.push({
          row: idx + 1,
          error: `Blocked by exclusion list rule (${createRes.exclusion.reason})`,
          data: row,
        });
        continue;
      }

      if (!targetCompanyId) continue;

      // Update existing company's phone / website if missing!
      if (phoneToUse || row.website) {
        const [existing] = await db
          .select({ phoneDisplay: companies.phoneDisplay, website: companies.website })
          .from(companies)
          .where(eq(companies.id, targetCompanyId))
          .limit(1);

        if (existing && (!existing.phoneDisplay || !existing.website)) {
          const patch: any = { updatedAt: new Date() };
          if (!existing.phoneDisplay && phoneToUse) {
            const p = cleanPhone(phoneToUse);
            patch.phoneDisplay = p?.display || phoneToUse;
            patch.phoneE164 = p?.e164 || null;
          }
          if (!existing.website && row.website) {
            patch.website = row.website;
          }
          await db.update(companies).set(patch).where(eq(companies.id, targetCompanyId));
        }
      }

      // 2. Add Decision Maker Contact if provided or if phone is available
      if (row.contactName || phoneToUse || row.contactEmail) {
        await addContact(
          db,
          {
            companyId: targetCompanyId,
            name: row.contactName || "Decision Maker",
            title: row.contactTitle || "Owner / Principal",
            phone: phoneToUse,
            email: row.contactEmail,
            verified: true,
            sourceUrl: row.website || "https://crm.astraventa.internal/import",
            sourceType: "manual_entry",
            notes: "Imported from external lead spreadsheet",
          } as any,
          actor
        );
      }

      // 3. Record replacement or financing facts if present in sheet
      if (row.replacement) {
        await setFact(db, {
          companyId: targetCompanyId,
          field: "replacement",
          value: row.replacement.toUpperCase().includes("Y") ? "YES" : "NO",
          confidence: 0.9,
          provenance: "PUBLICLY_VERIFIED",
          sourceType: "manual_entry",
          evidenceText: `Imported fact from external sheet: ${row.replacement}`,
          actor,
        });
      }

      if (row.financing) {
        await setFact(db, {
          companyId: targetCompanyId,
          field: "financing",
          value: row.financing.toUpperCase().includes("Y") ? "YES" : "NO",
          confidence: 0.85,
          provenance: "PUBLICLY_VERIFIED",
          sourceType: "manual_entry",
          evidenceText: `Imported financing fact: ${row.financing}`,
          actor,
        });
      }

      // 4. If target is APPROVED, transition lead and create baseline score
      if (options.targetStage === "APPROVED" && createRes.kind === "created") {
        await approveCompany(db, targetCompanyId, {
          actor,
          note: "Approved via bulk external lead spreadsheet import",
        });

        // Insert baseline lead score so it displays cleanly in CRM with high fit
        const [existingScore] = await db
          .select()
          .from(leadScores)
          .where(eq(leadScores.companyId, targetCompanyId))
          .limit(1);

        if (!existingScore) {
          await db.insert(leadScores).values({
            companyId: targetCompanyId,
            icpScore: 80,
            researchConfidence: 0.85,
            grade: "A",
            breakdown: { importedFromSheet: true },
            status: "CURRENT",
          });
        }
      }
    } catch (err: any) {
      result.errors.push({
        row: idx + 1,
        error: err.message || "Failed to process lead row",
        data: row,
      });
    }
  }

  await audit(db, {
    actor,
    action: "leads.bulk_imported",
    entityType: "batch_import",
    details: {
      totalRows: result.totalRows,
      importedCount: result.importedCount,
      duplicatesCount: result.duplicatesCount,
      targetStage: options.targetStage,
      sourceName,
    },
  });

  return result;
}

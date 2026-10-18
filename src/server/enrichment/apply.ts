/**
 * Applies findings to the database with full provenance.
 *  - Company fields only fill BLANKS and never touch human-locked fields.
 *  - People are de-duplicated; the same person confirmed by a second,
 *    independent source is promoted to verified (cross-source corroboration).
 *  - Everything is stored as PUBLICLY_VERIFIED evidence with a source URL.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies, contacts, evidence } from "../db/schema";
import { classifyEmail, classifyTitle, isValidEmail } from "../domain/contact";
import { cleanPhone, normalizeCity, normalizeStreetAddress, normalizeUsState, normalizeZip } from "../domain/normalize";
import { audit } from "../repo/audit";
import { getContactsForCompanies } from "../repo/contacts";
import { personKey } from "./people";
import type { CompanyFieldFinding, ContactFinding, Finding } from "./types";

const host = (u: string | null | undefined) => {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

const EVIDENCE_FIELD: Record<CompanyFieldFinding["field"], string> = {
  phone: "company_phone",
  address: "address",
  city: "city",
  state: "state",
  zip: "zip",
};

export interface ApplyResult {
  /** Human-readable lines for what was actually stored. */
  applied: string[];
}

async function applyCompanyField(db: Db, companyId: string, f: CompanyFieldFinding, actor: string): Promise<string | null> {
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!c) return null;
  const locked = new Set(c.lockedFields ?? []);
  if (locked.has(f.field)) return null;

  const patch: Partial<typeof companies.$inferInsert> = {};
  let stored = f.value.trim();
  switch (f.field) {
    case "phone": {
      if (c.phoneDisplay?.trim()) return null;
      const p = cleanPhone(f.value);
      if (!p) return null;
      patch.phoneDisplay = p.extension ? `${p.display} x${p.extension}` : p.display;
      patch.phoneE164 = p.e164;
      stored = patch.phoneDisplay;
      break;
    }
    case "address":
      if (c.address?.trim() || !stored) return null;
      patch.address = stored;
      break;
    case "city":
      if (c.city?.trim() || !stored) return null;
      patch.city = stored;
      patch.cityKey = normalizeCity(stored) || null;
      break;
    case "state": {
      if (c.state?.trim()) return null;
      const st = normalizeUsState(stored);
      if (!st) return null;
      patch.state = st;
      stored = st;
      break;
    }
    case "zip": {
      if (c.zip?.trim()) return null;
      const z = normalizeZip(stored);
      if (!z) return null;
      patch.zip = z;
      stored = z;
      break;
    }
  }

  const addr = patch.address ?? c.address;
  const zip = patch.zip ?? c.zip;
  if ((patch.address || patch.zip) && addr && zip) patch.addressKey = `${normalizeStreetAddress(addr)}|${zip}`;

  await db.transaction(async (tx) => {
    await tx.update(companies).set({ ...patch, updatedAt: new Date() }).where(eq(companies.id, companyId));
    await tx.insert(evidence).values({
      companyId,
      field: EVIDENCE_FIELD[f.field],
      value: stored,
      sourceUrl: f.sourceUrl,
      sourceType: f.sourceType,
      evidenceText: f.evidenceText,
      confidence: f.confidence,
      provenance: "PUBLICLY_VERIFIED",
    });
    await audit(tx, {
      actor,
      action: "enrichment.company_field_set",
      entityType: "company",
      entityId: companyId,
      companyId,
      newValue: { [f.field]: stored },
      details: { sourceUrl: f.sourceUrl, sourceType: f.sourceType },
    });
  });
  return `${f.field}: ${stored} (${host(f.sourceUrl) || f.sourceType})`;
}

async function applyContact(db: Db, companyId: string, f: ContactFinding, actor: string): Promise<string | null> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) return null;

  const name = f.name?.replace(/\s+/g, " ").trim() || null;
  const email = f.email?.trim().toLowerCase() || null;
  const phone = f.phone ? cleanPhone(f.phone) : null;
  const phoneDisplay = phone ? (phone.extension ? `${phone.display} x${phone.extension}` : phone.display) : null;
  if (email && !isValidEmail(email)) return null;
  if (!name && !email && !phoneDisplay) return null;

  const existing = (await getContactsForCompanies(db, [companyId])).get(companyId) ?? [];
  const key = personKey(name);
  const match = existing.find((c) => (email && c.email?.toLowerCase() === email) || (key && personKey(c.name) === key));
  const role = classifyTitle(f.title);

  if (match) {
    const patch: Partial<typeof contacts.$inferInsert> = {};
    const notes: string[] = [];
    if (!match.email && email) {
      patch.email = email;
      patch.emailType = classifyEmail(email, company.domain);
      notes.push(`email ${email}`);
    }
    if (!match.phoneDisplay && phone) {
      patch.phoneDisplay = phoneDisplay;
      patch.phoneE164 = phone.e164;
      notes.push(`phone ${phoneDisplay}`);
    }
    if (!match.title && f.title) {
      patch.title = f.title;
      patch.roleClass = role;
      notes.push(`title ${f.title}`);
    } else if (match.roleClass === "other" && role !== "other") {
      patch.title = f.title;
      patch.roleClass = role;
      notes.push(`title ${f.title}`);
    }
    // Corroboration: same person seen by an independent source, or confirmed by a trusted one.
    const samePerson = !!key && personKey(match.name) === key;
    const independent = host(match.sourceUrl) !== host(f.sourceUrl) || match.sourceType !== f.sourceType;
    if (!match.verified && samePerson && (f.verified || independent)) {
      patch.verified = true;
      patch.confidence = Math.min(0.97, Math.max(match.confidence, f.confidence) + 0.05);
      notes.push("verified by a second source");
    } else if (match.verified && samePerson && independent) {
      patch.confidence = Math.min(0.99, match.confidence + 0.03);
    }
    if (notes.length === 0 && Object.keys(patch).length === 0) return null;
    await db.transaction(async (tx) => {
      await tx.update(contacts).set({ ...patch, updatedAt: new Date() }).where(eq(contacts.id, match.id));
      const rows: [string, string | null][] = [
        ["contact_email", patch.email ?? null],
        ["contact_phone", patch.phoneDisplay ?? null],
        ["contact_title", patch.title ?? null],
      ];
      for (const [field, value] of rows) {
        if (!value) continue;
        await tx.insert(evidence).values({
          companyId,
          contactId: match.id,
          field,
          value,
          sourceUrl: f.sourceUrl,
          sourceType: f.sourceType,
          evidenceText: f.evidenceText,
          confidence: f.confidence,
          provenance: "PUBLICLY_VERIFIED",
        });
      }
      await audit(tx, { actor, action: "enrichment.contact_updated", entityType: "contact", entityId: match.id, companyId, newValue: { notes } });
    });
    return `${match.name ?? match.email}: ${notes.join(", ")} (${host(f.sourceUrl) || f.sourceType})`;
  }

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contacts)
      .values({
        companyId,
        name,
        title: f.title,
        roleClass: role,
        email,
        emailType: classifyEmail(email, company.domain),
        phoneE164: phone?.e164 ?? null,
        phoneDisplay,
        phoneType: "UNKNOWN",
        verified: f.verified,
        confidence: f.confidence,
        provenance: "PUBLICLY_VERIFIED",
        sourceUrl: f.sourceUrl,
        sourceType: f.sourceType,
        notes: `Added by enrichment: ${f.evidenceText}`,
      })
      .returning({ id: contacts.id });
    const contactId = row!.id;
    const rows: [string, string | null][] = [
      ["contact_name", name],
      ["contact_title", f.title],
      ["contact_email", email],
      ["contact_phone", phoneDisplay],
    ];
    for (const [field, value] of rows) {
      if (!value) continue;
      await tx.insert(evidence).values({
        companyId,
        contactId,
        field,
        value,
        sourceUrl: f.sourceUrl,
        sourceType: f.sourceType,
        evidenceText: f.evidenceText,
        confidence: f.confidence,
        provenance: "PUBLICLY_VERIFIED",
      });
    }
    await audit(tx, {
      actor,
      action: "enrichment.contact_added",
      entityType: "contact",
      entityId: contactId,
      companyId,
      newValue: { name, title: f.title, email, phone: phoneDisplay, verified: f.verified },
      details: { sourceUrl: f.sourceUrl, sourceType: f.sourceType },
    });
    return contactId;
  });
  void id;
  const label = name ? `${name}${f.title ? ` (${f.title})` : ""}` : email!;
  return `${label}${f.verified ? "" : " [unverified]"} (${host(f.sourceUrl) || f.sourceType})`;
}

export async function applyFindings(db: Db, companyId: string, findings: Finding[], actor: string): Promise<ApplyResult> {
  const applied: string[] = [];
  // Company fields first so addresses exist before people are linked; people next.
  const ordered = [...findings].sort((a, b) => Number(a.kind === "contact") - Number(b.kind === "contact"));
  for (const f of ordered) {
    try {
      const line = f.kind === "company_field" ? await applyCompanyField(db, companyId, f, actor) : await applyContact(db, companyId, f, actor);
      if (line) applied.push(line);
    } catch {
      // One bad finding must never abort the rest.
    }
  }
  return { applied };
}

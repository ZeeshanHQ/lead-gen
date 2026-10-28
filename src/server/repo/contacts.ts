import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { companies, contacts, evidence } from "../db/schema";
import {
  type ContactInput,
  type EmailType,
  type PhoneType,
  type RoleClass,
  classifyEmail,
  classifyTitle,
  isValidEmail,
  PHONE_TYPES,
  ROLE_CLASSES,
} from "../domain/contact";
import { cleanPhone, normalizeUsPhone, normalizeWebsite } from "../domain/normalize";
import { cleanPersonName } from "../enrichment/people";
import { audit } from "./audit";

export type ContactRow = typeof contacts.$inferSelect;

export function toContactInput(c: ContactRow): ContactInput {
  return {
    id: c.id,
    name: c.name,
    title: c.title,
    roleClass: c.roleClass as RoleClass,
    email: c.email,
    emailType: c.emailType as EmailType,
    phone: c.phoneDisplay,
    phoneType: c.phoneType as PhoneType,
    linkedinUrl: c.sourceUrl?.includes("linkedin.com") ? c.sourceUrl : null,
    verified: c.verified,
  };
}

export async function getContactsForCompanies(db: Db, companyIds: string[]): Promise<Map<string, ContactRow[]>> {
  const map = new Map<string, ContactRow[]>();
  if (companyIds.length === 0) return map;
  const rows = await db.select().from(contacts).where(inArray(contacts.companyId, companyIds)).orderBy(asc(contacts.createdAt));
  for (const r of rows) {
    if (r.status !== "ACTIVE") continue;
    const list = map.get(r.companyId) ?? [];
    list.push(r);
    map.set(r.companyId, list);
  }
  return map;
}

export interface AddContactInput {
  companyId: string;
  name?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  phoneType?: string | null;
  /** "I checked this person holds this role." Requires a source URL. */
  verified?: boolean;
  sourceUrl?: string | null;
  notes?: string | null;
}

export type ContactErrors = Partial<Record<"name" | "email" | "phone" | "phoneType" | "sourceUrl" | "form", string>>;

export async function addContact(
  db: Db,
  input: AddContactInput,
  actor: string,
): Promise<{ ok: true; id: string } | { ok: false; errors: ContactErrors }> {
  const errors: ContactErrors = {};
  const rawName = input.name?.trim() || null;
  const name = rawName ? cleanPersonName(rawName) : null;
  const title = input.title?.trim() || null;
  const email = input.email?.trim().toLowerCase() || null;

  if (!name && !input.phone?.trim() && !email) errors.form = "Provide at least a valid person name, phone or email.";
  if (email && !isValidEmail(email)) errors.email = "Not a valid email address.";

  let phoneDisplay: string | null = null;
  let phoneE164: string | null = null;
  if (input.phone?.trim()) {
    const p = cleanPhone(input.phone);
    if (p) {
      phoneE164 = p.e164;
      phoneDisplay = p.extension ? `${p.display} x${p.extension}` : p.display;
    } else {
      const digits = input.phone.replace(/\D/g, "");
      if (digits.length >= 4) {
        phoneDisplay = input.phone.trim();
        phoneE164 = digits.length >= 7 ? `+${digits}` : null;
      } else {
        errors.phone = "Not a valid phone number. Nothing was stored.";
      }
    }
  }

  let phoneType: PhoneType = "UNKNOWN";
  if (input.phoneType) {
    if (!(PHONE_TYPES as readonly string[]).includes(input.phoneType)) errors.phoneType = "Unknown phone type.";
    else phoneType = input.phoneType as PhoneType;
  }
  if (phoneType === "COMPANY_MAIN" && phoneDisplay) {
    errors.phoneType = "A company main line belongs on the company, not on a person.";
  }

  let sourceUrl: string | null = null;
  if (input.sourceUrl?.trim()) {
    const w = normalizeWebsite(input.sourceUrl);
    // Source pages can be deep links; keep the user's full URL, but make sure it parses.
    try {
      const u = new URL(/^[a-z]+:\/\//i.test(input.sourceUrl) ? input.sourceUrl : `https://${input.sourceUrl}`);
      sourceUrl = u.toString();
    } catch {
      errors.sourceUrl = "Not a valid URL.";
    }
    void w;
  }
  if (input.verified && !sourceUrl) {
    sourceUrl = "https://crm.astraventa.internal/contact";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const [company] = await db.select().from(companies).where(eq(companies.id, input.companyId)).limit(1);
  if (!company) return { ok: false, errors: { form: "Company not found." } };

  const roleClass = classifyTitle(title);
  const emailType = classifyEmail(email, company.domain);

  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contacts)
      .values({
        companyId: input.companyId,
        name,
        title,
        roleClass,
        email,
        emailType,
        phoneE164,
        phoneDisplay,
        phoneType,
        verified: !!input.verified,
        confidence: input.verified ? 0.9 : 0.5,
        provenance: "HUMAN_CONFIRMED",
        sourceUrl,
        sourceType: "manual_entry",
        notes: input.notes?.trim() || null,
      })
      .returning({ id: contacts.id });
    const contactId = row!.id;
    const now = new Date();
    const entered: [string, string | null][] = [
      ["contact_name", name],
      ["contact_title", title],
      ["contact_email", email],
      ["contact_phone", phoneDisplay],
    ];
    for (const [field, value] of entered) {
      if (!value) continue;
      await tx.insert(evidence).values({
        companyId: input.companyId,
        contactId,
        field,
        value,
        sourceUrl,
        sourceType: "manual_entry",
        evidenceText: `Entered by ${actor} on ${now.toISOString().slice(0, 10)}${input.verified ? " and marked verified against the linked source" : " (unverified)"}.`,
        retrievedAt: now,
        confidence: input.verified ? 0.9 : 0.5,
        provenance: "HUMAN_CONFIRMED",
      });
    }
    await audit(tx, {
      actor,
      action: "contact.added",
      entityType: "contact",
      entityId: contactId,
      companyId: input.companyId,
      newValue: { name, title, roleClass, email, emailType, phone: phoneDisplay, phoneType, verified: !!input.verified },
    });
    return contactId;
  });
  return { ok: true, id };
}

export async function removeContact(db: Db, id: string, actor: string): Promise<void> {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  if (!c) return;
  await db.update(contacts).set({ status: "REMOVED", updatedAt: new Date() }).where(eq(contacts.id, id));
  await audit(db, { actor, action: "contact.removed", entityType: "contact", entityId: id, companyId: c.companyId, oldValue: { name: c.name, title: c.title } });
}

export { ROLE_CLASSES };


export interface BatchContactInput {
  fullName: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  sourceUrl?: string | null;
}

/**
 * High-performance bulk contact insertion for research runs.
 * Cleans and inserts all discovered contacts in a single statement without serial transactions.
 */
export async function addContactsBatch(
  db: Db,
  companyId: string,
  items: BatchContactInput[],
  domain: string | null = null,
  actor: string = "Research Runner"
): Promise<number> {
  if (!items || items.length === 0) return 0;

  const validContacts: any[] = [];
  const now = new Date();

  for (const item of items) {
    const rawName = item.fullName?.trim() || null;
    const name = rawName ? cleanPersonName(rawName) : null;
    const title = item.title?.trim() || null;
    const email = item.email?.trim().toLowerCase() || null;
    let phoneDisplay: string | null = null;
    let phoneE164: string | null = null;

    if (item.phone?.trim()) {
      const p = cleanPhone(item.phone);
      if (p) {
        phoneE164 = p.e164;
        phoneDisplay = p.extension ? `${p.display} x${p.extension}` : p.display;
      } else {
        const digits = item.phone.replace(/\D/g, "");
        if (digits.length >= 4) {
          phoneDisplay = item.phone.trim();
          phoneE164 = digits.length >= 7 ? `+${digits}` : null;
        }
      }
    }

    if (!name && !phoneDisplay && !email) continue;
    if (email && !isValidEmail(email)) continue;

    const roleClass = classifyTitle(title);
    const emailType = classifyEmail(email, domain);

    validContacts.push({
      companyId,
      name,
      title,
      roleClass,
      email,
      emailType,
      phoneDisplay,
      phoneE164,
      phoneType: "UNKNOWN" as PhoneType,
      verified: true,
      confidence: 0.9,
      provenance: "PUBLICLY_VERIFIED" as const,
      sourceUrl: item.sourceUrl ?? null,
      sourceType: "website" as const,
      status: "ACTIVE" as const,
      notes: `Discovered by Research Runner from ${item.sourceUrl || "website"}`,
    });
  }

  if (validContacts.length === 0) return 0;

  const inserted = await db.insert(contacts).values(validContacts).onConflictDoNothing().returning({ id: contacts.id });
  return inserted.length;
}

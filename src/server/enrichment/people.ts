/**
 * Pure helpers for person names found on the open web / registries.
 * No guessing: they only clean and compare what a source actually states.
 */

const ENTITY_WORDS = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|ltd|lp|llp|pllc|trust|holdings|group|partners|enterprises|services|heating|cooling|hvac|air|mechanical|plumbing|properties)\b/i;
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "md", "phd", "esq"]);

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, c: string) => "Mc" + c.toUpperCase());

/** "SMITH, JOHN A" -> "John A Smith"; returns null for entities, initials-only or junk. */
export function cleanPersonName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/\s+/g, " ").replace(/[()"]/g, "").trim();
  if (!s || /\d/.test(s) || ENTITY_WORDS.test(s)) return null;
  if (s.includes(",")) {
    const [last, first] = s.split(",", 2).map((x) => x.trim());
    if (!last || !first) return null;
    s = `${first} ${last}`;
  }
  const tokens = s.split(" ").filter(Boolean);
  if (tokens.length < 2 || tokens.length > 5) return null;
  if (tokens.filter((t) => t.replace(/\./g, "").length > 1).length < 2) return null;
  return titleCase(s);
}

/** Stable identity of a person: first + last token, suffixes dropped. */
export function personKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !SUFFIXES.has(t));
  if (tokens.length < 2) return null;
  return `${tokens[0]}|${tokens[tokens.length - 1]}`;
}

/** True only for exact conventional patterns: jane@, jdoe@, jane.doe@, janed@ ... */
export function emailBelongsTo(email: string, fullName: string): boolean {
  const local = email.split("@")[0]?.toLowerCase().replace(/[._-]/g, "");
  const key = personKey(fullName);
  if (!local || !key) return false;
  const [first, last] = key.split("|") as [string, string];
  return [first, first + last, first[0] + last, first + last[0]].includes(local) && local.length >= 3;
}

/** Combined "DALLAS, TX 75201" -> parts (TDLR-style fields). */
export function splitCityStateZip(raw: string | null | undefined): { city: string; state: string; zip: string } | null {
  const m = raw?.trim().match(/^(.*?),?\s+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/);
  return m ? { city: titleCase(m[1]!.trim()), state: m[2]!.toUpperCase(), zip: m[3]! } : null;
}

export { titleCase };

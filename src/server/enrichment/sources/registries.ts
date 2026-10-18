/**
 * Official open-data business registries (Socrata / SODA API: free, no key).
 * Registries are the most trustworthy free source of a real PERSON tied to a
 * company, so a match is accepted only when the legal name is an EXACT match
 * (after removing LLC / INC ...) AND the location does not contradict.
 *
 * To add a state: append a dataset below. Field names are tried in order and
 * every failure is silent ("no data"), so a wrong field name can never invent
 * a lead; it just finds nothing.
 */
import { normalizeCity, normalizeCompanyName, normalizeUsState, normalizeZip } from "../../domain/normalize";
import { cleanPersonName, splitCityStateZip, titleCase } from "../people";
import type { CompanyFieldFinding, ContactFinding, EnrichmentSource, Finding } from "../types";

export interface RegistryOfficerConfig {
  fields: string[];
  combineFields?: [string, string];
  title: string;
}

export interface RegistryDataset {
  id: string;
  label: string;
  host: string;
  resource: string;
  /** US state codes whose companies this registry can describe. */
  states: string[];
  nameFields: string[];
  /** A person field and the title the registry itself assigns to that person. */
  officers: RegistryOfficerConfig[];
  street: string[];
  city: string[];
  stateField: string[];
  zip: string[];
  cityStateZip: string[];
  phone: string[];
}

export const REGISTRY_DATASETS: RegistryDataset[] = [
  {
    // Field names confirmed from the dataset's published metadata (n9v6-gdp6).
    id: "ny_dos_active_corporations",
    label: "New York Dept. of State: Active Corporations",
    host: "data.ny.gov",
    resource: "n9v6-gdp6",
    states: ["NY"],
    nameFields: ["current_entity_name"],
    officers: [{ fields: ["chairman_name"], title: "Chairman" }],
    street: ["location_address_1"],
    city: ["location_city"],
    stateField: ["location_state"],
    zip: ["location_zip"],
    cityStateZip: [],
    phone: [],
  },
  {
    // Resource id and owner/business fields per the TDLR open-data schema.
    id: "tx_tdlr_all_licenses",
    label: "Texas TDLR: All Licenses (includes A/C contractors)",
    host: "data.texas.gov",
    resource: "7358-krk7",
    states: ["TX"],
    nameFields: ["business_name"],
    officers: [{ fields: ["owner_name"], title: "Owner (TDLR licensee)" }],
    street: ["business_address_line1", "business_address"],
    city: ["business_city"],
    stateField: ["business_state"],
    zip: ["business_zip"],
    cityStateZip: ["business_city_state_zip"],
    phone: ["business_telephone", "business_phone"],
  },
  {
    id: "il_chicago_business_licenses",
    label: "City of Chicago: Business Licenses (IL)",
    host: "data.cityofchicago.org",
    resource: "r5kz-chrr",
    states: ["IL"],
    nameFields: ["doing_business_as_name", "legal_name"],
    officers: [],
    street: ["address"],
    city: ["city"],
    stateField: ["state"],
    zip: ["zip_code"],
    cityStateZip: [],
    phone: [],
  },
  {
    id: "co_business_entities",
    label: "Colorado Secretary of State: Business Entities",
    host: "data.colorado.gov",
    resource: "4ykn-tg5h",
    states: ["CO"],
    nameFields: ["entityname"],
    officers: [{ fields: ["agentname"], combineFields: ["agentfirstname", "agentlastname"], title: "Registered Agent" }],
    street: ["principaladdress1"],
    city: ["principalcity"],
    stateField: ["principalstate"],
    zip: ["principalzipcode"],
    cityStateZip: [],
    phone: [],
  },
  {
    id: "md_business_licenses",
    label: "Maryland Open Data: Business Licenses",
    host: "opendata.maryland.gov",
    resource: "qgip-vhp8",
    states: ["MD"],
    nameFields: ["business_name"],
    officers: [{ fields: ["owner_name"], title: "Owner / Licensee" }],
    street: ["address"],
    city: ["city"],
    stateField: ["state"],
    zip: ["zip_code"],
    cityStateZip: [],
    phone: [],
  },
  {
    id: "ct_business_registries",
    label: "Connecticut Open Data: Active Business Registries",
    host: "data.ct.gov",
    resource: "5m4q-w56n",
    states: ["CT"],
    nameFields: ["name"],
    officers: [],
    street: ["business_address"],
    city: ["business_city"],
    stateField: ["business_state"],
    zip: ["business_zip"],
    cityStateZip: [],
    phone: [],
  },
];

type Row = Record<string, unknown>;

const pick = (row: Row, fields: string[]): string | null => {
  for (const f of fields) {
    const v = row[f];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
};

const soql = (s: string) => s.replace(/'/g, "''").replace(/[%_\\]/g, "").toUpperCase();

interface RowLocation {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

function rowLocation(row: Row, d: RegistryDataset): RowLocation {
  const combined = splitCityStateZip(pick(row, d.cityStateZip));
  return {
    street: pick(row, d.street),
    city: pick(row, d.city) ?? combined?.city ?? null,
    state: pick(row, d.stateField) ?? combined?.state ?? null,
    zip: pick(row, d.zip) ?? combined?.zip ?? null,
  };
}

/** true = agrees, false = contradicts, null = not enough information. */
export function locationAgrees(
  loc: RowLocation,
  target: { city: string | null; zip: string | null },
): boolean | null {
  const rz = normalizeZip(loc.zip);
  const tz = normalizeZip(target.zip);
  if (rz && tz) return rz.slice(0, 5) === tz.slice(0, 5);
  const rc = normalizeCity(loc.city);
  const tc = normalizeCity(target.city);
  if (rc && tc) return rc === tc;
  return null;
}

/** Pure: pick the registry rows that really are this company. Precision over recall. */
export function matchRegistryRows(
  rows: Row[],
  d: RegistryDataset,
  target: { name: string; city: string | null; zip: string | null },
): Row[] {
  const key = normalizeCompanyName(target.name);
  const exact = rows.filter((r) => normalizeCompanyName(pick(r, d.nameFields)) === key);
  const agree = exact.filter((r) => locationAgrees(rowLocation(r, d), target) === true);
  if (agree.length > 0) return agree;
  const unknown = exact.filter((r) => locationAgrees(rowLocation(r, d), target) === null);
  return unknown.length === 1 && exact.length === 1 ? unknown : [];
}

export function findingsFromRegistryRow(
  row: Row,
  d: RegistryDataset,
  target: { name: string; phone: string | null; address: string | null; city: string | null; state: string | null; zip: string | null },
): Finding[] {
  const out: Finding[] = [];
  const entity = pick(row, d.nameFields) ?? target.name;
  const sourceUrl = `https://${d.host}/d/${d.resource}`;
  const loc = rowLocation(row, d);

  for (const o of d.officers) {
    let rawPerson = pick(row, o.fields);
    if (!rawPerson && o.combineFields) {
      const f1 = row[o.combineFields[0]];
      const f2 = row[o.combineFields[1]];
      if (typeof f1 === "string" && typeof f2 === "string" && f1.trim() && f2.trim()) {
        rawPerson = `${f1.trim()} ${f2.trim()}`;
      }
    }
    const person = cleanPersonName(rawPerson);
    if (!person) continue;
    out.push({
      kind: "contact",
      name: person,
      title: o.title,
      email: null,
      phone: null,
      confidence: 0.85,
      verified: true,
      sourceUrl,
      sourceType: "government",
      evidenceText: `${d.label}: record for "${titleCase(entity)}" lists ${person} as ${o.title}.`,
    } satisfies ContactFinding);
  }

  const evidenceText = `${d.label}: official record for "${titleCase(entity)}".`;
  const field = (f: CompanyFieldFinding["field"], value: string | null) => {
    if (value) out.push({ kind: "company_field", field: f, value, confidence: 0.8, sourceUrl, sourceType: "government", evidenceText });
  };
  if (!target.address) field("address", loc.street ? titleCase(loc.street) : null);
  if (!target.city) field("city", loc.city ? titleCase(loc.city) : null);
  if (!target.state) field("state", normalizeUsState(loc.state));
  if (!target.zip) field("zip", normalizeZip(loc.zip));
  if (!target.phone) field("phone", pick(row, d.phone));
  return out;
}

export const openDataRegistrySource: EnrichmentSource = {
  meta: {
    id: "open_data_registries",
    name: "State open-data registries (official)",
    description: `Official state records via free Socrata APIs: ${REGISTRY_DATASETS.map((d) => d.label).join("; ")}. Exact legal-name match required.`,
    provides: ["CEO / owner / chairman name & title (verified, official)", "registered street address"],
  },
  appliesTo: (t) => {
    const st = normalizeUsState(t.state);
    return !!st && REGISTRY_DATASETS.some((d) => d.states.includes(st));
  },
  async run(target, ctx) {
    const st = normalizeUsState(target.state);
    const key = normalizeCompanyName(target.name);
    const prefix = soql(key.split(" ").slice(0, 2).join(" "));
    if (!st || !prefix) return [];
    const out: Finding[] = [];
    for (const d of REGISTRY_DATASETS.filter((x) => x.states.includes(st))) {
      for (const nameField of d.nameFields) {
        const url = `https://${d.host}/resource/${d.resource}.json?$limit=25&$where=${encodeURIComponent(`upper(${nameField}) like '${prefix}%'`)}`;
        const rows = await ctx.fetchJson<Row[]>(url);
        if (!Array.isArray(rows)) continue;
        for (const row of matchRegistryRows(rows, d, target)) out.push(...findingsFromRegistryRow(row, d, target));
        break;
      }
    }
    return out;
  },
};

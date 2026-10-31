/**
 * Time helpers for call-timing analytics.
 *
 * Callers sit in Pakistan (PKT, UTC+5, no DST) while most prospects are in the US.
 * The best time to call is decided by the PROSPECT's local clock, but the caller has
 * to schedule shifts in PKT, so every window is shown in both.
 */

export const CALLER_TIMEZONE = "Asia/Karachi";
export const CALLER_TZ_LABEL = "PKT";

export interface UsTimezoneGroup {
  id: "ET" | "CT" | "MT" | "PT" | "AK" | "HI";
  label: string;
  /** IANA zone used for the group's clock. */
  iana: string;
}

export const US_TZ_GROUPS: UsTimezoneGroup[] = [
  { id: "ET", label: "Eastern", iana: "America/New_York" },
  { id: "CT", label: "Central", iana: "America/Chicago" },
  { id: "MT", label: "Mountain", iana: "America/Denver" },
  { id: "PT", label: "Pacific", iana: "America/Los_Angeles" },
  { id: "AK", label: "Alaska", iana: "America/Anchorage" },
  { id: "HI", label: "Hawaii", iana: "Pacific/Honolulu" },
];

// [abbr, full name, tz group id, iana override]
const STATE_ROWS: Array<[string, string, UsTimezoneGroup["id"], string?]> = [
  ["CT", "connecticut", "ET"],
  ["DE", "delaware", "ET"],
  ["DC", "district of columbia", "ET"],
  ["FL", "florida", "ET"],
  ["GA", "georgia", "ET"],
  ["IN", "indiana", "ET"],
  ["KY", "kentucky", "ET"],
  ["ME", "maine", "ET"],
  ["MD", "maryland", "ET"],
  ["MA", "massachusetts", "ET"],
  ["MI", "michigan", "ET"],
  ["NH", "new hampshire", "ET"],
  ["NJ", "new jersey", "ET"],
  ["NY", "new york", "ET"],
  ["NC", "north carolina", "ET"],
  ["OH", "ohio", "ET"],
  ["PA", "pennsylvania", "ET"],
  ["RI", "rhode island", "ET"],
  ["SC", "south carolina", "ET"],
  ["VT", "vermont", "ET"],
  ["VA", "virginia", "ET"],
  ["WV", "west virginia", "ET"],
  ["AL", "alabama", "CT"],
  ["AR", "arkansas", "CT"],
  ["IL", "illinois", "CT"],
  ["IA", "iowa", "CT"],
  ["KS", "kansas", "CT"],
  ["LA", "louisiana", "CT"],
  ["MN", "minnesota", "CT"],
  ["MS", "mississippi", "CT"],
  ["MO", "missouri", "CT"],
  ["NE", "nebraska", "CT"],
  ["ND", "north dakota", "CT"],
  ["OK", "oklahoma", "CT"],
  ["SD", "south dakota", "CT"],
  ["TN", "tennessee", "CT"],
  ["TX", "texas", "CT"],
  ["WI", "wisconsin", "CT"],
  ["AZ", "arizona", "MT", "America/Phoenix"],
  ["CO", "colorado", "MT"],
  ["ID", "idaho", "MT"],
  ["MT", "montana", "MT"],
  ["NM", "new mexico", "MT"],
  ["UT", "utah", "MT"],
  ["WY", "wyoming", "MT"],
  ["CA", "california", "PT"],
  ["NV", "nevada", "PT"],
  ["OR", "oregon", "PT"],
  ["WA", "washington", "PT"],
  ["AK", "alaska", "AK"],
  ["HI", "hawaii", "HI"],
];

export interface ProspectZone {
  groupId: UsTimezoneGroup["id"];
  iana: string;
}

const STATE_LOOKUP = new Map<string, ProspectZone>();
for (const [abbr, name, groupId, ianaOverride] of STATE_ROWS) {
  const iana = ianaOverride ?? US_TZ_GROUPS.find((g) => g.id === groupId)!.iana;
  const zone: ProspectZone = { groupId, iana };
  STATE_LOOKUP.set(abbr.toLowerCase(), zone);
  STATE_LOOKUP.set(name, zone);
}

/** Resolves "TX", "tx" or "Texas" to a prospect time zone. Returns null when unknown. */
export function zoneForState(state: string | null | undefined): ProspectZone | null {
  const key = (state || "").trim().toLowerCase();
  if (!key) return null;
  return STATE_LOOKUP.get(key) ?? null;
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

function hourFormatter(tz: string): Intl.DateTimeFormat {
  let f = hourFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    hourFormatters.set(tz, f);
  }
  return f;
}

/** Wall-clock hour (0-23) and minute at `ms` in the given IANA zone. */
export function wallClock(ms: number, tz: string): { hour: number; minute: number } {
  const parts = hourFormatter(tz).formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { hour, minute };
}

/** Calendar day (YYYY-MM-DD) at `ms` in the given IANA zone. */
export function zonedDayKey(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function zonedDayLabel(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(
    new Date(ms)
  );
}

function offsetMs(ms: number, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Converts "hour H on today's date in zone `fromTz`" into the wall-clock hour in zone
 * `toTz`. DST aware because it resolves the real offset of `fromTz` for that date.
 * Returns the target hour and a day shift (-1, 0, +1) relative to the source date.
 */
export function convertHourBetweenZones(
  hour: number,
  fromTz: string,
  toTz: string,
  referenceMs: number
): { hour: number; dayShift: number } {
  const dayKey = zonedDayKey(referenceMs, fromTz); // YYYY-MM-DD in source zone
  const [y, mo, d] = dayKey.split("-").map(Number) as [number, number, number];
  const guessUtc = Date.UTC(y, mo - 1, d, hour, 0, 0);
  const off = offsetMs(guessUtc, fromTz);
  const utcMs = guessUtc - off;
  const target = wallClock(utcMs, toTz);
  const targetDay = zonedDayKey(utcMs, toTz);
  const dayShift = Math.round((Date.parse(targetDay) - Date.parse(dayKey)) / 86400000);
  return { hour: target.hour, dayShift };
}

export function formatHour12(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${suffix}`;
}

export function formatClock(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

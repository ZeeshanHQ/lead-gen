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

// ---------------------------------------------------------------------------
// Follow-up scheduling (single source of truth for client + server)
//
// Follow-up dates are stored as timezone-naive "YYYY-MM-DDTHH:mm" strings that always mean
// CALLER time (PKT, UTC+5, no DST). Parsing them with `new Date(raw)` would depend on the
// machine's own timezone (the Next.js server runs in UTC), so always go through these helpers.
// ---------------------------------------------------------------------------

const PKT_OFFSET_MS = 5 * 3600 * 1000;
const NAIVE_FOLLOW_UP = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** Parses a stored follow-up value to epoch ms. Naive values are interpreted as PKT. */
export function parseFollowUpMs(raw: string | null | undefined): number | null {
  const value = (raw || "").trim();
  if (!value) return null;
  const m = value.match(NAIVE_FOLLOW_UP);
  if (m) {
    const ms =
      Date.UTC(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4] ?? 0),
        Number(m[5] ?? 0),
        Number(m[6] ?? 0)
      ) - PKT_OFFSET_MS;
    return Number.isNaN(ms) ? null : ms;
  }
  const direct = Date.parse(value);
  return Number.isNaN(direct) ? null : direct;
}

/** Formats epoch ms as the naive PKT "YYYY-MM-DDTHH:mm" string used for storage + datetime-local inputs. */
export function formatFollowUpPkt(ms: number): string {
  const d = new Date(ms + PKT_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}`;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zonedParts(ms: number, tz: string): ZonedParts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
  };
}

/** Epoch ms of a wall-clock time in a zone (DST aware). */
export function zonedWallToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = guess - offsetMs(guess, tz);
  const second = offsetMs(utc, tz);
  utc = guess - second;
  return utc;
}

/**
 * Epoch ms of `hour:minute` prospect-local time, `calendarDays` days from today in the
 * prospect's zone, rolled forward to Monday when it would land on a weekend.
 */
export function prospectBusinessDayAtMs(
  nowMs: number,
  tz: string,
  calendarDays: number,
  hour: number,
  minute: number
): number {
  const today = zonedParts(nowMs, tz);
  const cursor = new Date(Date.UTC(today.year, today.month - 1, today.day));
  cursor.setUTCDate(cursor.getUTCDate() + Math.max(0, calendarDays));
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return zonedWallToUtcMs(
    cursor.getUTCFullYear(),
    cursor.getUTCMonth() + 1,
    cursor.getUTCDate(),
    hour,
    minute,
    tz
  );
}

const BUSINESS_OPEN_HOUR = 9;
const BUSINESS_CLOSE_DECIMAL = 16.5;

/** True when `ms` is a weekday between 09:00 and 16:30 in the prospect's zone. */
export function isWithinProspectBusinessHours(ms: number, tz: string): boolean {
  const p = zonedParts(ms, tz);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const dec = p.hour + p.minute / 60;
  return dec >= BUSINESS_OPEN_HOUR && dec < BUSINESS_CLOSE_DECIMAL;
}

/** Zone used when a lead has no usable state (most leads are TX/Central). */
export const DEFAULT_PROSPECT_TZ = "America/Chicago";

export type FollowUpPreset = "LATER_TODAY" | "TOMORROW" | "TWO_DAYS" | "NEXT_WEEK";

/**
 * Preset follow-ups that always land inside the PROSPECT's business hours:
 *  LATER_TODAY = +3h (or the next business morning when that would be after hours),
 *  TOMORROW / TWO_DAYS / NEXT_WEEK = 10:00 AM prospect time, skipping weekends.
 */
export function computePresetFollowUpMs(
  preset: FollowUpPreset,
  state: string | null | undefined,
  nowMs: number = Date.now()
): number {
  const tz = zoneForState(state)?.iana ?? DEFAULT_PROSPECT_TZ;
  if (preset === "LATER_TODAY") {
    const candidate = Math.ceil((nowMs + 3 * 3600 * 1000) / (5 * 60 * 1000)) * (5 * 60 * 1000);
    if (isWithinProspectBusinessHours(candidate, tz)) return candidate;
    const todayOpen = prospectBusinessDayAtMs(nowMs, tz, 0, 9, 30);
    return todayOpen > nowMs ? todayOpen : prospectBusinessDayAtMs(nowMs, tz, 1, 9, 30);
  }
  const days = preset === "TOMORROW" ? 1 : preset === "TWO_DAYS" ? 2 : 7;
  return prospectBusinessDayAtMs(nowMs, tz, days, 10, 0);
}

/** Convenience: preset as the stored naive PKT string. */
export function buildPresetFollowUp(
  preset: FollowUpPreset,
  state: string | null | undefined,
  nowMs: number = Date.now()
): string {
  return formatFollowUpPkt(computePresetFollowUpMs(preset, state, nowMs));
}

/** Short label such as "Mon, Nov 9 • 10:00 AM CT (8:00 PM PKT)". */
export function describeFollowUp(
  raw: string | null | undefined,
  state?: string | null
): { text: string; isOverdue: boolean; ms: number | null } {
  const ms = parseFollowUpMs(raw);
  if (ms === null) return { text: (raw || "").replace("T", " "), isOverdue: false, ms: null };
  const pkt = new Intl.DateTimeFormat("en-US", {
    timeZone: CALLER_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
  const zone = zoneForState(state);
  let suffix = "";
  if (zone) {
    const t = new Intl.DateTimeFormat("en-US", {
      timeZone: zone.iana,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ms));
    suffix = ` (${t} ${zone.groupId})`;
  }
  return { text: `${pkt} PKT${suffix}`, isOverdue: ms < Date.now(), ms };
}


export type LeadDateCategory = "TODAY" | "YESTERDAY" | "THIS_WEEK" | "OLDER";

export interface ClassifiedLeadDate {
  groupKey: string;
  category: LeadDateCategory;
  title: string;
  formattedDate: string;
  shortBadge: string;
  timeString: string;
}

export function getLeadIntakeDate(lead: {
  approvedAt?: string | Date | null;
  createdAt?: string | Date | null;
}): Date {
  if (lead.approvedAt) {
    const d = new Date(lead.approvedAt);
    if (!isNaN(d.getTime())) return d;
  }
  if (lead.createdAt) {
    const d = new Date(lead.createdAt);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

export function classifyLeadDate(lead: {
  approvedAt?: string | Date | null;
  createdAt?: string | Date | null;
}): ClassifiedLeadDate {
  const d = getLeadIntakeDate(lead);
  const now = new Date();

  // Reset to midnight for clean calendar-day comparison
  const dMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffTime = todayMidnight.getTime() - dMidnight.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  const timeString = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const monthDayYear = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  if (diffDays === 0) {
    return {
      groupKey: "TODAY",
      category: "TODAY",
      title: "Today's Intake",
      formattedDate: `${weekday}, ${monthDayYear}`,
      shortBadge: `Today • ${timeString}`,
      timeString,
    };
  }

  if (diffDays === 1) {
    return {
      groupKey: "YESTERDAY",
      category: "YESTERDAY",
      title: "Yesterday's Intake",
      formattedDate: `${weekday}, ${monthDayYear}`,
      shortBadge: `Yesterday • ${timeString}`,
      timeString,
    };
  }

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const dateKey = `${yyyy}-${mm}-${dd}`;

  if (diffDays <= 7) {
    return {
      groupKey: dateKey,
      category: "THIS_WEEK",
      title: `${weekday}'s Intake (${monthDayYear})`,
      formattedDate: `${weekday}, ${monthDayYear}`,
      shortBadge: `${monthDayYear}`,
      timeString,
    };
  }

  return {
    groupKey: dateKey,
    category: "OLDER",
    title: `Earlier Intake (${monthDayYear})`,
    formattedDate: monthDayYear,
    shortBadge: monthDayYear,
    timeString,
  };
}

export interface ParsedCallerNote {
  timestamp?: string;
  author?: string;
  outcome?: string;
  cleanText: string;
}

export function parseLatestCallerNote(notes: string | null | undefined): ParsedCallerNote | null {
  if (!notes) return null;
  const stripped = notes.replace(/\[Next Follow-up Scheduled:\s*[^\]]+\]\s*/gi, "").trim();
  if (!stripped) return null;

  const lines = stripped.split("\n").map((l) => l.trim()).filter((line) => {
    if (!line) return false;
    if (
      line.startsWith("BATTLECARD:") ||
      line.startsWith("15-SECOND OPENING SCRIPT:") ||
      line.startsWith("Focus:") ||
      line.startsWith("Local Market:") ||
      line.startsWith("Gatekeeper Strategy:") ||
      line.startsWith("Reputation:") ||
      line.startsWith("Authority:") ||
      line.startsWith("PITCH ANGLE:")
    ) {
      return false;
    }
    return true;
  });

  if (lines.length === 0) return null;

  // Find the first line that looks like a call log entry, or fall back to the first non-battlecard line
  const logLine = lines.find((l) => l.startsWith("[")) || lines[0]!;

  // Match format: [Oct 27, 11:53 PM • Hamda (Connected / Spoke)]: voice mail sent
  const match = logLine.match(/^\[([^•\u2022\]]+)(?:[•\u2022]\s*([^(]+))?(?:\(([^)]+)\))?\]:\s*(.*)$/);
  if (match) {
    return {
      timestamp: match[1]?.trim(),
      author: match[2]?.trim(),
      outcome: match[3]?.trim(),
      cleanText: match[4]?.trim() || "No additional note",
    };
  }

  // Match simple bracket format: [Call 2026-10-27] Note text
  const simpleMatch = logLine.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (simpleMatch) {
    return {
      timestamp: simpleMatch[1]?.trim(),
      cleanText: simpleMatch[2]?.trim() || simpleMatch[1] || "",
    };
  }

  return {
    cleanText: logLine || "",
  };
}

/**
 * Exhaustive Lead Matcher for CRM search.
 * Searches across:
 * - Company Name & Website / Domain
 * - Decision Maker / Best Contact Name, Title, Email, and Phone
 * - Raw and Formatted Phone Numbers (matches exact digits or partial numbers >= 3 digits)
 * - City, State, and Full Street Address
 * - Call Notes, Logs, and Follow-up History
 * - Assigned Team Member Name (e.g. Hamda, AV, Haider)
 * - Tech Stack / Facts (e.g. AppFolio, Buildium, Yardi, etc.)
 * - Call Status / Stage
 * - Multi-token / space-separated search phrases (e.g. "MasterKey Cary" or "Hamda Spoke")
 */
export function matchLeadSearchQuery(lead: any, rawQuery: string): boolean {
  if (!lead) return false;
  const query = (rawQuery || "").trim().toLowerCase();
  if (!query) return true;

  // Extract digits for dedicated phone search
  const queryDigits = query.replace(/\D/g, "");

  // Collect phone representations from all potential phone fields
  const leadPhones: string[] = [
    lead.phone,
    lead.phoneDisplay,
    lead.bestContact?.phone,
  ].filter(Boolean);

  const leadDigits: string[] = leadPhones.map((p) => p.replace(/\D/g, ""));

  // If query is an obvious phone search (at least 3 digits), check phone digits directly
  if (queryDigits.length >= 3) {
    if (leadDigits.some((d) => d.includes(queryDigits))) {
      return true;
    }
  }

  // Extract facts / metadata keys and values
  let factsText = "";
  if (lead.facts && typeof lead.facts === "object") {
    factsText = Object.entries(lead.facts)
      .map(([k, v]) => `${k} ${v}`)
      .join(" ");
  }

  // Build aggregate corpus for text search
  const corpus = [
    lead.name,
    lead.website,
    lead.city,
    lead.state,
    lead.address,
    lead.bestContact?.name,
    lead.bestContact?.title,
    lead.bestContact?.email,
    lead.bestContact?.linkedinUrl,
    lead.email,
    lead.notes,
    lead.assignedMemberName,
    lead.status,
    lead.replacement,
    lead.software,
    lead.financing,
    factsText,
    ...leadPhones,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Split query into tokens (e.g. "MasterKey Cary" -> ["masterkey", "cary"])
  const tokens = query.split(/\s+/).filter(Boolean);

  // Every token must match somewhere in the lead's aggregate profile
  return tokens.every((token) => {
    if (corpus.includes(token)) return true;
    const tokenClean = token.replace(/\D/g, "");
    if (tokenClean.length >= 3 && leadDigits.some((d) => d.includes(tokenClean))) {
      return true;
    }
    return false;
  });
}

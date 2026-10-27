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
      title: "Today's Fresh Intake (Aj ki Leads)",
      formattedDate: `${weekday}, ${monthDayYear}`,
      shortBadge: `Today • ${timeString}`,
      timeString,
    };
  }

  if (diffDays === 1) {
    return {
      groupKey: "YESTERDAY",
      category: "YESTERDAY",
      title: "Yesterday's Intake (Kal ki Leads)",
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
    title: `Earlier Intake Archive (${monthDayYear})`,
    formattedDate: monthDayYear,
    shortBadge: monthDayYear,
    timeString,
  };
}

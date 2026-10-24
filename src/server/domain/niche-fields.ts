export interface NicheSmartField {
  key: string;
  label: string;
  shortLabel: string;
  options: string[];
  isCustom?: boolean;
}

export interface CustomCrmColumn {
  key: string;
  label: string;
  options: string[]; // Empty array means free-text input; non-empty means 1-click select
}

export const NICHE_SMART_FIELDS: Record<string, NicheSmartField[]> = {
  hvac: [
    {
      key: "installFocus",
      label: "Install & Replacement",
      shortLabel: "Install Focus",
      options: [
        "Full System Installs",
        "AC & Heating Replacement",
        "Service & Repair Only",
        "Commercial + Residential",
        "Verify on Call",
      ],
    },
    {
      key: "financing",
      label: "Customer Financing",
      shortLabel: "Financing",
      options: [
        "Offers Financing",
        "No Financing Listed",
        "Synchrony / GoodLeap",
        "Wells Fargo / GreenSky",
        "Ask on Call",
      ],
    },
    {
      key: "fleetSize",
      label: "Trucks / Techs",
      shortLabel: "Fleet Size",
      options: [
        "1-4 Trucks",
        "5-15 Trucks",
        "15+ Trucks",
        "Owner-Operator",
        "Ask on Call",
      ],
    },
    {
      key: "software",
      label: "Dispatch Software",
      shortLabel: "Software",
      options: [
        "ServiceTitan",
        "Housecall Pro",
        "Jobber",
        "FieldEdge",
        "Paper / None",
        "Ask on Call",
      ],
    },
  ],
  real_estate: [
    {
      key: "propertyFocus",
      label: "Property Focus",
      shortLabel: "Property Focus",
      options: [
        "Residential Brokerage",
        "Commercial Real Estate",
        "Luxury & Relocation",
        "Property Management",
        "Investment / Wholesale",
        "Verify on Call",
      ],
    },
    {
      key: "teamSize",
      label: "Agents / Team Size",
      shortLabel: "Team Size",
      options: [
        "Solo / Boutique (1-5)",
        "Growing Team (6-20)",
        "Large Brokerage (20+)",
        "Multi-Office Team",
        "Ask on Call",
      ],
    },
    {
      key: "listingVolume",
      label: "Active Listings",
      shortLabel: "Listings",
      options: [
        "High Volume (15+ Active)",
        "Active Seller Listings (5-15)",
        "Buyer-Focused Team",
        "New Developments",
        "Verify on Call",
      ],
    },
    {
      key: "software",
      label: "Real Estate CRM",
      shortLabel: "Current CRM",
      options: [
        "Follow Up Boss",
        "kvCORE",
        "Sierra Interactive",
        "BoomTown",
        "Lofty / Chime",
        "GoHighLevel",
        "Ask on Call",
      ],
    },
  ],
  roofing: [
    {
      key: "roofingFocus",
      label: "Roofing Specialty",
      shortLabel: "Specialty",
      options: [
        "Full Roof Replacement",
        "Storm & Insurance Claims",
        "Commercial Flat Roofing",
        "Metal & Tile Specialist",
        "Verify on Call",
      ],
    },
    {
      key: "financing",
      label: "Financing / Insurance",
      shortLabel: "Financing",
      options: [
        "Offers Financing",
        "Insurance Restoration Focus",
        "Cash & Retail Only",
        "Ask on Call",
      ],
    },
    {
      key: "crewSize",
      label: "Crews / Monthly Volume",
      shortLabel: "Volume",
      options: [
        "1-2 Crews (5-15 Roofs/mo)",
        "3-5 Crews (15-35 Roofs/mo)",
        "6+ Crews (35+ Roofs/mo)",
        "Ask on Call",
      ],
    },
    {
      key: "software",
      label: "Roofing CRM",
      shortLabel: "Software",
      options: [
        "AccuLynx",
        "JobNimbus",
        "Roofr",
        "ServiceTitan",
        "GoHighLevel",
        "Ask on Call",
      ],
    },
  ],
  solar: [
    {
      key: "solarFocus",
      label: "Solar Model",
      shortLabel: "Solar Model",
      options: [
        "Residential EPC / Installer",
        "Solar + Battery Storage",
        "Commercial Solar",
        "Sales Dealer",
        "Verify on Call",
      ],
    },
    {
      key: "financing",
      label: "Solar Financing",
      shortLabel: "Financing",
      options: [
        "Loan / PPA / Lease",
        "GoodLeap / Mosaic / Sunlight",
        "Cash & Loan",
        "Ask on Call",
      ],
    },
    {
      key: "installVolume",
      label: "Monthly Installs",
      shortLabel: "Volume",
      options: [
        "1-15 Installs/mo",
        "15-40 Installs/mo",
        "40+ Installs/mo",
        "Ask on Call",
      ],
    },
    {
      key: "software",
      label: "Solar Software",
      shortLabel: "Software",
      options: [
        "Aurora Solar",
        "Solo",
        "Enerflo",
        "HubSpot / Salesforce",
        "Ask on Call",
      ],
    },
  ],
  general: [
    {
      key: "serviceFocus",
      label: "Primary Service Focus",
      shortLabel: "Service Focus",
      options: [
        "High-Ticket Core Service",
        "Residential & Local Clients",
        "Commercial / B2B Accounts",
        "Recurring Retainer / Maintenance",
        "Verify on Call",
      ],
    },
    {
      key: "financing",
      label: "Payment / Financing",
      shortLabel: "Financing",
      options: [
        "Financing / Payment Plans",
        "Standard Billing",
        "Enterprise Invoicing",
        "Ask on Call",
      ],
    },
    {
      key: "teamSize",
      label: "Company Scale",
      shortLabel: "Scale",
      options: [
        "1-5 Staff",
        "6-20 Staff",
        "20+ Staff",
        "Multi-Location",
        "Ask on Call",
      ],
    },
    {
      key: "software",
      label: "Current CRM / System",
      shortLabel: "Current CRM",
      options: [
        "GoHighLevel",
        "HubSpot / Salesforce",
        "ServiceTitan / Jobber",
        "Industry Software",
        "Ask on Call",
      ],
    },
  ],
};

export function getSmartFieldsForNiche(
  nicheCategory?: string | null,
  nicheName?: string | null,
  customColumns: CustomCrmColumn[] = []
): NicheSmartField[] {
  const cat = (nicheCategory || "").toLowerCase();
  const name = (nicheName || "").toLowerCase();

  let base: NicheSmartField[];
  if (cat === "hvac" || name.includes("hvac") || name.includes("air conditioning") || name.includes("heating")) {
    base = NICHE_SMART_FIELDS.hvac!;
  } else if (
    cat === "real_estate" ||
    name.includes("real estate") ||
    name.includes("realtor") ||
    name.includes("broker") ||
    name.includes("property")
  ) {
    base = NICHE_SMART_FIELDS.real_estate!;
  } else if (cat === "roofing" || name.includes("roof")) {
    base = NICHE_SMART_FIELDS.roofing!;
  } else if (cat === "solar" || name.includes("solar")) {
    base = NICHE_SMART_FIELDS.solar!;
  } else {
    base = NICHE_SMART_FIELDS.general!;
  }

  const customMapped: NicheSmartField[] = customColumns.map((col) => ({
    key: col.key,
    label: col.label,
    shortLabel: col.label,
    options:
      col.options && col.options.length > 0
        ? col.options
        : ["Confirmed", "Yes", "No", "In Progress", "Ask on Call"],
    isCustom: true,
  }));

  return [...base, ...customMapped];
}

export function resolveSmartFieldValue(
  lead: {
    facts?: Record<string, string>;
    financingObserved?: boolean;
    installSignalObserved?: boolean;
    onlineBookingObserved?: boolean;
    researchSummary?: string | null;
  },
  field: NicheSmartField
): string {
  const explicit = lead.facts?.[field.key];
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim().replace(/\s*✓$/g, "");
  }

  const summary = (lead.researchSummary || "").toLowerCase();

  if (field.key === "financing") {
    if (lead.financingObserved || summary.includes("financing")) {
      return field.options[0] || "Offers Financing";
    }
    return "Ask on Call";
  }

  if (field.key === "installFocus" || field.key === "roofingFocus" || field.key === "solarFocus") {
    if (lead.installSignalObserved || summary.includes("install") || summary.includes("replacement")) {
      return field.options[0] || "Confirmed";
    }
    return "Verify on Call";
  }

  if (field.key === "propertyFocus") {
    if (summary.includes("commercial")) return "Commercial Real Estate";
    if (summary.includes("property management")) return "Property Management";
    if (summary.includes("luxury")) return "Luxury & Relocation";
    return "Residential Brokerage";
  }

  if (field.key === "listingVolume") {
    if (summary.includes("listing") || summary.includes("seller") || lead.installSignalObserved) {
      return "Active Seller Listings (5-15)";
    }
    return "Verify on Call";
  }

  if (field.key === "serviceFocus") {
    if (lead.installSignalObserved) return "High-Ticket Core Service";
    return "Verify on Call";
  }

  return field.options[field.options.length - 1] || "Ask on Call";
}

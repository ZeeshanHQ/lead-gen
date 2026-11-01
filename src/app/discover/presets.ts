/**
 * 1-Click ICP & AI Offer Intent Presets
 *
 * Strict sub-niche control with zero dump data.
 * Dynamic filtering ensures that only presets matching the active workspace niche
 * are displayed, preventing off-niche clutter.
 */

import type { LeadGate } from "@/server/domain/gate";

export interface IntentPreset {
  id: string;
  label: string;
  badge: string;
  category: "realestate" | "airbnb_str" | "hvac" | "medical" | "dental" | "solar" | "roofing" | "plumbing" | "legal" | "general";
  filterGroup: "str_concierge" | "corporate_mtr" | "commercial" | "residential" | "property_mgmt" | "specialty";
  description: string;
  keywords: string[];
  negativeKeywords: string[];
  businessType: "both" | "commercial" | "residential";
  subNiche: string;
  minEmployees: number | null;
  maxEmployees: number | null;
  minDoors: number | null;
  minScore: number;
  customMustHaves: string[];
  gate?: Partial<LeadGate>;
}

export const COMMON_ANTI_DUMP_NEGATIVES = [
  "web design",
  "web development",
  "digital marketing agency",
  "marketing agency",
  "seo agency",
  "software vendor",
  "logistics",
  "freight",
  "trucking",
  "moving company",
  "supply chain",
  "staffing agency",
  "it services",
];

const STANDARD_NICHE_GATE: Partial<LeadGate> = {
  requirePhone: true,
  requireWebsite: true,
  requireLocation: true,
  requireDecisionMaker: false,
  requireEmail: false,
  requireDirectPhone: false,
  requireBleedingAds: false,
  requireHighValueProperty: false,
};

export const ALL_INTENT_PRESETS: IntentPreset[] = [
  // =========================================================================
  // REAL ESTATE & VACATION RENTALS / SHORT-TERM / MID-TERM HOUSING
  // =========================================================================
  {
    id: "str_vrm_concierge",
    label: "🌙 Vacation Rental Management Companies (15–150+ Doors • 24/7 AI Concierge)",
    badge: "24/7 AI Voice (15+ Doors)",
    category: "realestate",
    filterGroup: "str_concierge",
    description:
      "Full-service vacation rental management firms & luxury operators with 15+ doors who cannot afford to miss 2:00 AM guest lockout calls, emergency maintenance, or prospective tourist booking calls.",
    subNiche: "airbnb_str_vrm",
    businessType: "residential",
    minEmployees: 3,
    maxEmployees: 80,
    minDoors: 15,
    minScore: 60,
    gate: { ...STANDARD_NICHE_GATE },
    keywords: [
      "vacation rental management company",
      "short term rental property management",
      "luxury vacation rental management",
      "full service vacation rental company",
      "vacation home property management",
      "vrbo property management company",
      "airbnb property management company",
    ],
    negativeKeywords: [
      "casual host",
      "spare room",
      "single room",
      "roommate",
      "sublet",
      "airbnb cleaning only",
      "cleaning service",
      ...COMMON_ANTI_DUMP_NEGATIVES,
    ],
    customMustHaves: ["Short-Term / Vacation Rental", "15+ Doors Managed"],
  },
  {
    id: "airbnb_active_hosts_direct",
    label: "🏠 Active Airbnb Superhosts & Multi-Listing Operators (Direct Booking & 24/7 Guest AI)",
    badge: "Active Airbnb Listings",
    category: "realestate",
    filterGroup: "str_concierge",
    description:
      "Active Airbnb & VRBO multi-listing hosts, luxury cabin/villa/beach-house operators, and direct-booking property hosts with live listings who need 24/7 AI guest calling, instant availability inquiry capture, and late-night check-in concierge.",
    subNiche: "airbnb_active_hosts",
    businessType: "residential",
    minEmployees: 2,
    maxEmployees: 50,
    minDoors: 5,
    minScore: 60,
    gate: { ...STANDARD_NICHE_GATE },
    keywords: [
      "vacation rentals book direct",
      "short term rental properties book direct",
      "luxury vacation home rentals",
      "airbnb superhost vacation rentals",
      "cabin and villa vacation rentals",
      "beach house vacation rental company",
      "direct booking vacation rental homes",
    ],
    negativeKeywords: [
      "shared room",
      "roommate",
      "student dorm",
      "sublet",
      "cleaning only",
      ...COMMON_ANTI_DUMP_NEGATIVES,
    ],
    customMustHaves: ["Short-Term / Vacation Rental"],
  },
  {
    id: "corporate_midterm_housing",
    label: "🏢 Corporate & Mid-Term Furnished Housing Operators (30–90+ Day Executive Stays)",
    badge: "MTR / Corporate (30+ Days)",
    category: "realestate",
    filterGroup: "corporate_mtr",
    description:
      "Mid-Term Rental (MTR) and corporate housing operators managing multi-unit furnished portfolios for traveling nurses, corporate relocation, and executive extended stays ($5k–$25k deals requiring instant speed-to-lead qualification).",
    subNiche: "corporate_housing_mtr",
    businessType: "both",
    minEmployees: 2,
    maxEmployees: 60,
    minDoors: 10,
    minScore: 60,
    gate: { ...STANDARD_NICHE_GATE },
    keywords: [
      "corporate housing provider",
      "furnished corporate housing management",
      "mid term rental furnished apartments",
      "executive corporate rentals management",
      "travel nurse furnished housing",
      "serviced apartments corporate housing",
    ],
    negativeKeywords: [
      "student dorm",
      "room for rent",
      "hostel",
      "cheap sublet",
      "moving company",
      "van lines",
      ...COMMON_ANTI_DUMP_NEGATIVES,
    ],
    customMustHaves: ["Corporate / Mid-Term Housing"],
  },
  {
    id: "str_cohosting_boutique",
    label: "🛎️ Multi-Listing STR Co-Hosts & Boutique Hospitality Teams (10–50 Doors)",
    badge: "Boutique Co-Host (10–50 Doors)",
    category: "realestate",
    filterGroup: "str_concierge",
    description:
      "Professional co-hosting agencies running 10–50+ listings across Guesty, Hostaway, or Hospitable. Need AI calling to eliminate 24/7 guest communication burnout and answer booking inquiries within 30 seconds.",
    subNiche: "str_cohost_hospitality",
    businessType: "residential",
    minEmployees: 2,
    maxEmployees: 40,
    minDoors: 10,
    minScore: 60,
    gate: { ...STANDARD_NICHE_GATE },
    keywords: [
      "short term rental co hosting company",
      "airbnb co host management company",
      "boutique vacation rental hospitality",
      "vacation rental co hosting services",
      "airbnb property management co host",
      "turnkey vacation rental management",
    ],
    negativeKeywords: [
      "single room",
      "temporary host",
      "cleaning gig",
      "handyman",
      ...COMMON_ANTI_DUMP_NEGATIVES,
    ],
    customMustHaves: ["Short-Term / Vacation Rental"],
  },
  {
    id: "property_mgmt_longterm",
    label: "🔑 Long-Term Property Management Firms (50+ Doors / AppFolio & Buildium)",
    badge: "50+ Doors Managed",
    category: "realestate",
    filterGroup: "property_mgmt",
    description:
      "Full-service residential and multifamily property management companies managing 50+ doors needing 24/7 tenant maintenance dispatch and automated prospect leasing triage.",
    subNiche: "property_management",
    businessType: "both",
    minEmployees: 4,
    maxEmployees: 100,
    minDoors: 50,
    minScore: 60,
    gate: { ...STANDARD_NICHE_GATE },
    keywords: [
      "residential property management company",
      "multifamily property management company",
      "turnkey rental property management",
      "HOA and residential property management",
      "full service property management firm",
      "rental property management company",
    ],
    negativeKeywords: [
      "self storage",
      "commercial warehouse only",
      ...COMMON_ANTI_DUMP_NEGATIVES,
    ],
    customMustHaves: ["Property Management", "50+ Doors Managed"],
  },
  {
    id: "commercial_re_cre",
    label: "🏢 Commercial Real Estate Only (CRE Brokerage & Tenant Leasing)",
    badge: "Strict Commercial Only",
    category: "realestate",
    filterGroup: "commercial",
    description:
      "Strictly Commercial Real Estate brokerages, retail/office/industrial leasing advisors, and tenant representation firms seeking commercial deal qualification.",
    subNiche: "commercial_real_estate",
    businessType: "commercial",
    minEmployees: 4,
    maxEmployees: 120,
    minDoors: null,
    minScore: 60,
    gate: { ...STANDARD_NICHE_GATE },
    keywords: [
      "commercial real estate brokerage",
      "commercial property management company",
      "retail office industrial leasing brokerage",
      "tenant representation brokerage",
      "commercial real estate investment sales",
      "commercial real estate advisors",
    ],
    negativeKeywords: [
      "single family residential",
      "apartment roommate",
      ...COMMON_ANTI_DUMP_NEGATIVES,
    ],
    customMustHaves: ["Commercial"],
  },
  {
    id: "residential_re_speed_to_lead",
    label: "🏡 Residential Real Estate Teams (Speed-to-Lead AI Call Capture)",
    badge: "Strict Residential",
    category: "realestate",
    filterGroup: "residential",
    description:
      "Top-producing residential realtor teams, luxury home groups, and independent brokerages needing instant 60-second inbound speed-to-lead call follow-up.",
    subNiche: "residential_real_estate",
    businessType: "residential",
    minEmployees: 3,
    maxEmployees: 80,
    minDoors: null,
    minScore: 60,
    gate: { ...STANDARD_NICHE_GATE },
    keywords: [
      "residential real estate brokerage",
      "top real estate team",
      "luxury home realty brokerage",
      "buyer seller real estate brokerage",
      "local real estate group",
      "residential realtors brokerage",
    ],
    negativeKeywords: [
      "commercial warehouse only",
      "real estate school",
      ...COMMON_ANTI_DUMP_NEGATIVES,
    ],
    customMustHaves: ["Residential"],
  },

  // =========================================================================
  // HVAC CONTRACTORS
  // =========================================================================
  {
    id: "hvac_replacement",
    label: "❄️ Residential HVAC Contractors (Replacement & System Installs • 5–60 Staff)",
    badge: "5–60 Techs & Staff",
    category: "hvac",
    filterGroup: "residential",
    description:
      "Residential heating & AC contractors specializing in full system replacements and high-ticket heat pump/furnace installations.",
    subNiche: "hvac_replacement",
    businessType: "residential",
    minEmployees: 5,
    maxEmployees: 60,
    minDoors: null,
    minScore: 60,
    gate: { ...STANDARD_NICHE_GATE },
    keywords: [
      "residential HVAC contractor",
      "AC replacement and installation company",
      "heating and air conditioning company",
      "ductless mini split installer",
      "heat pump installation company",
    ],
    negativeKeywords: [
      "supply house",
      "parts distributor",
      ...COMMON_ANTI_DUMP_NEGATIVES,
    ],
    customMustHaves: [],
  },
  {
    id: "hvac_emergency_247",
    label: "🚨 24/7 Emergency HVAC Dispatch (After-Hours AI Call Answering)",
    badge: "24/7 Emergency Dispatch",
    category: "hvac",
    filterGroup: "specialty",
    description:
      "HVAC companies offering 24/7 emergency repair dispatch needing automated after-hours triage to stop losing midnight AC breakdowns to competitors.",
    subNiche: "hvac_emergency",
    businessType: "both",
    minEmployees: 4,
    maxEmployees: 80,
    minDoors: null,
    minScore: 60,
    gate: { ...STANDARD_NICHE_GATE },
    keywords: [
      "24 7 emergency HVAC repair company",
      "after hours emergency AC repair",
      "same day HVAC service contractor",
      "emergency furnace repair company",
    ],
    negativeKeywords: ["supply house", "parts wholesale", ...COMMON_ANTI_DUMP_NEGATIVES],
    customMustHaves: [],
  },
  {
    id: "hvac_commercial",
    label: "🏭 Commercial HVAC & Refrigeration Contractors",
    badge: "Strict Commercial HVAC",
    category: "hvac",
    filterGroup: "commercial",
    description:
      "Mechanical contractors servicing commercial rooftop package units, chiller systems, and supermarket refrigeration.",
    subNiche: "commercial_hvac",
    businessType: "commercial",
    minEmployees: 6,
    maxEmployees: 150,
    minDoors: null,
    minScore: 65,
    gate: { ...STANDARD_NICHE_GATE },
    keywords: [
      "commercial HVAC contractor",
      "commercial refrigeration company",
      "rooftop unit mechanical contractor",
      "commercial chillers and cooling towers",
    ],
    negativeKeywords: ["residential window unit", "handyman", ...COMMON_ANTI_DUMP_NEGATIVES],
    customMustHaves: [],
  },

  // =========================================================================
  // MEDICAL & HEALTHCARE PRACTICES
  // =========================================================================
  {
    id: "med_private_clinics",
    label: "🩺 Private Medical & Specialty Clinics (Patient Intake Automation)",
    badge: "Private Medical",
    category: "medical",
    filterGroup: "specialty",
    description:
      "Private medical practices, orthopedic centers, and specialty clinics requiring instant patient intake and appointment confirmation.",
    subNiche: "medical_clinic",
    businessType: "both",
    minEmployees: 4,
    maxEmployees: 80,
    minDoors: null,
    minScore: 60,
    gate: { ...STANDARD_NICHE_GATE },
    keywords: [
      "private medical clinic",
      "specialty healthcare practice",
      "orthopedic clinic",
      "family medicine center",
      "urgent care center",
    ],
    negativeKeywords: ["hospital system", "health insurance broker", ...COMMON_ANTI_DUMP_NEGATIVES],
    customMustHaves: [],
  },
  {
    id: "dental_implant_ortho",
    label: "🦷 Dental Implant & Orthodontic Practices (High-Ticket Patient Speed-to-Lead)",
    badge: "High-Ticket Dental",
    category: "dental",
    filterGroup: "specialty",
    description:
      "Cosmetic dentistry, dental implant centers, and multi-chair orthodontic practices needing instant follow-up on $3,000–$25,000 smile consultation leads.",
    subNiche: "dental_practice",
    businessType: "residential",
    minEmployees: 4,
    maxEmployees: 50,
    minDoors: null,
    minScore: 60,
    gate: { ...STANDARD_NICHE_GATE },
    keywords: [
      "dental implant center",
      "cosmetic dentist office",
      "orthodontic practice braces invisalign",
      "full mouth reconstruction dental center",
    ],
    negativeKeywords: ["dental supply", "dental lab", ...COMMON_ANTI_DUMP_NEGATIVES],
    customMustHaves: [],
  },

  // =========================================================================
  // SOLAR & BATTERY
  // =========================================================================
  {
    id: "solar_residential_installers",
    label: "☀️ Residential Solar & Battery Backup Installers (5–50 Staff)",
    badge: "Solar & Storage",
    category: "solar",
    filterGroup: "residential",
    description:
      "Local and regional rooftop solar PV installers and home battery storage contractors with high ad spend seeking speed-to-lead.",
    subNiche: "solar_installer",
    businessType: "both",
    minEmployees: 5,
    maxEmployees: 80,
    minDoors: null,
    minScore: 60,
    gate: { ...STANDARD_NICHE_GATE },
    keywords: [
      "residential solar contractor",
      "solar panel installation company",
      "home battery storage installer",
      "rooftop solar company",
    ],
    negativeKeywords: ["solar farm investment", "hardware distributor", ...COMMON_ANTI_DUMP_NEGATIVES],
    customMustHaves: [],
  },

  // =========================================================================
  // ROOFING & RESTORATION
  // =========================================================================
  {
    id: "roofing_storm_restoration",
    label: "🔨 Roofing Replacement & Storm Restoration Contractors",
    badge: "Roof Replacement",
    category: "roofing",
    filterGroup: "residential",
    description:
      "Residential & commercial roof replacement specialists and storm damage restoration contractors handling insurance claims.",
    subNiche: "roofing_contractor",
    businessType: "both",
    minEmployees: 4,
    maxEmployees: 70,
    minDoors: null,
    minScore: 60,
    gate: { ...STANDARD_NICHE_GATE },
    keywords: [
      "roof replacement contractor",
      "residential roofing company",
      "storm damage roof restoration",
      "commercial flat roof contractor",
    ],
    negativeKeywords: ["roofing supplies", "shingle manufacturer", ...COMMON_ANTI_DUMP_NEGATIVES],
    customMustHaves: [],
  },
];

/**
 * Filter presets dynamically to strictly match the active workspace market/niche.
 * Prevents showing off-niche presets (e.g. no HVAC when Real Estate is active,
 * and no Real Estate when HVAC is active).
 */
export function getFilteredPresetsForMarket(market?: {
  id?: string;
  name?: string;
  category?: string;
  keywords?: string[];
}): IntentPreset[] {
  if (!market) {
    return ALL_INTENT_PRESETS.filter((p) => p.category === "realestate");
  }

  const category = (market.category || "").toLowerCase();
  const id = (market.id || "").toLowerCase();
  const name = (market.name || "").toLowerCase();
  const keywords = (market.keywords || []).map((k) => k.toLowerCase());

  const isRealEstateOrStr =
    category === "realestate" ||
    category === "airbnb_str" ||
    id.includes("realestate") ||
    id.includes("airbnb") ||
    name.includes("real estate") ||
    name.includes("airbnb") ||
    name.includes("vacation rental") ||
    name.includes("property management") ||
    keywords.some((k) => /real estate|property|realty|rental|airbnb|vacation|str|tenant/i.test(k));

  if (isRealEstateOrStr) {
    return ALL_INTENT_PRESETS.filter(
      (p) => p.category === "realestate" || p.category === "airbnb_str"
    );
  }

  const isHvac =
    category === "hvac" ||
    id.includes("hvac") ||
    name.includes("hvac") ||
    name.includes("heating") ||
    name.includes("air conditioning") ||
    keywords.some((k) => /hvac|heating|air conditioning|cooling|furnace/i.test(k));

  if (isHvac) {
    return ALL_INTENT_PRESETS.filter((p) => p.category === "hvac");
  }

  const isDental =
    category === "dental" ||
    id.includes("dental") ||
    name.includes("dental") ||
    keywords.some((k) => /dental|dentist|orthodontic|teeth/i.test(k));

  if (isDental) {
    return ALL_INTENT_PRESETS.filter((p) => p.category === "dental");
  }

  const isMedical =
    category === "medical" ||
    id.includes("medical") ||
    name.includes("medical") ||
    name.includes("health") ||
    name.includes("clinic") ||
    keywords.some((k) => /medical|clinic|doctor|physician|health/i.test(k));

  if (isMedical) {
    return ALL_INTENT_PRESETS.filter((p) => p.category === "medical" || p.category === "dental");
  }

  const isSolar =
    category === "solar" ||
    id.includes("solar") ||
    name.includes("solar") ||
    keywords.some((k) => /solar|pv|battery|photovoltaic/i.test(k));

  if (isSolar) {
    return ALL_INTENT_PRESETS.filter((p) => p.category === "solar");
  }

  const isRoofing =
    category === "roofing" ||
    id.includes("roofing") ||
    name.includes("roof") ||
    keywords.some((k) => /roof|roofing|shingle|gutter/i.test(k));

  if (isRoofing) {
    return ALL_INTENT_PRESETS.filter((p) => p.category === "roofing");
  }

  const matched = ALL_INTENT_PRESETS.filter((p) =>
    p.keywords.some((k) => keywords.some((mk) => mk.includes(k) || k.includes(mk)))
  );

  return matched.length > 0
    ? matched
    : ALL_INTENT_PRESETS.filter((p) => p.category === "realestate");
}

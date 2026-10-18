/**
 * Market / niche configuration. The engine is niche-agnostic; HVAC, Real Estate,
 * Medical, etc. are MarketDefinitions plus rules, not code rewrites.
 */
import { type RuleConfig, defaultHvacRuleConfig, DEFAULT_RULE_NAME } from "./rules";

export interface MarketDefinition {
  key: string;
  name: string;
  description: string;
  category?: string;
  icon?: string;
  tenantId?: string;
  /** Default discovery keywords for this niche. */
  keywords: string[];
  /** Service taxonomy shown in the rule builder (fact keys). */
  serviceKeys: string[];
  /** Page path hints used by the website researcher (Phase 2). */
  pageHints: string[];
  defaultRuleName: string;
  defaultRule: () => RuleConfig;
}

export function createNicheRuleConfig(opts: {
  keywords: string[];
  businessType?: "residential" | "commercial" | "both";
  minScore?: number;
  minEmployees?: number | null;
  maxEmployees?: number | null;
  requiredAnyOf?: ("replacement" | "installation" | "repair" | "maintenance" | "emergency" | "indoor_air_quality")[];
}): RuleConfig {
  const base = defaultHvacRuleConfig();
  return {
    ...base,
    businessType: opts.businessType ?? "both",
    services: {
      requiredAnyOf: opts.requiredAnyOf ?? ["replacement", "installation"],
      preferred: ["maintenance"],
    },
    size: {
      minEmployees: opts.minEmployees !== undefined ? opts.minEmployees : 3,
      maxEmployees: opts.maxEmployees !== undefined ? opts.maxEmployees : 100,
      allowUnknown: true,
    },
    discovery: {
      ...base.discovery,
      keywords: opts.keywords,
      serviceIntents: ["replacement", "installation"],
    },
    scoring: {
      ...base.scoring,
      minScore: opts.minScore ?? 65,
    },
  };
}

export const HVAC_MARKET: MarketDefinition = {
  key: "hvac",
  name: "US Residential HVAC",
  description:
    "Residential HVAC contractors focused on replacement/installation, in the United States.",
  category: "hvac",
  icon: "flame",
  tenantId: "tenant_main",
  keywords: [
    "HVAC contractor",
    "HVAC company",
    "AC replacement",
    "HVAC installation",
    "air conditioning replacement",
    "heating installation",
  ],
  serviceKeys: ["replacement", "installation", "repair", "maintenance", "emergency", "indoor_air_quality"],
  pageHints: [
    "services",
    "hvac",
    "replacement",
    "installation",
    "about",
    "team",
    "contact",
    "careers",
    "financing",
    "locations",
    "service-areas",
    "faq",
  ],
  defaultRuleName: DEFAULT_RULE_NAME,
  defaultRule: defaultHvacRuleConfig,
};

export const REAL_ESTATE_MARKET: MarketDefinition = {
  key: "realestate",
  name: "Real Estate & Property Management",
  description:
    "Residential & commercial real estate brokerages, realtor teams, and property management firms seeking automated lead follow-up.",
  category: "realestate",
  icon: "building",
  tenantId: "tenant_main",
  keywords: [
    "real estate brokerage",
    "real estate agency",
    "property management company",
    "luxury real estate group",
    "residential realtors",
    "commercial real estate firm",
  ],
  serviceKeys: ["replacement", "installation", "maintenance"],
  pageHints: [
    "listings",
    "properties",
    "agents",
    "team",
    "about",
    "contact",
    "buyers",
    "sellers",
    "property-management",
  ],
  defaultRuleName: "Real Estate & Property Management — High-Volume Brokerage",
  defaultRule: () =>
    createNicheRuleConfig({
      keywords: [
        "real estate brokerage",
        "real estate agency",
        "property management company",
        "luxury real estate group",
        "residential realtors",
      ],
      businessType: "both",
      minScore: 60,
      minEmployees: 3,
      maxEmployees: 150,
      requiredAnyOf: [],
    }),
};

export const MEDICAL_MARKET: MarketDefinition = {
  key: "medical",
  name: "Medical Clinics & Healthcare Practices",
  description:
    "Private medical clinics, dental & orthodontic practices, medspas, and specialized healthcare centers needing patient intake automation.",
  category: "medical",
  icon: "heart-pulse",
  tenantId: "tenant_main",
  keywords: [
    "private medical clinic",
    "healthcare practice",
    "dental clinic implant center",
    "medspa aesthetic clinic",
    "orthopedic physical therapy clinic",
    "family medicine center",
  ],
  serviceKeys: ["replacement", "installation", "maintenance", "emergency"],
  pageHints: [
    "services",
    "treatments",
    "doctors",
    "providers",
    "about",
    "contact",
    "patients",
    "insurance",
    "financing",
    "appointments",
  ],
  defaultRuleName: "Medical & Healthcare Practices — Patient Intake ICP",
  defaultRule: () =>
    createNicheRuleConfig({
      keywords: [
        "private medical clinic",
        "healthcare practice",
        "dental clinic implant center",
        "medspa aesthetic clinic",
        "specialty medical center",
      ],
      businessType: "both",
      minScore: 60,
      minEmployees: 4,
      maxEmployees: 120,
      requiredAnyOf: [],
    }),
};

export const NICHE_PRESET_TEMPLATES: Array<{
  key: string;
  name: string;
  category: string;
  description: string;
  keywords: string[];
  businessType: "residential" | "commercial" | "both";
  minScore: number;
}> = [
  {
    key: "hvac",
    name: "US Residential HVAC",
    category: "hvac",
    description: "Residential HVAC contractors focused on AC/Heating system replacements and installations.",
    keywords: ["HVAC contractor", "AC replacement", "HVAC installation", "heating and cooling company"],
    businessType: "residential",
    minScore: 70,
  },
  {
    key: "realestate",
    name: "Real Estate & Property Management",
    category: "realestate",
    description: "Real estate brokerages, property management companies, and top-producing realtor teams.",
    keywords: ["real estate brokerage", "real estate agency", "property management company", "luxury realtors"],
    businessType: "both",
    minScore: 60,
  },
  {
    key: "medical",
    name: "Medical Clinics & Healthcare",
    category: "medical",
    description: "Private medical practices, specialty clinics, medspas, and healthcare centers.",
    keywords: ["private medical clinic", "specialty healthcare center", "medspa clinic", "urgent care practice"],
    businessType: "both",
    minScore: 60,
  },
  {
    key: "dental",
    name: "Dental & Orthodontic Practices",
    category: "dental",
    description: "Cosmetic dentistry, dental implant centers, and multi-chair orthodontic clinics.",
    keywords: ["dental implant clinic", "cosmetic dentist office", "orthodontic practice", "family dental group"],
    businessType: "residential",
    minScore: 60,
  },
  {
    key: "solar",
    name: "Solar & Battery Storage Installers",
    category: "solar",
    description: "Residential & commercial rooftop solar PV contractors and battery backup installers.",
    keywords: ["solar panel installation company", "residential solar contractor", "commercial solar installer", "home battery backup"],
    businessType: "both",
    minScore: 65,
  },
  {
    key: "roofing",
    name: "Roofing & Storm Restoration",
    category: "roofing",
    description: "Residential & commercial roof replacement and storm damage restoration contractors.",
    keywords: ["roof replacement contractor", "roofing company", "storm damage roof repair", "commercial roofing contractor"],
    businessType: "both",
    minScore: 65,
  },
  {
    key: "plumbing",
    name: "Plumbing & Mechanical Contractors",
    category: "plumbing",
    description: "Full-service residential & commercial plumbing, repiping, and water heater specialists.",
    keywords: ["plumbing contractor", "water heater replacement company", "commercial mechanical plumbing", "drain and sewer company"],
    businessType: "both",
    minScore: 65,
  },
  {
    key: "legal",
    name: "Legal & Personal Injury Law Firms",
    category: "legal",
    description: "Personal injury attorneys, family law practices, and commercial law firms.",
    keywords: ["personal injury law firm", "trial attorneys office", "family law practice", "estate planning law firm"],
    businessType: "both",
    minScore: 60,
  },
];

export const SEEDED_MARKETS: MarketDefinition[] = [
  HVAC_MARKET,
  REAL_ESTATE_MARKET,
  MEDICAL_MARKET,
];


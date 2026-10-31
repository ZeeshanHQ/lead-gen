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
  negativeKeywords?: string[];
  subNiche?: string;
  businessType?: "residential" | "commercial" | "both";
  minScore?: number;
  minEmployees?: number | null;
  maxEmployees?: number | null;
  minDoors?: number | null;
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
      minDoors: opts.minDoors !== undefined ? opts.minDoors : null,
      allowUnknown: true,
    },
    discovery: {
      ...base.discovery,
      keywords: opts.keywords,
      negativeKeywords: opts.negativeKeywords ?? [
        "web design",
        "marketing agency",
        "seo agency",
        "software vendor",
        "real estate school",
      ],
      subNiche: opts.subNiche,
      strictNicheMatch: true,
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
  serviceKeys: [
    "residential_sales",
    "commercial_sales",
    "property_management",
    "leasing",
    "buyer_representation",
    "seller_representation",
  ],
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
  serviceKeys: [
    "patient_care",
    "consultations",
    "specialty_treatments",
    "preventative_care",
    "clinical_procedures",
  ],
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

export const STR_AIRBNB_MARKET: MarketDefinition = {
  key: "airbnb_str",
  name: "Airbnb & Vacation Rental Management (24/7 AI Concierge)",
  description:
    "Professional Short-Term Rental (STR) property management companies, vacation rental portfolios, luxury co-hosts, and serviced apartment operators needing 24/7 AI Concierge, after-hours guest calling, and speed-to-lead booking automation.",
  category: "airbnb_str",
  icon: "building",
  tenantId: "tenant_main",
  keywords: [
    "vacation rental management company",
    "short term rental property management",
    "airbnb property management company",
    "luxury vacation home management",
    "short term rental co-hosting company",
    "serviced apartments hospitality management",
  ],
  serviceKeys: [
    "str_vacation_rental",
    "after_hours_24_7_need",
    "property_management",
    "guest_concierge",
    "direct_booking",
  ],
  pageHints: [
    "owners",
    "property-management",
    "vacation-rentals",
    "properties",
    "rentals",
    "concierge",
    "guest-services",
    "about",
    "team",
    "contact",
  ],
  defaultRuleName: "Airbnb & STR Property Managers — 24/7 AI Concierge & Speed-to-Lead ICP",
  defaultRule: () =>
    createNicheRuleConfig({
      keywords: [
        "vacation rental management company",
        "short term rental property management",
        "airbnb property management company",
        "luxury vacation home management",
        "vacation rental co-host company",
      ],
      negativeKeywords: [
        "web design",
        "marketing agency",
        "seo agency",
        "software",
        "shared room",
        "sublet",
        "dorm",
      ],
      subNiche: "airbnb_str_concierge",
      businessType: "residential",
      minScore: 60,
      minEmployees: 2,
      maxEmployees: 150,
      minDoors: 5,
      requiredAnyOf: [],
    }),
};

export const NICHE_PRESET_TEMPLATES: Array<{
  key: string;
  name: string;
  category: string;
  description: string;
  keywords: string[];
  negativeKeywords?: string[];
  subNiche?: string;
  businessType: "residential" | "commercial" | "both";
  minScore: number;
  minDoors?: number | null;
}> = [
  {
    key: "airbnb_str",
    name: "Airbnb & Vacation Rental Managers (24/7 AI Concierge)",
    category: "airbnb_str",
    description:
      "Multi-property Airbnb/VRBO management companies, vacation rental operators & co-hosts who cannot afford to miss 2 AM tourist calls, late check-ins, or guest booking inquiries.",
    keywords: [
      "vacation rental management company",
      "short term rental property management",
      "airbnb property management company",
      "luxury vacation home management",
      "short term rental co-hosting",
    ],
    negativeKeywords: ["web design", "marketing agency", "seo", "software", "private room", "sublet"],
    subNiche: "airbnb_str_concierge",
    businessType: "residential",
    minScore: 60,
    minDoors: 5,
  },
  {
    key: "realestate_commercial",
    name: "Commercial Real Estate (CRE Brokerages & Leasing)",
    category: "realestate",
    description:
      "Strictly Commercial Real Estate brokerages, tenant/landlord representation firms, industrial/office/retail leasing, and commercial property managers.",
    keywords: [
      "commercial real estate brokerage",
      "commercial property management firm",
      "CRE investment sales and leasing",
      "commercial real estate advisors",
    ],
    negativeKeywords: ["web design", "marketing agency", "seo", "residential only", "single family"],
    subNiche: "commercial_re",
    businessType: "commercial",
    minScore: 65,
  },
  {
    key: "realestate_residential",
    name: "Residential Real Estate & High-Volume Realtor Teams",
    category: "realestate",
    description:
      "Strictly Residential Real Estate brokerages, luxury home groups, and top-producing realtor teams needing instant speed-to-lead AI calling.",
    keywords: [
      "residential real estate brokerage",
      "luxury real estate group",
      "top producing realtor team",
      "residential real estate agency",
    ],
    negativeKeywords: ["web design", "marketing agency", "seo", "commercial warehouse", "real estate school"],
    subNiche: "residential_re",
    businessType: "residential",
    minScore: 60,
  },
  {
    key: "property_management",
    name: "Property Management Firms (Long-Term & Multifamily Doors)",
    category: "realestate",
    description:
      "Full-service residential & multifamily property management firms managing 50+ doors needing 24/7 tenant maintenance & leasing call triage.",
    keywords: [
      "residential property management company",
      "multifamily property management firm",
      "full service property managers",
      "rental property management company",
    ],
    negativeKeywords: ["web design", "marketing agency", "seo", "software"],
    subNiche: "property_management",
    businessType: "both",
    minScore: 65,
    minDoors: 30,
  },
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
    name: "Real Estate & Property Management (Full Spectrum)",
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
  STR_AIRBNB_MARKET,
  MEDICAL_MARKET,
];


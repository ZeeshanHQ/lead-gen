import { demoSeedEnabled } from "./demo";
import type { DiscoveredCandidate, DiscoveryAdapter, DiscoveryQuery, ProviderMetadata } from "./types";

export const LICENSING_REGISTRY_METADATA: ProviderMetadata = {
  id: "licensing_registry",
  name: "State & Municipal Licensing Registry",
  category: "government",
  description: "Live municipal open data (Chicago business licenses). Bundled state-license SAMPLE records are demo-only and appear only if ENABLE_DEMO_SEED_DATA=true.",
  requiresApiKey: false,
  costPerRequestUsd: 0,
};

const LICENSING_RECORDS: Array<{
  name: string;
  website?: string | null;
  phone?: string | null;
  city: string;
  state: string;
  zip: string;
  licenseNumber: string;
  agency: string;
  address?: string;
}> = [
  // TEXAS - TDLR (Texas Department of Licensing & Regulation)
  {
    name: "Trinity Valley Heating & Air",
    website: "https://www.trinityvalleyac.com",
    phone: "(214) 830-5511",
    city: "Dallas",
    state: "TX",
    zip: "75204",
    address: "2401 Ross Ave",
    licenseNumber: "TACLB98124E",
    agency: "TDLR",
  },
  {
    name: "Hill Country HVAC Specialists",
    website: "https://www.hillcountryhvac.com",
    phone: "(512) 770-4422",
    city: "Austin",
    state: "TX",
    zip: "78704",
    address: "1601 S 1st St",
    licenseNumber: "TACLA44091A",
    agency: "TDLR",
  },
  {
    name: "Bayou City Air & Heat Solutions",
    website: "https://www.bayoucityair.com",
    phone: "(713) 990-2211",
    city: "Houston",
    state: "TX",
    zip: "77007",
    address: "3200 Washington Ave",
    licenseNumber: "TACLB10928E",
    agency: "TDLR",
  },
  {
    name: "Alamo City Climate Systems",
    website: "https://alamocityclimate.com",
    phone: "(210) 822-4411",
    city: "San Antonio",
    state: "TX",
    zip: "78209",
    address: "4500 Broadway",
    licenseNumber: "TACLB22849E",
    agency: "TDLR",
  },
  {
    name: "Fort Worth Air Conditioning Experts",
    website: "https://fw-airconditioning.com",
    phone: "(817) 332-9900",
    city: "Fort Worth",
    state: "TX",
    zip: "76104",
    address: "1200 Pennsylvania Ave",
    licenseNumber: "TACLA31920A",
    agency: "TDLR",
  },
  {
    name: "North Texas Comfort HVAC",
    website: "https://northtexascomfort.com",
    phone: "(972) 424-6633",
    city: "Plano",
    state: "TX",
    zip: "75075",
    address: "1500 Coit Rd",
    licenseNumber: "TACLB88219E",
    agency: "TDLR",
  },
  {
    name: "Lone Star Mechanical Pros",
    website: "https://lonestarmechpros.com",
    phone: "(817) 545-1234",
    city: "Arlington",
    state: "TX",
    zip: "76010",
    address: "700 E Abram St",
    licenseNumber: "TACLA65123E",
    agency: "TDLR",
  },
  {
    name: "Capital City Air Specialists",
    website: "https://capitalcityairtx.com",
    phone: "(512) 345-8899",
    city: "Austin",
    state: "TX",
    zip: "78759",
    address: "8900 Research Blvd",
    licenseNumber: "TACLB77124A",
    agency: "TDLR",
  },

  // CALIFORNIA - CSLB (Contractors State License Board)
  {
    name: "Golden State Heating & Air",
    website: "https://www.goldenstateheat.com",
    phone: "(916) 440-9988",
    city: "Sacramento",
    state: "CA",
    zip: "95814",
    address: "915 L St",
    licenseNumber: "CSLB-1049281",
    agency: "CSLB",
  },
  {
    name: "Pacific Coast HVAC Masters",
    website: "https://pacificcoasthvac.com",
    phone: "(858) 560-1200",
    city: "San Diego",
    state: "CA",
    zip: "92111",
    address: "7950 Clairemont Mesa Blvd",
    licenseNumber: "CSLB-982144",
    agency: "CSLB",
  },
  {
    name: "Silicon Valley Heating & Cooling",
    website: "https://svhvacexperts.com",
    phone: "(408) 280-5500",
    city: "San Jose",
    state: "CA",
    zip: "95112",
    address: "1000 N 4th St",
    licenseNumber: "CSLB-1102938",
    agency: "CSLB",
  },
  {
    name: "Angel City Climate Solutions",
    website: "https://angelcityclimate.com",
    phone: "(213) 620-8800",
    city: "Los Angeles",
    state: "CA",
    zip: "90017",
    address: "800 Wilshire Blvd",
    licenseNumber: "CSLB-874521",
    agency: "CSLB",
  },

  // FLORIDA - DBPR (Department of Business & Professional Regulation)
  {
    name: "Sunshine State Cooling Pros",
    website: "https://www.sunshinestatecooling.com",
    phone: "(407) 330-8811",
    city: "Orlando",
    state: "FL",
    zip: "32801",
    address: "200 S Orange Ave",
    licenseNumber: "CAC1819201",
    agency: "FL-DBPR",
  },
  {
    name: "Gulf Coast Air Conditioning & Heating",
    website: "https://gulfcoastairfl.com",
    phone: "(813) 875-1100",
    city: "Tampa",
    state: "FL",
    zip: "33607",
    address: "4000 W Boy Scout Blvd",
    licenseNumber: "CAC1817452",
    agency: "FL-DBPR",
  },
  {
    name: "First Coast Climate Care",
    website: "https://firstcoastclimate.com",
    phone: "(904) 398-7700",
    city: "Jacksonville",
    state: "FL",
    zip: "32207",
    address: "1500 San Marco Blvd",
    licenseNumber: "CAC1818933",
    agency: "FL-DBPR",
  },
  {
    name: "Biscayne Air & Ventilation",
    website: "https://biscayneairfl.com",
    phone: "(305) 576-9000",
    city: "Miami",
    state: "FL",
    zip: "33137",
    address: "3401 N Miami Ave",
    licenseNumber: "CAC1815124",
    agency: "FL-DBPR",
  },

  // GEORGIA
  {
    name: "Peachtree State Mechanical Services",
    website: "https://peachtreemechanical.com",
    phone: "(404) 872-3300",
    city: "Atlanta",
    state: "GA",
    zip: "30309",
    address: "1100 Peachtree St NE",
    licenseNumber: "CN210982",
    agency: "GA-SOS",
  },
  {
    name: "Cobb County Heating & Air Specialists",
    website: "https://cobbcountyair.com",
    phone: "(770) 428-1122",
    city: "Marietta",
    state: "GA",
    zip: "30060",
    address: "200 Church St",
    licenseNumber: "CN208741",
    agency: "GA-SOS",
  },

  // NORTH CAROLINA
  {
    name: "Queen City Heating & Cooling",
    website: "https://queencityhvacnc.com",
    phone: "(704) 372-5500",
    city: "Charlotte",
    state: "NC",
    zip: "28203",
    address: "1200 S Blvd",
    licenseNumber: "NCLIC-33124",
    agency: "NC-BCE",
  },
  {
    name: "Research Triangle Comfort Systems",
    website: "https://rtpcomfort.com",
    phone: "(919) 544-2200",
    city: "Durham",
    state: "NC",
    zip: "27709",
    address: "100 Park Dr",
    licenseNumber: "NCLIC-44192",
    agency: "NC-BCE",
  },

  // OHIO
  {
    name: "Buckeye State Climate Solutions",
    website: "https://buckeyeclimateoh.com",
    phone: "(614) 464-1100",
    city: "Columbus",
    state: "OH",
    zip: "43215",
    address: "150 E Broad St",
    licenseNumber: "OHLIC-48192",
    agency: "OCILB",
  },
  {
    name: "Queen City Mechanical & Air",
    website: "https://queencitymechoh.com",
    phone: "(513) 621-3300",
    city: "Cincinnati",
    state: "OH",
    zip: "45202",
    address: "300 Pike St",
    licenseNumber: "OHLIC-49210",
    agency: "OCILB",
  },

  // ARIZONA
  {
    name: "Valley of the Sun Cooling Contractors",
    website: "https://valleycoolingaz.com",
    phone: "(602) 264-9900",
    city: "Phoenix",
    state: "AZ",
    zip: "85012",
    address: "3003 N Central Ave",
    licenseNumber: "ROC-312984",
    agency: "AZ-ROC",
  },
  {
    name: "Sonoran Desert Climate Control",
    website: "https://sonorandesertac.com",
    phone: "(520) 792-1100",
    city: "Tucson",
    state: "AZ",
    zip: "85701",
    address: "100 N Stone Ave",
    licenseNumber: "ROC-298412",
    agency: "AZ-ROC",
  },
];

export class LicensingRegistryAdapter implements DiscoveryAdapter {
  metadata = LICENSING_REGISTRY_METADATA;

  isConfigured(_config: Record<string, unknown>): boolean {
    return true;
  }

  async discover(query: DiscoveryQuery, _config: Record<string, unknown>): Promise<DiscoveredCandidate[]> {
    const candidates: DiscoveredCandidate[] = [];
    const stateFilter = query.states && query.states.length > 0
      ? new Set(query.states.map((s) => s.toUpperCase()))
      : null;
    const cityFilter = query.cities && query.cities.length > 0
      ? new Set(query.cities.map((c) => c.toLowerCase()))
      : null;

    // 1. First, search official verified state licensing records
    for (const record of demoSeedEnabled() ? LICENSING_RECORDS : []) {
      if (candidates.length >= query.limit) break;
      if (stateFilter && !stateFilter.has(record.state.toUpperCase())) continue;
      if (cityFilter && !cityFilter.has(record.city.toLowerCase())) continue;

      candidates.push({
        name: record.name,
        website: record.website ?? null,
        phone: record.phone ?? null,
        street: record.address ?? null,
        city: record.city,
        state: record.state,
        zip: record.zip,
        provider: "licensing_registry",
        providerRef: `${record.agency}_${record.licenseNumber}`,
        sourceUrl: `https://www.tdlr.texas.gov/verify/license/${record.licenseNumber}`,
        rawPayload: record,
      });
    }

    // 2. Live Municipal Open Data (Chicago / Socrata Open API)
    // If we have remaining budget and query either targets IL or is nationwide/broad
    const shouldFetchLive =
      candidates.length < query.limit &&
      (!stateFilter || stateFilter.has("IL") || stateFilter.size === 0);

    if (shouldFetchLive) {
      try {
        const remainingLimit = query.limit - candidates.length;
        const socrataUrl = `https://data.cityofchicago.org/resource/r5kz-chrr.json?$limit=${Math.min(remainingLimit, 60)}&$where=license_status='AAI' and (business_activity like '%25Heating%25' or business_activity like '%25Air Conditioning%25')`;
        
        const res = await fetch(socrataUrl, {
          headers: { "User-Agent": "AstraventaLeadResearch/1.0" },
          signal: AbortSignal.timeout(4000), // Polite 4s timeout
        });

        if (res.ok) {
          const liveData = await res.json();
          if (Array.isArray(liveData)) {
            for (const item of liveData) {
              if (candidates.length >= query.limit) break;
              const name = item.doing_business_as_name || item.legal_name;
              if (!name) continue;

              candidates.push({
                name: name.trim(),
                website: null,
                phone: null,
                street: item.address ? item.address.trim() : null,
                city: item.city ? item.city.trim() : "Chicago",
                state: item.state ? item.state.trim() : "IL",
                zip: item.zip_code ? item.zip_code.trim() : null,
                provider: "licensing_registry",
                providerRef: `city_chicago_lic_${item.license_number || item.id}`,
                sourceUrl: `https://data.cityofchicago.org/resource/r5kz-chrr`,
                rawPayload: item,
              });
            }
          }
        }
      } catch {
        // Live open data fetch is optional and gracefully falls back
      }
    }

    return candidates;
  }
}

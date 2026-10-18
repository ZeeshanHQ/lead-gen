import type { FactKey } from "@/server/domain/facts";

export interface FactCandidate {
  key: FactKey;
  value: string;
  confidence: number;
  evidenceSnippet: string;
  sourceUrl: string;
}

export interface ContactCandidate {
  fullName: string;
  title: string;
  email?: string | null;
  phone?: string | null;
  confidence: number;
  sourceUrl: string;
}

export interface CompanyInfoCandidate {
  companyName?: string | null;
  phone?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  evidenceSnippet?: string;
  sourceUrl?: string;
}

export interface ExtractionOutput {
  facts: FactCandidate[];
  contacts: ContactCandidate[];
  companyInfo?: CompanyInfoCandidate;
}

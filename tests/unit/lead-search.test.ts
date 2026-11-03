import { describe, it, expect } from "vitest";
import { matchLeadSearchQuery } from "@/components/crm-date-utils";

describe("matchLeadSearchQuery - Exhaustive CRM Search", () => {
  const sampleLead = {
    id: "lead_123",
    name: "MasterKey Property Management",
    website: "https://www.masterkeypm.com",
    address: "100 Main St Suite 200",
    city: "Cary",
    state: "NC",
    phone: "(919) 655-3950",
    phoneDisplay: "(919) 655-3950",
    status: "CONNECTED",
    bestContact: {
      name: "Marcus Vance",
      title: "Managing Principal & Owner",
      phone: "+1 919-655-3950",
      email: "marcus@masterkeypm.com",
    },
    notes: "[Oct 28, 10:00 AM • Hamda (Connected / Spoke)]: Owner was busy with tenant issue. Follow up next Tuesday after 2pm.",
    assignedMemberName: "Hamda",
    software: "AppFolio",
    facts: {
      bleeding_ads: "YES",
      ad_platform: "Google Ads",
      units_managed: "450",
    },
  };

  it("matches by company name (exact, lower, partial)", () => {
    expect(matchLeadSearchQuery(sampleLead, "MasterKey")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "masterkey")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "Property Management")).toBe(true);
  });

  it("matches by decision maker contact name", () => {
    expect(matchLeadSearchQuery(sampleLead, "Marcus")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "Vance")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "marcus vance")).toBe(true);
  });

  it("matches by clean digits phone number regardless of formatting", () => {
    // Lead phone is stored formatted as "(919) 655-3950"
    expect(matchLeadSearchQuery(sampleLead, "9196553950")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "6553950")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "919-655")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "919")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "(919) 655")).toBe(true);
  });

  it("matches by contact title, email, and website domain", () => {
    expect(matchLeadSearchQuery(sampleLead, "Managing Principal")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "marcus@masterkeypm.com")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "masterkeypm.com")).toBe(true);
  });

  it("matches by geographic location and address", () => {
    expect(matchLeadSearchQuery(sampleLead, "Cary")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "NC")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "Suite 200")).toBe(true);
  });

  it("matches by notes and call log contents", () => {
    expect(matchLeadSearchQuery(sampleLead, "tenant issue")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "next Tuesday")).toBe(true);
  });

  it("matches by assigned caller name", () => {
    expect(matchLeadSearchQuery(sampleLead, "Hamda")).toBe(true);
  });

  it("matches by tech stack, software, and facts", () => {
    expect(matchLeadSearchQuery(sampleLead, "AppFolio")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "Google Ads")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "bleeding_ads")).toBe(true);
  });

  it("matches multi-term combinations across fields (e.g. name + city)", () => {
    expect(matchLeadSearchQuery(sampleLead, "MasterKey Cary")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "Marcus Cary NC")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "AppFolio Hamda")).toBe(true);
  });

  it("returns false for non-matching queries", () => {
    expect(matchLeadSearchQuery(sampleLead, "Austin Texas")).toBe(false);
    expect(matchLeadSearchQuery(sampleLead, "8885551212")).toBe(false);
    expect(matchLeadSearchQuery(sampleLead, "Yardi Systems")).toBe(false);
  });

  it("returns true for empty or whitespace query", () => {
    expect(matchLeadSearchQuery(sampleLead, "")).toBe(true);
    expect(matchLeadSearchQuery(sampleLead, "   ")).toBe(true);
  });
});

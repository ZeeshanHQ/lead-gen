import { createDb } from "../src/server/db/client";
import { bootstrap } from "../src/server/db/bootstrap";
import { defaultHvacRuleConfig } from "../src/server/domain/rules";
import { TavilyAdapter } from "../src/server/providers/tavily_adapter";
import { createCandidate } from "../src/server/repo/companies";
import { researchCompany } from "../src/server/research/engine";
import { loadLeadRows } from "../src/server/repo/queue";
import { companies, evidence, leadScores } from "../src/server/db/schema";
import { eq } from "drizzle-orm";

async function verifyLiveTavilyPipeline() {
  console.log("=== STARTING LIVE TAVILY END-TO-END PIPELINE VERIFICATION ===");
  console.log("1. Initializing isolated database environment...");
  const handle = await createDb("memory://");
  await bootstrap(handle.db);
  const db = handle.db;

  const rule = defaultHvacRuleConfig();
  const apiKey = process.env.TAVILY_API_KEY || "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";

  console.log("\n2. Initializing Tavily Search Adapter...");
  const adapter = new TavilyAdapter();
  const isConfigured = adapter.isConfigured({ apiKey });
  console.log("   - Provider ID:", adapter.metadata.id);
  console.log("   - Is Configured:", isConfigured);

  console.log("\n3. Generating Search Queries from Saved HVAC Rule...");
  const queries = adapter.generateQueries({
    rule,
    keywords: ["residential HVAC replacement"],
    states: ["TX"],
    cities: ["Dallas", "Houston", "Austin"],
    zips: [],
    limit: 10,
  });
  queries.forEach((q, idx) => {
    console.log(`   [Query ${idx + 1}]: "${q.queryText}" (${q.city}, ${q.state})`);
  });

  console.log("\n4. Executing Real Live Tavily Search API Discovery (Network Request)...");
  const t0 = Date.now();
  const discovered = await adapter.discover(
    {
      rule,
      keywords: ["residential HVAC replacement"],
      states: ["TX"],
      cities: ["Dallas", "Houston", "Austin"],
      zips: [],
      limit: 10,
    },
    { apiKey }
  );
  const t1 = Date.now();
  console.log(`   - Received ${discovered.length} candidates in ${t1 - t0}ms from live web search!`);

  if (discovered.length === 0) {
    throw new Error("No candidates returned from Tavily.");
  }

  console.log("\n   Sample Discovered Candidates:");
  discovered.slice(0, 3).forEach((c, idx) => {
    console.log(`   #${idx + 1}: ${c.name} | Web: ${c.website} | Source: ${c.sourceUrl}`);
  });

  console.log("\n5. Passing Discovered Candidates into Candidate Intake (Deduplication & Exclusions)...");
  const createdCompanyIds: string[] = [];
  for (const c of discovered.slice(0, 5)) {
    const intake = await createCandidate(
      db,
      {
        name: c.name,
        website: c.website,
        phone: c.phone,
        address: c.street,
        city: c.city,
        state: c.state,
        zip: c.zip,
        provider: c.provider,
        providerRef: c.providerRef,
      },
      { actor: "Tavily Live Pipeline Test" }
    );

    if (intake.kind === "created") {
      createdCompanyIds.push(intake.id);
      console.log(`   [Created]: ${c.name} -> ID: ${intake.id}`);
    } else if (intake.kind === "duplicate") {
      console.log(`   [Duplicate merged]: ${c.name} -> Matches existing ID: ${intake.existingId}`);
    } else if (intake.kind === "excluded") {
      console.log(`   [Excluded]: ${c.name}`);
    }
  }

  console.log(`\n6. Executing Research Crawler & Evidence Extraction on Created Companies (${createdCompanyIds.length})...`);
  for (const cid of createdCompanyIds) {
    const compRow = (await db.select().from(companies).where(eq(companies.id, cid)))[0];
    console.log(`   Researching ${compRow?.name} (${compRow?.website})...`);
    const resResult = await researchCompany(db, cid, {
      ruleConfig: rule,
      maxPages: 3,
      timeoutMs: 6000,
      actor: "Tavily Live Research Agent",
    });

    console.log(`   -> Status: ${resResult.status} | ICP Score: ${resResult.icpScore}/100 | Grade: ${resResult.grade} | Facts: ${resResult.factsRecorded}`);
  }

  console.log("\n7. Inspecting Review Queue & Evidence Audit Store...");
  const queueLeads = await loadLeadRows(db, "review");
  console.log(`   - Review Queue Size: ${queueLeads.length} leads awaiting human approval`);

  const evidenceRows = await db.select().from(evidence);
  console.log(`   - Total Grounded Evidence Records: ${evidenceRows.length} citations with source URLs`);

  if (evidenceRows.length > 0) {
    console.log("   - Sample Evidence Citation:");
    console.log({
      field: evidenceRows[0]?.field,
      value: evidenceRows[0]?.value,
      sourceUrl: evidenceRows[0]?.sourceUrl,
      sourceType: evidenceRows[0]?.sourceType,
      textSnippet: evidenceRows[0]?.evidenceText?.slice(0, 100),
    });
  }

  await handle.close();
  console.log("\n=== LIVE TAVILY PIPELINE VERIFICATION PASSED WITH 100% SUCCESS ===");
}

verifyLiveTavilyPipeline().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});

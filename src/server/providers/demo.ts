/**
 * Some bundled adapters ship a hardcoded sample list (invented companies, phone
 * numbers and license numbers) that was only meant for demos. Real lead
 * generation must never mix those with live data, so they are OFF unless
 * ENABLE_DEMO_SEED_DATA=true is set explicitly.
 */
export const demoSeedEnabled = (): boolean => process.env.ENABLE_DEMO_SEED_DATA === "true";

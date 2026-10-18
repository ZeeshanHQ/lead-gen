"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getDb } from "@/server/db/client";
import { getActor } from "@/server/repo/settings";
import {
  getActiveContext,
  switchActiveMarket,
  switchActiveTenant,
  createMarketNiche,
  updateMarketNiche,
  deleteMarketNiche,
  createTenantWorkspace,
  type CreateNicheInput,
} from "@/server/repo/markets";

async function setContextCookies(marketId: string, tenantId: string) {
  try {
    const jar = await cookies();
    jar.set("astraventa_market_id", marketId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    jar.set("astraventa_tenant_id", tenantId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  } catch {
    // Safe fallback if called outside request context
  }
}

export async function getTenantContextAction() {
  try {
    const db = await getDb();
    const ctx = await getActiveContext(db);
    return {
      ok: true,
      tenant: ctx.tenant,
      market: ctx.market,
      allTenants: ctx.allTenants,
      tenantMarkets: ctx.tenantMarkets,
      allMarkets: ctx.allMarkets,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to load tenant context" };
  }
}

export async function switchMarketAction(marketId: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const market = await switchActiveMarket(db, marketId, actor);
    await setContextCookies(market.id, market.tenantId);

    revalidatePath("/", "layout");
    return { ok: true, market };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to switch niche" };
  }
}

export async function switchTenantAction(tenantId: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { tenant, market } = await switchActiveTenant(db, tenantId, actor);
    await setContextCookies(market.id, tenant.id);

    revalidatePath("/", "layout");
    return { ok: true, tenant, market };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to switch tenant workspace" };
  }
}

export async function createNicheAction(input: CreateNicheInput) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { market, ruleId } = await createMarketNiche(db, input, actor);
    await setContextCookies(market.id, market.tenantId);

    revalidatePath("/", "layout");
    return { ok: true, market, ruleId };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to create niche" };
  }
}

export async function updateNicheAction(
  marketId: string,
  input: {
    name: string;
    description?: string;
    keywords?: string[];
    category?: string;
  }
) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    await updateMarketNiche(db, marketId, input, actor);

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to update niche" };
  }
}

export async function deleteNicheAction(marketId: string) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { nextMarketId } = await deleteMarketNiche(db, marketId, actor);
    const ctx = await getActiveContext(db);
    await setContextCookies(nextMarketId, ctx.tenant.id);

    revalidatePath("/", "layout");
    return { ok: true, nextMarketId };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to delete niche" };
  }
}

export async function createTenantWorkspaceAction(input: {
  name: string;
  role?: string;
  description?: string;
  initialNicheName?: string;
  initialNicheCategory?: string;
  initialNicheKeywords?: string[];
}) {
  try {
    const db = await getDb();
    const actor = await getActor(db);
    const { tenant, market } = await createTenantWorkspace(db, input, actor);
    await setContextCookies(market.id, tenant.id);

    revalidatePath("/", "layout");
    return { ok: true, tenant, market };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to create workspace" };
  }
}

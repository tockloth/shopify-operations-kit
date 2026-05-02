import { authenticate } from "../shopify.server";
import { getOperationsKitPool } from "./kit-db.server";
import { ensureTenantForShop } from "./operations-kit.server";

export async function requireOperationsKitContext(request: Request) {
  const { session } = await authenticate.admin(request);
  const pool = getOperationsKitPool();

  if (!pool) {
    return {
      configured: false as const,
      shopDomain: session.shop,
      pool: null,
      ctx: null,
      setupError:
        "Operations Kit database is not configured. Set OPERATIONS_KIT_DATABASE_URL and start the local Supabase database.",
    };
  }

  try {
    const ctx = await ensureTenantForShop(pool, session.shop, session.scope ?? null);
    return {
      configured: true as const,
      shopDomain: session.shop,
      pool,
      ctx,
      setupError: null,
    };
  } catch (error) {
    return {
      configured: false as const,
      shopDomain: session.shop,
      pool: null,
      ctx: null,
      setupError:
        error instanceof Error
          ? `Operations Kit database is reachable but not ready: ${error.message}`
          : "Operations Kit database is reachable but not ready.",
    };
  }
}

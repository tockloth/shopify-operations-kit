import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { getOperationsKitPool } from "../lib/kit-db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  const pool = getOperationsKitPool();

  if (pool && shop) {
    await pool.query(
      "update shopify_installations set status = 'uninstalled', updated_at = now() where shop_domain = $1",
      [shop],
    );
    await pool.query(
      "update tenants set status = 'uninstalled', updated_at = now() where shop_domain = $1",
      [shop],
    );
  }

  return new Response();
};

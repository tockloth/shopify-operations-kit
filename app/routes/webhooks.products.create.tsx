import type { ActionFunctionArgs } from "react-router";

import { getOperationsKitPool } from "../lib/kit-db.server";
import { handleShopifyProductWebhook } from "../lib/shopify-product-webhooks.server";
import { authenticate, unauthenticated } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, webhookId } = await authenticate.webhook(request);
  const pool = getOperationsKitPool();

  if (!pool) {
    return new Response("Operations Kit database is not configured.", {
      status: 503,
    });
  }

  const result = await handleShopifyProductWebhook(
    pool,
    { shop, topic, payload, webhookId },
    async (shopDomain) => {
      const { admin } = await unauthenticated.admin(shopDomain);
      return admin;
    },
  );

  return Response.json(result);
};

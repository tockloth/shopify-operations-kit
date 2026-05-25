import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ensureTenantForShop,
  loadOperationsOrdersList,
} from "../../app/lib/operations-kit.server";
import { handleShopifyOrderWebhook } from "../../app/lib/shopify-order-webhooks.server";

const databaseUrl =
  process.env.OPERATIONS_KIT_DATABASE_URL ||
  process.env.OPERATIONS_LEDGER_DATABASE_URL;

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
}

function shopifyOrderNode(input: {
  gid: string;
  name: string;
  sku: string;
  title?: string;
  quantity?: number;
  fulfillmentStatus?: string;
  customerName?: string;
  customerEmail?: string;
  address1?: string;
}) {
  const variantId = input.gid.replace("/Order/", "/ProductVariant/");
  const productId = input.gid.replace("/Order/", "/Product/");
  const lineId = input.gid.replace("/Order/", "/LineItem/");
  return {
    id: input.gid,
    legacyResourceId: input.gid.split("/").at(-1) ?? null,
    name: input.name,
    processedAt: "2026-05-24T10:00:00Z",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: input.fulfillmentStatus ?? "UNFULFILLED",
    customer: {
      displayName: input.customerName ?? "Webhook Customer",
      defaultEmailAddress: {
        emailAddress: input.customerEmail ?? "webhook@example.com",
      },
      defaultAddress: {
        name: input.customerName ?? "Webhook Customer",
        address1: input.address1 ?? "100 Webhook St",
        address2: null,
        city: "Berlin",
        provinceCode: "BE",
        zip: "10115",
        countryCodeV2: "DE",
      },
    },
    shippingAddress: {
      name: input.customerName ?? "Webhook Customer",
      address1: input.address1 ?? "100 Webhook St",
      address2: null,
      city: "Berlin",
      provinceCode: "BE",
      zip: "10115",
      countryCodeV2: "DE",
    },
    lineItems: {
      nodes: [
        {
          id: lineId,
          title: input.title ?? "Webhook Product",
          sku: input.sku,
          quantity: input.quantity ?? 1,
          variant: {
            id: variantId,
            legacyResourceId: variantId.split("/").at(-1) ?? null,
            title: "Default",
            sku: input.sku,
            inventoryItem: {
              id: input.gid.replace("/Order/", "/InventoryItem/"),
              legacyResourceId: input.gid.split("/").at(-1) ?? null,
            },
            product: {
              id: productId,
              legacyResourceId: productId.split("/").at(-1) ?? null,
              title: input.title ?? "Webhook Product",
              handle: "webhook-product",
              status: "ACTIVE",
            },
          },
        },
      ],
    },
  };
}

function orderPayload(gid: string, name: string) {
  return {
    id: gid.split("/").at(-1),
    admin_graphql_api_id: gid,
    name,
    created_at: "2026-05-24T10:00:00Z",
    updated_at: "2026-05-24T10:00:00Z",
  };
}

function adminReturningOrder(node: ReturnType<typeof shopifyOrderNode>) {
  return {
    graphql: async (_query: string, options?: { variables?: Record<string, unknown> }) => {
      expect(options?.variables?.id).toBe(node.id);
      return jsonResponse({ data: { node } });
    },
  };
}

describe.skipIf(!databaseUrl)("Shopify order webhook incremental sync", () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  let tenantA = "";
  let tenantB = "";
  const shopA = `operations-kit-webhook-a-${Date.now()}.myshopify.com`;
  const shopB = `operations-kit-webhook-b-${Date.now()}.myshopify.com`;

  beforeAll(async () => {
    tenantA = (await ensureTenantForShop(pool, shopA, "read_orders,read_customers")).tenantId;
    tenantB = (await ensureTenantForShop(pool, shopB, "read_orders,read_customers")).tenantId;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("processes orders/create and stores encrypted customer data", async () => {
    const gid = "gid://shopify/Order/910001";
    const node = shopifyOrderNode({
      gid,
      name: "#WEBHOOK-CREATE",
      sku: `WEBHOOK-CREATE-${Date.now()}`,
    });

    const result = await handleShopifyOrderWebhook(
      pool,
      {
        shop: shopA,
        topic: "ORDERS_CREATE",
        payload: orderPayload(gid, node.name),
        webhookId: `webhook-create-${Date.now()}`,
      },
      async () => adminReturningOrder(node),
    );

    expect(result.status).toBe("processed");
    const orders = await loadOperationsOrdersList(pool, tenantA);
    const order = orders.find((row: any) => row.order_name === node.name) as any;
    expect(order?.operational_status).toBe("Product classification required");
    expect(order?.next_action_label).toBe("Classify order line products");
    expect(order?.next_reason).toContain("Order lines need operational product data");
    expect(order?.last_order_sync_source).toBe("webhook");
    expect(order?.last_order_webhook_topic).toBe("ORDERS_CREATE");
    expect(order?.customer_name).toBe("Webhook Customer");
    expect(order?.customer_email).toBe("webhook@example.com");
    expect(order?.shipping_address?.address1).toBe("100 Webhook St");

    const stored = await pool.query<{
      customer_name_encrypted: string | null;
      customer_email_encrypted: string | null;
      shipping_address_encrypted: string | null;
    }>(
      `
        select customer_name_encrypted, customer_email_encrypted, shipping_address_encrypted
        from operations_orders
        where tenant_id = $1 and order_name = $2
      `,
      [tenantA, node.name],
    );
    expect(stored.rows[0]?.customer_name_encrypted).toBeTruthy();
    expect(stored.rows[0]?.customer_email_encrypted).toBeTruthy();
    expect(stored.rows[0]?.shipping_address_encrypted).toBeTruthy();
  });

  it("processes orders/updated without crossing tenants", async () => {
    const gid = "gid://shopify/Order/910002";
    const name = "#WEBHOOK-UPDATE";
    const sku = `WEBHOOK-UPDATE-${Date.now()}`;
    const createNode = shopifyOrderNode({ gid, name, sku, quantity: 1 });
    const updateNode = shopifyOrderNode({
      gid,
      name,
      sku,
      quantity: 2,
      fulfillmentStatus: "FULFILLED",
      address1: "200 Updated St",
    });

    await handleShopifyOrderWebhook(
      pool,
      {
        shop: shopA,
        topic: "ORDERS_CREATE",
        payload: orderPayload(gid, name),
        webhookId: `webhook-update-create-${Date.now()}`,
      },
      async () => adminReturningOrder(createNode),
    );

    const updated = await handleShopifyOrderWebhook(
      pool,
      {
        shop: shopA,
        topic: "ORDERS_UPDATED",
        payload: orderPayload(gid, name),
        webhookId: `webhook-update-${Date.now()}`,
      },
      async () => adminReturningOrder(updateNode),
    );

    expect(updated.status).toBe("processed");
    const ordersA = await loadOperationsOrdersList(pool, tenantA);
    const ordersB = await loadOperationsOrdersList(pool, tenantB);
    const orderA = ordersA.find((row: any) => row.order_name === name) as any;
    const orderB = ordersB.find((row: any) => row.order_name === name);
    expect(orderA?.fulfillment_status).toBe("FULFILLED");
    expect(orderA?.shipping_address?.address1).toBe("200 Updated St");
    expect(orderB).toBeUndefined();
  });

  it("ignores duplicate webhook IDs", async () => {
    const gid = "gid://shopify/Order/910003";
    const node = shopifyOrderNode({
      gid,
      name: "#WEBHOOK-DUPLICATE",
      sku: `WEBHOOK-DUPLICATE-${Date.now()}`,
    });
    const webhookId = `webhook-duplicate-${Date.now()}`;

    const first = await handleShopifyOrderWebhook(
      pool,
      {
        shop: shopA,
        topic: "ORDERS_CREATE",
        payload: orderPayload(gid, node.name),
        webhookId,
      },
      async () => adminReturningOrder(node),
    );
    const duplicate = await handleShopifyOrderWebhook(
      pool,
      {
        shop: shopA,
        topic: "ORDERS_CREATE",
        payload: orderPayload(gid, node.name),
        webhookId,
      },
      async () => {
        throw new Error("Duplicate webhook should not fetch Shopify order.");
      },
    );

    expect(first.status).toBe("processed");
    expect(duplicate.status).toBe("ignored_duplicate");
  });

  it("records an event for unknown shops without processing", async () => {
    const gid = "gid://shopify/Order/910004";
    const webhookId = `webhook-unknown-shop-${Date.now()}`;

    const result = await handleShopifyOrderWebhook(
      pool,
      {
        shop: `unknown-webhook-${Date.now()}.myshopify.com`,
        topic: "ORDERS_CREATE",
        payload: orderPayload(gid, "#WEBHOOK-UNKNOWN"),
        webhookId,
      },
      async () => {
        throw new Error("Unknown shop should not fetch Shopify order.");
      },
    );

    expect(result.status).toBe("failed");
    const event = await pool.query<{ status: string; error_message: string | null }>(
      "select status, error_message from webhook_events where webhook_id = $1",
      [webhookId],
    );
    expect(event.rows[0]?.status).toBe("failed");
    expect(event.rows[0]?.error_message).toContain("No active Operations Kit tenant");
  });

  it("records webhook and tenant system events when order fetch fails", async () => {
    const gid = "gid://shopify/Order/910005";
    const webhookId = `webhook-fetch-failed-${Date.now()}`;

    const result = await handleShopifyOrderWebhook(
      pool,
      {
        shop: shopA,
        topic: "ORDERS_UPDATED",
        payload: orderPayload(gid, "#WEBHOOK-FAILED"),
        webhookId,
      },
      async () => ({
        graphql: async () => {
          throw new Error("Simulated Shopify order fetch failure.");
        },
      }),
    );

    expect(result.status).toBe("failed");
    const event = await pool.query<{ status: string; error_message: string | null }>(
      "select status, error_message from webhook_events where webhook_id = $1",
      [webhookId],
    );
    expect(event.rows[0]?.status).toBe("failed");
    expect(event.rows[0]?.error_message).toContain("Simulated Shopify order fetch failure");

    const systemEvent = await pool.query<{ title: string; message: string }>(
      `
        select title, message
        from case_events
        where tenant_id = $1
          and event_type = 'shopify_webhook'
          and source_ref = $2
        order by created_at desc
        limit 1
      `,
      [tenantA, webhookId],
    );
    expect(systemEvent.rows[0]?.title).toBe("Shopify order webhook failed");
    expect(systemEvent.rows[0]?.message).toContain(
      "Simulated Shopify order fetch failure",
    );
  });
});

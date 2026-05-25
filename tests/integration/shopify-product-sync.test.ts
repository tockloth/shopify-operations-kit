import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ensureTenantForShop,
  loadItems,
} from "../../app/lib/operations-kit.server";
import { handleShopifyProductWebhook } from "../../app/lib/shopify-product-webhooks.server";
import { syncShopifyProducts } from "../../app/lib/shopify-sync.server";

const databaseUrl =
  process.env.OPERATIONS_KIT_DATABASE_URL ||
  process.env.OPERATIONS_LEDGER_DATABASE_URL;

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
}

function productNode(input: {
  gid: string;
  title: string;
  sku: string;
  variantGid?: string;
  variantTitle?: string;
  status?: string;
  price?: string;
}) {
  const variantGid =
    input.variantGid ?? input.gid.replace("/Product/", "/ProductVariant/");
  return {
    id: input.gid,
    legacyResourceId: input.gid.split("/").at(-1) ?? null,
    title: input.title,
    handle: input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    vendor: "Webhook Vendor",
    productType: "Snowboards",
    status: input.status ?? "ACTIVE",
    tags: ["operations-kit", "synced"],
    publishedAt: "2026-05-25T08:00:00Z",
    onlineStoreUrl: "https://example.myshopify.com/products/webhook-product",
    variants: {
      nodes: [
        {
          id: variantGid,
          legacyResourceId: variantGid.split("/").at(-1) ?? null,
          title: input.variantTitle ?? "Default Title",
          sku: input.sku,
          barcode: `BAR-${input.sku}`,
          price: input.price ?? "19.99",
          inventoryQuantity: 7,
          inventoryItem: {
            id: input.gid.replace("/Product/", "/InventoryItem/"),
            legacyResourceId: input.gid.split("/").at(-1) ?? null,
          },
        },
      ],
    },
  };
}

function productsConnection(nodes: Array<ReturnType<typeof productNode>>) {
  return {
    data: {
      products: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes,
      },
    },
  };
}

function productPayload(gid: string, title: string) {
  return {
    id: gid.split("/").at(-1),
    admin_graphql_api_id: gid,
    title,
    handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    updated_at: "2026-05-25T08:00:00Z",
  };
}

function adminReturningProduct(node: ReturnType<typeof productNode>) {
  return {
    graphql: async (_query: string, options?: { variables?: Record<string, unknown> }) => {
      expect(options?.variables?.id).toBe(node.id);
      return jsonResponse({ data: { node } });
    },
  };
}

describe.skipIf(!databaseUrl)("Shopify product sync", () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  let tenantA = "";
  let tenantB = "";
  const shopA = `operations-kit-products-a-${Date.now()}.myshopify.com`;
  const shopB = `operations-kit-products-b-${Date.now()}.myshopify.com`;

  beforeAll(async () => {
    tenantA = (await ensureTenantForShop(pool, shopA, "read_products")).tenantId;
    tenantB = (await ensureTenantForShop(pool, shopB, "read_products")).tenantId;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("runs initial product sync idempotently and preserves operational item data", async () => {
    const gid = "gid://shopify/Product/920001";
    const variantGid = "gid://shopify/ProductVariant/920001";
    const product = productNode({
      gid,
      variantGid,
      title: "Initial Sync Product",
      sku: `PROD-SYNC-${Date.now()}`,
    });
    const admin = {
      graphql: async () => jsonResponse(productsConnection([product])),
    };

    const first = await syncShopifyProducts(pool, tenantA, admin);
    const second = await syncShopifyProducts(pool, tenantA, admin);
    expect(first.productsFetched).toBe(1);
    expect(first.productsUpserted).toBe(1);
    expect(first.variantsFetched).toBe(1);
    expect(first.variantsUpserted).toBe(1);
    expect(second.productsUpserted).toBe(1);

    await pool.query(
      `
        update items
        set is_purchasable = true,
            supplier_lead_time_days = 42,
            min_inventory_quantity = 5
        where tenant_id = $1 and shopify_variant_gid = $2
      `,
      [tenantA, variantGid],
    );
    await syncShopifyProducts(pool, tenantA, admin);
    const item = await pool.query<{
      is_purchasable: boolean;
      supplier_lead_time_days: number;
      min_inventory_quantity: string;
    }>(
      `
        select is_purchasable, supplier_lead_time_days, min_inventory_quantity
        from items
        where tenant_id = $1 and shopify_variant_gid = $2
      `,
      [tenantA, variantGid],
    );
    expect(item.rows[0]?.is_purchasable).toBe(true);
    expect(item.rows[0]?.supplier_lead_time_days).toBe(42);
    expect(Number(item.rows[0]?.min_inventory_quantity)).toBe(5);
  });

  it("keeps equal SKUs isolated by tenant", async () => {
    const sharedSku = `SHARED-PROD-${Date.now()}`;
    const productA = productNode({
      gid: "gid://shopify/Product/920010",
      title: "Tenant A Product",
      sku: sharedSku,
    });
    const productB = productNode({
      gid: "gid://shopify/Product/920011",
      title: "Tenant B Product",
      sku: sharedSku,
    });

    await syncShopifyProducts(pool, tenantA, {
      graphql: async () => jsonResponse(productsConnection([productA])),
    });
    await syncShopifyProducts(pool, tenantB, {
      graphql: async () => jsonResponse(productsConnection([productB])),
    });

    const itemsA = await loadItems(pool, tenantA, { query: sharedSku });
    const itemsB = await loadItems(pool, tenantB, { query: sharedSku });
    expect(itemsA).toHaveLength(1);
    expect(itemsB).toHaveLength(1);
    expect(itemsA[0].title).toBe("Tenant A Product");
    expect(itemsB[0].title).toBe("Tenant B Product");
  });

  it("processes products/create and products/update webhooks", async () => {
    const gid = "gid://shopify/Product/920020";
    const createProduct = productNode({
      gid,
      title: "Webhook Product",
      sku: `PROD-WEBHOOK-${Date.now()}`,
    });
    const updateProduct = productNode({
      gid,
      title: "Webhook Product Updated",
      sku: createProduct.variants.nodes[0].sku ?? "PROD-WEBHOOK",
      price: "29.99",
    });

    const created = await handleShopifyProductWebhook(
      pool,
      {
        shop: shopA,
        topic: "PRODUCTS_CREATE",
        payload: productPayload(gid, createProduct.title),
        webhookId: `product-create-${Date.now()}`,
      },
      async () => adminReturningProduct(createProduct),
    );
    const updated = await handleShopifyProductWebhook(
      pool,
      {
        shop: shopA,
        topic: "PRODUCTS_UPDATE",
        payload: productPayload(gid, updateProduct.title),
        webhookId: `product-update-${Date.now()}`,
      },
      async () => adminReturningProduct(updateProduct),
    );

    expect(created.status).toBe("processed");
    expect(updated.status).toBe("processed");
    const productRow = await pool.query<{ title: string; price: string }>(
      `
        select shopify_products.title, shopify_product_variants.price
        from shopify_products
        join shopify_product_variants
          on shopify_product_variants.tenant_id = shopify_products.tenant_id
         and shopify_product_variants.shopify_product_gid = shopify_products.shopify_product_gid
        where shopify_products.tenant_id = $1
          and shopify_products.shopify_product_gid = $2
      `,
      [tenantA, gid],
    );
    expect(productRow.rows[0]?.title).toBe("Webhook Product Updated");
    expect(Number(productRow.rows[0]?.price)).toBe(29.99);
  });

  it("marks products/delete without deleting operational data and ignores duplicate webhook IDs", async () => {
    const gid = "gid://shopify/Product/920030";
    const product = productNode({
      gid,
      title: "Deleted Webhook Product",
      sku: `PROD-DELETE-${Date.now()}`,
    });
    const webhookId = `product-delete-${Date.now()}`;
    await syncShopifyProducts(pool, tenantA, {
      graphql: async () => jsonResponse(productsConnection([product])),
    });
    await pool.query(
      "update items set min_inventory_quantity = 9 where tenant_id = $1 and shopify_product_gid = $2",
      [tenantA, gid],
    );

    const deleted = await handleShopifyProductWebhook(
      pool,
      {
        shop: shopA,
        topic: "PRODUCTS_DELETE",
        payload: productPayload(gid, product.title),
        webhookId,
      },
      async () => {
        throw new Error("Product delete webhook should not fetch deleted product.");
      },
    );
    const duplicate = await handleShopifyProductWebhook(
      pool,
      {
        shop: shopA,
        topic: "PRODUCTS_DELETE",
        payload: productPayload(gid, product.title),
        webhookId,
      },
      async () => {
        throw new Error("Duplicate delete webhook should not fetch product.");
      },
    );

    expect(deleted.status).toBe("processed");
    expect(duplicate.status).toBe("ignored_duplicate");
    const rows = await pool.query<{
      product_deleted_at: string | null;
      variant_deleted_at: string | null;
      is_active: boolean;
      product_status: string;
      min_inventory_quantity: string;
    }>(
      `
        select
          shopify_products.deleted_at as product_deleted_at,
          shopify_product_variants.deleted_at as variant_deleted_at,
          items.is_active,
          items.product_status,
          items.min_inventory_quantity
        from shopify_products
        join shopify_product_variants
          on shopify_product_variants.tenant_id = shopify_products.tenant_id
         and shopify_product_variants.shopify_product_gid = shopify_products.shopify_product_gid
        join items
          on items.tenant_id = shopify_product_variants.tenant_id
         and items.id = shopify_product_variants.item_id
        where shopify_products.tenant_id = $1
          and shopify_products.shopify_product_gid = $2
      `,
      [tenantA, gid],
    );
    expect(rows.rows[0]?.product_deleted_at).toBeTruthy();
    expect(rows.rows[0]?.variant_deleted_at).toBeTruthy();
    expect(rows.rows[0]?.is_active).toBe(false);
    expect(rows.rows[0]?.product_status).toBe("MISSING");
    expect(Number(rows.rows[0]?.min_inventory_quantity)).toBe(9);
  });

  it("records an event for unknown product webhook shops", async () => {
    const gid = "gid://shopify/Product/920040";
    const webhookId = `product-unknown-shop-${Date.now()}`;

    const result = await handleShopifyProductWebhook(
      pool,
      {
        shop: `unknown-product-${Date.now()}.myshopify.com`,
        topic: "PRODUCTS_CREATE",
        payload: productPayload(gid, "Unknown Product"),
        webhookId,
      },
      async () => {
        throw new Error("Unknown shop should not fetch Shopify product.");
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
});

import type { QueryExecutor } from "./kit-db.server";
import { withKitTransaction } from "./kit-db.server";
import {
  encryptCustomerData,
  hashCustomerLookup,
} from "./customer-privacy.server";

type ShopifyAdmin = {
  graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response>;
};

const PRODUCT_SYNC_QUERY = `#graphql
  query OperationsKitProducts($first: Int!) {
    products(first: $first, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        legacyResourceId
        title
        handle
        status
        variants(first: 100) {
          nodes {
            id
            legacyResourceId
            title
            sku
            inventoryQuantity
            inventoryItem {
              id
              legacyResourceId
            }
          }
        }
      }
    }
  }
`;

const ORDER_SYNC_QUERY = `#graphql
  query OperationsKitOrders($first: Int!) {
    orders(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        legacyResourceId
        name
        processedAt
        displayFinancialStatus
        displayFulfillmentStatus
        customer {
          displayName
          defaultEmailAddress {
            emailAddress
          }
        }
        lineItems(first: 100) {
          nodes {
            id
            title
            sku
            quantity
            variant {
              id
              legacyResourceId
              title
              sku
              inventoryItem {
                id
                legacyResourceId
              }
              product {
                id
                legacyResourceId
                title
                handle
                status
              }
            }
          }
        }
      }
    }
  }
`;

const ORDER_SYNC_WITHOUT_CUSTOMER_QUERY = `#graphql
  query OperationsKitOrdersWithoutCustomer($first: Int!) {
    orders(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        legacyResourceId
        name
        processedAt
        displayFinancialStatus
        displayFulfillmentStatus
        lineItems(first: 100) {
          nodes {
            id
            title
            sku
            quantity
            variant {
              id
              legacyResourceId
              title
              sku
              inventoryItem {
                id
                legacyResourceId
              }
              product {
                id
                legacyResourceId
                title
                handle
                status
              }
            }
          }
        }
      }
    }
  }
`;

async function graphqlJson<T>(
  admin: ShopifyAdmin,
  query: string,
  variables: Record<string, unknown>,
) {
  const response = await admin.graphql(query, { variables });
  const payload = (await response.json()) as { data?: T; errors?: unknown };
  if (payload.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(payload.errors)}`);
  }
  if (!payload.data) throw new Error("Shopify GraphQL returned no data.");
  return payload.data;
}

async function upsertShopifyVariantItem(
  db: QueryExecutor,
  tenantId: string,
  input: {
    productGid: string | null;
    productLegacyId: string | null;
    productTitle: string;
    productHandle: string | null;
    productStatus: string | null;
    variantGid: string;
    variantLegacyId: string | null;
    variantTitle: string | null;
    sku: string | null;
    inventoryItemGid: string | null;
    inventoryItemLegacyId: string | null;
    inventoryQuantity: number | null;
  },
) {
  const sku =
    input.sku?.trim() ||
    input.variantLegacyId ||
    input.variantGid.split("/").at(-1) ||
    "UNSKUED";
  const title =
    input.variantTitle && input.variantTitle !== "Default Title"
      ? `${input.productTitle} / ${input.variantTitle}`
      : input.productTitle;

  const result = await db.query<{ id: string }>(
    `
      insert into items (
        tenant_id, shopify_product_gid, shopify_product_legacy_id,
        shopify_variant_gid, shopify_variant_legacy_id,
        shopify_inventory_item_gid, product_handle, product_status,
        variant_title, sku, title, item_type, unit, is_sellable,
        is_purchasable, is_producible, shopify_inventory_available
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, 'product', 'pcs', true,
        false, false, $12
      )
      on conflict (tenant_id, shopify_variant_gid)
      do update set
        shopify_product_gid = excluded.shopify_product_gid,
        shopify_product_legacy_id = excluded.shopify_product_legacy_id,
        shopify_variant_legacy_id = excluded.shopify_variant_legacy_id,
        shopify_inventory_item_gid = excluded.shopify_inventory_item_gid,
        product_handle = excluded.product_handle,
        product_status = excluded.product_status,
        variant_title = excluded.variant_title,
        sku = excluded.sku,
        title = excluded.title,
        shopify_inventory_available = excluded.shopify_inventory_available,
        updated_at = now()
      returning id
    `,
    [
      tenantId,
      input.productGid,
      input.productLegacyId,
      input.variantGid,
      input.variantLegacyId,
      input.inventoryItemGid,
      input.productHandle,
      input.productStatus,
      input.variantTitle,
      sku,
      title,
      input.inventoryQuantity,
    ],
  );

  return result.rows[0].id;
}

async function upsertShopifyOrderLineFallbackItem(
  db: QueryExecutor,
  tenantId: string,
  input: {
    lineItemGid: string;
    title: string | null;
    sku: string | null;
    variantGid: string | null;
    variantLegacyId: string | null;
  },
) {
  const fallbackId = input.lineItemGid.split("/").at(-1) ?? input.lineItemGid;
  const sku = input.sku?.trim() || `SHOPIFY-LINE-${fallbackId}`;
  const existing = await db.query<{ id: string }>(
    "select id from items where tenant_id = $1 and sku = $2",
    [tenantId, sku],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const result = await db.query<{ id: string }>(
    `
      insert into items (
        tenant_id, shopify_variant_gid, shopify_variant_legacy_id,
        sku, title, item_type, unit, is_sellable, is_purchasable, is_producible
      )
      values ($1, $2, $3, $4, $5, 'product', 'pcs', true, false, false)
      returning id
    `,
    [
      tenantId,
      input.variantGid,
      input.variantLegacyId,
      sku,
      input.title?.trim() || sku,
    ],
  );

  return result.rows[0].id;
}

async function loadCustomerDataRetentionDays(db: QueryExecutor, tenantId: string) {
  const result = await db.query<{ customer_data_retention_days: number }>(
    `
      insert into privacy_settings (tenant_id)
      values ($1)
      on conflict (tenant_id)
      do update set tenant_id = excluded.tenant_id
      returning customer_data_retention_days
    `,
    [tenantId],
  );

  return result.rows[0]?.customer_data_retention_days ?? 365;
}

function customerDataRetentionUntil(processedAt: string | null, retentionDays: number) {
  const baseDate = processedAt ? new Date(processedAt) : new Date();
  return new Date(baseDate.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

export async function syncShopifyProducts(
  db: QueryExecutor,
  tenantId: string,
  admin: ShopifyAdmin,
) {
  return withKitTransaction(db, async (tx) => {
    const data = await graphqlJson<{
      products: {
        nodes: Array<{
          id: string;
          legacyResourceId: string | null;
          title: string;
          handle: string | null;
          status: string | null;
          variants: {
            nodes: Array<{
              id: string;
              legacyResourceId: string | null;
              title: string | null;
              sku: string | null;
              inventoryQuantity: number | null;
              inventoryItem: {
                id: string;
                legacyResourceId: string | null;
              } | null;
            }>;
          };
        }>;
      };
    }>(admin, PRODUCT_SYNC_QUERY, { first: 50 });

    let variants = 0;
    for (const product of data.products.nodes) {
      for (const variant of product.variants.nodes) {
        await upsertShopifyVariantItem(tx, tenantId, {
          productGid: product.id,
          productLegacyId: product.legacyResourceId,
          productTitle: product.title,
          productHandle: product.handle,
          productStatus: product.status,
          variantGid: variant.id,
          variantLegacyId: variant.legacyResourceId,
          variantTitle: variant.title,
          sku: variant.sku,
          inventoryItemGid: variant.inventoryItem?.id ?? null,
          inventoryItemLegacyId: variant.inventoryItem?.legacyResourceId ?? null,
          inventoryQuantity: variant.inventoryQuantity,
        });
        variants += 1;
      }
    }

    return { products: data.products.nodes.length, variants };
  });
}

export async function syncShopifyOrders(
  db: QueryExecutor,
  tenantId: string,
  admin: ShopifyAdmin,
) {
  return withKitTransaction(db, async (tx) => {
    const retentionDays = await loadCustomerDataRetentionDays(tx, tenantId);
    type OrderSyncData = {
      orders: {
        nodes: Array<{
          id: string;
          legacyResourceId: string | null;
          name: string;
          processedAt: string | null;
          displayFinancialStatus: string | null;
          displayFulfillmentStatus: string | null;
          customer: {
            displayName: string | null;
            defaultEmailAddress: {
              emailAddress: string | null;
            } | null;
          } | null;
          lineItems: {
            nodes: Array<{
              id: string;
              title: string;
              sku: string | null;
              quantity: number;
              variant: {
                id: string;
                legacyResourceId: string | null;
                title: string | null;
                sku: string | null;
                inventoryItem: {
                  id: string;
                  legacyResourceId: string | null;
                } | null;
                product: {
                  id: string;
                  legacyResourceId: string | null;
                  title: string;
                  handle: string | null;
                  status: string | null;
                } | null;
              } | null;
            }>;
          };
        }>;
      };
    };

    let customerDataAvailable = true;
    let data: OrderSyncData;
    try {
      data = await graphqlJson<OrderSyncData>(admin, ORDER_SYNC_QUERY, { first: 25 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Access denied for customer field")) {
        throw error;
      }

      customerDataAvailable = false;
      data = await graphqlJson<OrderSyncData>(
        admin,
        ORDER_SYNC_WITHOUT_CUSTOMER_QUERY,
        { first: 25 },
      );
    }

    let lines = 0;
    for (const order of data.orders.nodes) {
      const orderResult = await tx.query<{ id: string }>(
        `
          insert into operations_orders (
            tenant_id, shopify_order_gid, shopify_order_legacy_id,
            order_name, status, customer_name, customer_email,
            customer_name_encrypted, customer_email_encrypted, customer_lookup_hash,
            customer_data_retention_until,
            financial_status, fulfillment_status, processed_at
          )
          values ($1, $2, $3, $4, 'open', null, null, $5, $6, $7, $8, $9, $10, $11)
          on conflict (tenant_id, order_name)
          do update set
            shopify_order_gid = excluded.shopify_order_gid,
            shopify_order_legacy_id = excluded.shopify_order_legacy_id,
            customer_name = null,
            customer_email = null,
            customer_name_encrypted = excluded.customer_name_encrypted,
            customer_email_encrypted = excluded.customer_email_encrypted,
            customer_lookup_hash = excluded.customer_lookup_hash,
            customer_data_redacted_at = null,
            customer_data_retention_until = excluded.customer_data_retention_until,
            financial_status = excluded.financial_status,
            fulfillment_status = excluded.fulfillment_status,
            processed_at = excluded.processed_at,
            updated_at = now()
          returning id
        `,
        [
          tenantId,
          order.id,
          order.legacyResourceId,
          order.name,
          customerDataAvailable ? encryptCustomerData(order.customer?.displayName) : null,
          customerDataAvailable
            ? encryptCustomerData(order.customer?.defaultEmailAddress?.emailAddress)
            : null,
          customerDataAvailable
            ? hashCustomerLookup(
                order.customer?.defaultEmailAddress?.emailAddress,
                order.customer?.displayName,
              )
            : null,
          customerDataRetentionUntil(order.processedAt, retentionDays),
          order.displayFinancialStatus,
          order.displayFulfillmentStatus,
          order.processedAt,
        ],
      );

      for (const line of order.lineItems.nodes) {
        const itemId =
          line.variant && line.variant.product
            ? await upsertShopifyVariantItem(tx, tenantId, {
                productGid: line.variant.product.id,
                productLegacyId: line.variant.product.legacyResourceId,
                productTitle: line.variant.product.title,
                productHandle: line.variant.product.handle,
                productStatus: line.variant.product.status,
                variantGid: line.variant.id,
                variantLegacyId: line.variant.legacyResourceId,
                variantTitle: line.variant.title,
                sku: line.variant.sku ?? line.sku,
                inventoryItemGid: line.variant.inventoryItem?.id ?? null,
                inventoryItemLegacyId: line.variant.inventoryItem?.legacyResourceId ?? null,
                inventoryQuantity: null,
              })
            : await upsertShopifyOrderLineFallbackItem(tx, tenantId, {
                lineItemGid: line.id,
                title: line.title,
                sku: line.sku,
                variantGid: line.variant?.id ?? null,
                variantLegacyId: line.variant?.legacyResourceId ?? null,
              });

        await tx.query(
          `
            insert into operations_order_lines (
              tenant_id, operations_order_id, item_id, quantity, unit,
              shopify_line_item_gid, shopify_variant_gid, sku, title
            )
            values ($1, $2, $3, $4, 'pcs', $5, $6, $7, $8)
            on conflict (tenant_id, operations_order_id, item_id)
            do update set
              quantity = excluded.quantity,
              shopify_line_item_gid = excluded.shopify_line_item_gid,
              shopify_variant_gid = excluded.shopify_variant_gid,
              sku = excluded.sku,
              title = excluded.title
          `,
          [
            tenantId,
            orderResult.rows[0].id,
            itemId,
            line.quantity,
            line.id,
            line.variant?.id ?? null,
            line.variant?.sku ?? line.sku,
            line.title,
          ],
        );
        lines += 1;
      }
    }

    return { orders: data.orders.nodes.length, lines, customerDataAvailable };
  });
}

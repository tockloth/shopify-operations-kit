import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  backfillTestShippingAddressForOpenOrders,
  commitMrpRun,
  completeReceiptLineQc,
  createGoodsReceiptForPurchaseOrder,
  createPurchaseNeedForOrderLine,
  createProductionWorkForLatestNeed,
  createPurchaseOrderFromNeed,
  createPurchaseOrdersFromReadyNeeds,
  createShippingOrdersFromOpenOperationsOrders,
  completeProductionOrder,
  ensureDefaultOperationAccess,
  ensureTenantForShop,
  loadAccessControlSettings,
  loadDashboard,
  loadInventoryLedger,
  loadOperationsOrderDetail,
  loadItems,
  loadOperationsOrdersList,
  loadOperationsOrderLineDetail,
  loadPurchaseNeeds,
  loadPurchaseOrders,
  loadProductionOrders,
  loadReceipts,
  loadWarehouseTasks,
  passQcAndCreatePutaway,
  postGoodsReceiptForAcknowledgedPurchaseOrders,
  putawayReceiptLine,
  runOperationsMrp,
  runScenarioMrp,
  seedOperationsKitScenario,
  setOperationUserActive,
  transitionPurchaseOrder,
  upsertOperationUser,
} from "../../app/lib/operations-kit.server";
import {
  decryptCustomerData,
  encryptCustomerData,
} from "../../app/lib/customer-privacy.server";
import {
  syncShopifyOrders,
  syncShopifyProducts,
} from "../../app/lib/shopify-sync.server";

const databaseUrl =
  process.env.OPERATIONS_KIT_DATABASE_URL ||
  process.env.OPERATIONS_LEDGER_DATABASE_URL;

describe.skipIf(!databaseUrl)("Operations Kit scenario flow", () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  let tenantId = "";
  const shopDomain = `operations-kit-test-${Date.now()}.myshopify.com`;

  beforeAll(async () => {
    const ctx = await ensureTenantForShop(
      pool,
      shopDomain,
      "read_orders,write_products",
    );
    tenantId = ctx.tenantId;
    await seedOperationsKitScenario(pool, tenantId);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("seeds master data idempotently", async () => {
    await seedOperationsKitScenario(pool, tenantId);
    await seedOperationsKitScenario(pool, tenantId);

    const summary = await loadDashboard(pool, tenantId);
    expect(summary.items).toBeGreaterThanOrEqual(5);
    expect(summary.activeBoms).toBeGreaterThanOrEqual(1);
  });

  it("seeds operation users and fixed role groups", async () => {
    await ensureDefaultOperationAccess(pool, tenantId);
    const seeded = await loadAccessControlSettings(pool, tenantId);

    expect(
      seeded.users.some((user: any) => user.email === "admin@tockloth.com"),
    ).toBe(true);
    expect(
      seeded.groups.some((group: any) => group.key === "procurement"),
    ).toBe(true);

    const user = await upsertOperationUser(pool, tenantId, {
      email: "buyer@tockloth.com",
      displayName: "Buyer User",
      groupKey: "procurement",
    });
    expect(user.userId).toBeTruthy();

    const deactivated = await setOperationUserActive(
      pool,
      tenantId,
      user.userId,
      false,
    );
    expect(deactivated.updated).toBe(1);

    const afterUpdate = await loadAccessControlSettings(pool, tenantId);
    expect(
      afterUpdate.users.some(
        (row: any) =>
          row.email === "buyer@tockloth.com" &&
          row.groups === "Procurement" &&
          row.is_active === false,
      ),
    ).toBe(true);
  });

  it("creates production work for available-stock scenario", async () => {
    const mrp = await runScenarioMrp(pool, tenantId, "available");
    await commitMrpRun(pool, tenantId, mrp.mrpRunId);
    const result = await createProductionWorkForLatestNeed(pool, tenantId);

    const repeatedMrp = await runScenarioMrp(pool, tenantId, "available");
    await commitMrpRun(pool, tenantId, repeatedMrp.mrpRunId);
    const secondResult = await createProductionWorkForLatestNeed(pool, tenantId);

    expect(result.productionOrderId).toBeTruthy();
    expect(secondResult.productionOrderId).toBe(result.productionOrderId);
    expect(result.warehouseTasks).toBeGreaterThanOrEqual(4);

    const productionOrders = await loadProductionOrders(pool, tenantId);
    const tasks = await loadWarehouseTasks(pool, tenantId);
    expect(productionOrders.length).toBeGreaterThan(0);
    expect(tasks.length).toBeGreaterThan(0);

    const completed = await completeProductionOrder(pool, tenantId);
    expect(completed.productionOrderId).toBeTruthy();
    expect(completed.componentsConsumed).toBeGreaterThanOrEqual(4);

    const inventory = await loadInventoryLedger(pool, tenantId);
    expect(
      inventory.movements.some(
        (movement: any) =>
          movement.movement_type === "produce" && movement.sku === "KIT-001",
      ),
    ).toBe(true);
  });

  it("creates purchase work and draft PO for shortage scenario", async () => {
    const mrp = await runScenarioMrp(pool, tenantId, "shortage");
    await commitMrpRun(pool, tenantId, mrp.mrpRunId);

    const needs = await loadPurchaseNeeds(pool, tenantId);
    expect(needs.some((need: any) => need.sku === "COMP-B")).toBe(true);
    expect(needs.some((need: any) => need.preferred_supplier_name === "Supplier Beta")).toBe(true);

    const poResult = await createPurchaseOrdersFromReadyNeeds(pool, tenantId);
    expect(poResult.purchaseOrderIds.length).toBeGreaterThan(0);

    const purchaseOrders = await loadPurchaseOrders(pool, tenantId);
    expect(purchaseOrders.length).toBeGreaterThan(0);
  });

  it("maps Shopify product status and publication to Products on shop", async () => {
    await pool.query(
      `
        insert into items (
          tenant_id, shopify_product_gid, shopify_variant_gid, sku, title,
          item_type, unit, is_sellable, is_purchasable, is_producible,
          is_active, product_status, shopify_published_at,
          shopify_online_store_url
        )
        values
          ($1, 'gid://shopify/Product/status-active', 'gid://shopify/ProductVariant/status-active', 'STATUS-ACTIVE', 'Published Shopify Product', 'product', 'pcs', true, false, false, true, 'ACTIVE', now(), 'https://example.myshopify.com/products/status-active'),
          ($1, 'gid://shopify/Product/status-draft', 'gid://shopify/ProductVariant/status-draft', 'STATUS-DRAFT', 'Draft Shopify Product', 'product', 'pcs', true, false, false, true, 'DRAFT', null, null),
          ($1, 'gid://shopify/Product/status-archived', 'gid://shopify/ProductVariant/status-archived', 'STATUS-ARCHIVED', 'Archived Shopify Product', 'product', 'pcs', true, false, false, true, 'ARCHIVED', null, null)
        on conflict (tenant_id, shopify_variant_gid)
        do update set
          is_sellable = excluded.is_sellable,
          is_active = excluded.is_active,
          product_status = excluded.product_status,
          shopify_published_at = excluded.shopify_published_at,
          shopify_online_store_url = excluded.shopify_online_store_url,
          updated_at = now()
      `,
      [tenantId],
    );

    const shopItems = await loadItems(pool, tenantId, {
      query: "STATUS-",
      source: "shop",
    });
    expect(shopItems.map((item) => item.sku)).toEqual(["STATUS-ACTIVE"]);

    const allItems = await loadItems(pool, tenantId, {
      query: "STATUS-",
      source: "all",
    });
    const bySku = new Map(allItems.map((item) => [item.sku, item]));
    expect(bySku.get("STATUS-ACTIVE")?.shop_product_flag).toBe("shop");
    expect(bySku.get("STATUS-DRAFT")?.shop_product_flag).toBe(
      "shopify_synced",
    );
    expect(bySku.get("STATUS-ARCHIVED")?.shop_product_flag).toBe(
      "shopify_synced",
    );
  });

  it("marks Shopify products missing from a full product sync as inactive", async () => {
    await pool.query(
      `
        insert into items (
          tenant_id, shopify_product_gid, shopify_variant_gid, sku, title,
          item_type, unit, is_sellable, is_purchasable, is_producible,
          is_active, product_status, shopify_published_at,
          shopify_online_store_url, shopify_last_seen_at
        )
        values ($1, 'gid://shopify/Product/missing-product', 'gid://shopify/ProductVariant/missing-variant',
          'SYNC-MISSING', 'Missing Product', 'product', 'pcs', true, false,
          false, true, 'ACTIVE', now(), 'https://example.myshopify.com/products/missing-product',
          now() - interval '1 day')
        on conflict (tenant_id, shopify_variant_gid)
        do update set
          is_active = true,
          product_status = 'ACTIVE',
          shopify_published_at = now(),
          shopify_online_store_url = 'https://example.myshopify.com/products/missing-product',
          shopify_last_seen_at = now() - interval '1 day',
          updated_at = now()
      `,
      [tenantId],
    );

    const admin = {
      graphql: async () =>
        new Response(
          JSON.stringify({
            data: {
              products: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: "gid://shopify/Product/present-product",
                    legacyResourceId: "present-product",
                    title: "Present Product",
                    handle: "present-product",
                    status: "ACTIVE",
                    publishedAt: new Date().toISOString(),
                    onlineStoreUrl:
                      "https://example.myshopify.com/products/present-product",
                    variants: {
                      nodes: [
                        {
                          id: "gid://shopify/ProductVariant/present-variant",
                          legacyResourceId: "present-variant",
                          title: "Default Title",
                          sku: "SYNC-PRESENT",
                          inventoryQuantity: 0,
                          inventoryItem: {
                            id: "gid://shopify/InventoryItem/present",
                            legacyResourceId: "present",
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    };

    const result = await syncShopifyProducts(pool, tenantId, admin);
    expect(result.markedMissing).toBeGreaterThanOrEqual(1);

    const missing = await pool.query<{
      is_active: boolean;
      product_status: string;
    }>(
      `
        select is_active, product_status
        from items
        where tenant_id = $1 and sku = 'SYNC-MISSING'
      `,
      [tenantId],
    );
    expect(missing.rows[0]?.is_active).toBe(false);
    expect(missing.rows[0]?.product_status).toBe("MISSING");
  });

  it("can decrypt local development customer data when Shopify secret is present", () => {
    const previousSecret = process.env.SHOPIFY_API_SECRET;
    process.env.SHOPIFY_API_SECRET = "different-runtime-secret";
    try {
      expect(
        decryptCustomerData(
          "v1:4nfPCfHhwib7osKB:InnfnDwe857ra-zpnzN_sg:tcin-jgQeK3uDq8",
        ),
      ).toBe("Jörn Voigt");
    } finally {
      if (previousSecret === undefined) {
        delete process.env.SHOPIFY_API_SECRET;
      } else {
        process.env.SHOPIFY_API_SECRET = previousSecret;
      }
    }
  });

  it("syncs Shopify order shipping address and preserves it when address access is unavailable later", async () => {
    const address = {
      name: "Address Sync Customer",
      address1: "100 Sync St",
      address2: null,
      city: "Berlin",
      provinceCode: "BE",
      zip: "10115",
      countryCodeV2: "DE",
      phone: "+491234567",
    };
    const orderPayload = {
      id: "gid://shopify/Order/address-sync",
      legacyResourceId: "address-sync",
      name: "#ADDR-SYNC",
      processedAt: new Date().toISOString(),
      displayFinancialStatus: "PAID",
      displayFulfillmentStatus: "UNFULFILLED",
      customer: {
        displayName: "Address Sync Customer",
        defaultEmailAddress: { emailAddress: "address@example.com" },
        defaultAddress: {
          ...address,
          address1: "Customer Default St",
        },
      },
      shippingAddress: address,
      lineItems: {
        nodes: [
          {
            id: "gid://shopify/LineItem/address-sync",
            title: "Address Sync Product",
            sku: "ADDR-SYNC",
            quantity: 1,
            variant: {
              id: "gid://shopify/ProductVariant/address-sync",
              legacyResourceId: "address-sync-variant",
              title: "Default Title",
              sku: "ADDR-SYNC",
              inventoryItem: {
                id: "gid://shopify/InventoryItem/address-sync",
                legacyResourceId: "address-sync-inventory",
              },
              product: {
                id: "gid://shopify/Product/address-sync",
                legacyResourceId: "address-sync-product",
                title: "Address Sync Product",
                handle: "address-sync-product",
                status: "ACTIVE",
              },
            },
          },
        ],
      },
    };
    const admin = {
      graphql: async () =>
        new Response(
          JSON.stringify({
            data: { orders: { nodes: [orderPayload] } },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    };

    const synced = await syncShopifyOrders(pool, tenantId, admin);
    expect(synced.shippingAddressAvailable).toBe(true);
    expect(synced.protectedCustomerDataUnavailable).toBe(false);
    expect(synced.fallbackQueryUsed).toBe(false);
    expect(synced.shippingAddressesStored).toBe(1);
    expect(synced.orderShippingAddressesStored).toBe(1);
    expect(synced.customerDefaultAddressesStored).toBe(0);
    expect(synced.shippingAddressesMissing).toBe(0);

    let orders = await loadOperationsOrdersList(pool, tenantId);
    const order = orders.find((row: any) => row.order_name === "#ADDR-SYNC") as any;
    expect(order?.shipping_address?.address1).toBe("100 Sync St");
    expect(order?.shipping_address?.city).toBe("Berlin");

    const stored = await pool.query<{ has_shipping_address: boolean }>(
      `
        select shipping_address_encrypted is not null as has_shipping_address
        from operations_orders
        where tenant_id = $1 and order_name = '#ADDR-SYNC'
      `,
      [tenantId],
    );
    expect(stored.rows[0]?.has_shipping_address).toBe(true);

    const detail = await loadOperationsOrderDetail(pool, tenantId, order.id);
    expect((detail.order as any)?.shipping_address?.countryCodeV2).toBe("DE");

    let calls = 0;
    const fallbackAdmin = {
      graphql: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(
            JSON.stringify({
              errors: [{ message: "Protected customer data access denied" }],
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              orders: {
                nodes: [{ ...orderPayload, shippingAddress: undefined }],
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    };

    const fallbackSynced = await syncShopifyOrders(
      pool,
      tenantId,
      fallbackAdmin,
    );
    expect(fallbackSynced.shippingAddressAvailable).toBe(false);
    expect(fallbackSynced.protectedCustomerDataUnavailable).toBe(true);
    expect(fallbackSynced.fallbackQueryUsed).toBe(true);
    expect(fallbackSynced.customerDefaultAddressAvailable).toBe(true);
    expect(fallbackSynced.shippingAddressesStored).toBe(1);
    expect(fallbackSynced.customerDefaultAddressesStored).toBe(1);

    orders = await loadOperationsOrdersList(pool, tenantId);
    const preserved = orders.find(
      (row: any) => row.order_name === "#ADDR-SYNC",
    ) as any;
    expect(preserved?.customer_name).toBe("Address Sync Customer");
    expect(preserved?.customer_email).toBe("address@example.com");
    expect(preserved?.shipping_address?.address1).toBe("Customer Default St");

    let noCustomerCalls = 0;
    const noCustomerAdmin = {
      graphql: async () => {
        noCustomerCalls += 1;
        if (noCustomerCalls <= 2) {
          return new Response(
            JSON.stringify({
              errors: [{ message: "Protected customer data access denied" }],
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              orders: {
                nodes: [
                  {
                    ...orderPayload,
                    customer: undefined,
                    shippingAddress: undefined,
                  },
                ],
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    };

    const noCustomerSynced = await syncShopifyOrders(
      pool,
      tenantId,
      noCustomerAdmin,
    );
    expect(noCustomerSynced.customerDataAvailable).toBe(false);
    expect(noCustomerSynced.protectedCustomerDataUnavailable).toBe(true);
    expect(noCustomerSynced.fallbackQueryUsed).toBe(true);

    orders = await loadOperationsOrdersList(pool, tenantId);
    const preservedAfterUnavailable = orders.find(
      (row: any) => row.order_name === "#ADDR-SYNC",
    ) as any;
    expect(preservedAfterUnavailable?.customer_name).toBe(
      "Address Sync Customer",
    );
    expect(preservedAfterUnavailable?.customer_email).toBe(
      "address@example.com",
    );
    expect(preservedAfterUnavailable?.shipping_address?.address1).toBe(
      "Customer Default St",
    );
  });

  it("keeps a Shopify order with null shipping address blocked after sync", async () => {
    const sku = `NULL-ADDR-${Date.now()}`;
    const orderName = `#${sku}`;
    const admin = {
      graphql: async () =>
        new Response(
          JSON.stringify({
            data: {
              orders: {
                nodes: [
                  {
                    id: `gid://shopify/Order/${sku}`,
                    legacyResourceId: sku,
                    name: orderName,
                    processedAt: new Date().toISOString(),
                    displayFinancialStatus: "PAID",
                    displayFulfillmentStatus: "UNFULFILLED",
                    customer: {
                      displayName: "Null Address Customer",
                      defaultEmailAddress: {
                        emailAddress: "null-address@example.com",
                      },
                    },
                    shippingAddress: null,
                    lineItems: {
                      nodes: [
                        {
                          id: `gid://shopify/LineItem/${sku}`,
                          title: "Null Address Product",
                          sku,
                          quantity: 1,
                          variant: {
                            id: `gid://shopify/ProductVariant/${sku}`,
                            legacyResourceId: `${sku}-variant`,
                            title: "Default Title",
                            sku,
                            inventoryItem: {
                              id: `gid://shopify/InventoryItem/${sku}`,
                              legacyResourceId: `${sku}-inventory`,
                            },
                            product: {
                              id: `gid://shopify/Product/${sku}`,
                              legacyResourceId: `${sku}-product`,
                              title: "Null Address Product",
                              handle: `null-address-${sku}`,
                              status: "ACTIVE",
                            },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    };

    const synced = await syncShopifyOrders(pool, tenantId, admin);
    expect(synced.shippingAddressAvailable).toBe(true);
    expect(synced.shippingAddressesStored).toBe(0);
    expect(synced.shippingAddressesMissing).toBe(1);
    expect(synced.ordersMissingShippingAddress).toEqual([orderName]);

    const orderRow = await pool.query<{
      id: string;
      item_id: string;
      has_shipping_address: boolean;
    }>(
      `
        select operations_orders.id, operations_order_lines.item_id,
          operations_orders.shipping_address_encrypted is not null as has_shipping_address
        from operations_orders
        join operations_order_lines
          on operations_order_lines.operations_order_id = operations_orders.id
        where operations_orders.tenant_id = $1
          and operations_orders.order_name = $2
        limit 1
      `,
      [tenantId, orderName],
    );
    expect(orderRow.rows[0]?.has_shipping_address).toBe(false);

    await pool.query(
      `
        update items
        set item_type = 'product',
          is_sellable = true,
          is_purchasable = true,
          is_producible = false,
          is_active = true,
          updated_at = now()
        where tenant_id = $1 and id = $2
      `,
      [tenantId, orderRow.rows[0].item_id],
    );

    await pool.query(
      `
        insert into inventory_movements (
          tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
          location_code, source_type, source_id, idempotency_key
        )
        values ($1, $2, 'putaway', 1, 0, 'MAIN', 'test', $3, $4)
      `,
      [
        tenantId,
        orderRow.rows[0].item_id,
        orderRow.rows[0].id,
        `null-address-stock:${sku}`,
      ],
    );

    const orders = await loadOperationsOrdersList(pool, tenantId);
    const loaded = orders.find((row: any) => row.id === orderRow.rows[0].id) as any;
    expect(loaded?.shipping_address).toBeNull();
    expect(loaded?.operational_status).toBe("Logistics blocked");

    const shipping = await createShippingOrdersFromOpenOperationsOrders(
      pool,
      tenantId,
      orderRow.rows[0].id,
    );
    expect(shipping.shippingOrderIds.length).toBe(0);
    expect(shipping.blockedOrders).toContain(orderName);
  });

  it("stores Shopify customer default address when order shipping address is null", async () => {
    const sku = `CUSTOMER-ADDR-${Date.now()}`;
    const customerAddress = {
      name: "Customer Default Address",
      address1: "500 Customer Ave",
      address2: null,
      city: "Munich",
      provinceCode: "BY",
      zip: "80331",
      countryCodeV2: "DE",
      phone: null,
    };
    const orderName = `#${sku}`;
    const admin = {
      graphql: async () =>
        new Response(
          JSON.stringify({
            data: {
              orders: {
                nodes: [
                  {
                    id: `gid://shopify/Order/${sku}`,
                    legacyResourceId: sku,
                    name: orderName,
                    processedAt: new Date().toISOString(),
                    displayFinancialStatus: "PAID",
                    displayFulfillmentStatus: "UNFULFILLED",
                    customer: {
                      displayName: "Customer Default Address",
                      defaultEmailAddress: {
                        emailAddress: "customer-default@example.com",
                      },
                      defaultAddress: customerAddress,
                    },
                    shippingAddress: null,
                    lineItems: {
                      nodes: [
                        {
                          id: `gid://shopify/LineItem/${sku}`,
                          title: "Customer Address Product",
                          sku,
                          quantity: 1,
                          variant: {
                            id: `gid://shopify/ProductVariant/${sku}`,
                            legacyResourceId: `${sku}-variant`,
                            title: "Default Title",
                            sku,
                            inventoryItem: {
                              id: `gid://shopify/InventoryItem/${sku}`,
                              legacyResourceId: `${sku}-inventory`,
                            },
                            product: {
                              id: `gid://shopify/Product/${sku}`,
                              legacyResourceId: `${sku}-product`,
                              title: "Customer Address Product",
                              handle: `customer-address-${sku}`,
                              status: "ACTIVE",
                            },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    };

    const synced = await syncShopifyOrders(pool, tenantId, admin);
    expect(synced.shippingAddressAvailable).toBe(true);
    expect(synced.shippingAddressesStored).toBe(1);
    expect(synced.orderShippingAddressesStored).toBe(0);
    expect(synced.customerDefaultAddressesStored).toBe(1);

    const orders = await loadOperationsOrdersList(pool, tenantId);
    const loaded = orders.find((row: any) => row.order_name === orderName) as any;
    expect(loaded?.shipping_address?.address1).toBe("500 Customer Ave");
    expect(loaded?.shipping_address?.city).toBe("Munich");
    expect(loaded?.shipping_address?.countryCodeV2).toBe("DE");
  });

  it("blocks logistics when shipping address is missing and preserves real addresses during test backfill", async () => {
    const sku = `ADDR-BLOCK-${Date.now()}`;
    const item = await pool.query<{ id: string }>(
      `
        insert into items (
          tenant_id, sku, title, item_type, unit, is_sellable, is_purchasable,
          is_producible, is_active
        )
        values ($1, $2, 'Address Block Product', 'product', 'pcs', true, true,
          false, true)
        returning id
      `,
      [tenantId, sku],
    );
    const missingOrder = await pool.query<{ id: string }>(
      `
        insert into operations_orders (
          tenant_id, order_name, status, customer_name_encrypted,
          customer_email_encrypted
        )
        values ($1, $2, 'open', $3, $4)
        returning id
      `,
      [
        tenantId,
        `#${sku}-MISSING`,
        encryptCustomerData("Missing Address Customer"),
        encryptCustomerData("missing-address@example.com"),
      ],
    );
    await pool.query(
      `
        insert into operations_order_lines (
          tenant_id, operations_order_id, item_id, quantity, unit, sku, title
        )
        values ($1, $2, $3, 1, 'pcs', $4, 'Address Block Product')
      `,
      [tenantId, missingOrder.rows[0].id, item.rows[0].id, sku],
    );
    await pool.query(
      `
        insert into inventory_movements (
          tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
          location_code, source_type, source_id, idempotency_key
        )
        values ($1, $2, 'putaway', 1, 0, 'MAIN', 'test', $3, $4)
      `,
      [
        tenantId,
        item.rows[0].id,
        missingOrder.rows[0].id,
        `addr-block-stock:${sku}`,
      ],
    );

    let orders = await loadOperationsOrdersList(pool, tenantId);
    const missing = orders.find(
      (row: any) => row.id === missingOrder.rows[0].id,
    ) as any;
    expect(missing?.operational_status).toBe("Logistics blocked");
    expect(String(missing?.next_reason ?? "")).toContain(
      "shipping address is missing",
    );

    const blockedShipping = await createShippingOrdersFromOpenOperationsOrders(
      pool,
      tenantId,
      missingOrder.rows[0].id,
    );
    expect(blockedShipping.shippingOrderIds.length).toBe(0);
    expect(blockedShipping.blockedOrders).toContain(`#${sku}-MISSING`);

    const realAddress = {
      name: "Real Address Customer",
      address1: "200 Real St",
      address2: null,
      city: "Hamburg",
      provinceCode: "HH",
      zip: "20095",
      countryCodeV2: "DE",
      phone: null,
    };
    const realOrder = await pool.query<{ id: string }>(
      `
        insert into operations_orders (
          tenant_id, order_name, status, customer_name_encrypted,
          customer_email_encrypted, shipping_address_encrypted
        )
        values ($1, $2, 'open', $3, $4, $5)
        returning id
      `,
      [
        tenantId,
        `#${sku}-REAL`,
        encryptCustomerData(realAddress.name),
        encryptCustomerData("real-address@example.com"),
        encryptCustomerData(JSON.stringify(realAddress)),
      ],
    );

    const backfill = await backfillTestShippingAddressForOpenOrders(
      pool,
      tenantId,
    );
    expect(backfill.updated).toBeGreaterThanOrEqual(1);

    orders = await loadOperationsOrdersList(pool, tenantId);
    const readyAfterBackfill = orders.find(
      (row: any) => row.id === missingOrder.rows[0].id,
    ) as any;
    expect(readyAfterBackfill?.shipping_address?.address1).toBe("123 Test St");

    const preservedReal = await loadOperationsOrderDetail(
      pool,
      tenantId,
      realOrder.rows[0].id,
    );
    expect((preservedReal.order as any)?.shipping_address?.address1).toBe(
      "200 Real St",
    );
  });

  it("treats invalid encrypted order customer and address data as missing instead of crashing", async () => {
    const sku = `BAD-CIPHER-${Date.now()}`;
    const item = await pool.query<{ id: string }>(
      `
        insert into items (
          tenant_id, sku, title, item_type, unit, is_sellable, is_purchasable,
          is_producible, is_active
        )
        values ($1, $2, 'Bad Cipher Product', 'product', 'pcs', true, true,
          false, true)
        returning id
      `,
      [tenantId, sku],
    );
    const order = await pool.query<{ id: string }>(
      `
        insert into operations_orders (
          tenant_id, order_name, status, customer_name_encrypted,
          customer_email_encrypted, shipping_address_encrypted
        )
        values ($1, $2, 'open', 'v1:not-valid:not-valid:not-valid',
          'v1:not-valid:not-valid:not-valid', 'v1:not-valid:not-valid:not-valid')
        returning id
      `,
      [tenantId, `#${sku}`],
    );
    await pool.query(
      `
        insert into operations_order_lines (
          tenant_id, operations_order_id, item_id, quantity, unit, sku, title
        )
        values ($1, $2, $3, 1, 'pcs', $4, 'Bad Cipher Product')
      `,
      [tenantId, order.rows[0].id, item.rows[0].id, sku],
    );
    await pool.query(
      `
        insert into inventory_movements (
          tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
          location_code, source_type, source_id, idempotency_key
        )
        values ($1, $2, 'putaway', 1, 0, 'MAIN', 'test', $3, $4)
      `,
      [
        tenantId,
        item.rows[0].id,
        order.rows[0].id,
        `bad-cipher-stock:${sku}`,
      ],
    );

    const orders = await loadOperationsOrdersList(pool, tenantId);
    const loaded = orders.find((row: any) => row.id === order.rows[0].id) as any;
    expect(loaded?.customer_name).toBeNull();
    expect(loaded?.customer_email).toBeNull();
    expect(loaded?.shipping_address).toBeNull();
    expect(loaded?.operational_status).toBe("Logistics blocked");
    expect(String(loaded?.next_reason ?? "")).toContain(
      "customer name, email or shipping address is missing",
    );

    const detail = await loadOperationsOrderDetail(
      pool,
      tenantId,
      order.rows[0].id,
    );
    expect((detail.order as any)?.customer_name).toBeNull();
    expect((detail.order as any)?.shipping_address).toBeNull();

    const shipping = await createShippingOrdersFromOpenOperationsOrders(
      pool,
      tenantId,
      order.rows[0].id,
    );
    expect(shipping.shippingOrderIds.length).toBe(0);
    expect(shipping.blockedOrders).toContain(`#${sku}`);
  });

  it("preserves customer shortage quantity for trading-goods procurement", async () => {
    const item = await pool.query<{ id: string }>(
      `
        insert into items (
          tenant_id, sku, title, item_type, unit, is_sellable, is_purchasable,
          is_producible, is_active, supplier_lead_time_days,
          default_order_quantity, default_production_quantity,
          min_inventory_quantity, qc_required_after_purchase,
          qc_required_after_production
        )
        values ($1, 'QTY-TEST', 'Quantity Preservation Test', 'product', 'pcs', true, true,
          false, true, 7, 1, 1, 0, true, false)
        on conflict (tenant_id, sku)
        do update set
          is_sellable = excluded.is_sellable,
          is_purchasable = excluded.is_purchasable,
          is_producible = excluded.is_producible,
          default_order_quantity = excluded.default_order_quantity,
          min_inventory_quantity = excluded.min_inventory_quantity,
          updated_at = now()
        returning id
      `,
      [tenantId],
    );
    const supplier = await pool.query<{ id: string }>(
      `
        insert into suppliers (tenant_id, name, is_active)
        values ($1, 'Quantity Supplier', true)
        on conflict (tenant_id, name)
        do update set is_active = true, updated_at = now()
        returning id
      `,
      [tenantId],
    );
    await pool.query(
      `
        insert into supplier_items (
          tenant_id, supplier_id, item_id, is_preferred, supplier_sku,
          unit_price, currency_code, lead_time_days, minimum_order_quantity,
          is_active
        )
        values ($1, $2, $3, true, 'QTY-TEST', 0, 'EUR', 7, 1, true)
        on conflict (tenant_id, supplier_id, item_id)
        do update set
          is_preferred = excluded.is_preferred,
          supplier_sku = excluded.supplier_sku,
          unit_price = excluded.unit_price,
          currency_code = excluded.currency_code,
          lead_time_days = excluded.lead_time_days,
          minimum_order_quantity = excluded.minimum_order_quantity,
          is_active = excluded.is_active,
          updated_at = now()
      `,
      [tenantId, supplier.rows[0].id, item.rows[0].id],
    );
    const order = await pool.query<{ id: string }>(
      `
        insert into operations_orders (tenant_id, order_name, status)
        values ($1, '#QTY-TEST', 'open')
        on conflict (tenant_id, order_name)
        do update set status = 'open', updated_at = now()
        returning id
      `,
      [tenantId],
    );
    await pool.query(
      `
        insert into operations_order_lines (
          tenant_id, operations_order_id, item_id, quantity, unit, sku, title
        )
        values ($1, $2, $3, 3, 'pcs', 'QTY-TEST', 'Quantity Preservation Test')
        on conflict (tenant_id, operations_order_id, item_id)
        do update set quantity = excluded.quantity
      `,
      [tenantId, order.rows[0].id, item.rows[0].id],
    );

    const mrp = await runOperationsMrp(pool, tenantId);
    await commitMrpRun(pool, tenantId, mrp.mrpRunId);

    const need = await pool.query<{ id: string; quantity: string }>(
      `
        select purchase_needs.id, purchase_needs.quantity
        from purchase_needs
        join items on items.id = purchase_needs.item_id
        where purchase_needs.tenant_id = $1 and items.sku = 'QTY-TEST'
        order by purchase_needs.created_at desc
        limit 1
      `,
      [tenantId],
    );
    expect(Number(need.rows[0]?.quantity ?? 0)).toBe(3);

    await createPurchaseOrderFromNeed(pool, tenantId, need.rows[0].id);
    const poLine = await pool.query<{
      quantity: string;
      requested_quantity: string;
    }>(
      `
        select quantity, requested_quantity
        from purchase_order_lines
        where tenant_id = $1 and purchase_need_id = $2
      `,
      [tenantId, need.rows[0].id],
    );

    expect(Number(poLine.rows[0]?.quantity ?? 0)).toBe(3);
    expect(Number(poLine.rows[0]?.requested_quantity ?? 0)).toBe(3);
  });

  it("keeps same-item procurement status scoped to the source order where current schema can link it", async () => {
    const sku = `TRACE-${Date.now()}`;
    const item = await pool.query<{ id: string }>(
      `
        insert into items (
          tenant_id, sku, title, item_type, unit, is_sellable, is_purchasable,
          is_producible, is_active, supplier_lead_time_days,
          default_order_quantity, default_production_quantity,
          min_inventory_quantity, qc_required_after_purchase,
          qc_required_after_production
        )
        values ($1, $2, 'Traceability Test Product', 'product', 'pcs', true, true,
          false, true, 7, 1, 1, 0, true, false)
        returning id
      `,
      [tenantId, sku],
    );
    const supplier = await pool.query<{ id: string }>(
      `
        insert into suppliers (tenant_id, name, is_active)
        values ($1, 'Traceability Supplier', true)
        on conflict (tenant_id, name)
        do update set is_active = true, updated_at = now()
        returning id
      `,
      [tenantId],
    );
    await pool.query(
      `
        insert into supplier_items (
          tenant_id, supplier_id, item_id, is_preferred, supplier_sku,
          unit_price, currency_code, lead_time_days, minimum_order_quantity,
          is_active
        )
        values ($1, $2, $3, true, $4, 10, 'EUR', 7, 1, true)
        on conflict (tenant_id, supplier_id, item_id)
        do update set
          is_preferred = excluded.is_preferred,
          supplier_sku = excluded.supplier_sku,
          unit_price = excluded.unit_price,
          currency_code = excluded.currency_code,
          lead_time_days = excluded.lead_time_days,
          minimum_order_quantity = excluded.minimum_order_quantity,
          is_active = excluded.is_active,
          updated_at = now()
      `,
      [tenantId, supplier.rows[0].id, item.rows[0].id, sku],
    );
    const firstOrder = await pool.query<{ id: string }>(
      `
        insert into operations_orders (tenant_id, order_name, status, processed_at)
        values ($1, $2, 'open', now())
        returning id
      `,
      [tenantId, `#${sku}-A`],
    );
    const secondOrder = await pool.query<{ id: string }>(
      `
        insert into operations_orders (tenant_id, order_name, status, processed_at)
        values ($1, $2, 'open', now() + interval '1 minute')
        returning id
      `,
      [tenantId, `#${sku}-B`],
    );
    const firstLine = await pool.query<{ id: string }>(
      `
        insert into operations_order_lines (
          tenant_id, operations_order_id, item_id, quantity, unit, sku, title
        )
        values ($1, $2, $3, 1, 'pcs', $4, 'Traceability Test Product')
        returning id
      `,
      [tenantId, firstOrder.rows[0].id, item.rows[0].id, sku],
    );
    const secondLine = await pool.query<{ id: string }>(
      `
        insert into operations_order_lines (
          tenant_id, operations_order_id, item_id, quantity, unit, sku, title
        )
        values ($1, $2, $3, 1, 'pcs', $4, 'Traceability Test Product')
        returning id
      `,
      [tenantId, secondOrder.rows[0].id, item.rows[0].id, sku],
    );

    const createdNeed = await createPurchaseNeedForOrderLine(
      pool,
      tenantId,
      firstLine.rows[0].id,
      1,
    );
    const linkedNeed = await pool.query<{ source_order_line_id: string | null }>(
      `
        select source_order_line_id
        from purchase_needs
        where tenant_id = $1 and id = $2
      `,
      [tenantId, createdNeed.purchaseNeedId],
    );
    expect(linkedNeed.rows[0]?.source_order_line_id).toBe(
      firstLine.rows[0].id,
    );
    const procurementNeeds = await loadPurchaseNeeds(pool, tenantId);
    const procurementNeed = procurementNeeds.find(
      (row: any) => row.id === createdNeed.purchaseNeedId,
    ) as any;
    expect(procurementNeed?.demand_link_scope).toBe("order_line");
    expect(procurementNeed?.source_order_line_id).toBe(firstLine.rows[0].id);

    let orders = await loadOperationsOrdersList(pool, tenantId);
    const firstBeforePo = orders.find(
      (row: any) => row.id === firstOrder.rows[0].id,
    ) as any;
    const secondBeforePo = orders.find(
      (row: any) => row.id === secondOrder.rows[0].id,
    ) as any;
    expect(firstBeforePo?.operational_status).toBe("Purchase proposal ready");
    expect(firstBeforePo?.product_summary).toContain(
      `1 × ${sku} Traceability Test Product`,
    );
    expect(firstBeforePo?.next_reason).toBeTruthy();
    expect(secondBeforePo?.operational_status).toBe("Needs planning");
    expect(secondBeforePo?.product_summary).toContain(
      `1 × ${sku} Traceability Test Product`,
    );
    expect(secondBeforePo?.next_reason).toBeTruthy();

    const firstOrderDetail = await loadOperationsOrderDetail(
      pool,
      tenantId,
      firstOrder.rows[0].id,
    );
    expect((firstOrderDetail.procurement?.[0] as any)?.demand_link_scope).toBe(
      "order_line",
    );
    const secondOrderDetail = await loadOperationsOrderDetail(
      pool,
      tenantId,
      secondOrder.rows[0].id,
    );
    expect(secondOrderDetail.procurement ?? []).toHaveLength(0);

    const firstLineDetail = await loadOperationsOrderLineDetail(
      pool,
      tenantId,
      firstLine.rows[0].id,
    );
    expect((firstLineDetail.procurement?.[0] as any)?.demand_link_scope).toBe(
      "order_line",
    );
    const secondLineDetail = await loadOperationsOrderLineDetail(
      pool,
      tenantId,
      secondLine.rows[0].id,
    );
    expect(secondLineDetail.procurement ?? []).toHaveLength(0);

    const po = await createPurchaseOrderFromNeed(
      pool,
      tenantId,
      createdNeed.purchaseNeedId,
    );
    await transitionPurchaseOrder(pool, tenantId, po.purchaseOrderId!, "sent");
    await transitionPurchaseOrder(
      pool,
      tenantId,
      po.purchaseOrderId!,
      "acknowledged",
    );
    const receipt = await createGoodsReceiptForPurchaseOrder(
      pool,
      tenantId,
      po.purchaseOrderId!,
    );
    const receiptLine = await pool.query<{
      id: string;
      received_quantity: string;
    }>(
      `
        select id, received_quantity
        from goods_receipt_lines
        where tenant_id = $1 and goods_receipt_id = $2
        limit 1
      `,
      [tenantId, receipt.receiptId],
    );
    await completeReceiptLineQc(pool, tenantId, {
      goodsReceiptLineId: receiptLine.rows[0].id,
      acceptedQuantity: Number(receiptLine.rows[0].received_quantity),
      rejectedQuantity: 0,
    });
    await putawayReceiptLine(pool, tenantId, receiptLine.rows[0].id);

    orders = await loadOperationsOrdersList(pool, tenantId);
    const first = orders.find(
      (row: any) => row.id === firstOrder.rows[0].id,
    ) as any;
    const second = orders.find(
      (row: any) => row.id === secondOrder.rows[0].id,
    ) as any;
    expect(first?.operational_status).toBe("Logistics blocked");
    expect(second?.operational_status).toBe("Needs planning");
    expect(second?.operational_status).not.toBe("Complete");
    expect(second?.operational_status).not.toBe("Shipment created");
    expect(String(second?.next_reason ?? "")).toContain(
      "Open Procurement to refresh purchasing needs",
    );

    await pool.query(
      "update purchase_orders set status = 'cancelled' where tenant_id = $1 and id = $2",
      [tenantId, po.purchaseOrderId],
    );
  });

  it("keeps item-level purchase needs explicit when no order-line source exists", async () => {
    const sku = `FALLBACK-${Date.now()}`;
    const item = await pool.query<{ id: string }>(
      `
        insert into items (
          tenant_id, sku, title, item_type, unit, is_sellable, is_purchasable,
          is_producible, is_active, supplier_lead_time_days,
          default_order_quantity, default_production_quantity,
          min_inventory_quantity, qc_required_after_purchase,
          qc_required_after_production
        )
        values ($1, $2, 'Fallback Scope Product', 'product', 'pcs', true, true,
          false, true, 7, 1, 1, 0, false, false)
        returning id
      `,
      [tenantId, sku],
    );
    const shippingAddress = {
      name: "Flow Customer",
      address1: "123 Flow St",
      address2: null,
      city: "Washington",
      provinceCode: "DC",
      zip: "20340",
      countryCodeV2: "US",
      phone: null,
    };
    const order = await pool.query<{ id: string }>(
      `
        insert into operations_orders (
          tenant_id, order_name, status, customer_name_encrypted,
          customer_email_encrypted, shipping_address_encrypted
        )
        values ($1, $2, 'open', $3, $4, $5)
        returning id
      `,
      [
        tenantId,
        `#${sku}`,
        encryptCustomerData(shippingAddress.name),
        encryptCustomerData("flow@example.com"),
        encryptCustomerData(JSON.stringify(shippingAddress)),
      ],
    );
    const line = await pool.query<{ id: string }>(
      `
        insert into operations_order_lines (
          tenant_id, operations_order_id, item_id, quantity, unit, sku, title
        )
        values ($1, $2, $3, 1, 'pcs', $4, 'Fallback Scope Product')
        returning id
      `,
      [tenantId, order.rows[0].id, item.rows[0].id, sku],
    );
    const mrp = await pool.query<{ id: string }>(
      `
        insert into mrp_runs (tenant_id, status, scenario_mode, summary, committed_at)
        values ($1, 'committed', 'operations', 'Item-level fallback test run.', now())
        returning id
      `,
      [tenantId],
    );
    const mrpLine = await pool.query<{ id: string }>(
      `
        insert into mrp_run_lines (
          tenant_id, mrp_run_id, item_id, source_item_id, line_type,
          demand_quantity, available_quantity, shortage_quantity,
          recommended_action, explanation
        )
        values ($1, $2, $3, $3, 'finished_good', 1, 0, 1, 'buy', 'Item-level fallback need.')
        returning id
      `,
      [tenantId, mrp.rows[0].id, item.rows[0].id],
    );
    await pool.query(
      `
        insert into purchase_needs (
          tenant_id, item_id, mrp_run_id, mrp_run_line_id,
          quantity, unit, status
        )
        values ($1, $2, $3, $4, 1, 'pcs', 'open')
      `,
      [tenantId, item.rows[0].id, mrp.rows[0].id, mrpLine.rows[0].id],
    );

    const detail = await loadOperationsOrderLineDetail(
      pool,
      tenantId,
      line.rows[0].id,
    );
    expect((detail.procurement?.[0] as any)?.demand_link_scope).toBe(
      "item_fallback",
    );
    const orderDetail = await loadOperationsOrderDetail(
      pool,
      tenantId,
      order.rows[0].id,
    );
    expect((orderDetail.procurement?.[0] as any)?.demand_link_scope).toBe(
      "item_fallback",
    );
  });

  it("shows trading-goods order progression, value and shipping readiness", async () => {
    const sku = `FLOW-${Date.now()}`;
    const item = await pool.query<{ id: string }>(
      `
        insert into items (
          tenant_id, sku, title, item_type, unit, is_sellable, is_purchasable,
          is_producible, is_active, supplier_lead_time_days,
          default_order_quantity, default_production_quantity,
          min_inventory_quantity, qc_required_after_purchase,
          qc_required_after_production
        )
        values ($1, $2, 'Flow Test Product', 'product', 'pcs', true, true,
          false, true, 7, 1, 1, 0, true, false)
        returning id
      `,
      [tenantId, sku],
    );
    const supplier = await pool.query<{ id: string }>(
      `
        insert into suppliers (tenant_id, name, is_active)
        values ($1, 'Flow Supplier', true)
        on conflict (tenant_id, name)
        do update set is_active = true, updated_at = now()
        returning id
      `,
      [tenantId],
    );
    await pool.query(
      `
        insert into supplier_items (
          tenant_id, supplier_id, item_id, is_preferred, supplier_sku,
          unit_price, currency_code, lead_time_days, minimum_order_quantity,
          is_active
        )
        values ($1, $2, $3, true, $4, 10, 'EUR', 7, 1, true)
      `,
      [tenantId, supplier.rows[0].id, item.rows[0].id, sku],
    );
    const shippingAddress = {
      name: "Flow Customer",
      address1: "123 Flow St",
      address2: null,
      city: "Washington",
      provinceCode: "DC",
      zip: "20340",
      countryCodeV2: "US",
      phone: null,
    };
    const order = await pool.query<{ id: string }>(
      `
        insert into operations_orders (
          tenant_id, order_name, status, customer_name_encrypted,
          customer_email_encrypted, shipping_address_encrypted
        )
        values ($1, $2, 'open', $3, $4, $5)
        returning id
      `,
      [
        tenantId,
        `#${sku}`,
        encryptCustomerData(shippingAddress.name),
        encryptCustomerData("flow@example.com"),
        encryptCustomerData(JSON.stringify(shippingAddress)),
      ],
    );
    await pool.query(
      `
        insert into operations_order_lines (
          tenant_id, operations_order_id, item_id, quantity, unit, sku, title
        )
        values ($1, $2, $3, 3, 'pcs', $4, 'Flow Test Product')
      `,
      [tenantId, order.rows[0].id, item.rows[0].id, sku],
    );

    let orders = await loadOperationsOrdersList(pool, tenantId);
    expect(
      (orders.find((row: any) => row.id === order.rows[0].id) as any)
        ?.operational_status,
    ).toBe("Needs planning");

    const mrp = await runOperationsMrp(pool, tenantId);
    await commitMrpRun(pool, tenantId, mrp.mrpRunId);
    orders = await loadOperationsOrdersList(pool, tenantId);
    expect(
      (orders.find((row: any) => row.id === order.rows[0].id) as any)
        ?.operational_status,
    ).toBe("Purchase proposal ready");

    const need = await pool.query<{ id: string }>(
      `
        select purchase_needs.id
        from purchase_needs
        where tenant_id = $1 and item_id = $2
        order by created_at desc
        limit 1
      `,
      [tenantId, item.rows[0].id],
    );
    const po = await createPurchaseOrderFromNeed(
      pool,
      tenantId,
      need.rows[0].id,
    );
    const poLine = await pool.query<{
      quantity: string;
      unit_price: string;
      currency_code: string;
    }>(
      `
        select quantity, unit_price, currency_code
        from purchase_order_lines
        where tenant_id = $1 and purchase_need_id = $2
      `,
      [tenantId, need.rows[0].id],
    );
    expect(Number(poLine.rows[0]?.quantity ?? 0)).toBe(3);
    expect(Number(poLine.rows[0]?.unit_price ?? 0)).toBe(10);
    expect(Number(poLine.rows[0]?.quantity ?? 0) * Number(poLine.rows[0]?.unit_price ?? 0)).toBe(30);
    expect(poLine.rows[0]?.currency_code).toBe("EUR");

    await transitionPurchaseOrder(pool, tenantId, po.purchaseOrderId!, "sent");
    await transitionPurchaseOrder(
      pool,
      tenantId,
      po.purchaseOrderId!,
      "acknowledged",
    );
    orders = await loadOperationsOrdersList(pool, tenantId);
    expect(
      (orders.find((row: any) => row.id === order.rows[0].id) as any)
        ?.operational_status,
    ).toBe("Awaiting receipt");

    const receipt = await createGoodsReceiptForPurchaseOrder(
      pool,
      tenantId,
      po.purchaseOrderId!,
    );
    const receiptLine = await pool.query<{
      id: string;
      received_quantity: string;
    }>(
      `
        select id, received_quantity
        from goods_receipt_lines
        where tenant_id = $1 and goods_receipt_id = $2
        limit 1
      `,
      [tenantId, receipt.receiptId],
    );
    await completeReceiptLineQc(pool, tenantId, {
      goodsReceiptLineId: receiptLine.rows[0].id,
      acceptedQuantity: Number(receiptLine.rows[0].received_quantity),
      rejectedQuantity: 0,
    });
    await putawayReceiptLine(pool, tenantId, receiptLine.rows[0].id);

    orders = await loadOperationsOrdersList(pool, tenantId);
    expect(
      (orders.find((row: any) => row.id === order.rows[0].id) as any)
        ?.operational_status,
    ).toBe("Ready for logistics");

    const shipping = await createShippingOrdersFromOpenOperationsOrders(
      pool,
      tenantId,
      order.rows[0].id,
    );
    expect(shipping.shippingOrderIds.length).toBe(1);
    expect(shipping.blockedOrders.length).toBe(0);

    await pool.query(
      "update purchase_orders set status = 'cancelled' where tenant_id = $1 and id = $2",
      [tenantId, po.purchaseOrderId],
    );
  });

  it("posts receiving, QC and putaway evidence for acknowledged PO", async () => {
    const mrp = await runScenarioMrp(pool, tenantId, "shortage");
    await commitMrpRun(pool, tenantId, mrp.mrpRunId);
    await createPurchaseOrdersFromReadyNeeds(pool, tenantId);

    const purchaseOrders = await loadPurchaseOrders(pool, tenantId);
    const po = purchaseOrders.find(
      (row: any) => row.status !== "cancelled" && Number(row.line_count) > 0,
    ) as any;
    expect(po).toBeTruthy();
    await pool.query(
      "update purchase_orders set status = 'acknowledged' where tenant_id = $1 and id = $2",
      [tenantId, po.id],
    );

    const receipt = await postGoodsReceiptForAcknowledgedPurchaseOrders(pool, tenantId);
    expect(receipt.receipts).toBeGreaterThan(0);
    expect(receipt.qcChecks).toBeGreaterThan(0);

    const qc = await passQcAndCreatePutaway(pool, tenantId);
    expect(qc.passed).toBeGreaterThan(0);

    const receiving = await loadReceipts(pool, tenantId);
    expect(receiving.receipts.length).toBeGreaterThan(0);
    expect(receiving.lines.some((line: any) => line.qc_status === "passed")).toBe(true);

    const acceptedLines = receiving.lines.filter(
      (line: any) => line.status === "accepted",
    ) as any[];
    expect(acceptedLines.length).toBeGreaterThan(0);

    let finalPutaway: Awaited<ReturnType<typeof putawayReceiptLine>> | null =
      null;
    for (const acceptedLine of acceptedLines) {
      finalPutaway = await putawayReceiptLine(
        pool,
        tenantId,
        acceptedLine.id,
      );
      expect(finalPutaway.putaway).toBeGreaterThan(0);
    }
    expect(finalPutaway?.paymentId).toBeTruthy();

    const repeatedPutaway = await putawayReceiptLine(
      pool,
      tenantId,
      acceptedLines[acceptedLines.length - 1].id,
    );
    expect(repeatedPutaway.putaway).toBe(0);

    const paymentCount = await pool.query<{ count: string }>(
      `
        select count(*)::text as count
        from purchase_payments
        where tenant_id = $1
          and purchase_order_id = $2
      `,
      [tenantId, po.id],
    );
    expect(Number(paymentCount.rows[0]?.count ?? 0)).toBe(1);

    const afterPutaway = await loadReceipts(pool, tenantId);
    expect(
      afterPutaway.lines.some((line: any) => line.status === "putaway_done"),
    ).toBe(true);

    const inventory = await loadInventoryLedger(pool, tenantId);
    expect(
      inventory.movements.some(
        (movement: any) => movement.movement_type === "putaway",
      ),
    ).toBe(true);
  });
});

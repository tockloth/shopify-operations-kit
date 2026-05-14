import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  backfillTestShippingAddressForOpenOrders,
  commitMrpRun,
  completeReceiptLineQc,
  createGoodsReceiptForPurchaseOrder,
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
  loadItems,
  loadOperationsOrdersList,
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
import { syncShopifyProducts } from "../../app/lib/shopify-sync.server";

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
    const order = await pool.query<{ id: string }>(
      `
        insert into operations_orders (tenant_id, order_name, status)
        values ($1, $2, 'open')
        returning id
      `,
      [tenantId, `#${sku}`],
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
    ).toBe("Logistics blocked");

    await backfillTestShippingAddressForOpenOrders(pool, tenantId);
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

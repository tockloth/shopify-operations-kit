import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  backfillTestShippingAddressForOpenOrders,
  completeReceiptLineQc,
  createGoodsReceiptForPurchaseOrder,
  createOperationsItem,
  createOperationsOrderEntry,
  createPurchaseNeedForOrderLine,
  createPurchaseOrderFromNeed,
  createShippingOrdersFromOpenOperationsOrders,
  ensureTenantForShop,
  loadInventoryItemDetail,
  loadItems,
  loadOperationsOrdersList,
  loadPurchaseOrderDetail,
  loadReceiptDetail,
  loadShippingOrderDetail,
  loadShippingOrders,
  loadSuppliers,
  putawayReceiptLine,
  saveSupplierMaster,
  saveSupplierForItem,
  transitionPurchaseOrder,
  updateItemOperationsProperties,
} from "../../app/lib/operations-kit.server";

const databaseUrl =
  process.env.OPERATIONS_KIT_DATABASE_URL ||
  process.env.OPERATIONS_LEDGER_DATABASE_URL;

describe.skipIf(!databaseUrl)("Tenant isolation", () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const runId = Date.now();
  const shopA = `tenant-a-test-${runId}.myshopify.com`;
  const shopB = `tenant-b-test-${runId}.myshopify.com`;
  const sharedSku = `TENANT-ISO-SHARED-${runId}`;
  const sharedSupplierName = `Tenant Isolation Supplier ${runId}`;
  const sharedOrderName = `#TENANT-ISO-${runId}`;

  let tenantA = "";
  let tenantB = "";
  let itemA = "";
  let itemB = "";
  let supplierA = "";
  let supplierB = "";
  let orderA = "";
  let orderB = "";
  let orderLineA = "";
  let orderLineB = "";

  beforeAll(async () => {
    const contextA = await ensureTenantForShop(pool, shopA, "read_orders");
    const contextB = await ensureTenantForShop(pool, shopB, "read_orders");
    tenantA = contextA.tenantId;
    tenantB = contextB.tenantId;

    const createdA = await createOperationsItem(pool, tenantA, {
      sku: sharedSku,
      title: "Tenant A shared SKU",
      itemType: "product",
      replenishmentPolicy: "buy",
      isSellable: true,
      isPurchasable: true,
      isProducible: false,
      minInventoryQuantity: 1,
      defaultProductionQuantity: 1,
      defaultOrderQuantity: 5,
      supplierLeadTimeDays: 3,
    });
    const createdB = await createOperationsItem(pool, tenantB, {
      sku: sharedSku,
      title: "Tenant B shared SKU",
      itemType: "product",
      replenishmentPolicy: "buy",
      isSellable: true,
      isPurchasable: true,
      isProducible: false,
      minInventoryQuantity: 2,
      defaultProductionQuantity: 1,
      defaultOrderQuantity: 6,
      supplierLeadTimeDays: 4,
    });
    itemA = createdA.itemId;
    itemB = createdB.itemId;

    await saveSupplierMaster(pool, tenantA, {
      name: sharedSupplierName,
      email: "tenant-a-supplier@example.com",
      isActive: true,
    });
    await saveSupplierMaster(pool, tenantB, {
      name: sharedSupplierName,
      email: "tenant-b-supplier@example.com",
      isActive: true,
    });
    const supplierRowsA = await loadSuppliers(pool, tenantA);
    const supplierRowsB = await loadSuppliers(pool, tenantB);
    supplierA = supplierRowsA.find(
      (supplier: any) => supplier.name === sharedSupplierName,
    )?.id ?? "";
    supplierB = supplierRowsB.find(
      (supplier: any) => supplier.name === sharedSupplierName,
    )?.id ?? "";
    expect(supplierA).toBeTruthy();
    expect(supplierB).toBeTruthy();

    await saveSupplierForItem(pool, tenantA, {
      itemId: itemA,
      supplierId: supplierA,
      isPreferred: true,
      unitPrice: 11,
      currencyCode: "EUR",
      leadTimeDays: 2,
      minimumOrderQuantity: 1,
    });
    await saveSupplierForItem(pool, tenantB, {
      itemId: itemB,
      supplierId: supplierB,
      isPreferred: true,
      unitPrice: 22,
      currencyCode: "EUR",
      leadTimeDays: 4,
      minimumOrderQuantity: 1,
    });

    await createOperationsOrderEntry(pool, tenantA, {
      orderName: sharedOrderName,
      customerName: "Tenant A Customer",
      customerEmail: "tenant-a-customer@example.com",
      itemId: itemA,
      quantity: 1,
    });
    await createOperationsOrderEntry(pool, tenantB, {
      orderName: sharedOrderName,
      customerName: "Tenant B Customer",
      customerEmail: "tenant-b-customer@example.com",
      itemId: itemB,
      quantity: 1,
    });

    const orderLineRowsA = await pool.query<{
      order_id: string;
      line_id: string;
    }>(
      `
        select operations_orders.id as order_id,
          operations_order_lines.id as line_id
        from operations_orders
        join operations_order_lines
          on operations_order_lines.operations_order_id = operations_orders.id
          and operations_order_lines.tenant_id = operations_orders.tenant_id
        where operations_orders.tenant_id = $1
          and operations_orders.order_name = $2
          and operations_order_lines.item_id = $3
        limit 1
      `,
      [tenantA, sharedOrderName, itemA],
    );
    const orderLineRowsB = await pool.query<{
      order_id: string;
      line_id: string;
    }>(
      `
        select operations_orders.id as order_id,
          operations_order_lines.id as line_id
        from operations_orders
        join operations_order_lines
          on operations_order_lines.operations_order_id = operations_orders.id
          and operations_order_lines.tenant_id = operations_orders.tenant_id
        where operations_orders.tenant_id = $1
          and operations_orders.order_name = $2
          and operations_order_lines.item_id = $3
        limit 1
      `,
      [tenantB, sharedOrderName, itemB],
    );
    orderA = orderLineRowsA.rows[0]?.order_id ?? "";
    orderLineA = orderLineRowsA.rows[0]?.line_id ?? "";
    orderB = orderLineRowsB.rows[0]?.order_id ?? "";
    orderLineB = orderLineRowsB.rows[0]?.line_id ?? "";
    expect(orderA).toBeTruthy();
    expect(orderLineA).toBeTruthy();
    expect(orderB).toBeTruthy();
    expect(orderLineB).toBeTruthy();
  });

  afterAll(async () => {
    if (tenantA || tenantB) {
      await pool.query("delete from tenants where id = any($1::uuid[])", [
        [tenantA, tenantB].filter(Boolean),
      ]);
    }
    await pool.end();
  });

  it("isolates reads for items, suppliers, and operations orders", async () => {
    const itemsA = await loadItems(pool, tenantA, { query: sharedSku });
    const itemsB = await loadItems(pool, tenantB, { query: sharedSku });
    expect(itemsA.map((item) => item.id)).toEqual([itemA]);
    expect(itemsB.map((item) => item.id)).toEqual([itemB]);
    expect(itemsA[0]?.title).toBe("Tenant A shared SKU");
    expect(itemsB[0]?.title).toBe("Tenant B shared SKU");

    const suppliersA = await loadSuppliers(pool, tenantA);
    const suppliersB = await loadSuppliers(pool, tenantB);
    expect(
      suppliersA.filter((supplier: any) => supplier.name === sharedSupplierName),
    ).toHaveLength(1);
    expect(
      suppliersB.filter((supplier: any) => supplier.name === sharedSupplierName),
    ).toHaveLength(1);
    expect(
      suppliersA.find((supplier: any) => supplier.name === sharedSupplierName)
        ?.email,
    ).toBe("tenant-a-supplier@example.com");
    expect(
      suppliersB.find((supplier: any) => supplier.name === sharedSupplierName)
        ?.email,
    ).toBe("tenant-b-supplier@example.com");

    const ordersA = await loadOperationsOrdersList(pool, tenantA);
    const ordersB = await loadOperationsOrdersList(pool, tenantB);
    const matchingOrdersA = ordersA.filter(
      (order: any) => order.order_name === sharedOrderName,
    );
    const matchingOrdersB = ordersB.filter(
      (order: any) => order.order_name === sharedOrderName,
    );
    expect(matchingOrdersA).toHaveLength(1);
    expect(matchingOrdersB).toHaveLength(1);
    expect(matchingOrdersA[0].customer_name).toBe("Tenant A Customer");
    expect(matchingOrdersB[0].customer_name).toBe("Tenant B Customer");
  });

  it("does not let a tenant-scoped mutation alter another tenant's item", async () => {
    await updateItemOperationsProperties(pool, tenantA, {
      itemId: itemB,
      itemType: "product",
      isSellable: true,
      isPurchasable: true,
      isProducible: false,
      minInventoryQuantity: 99,
      defaultProductionQuantity: 1,
      defaultOrderQuantity: 99,
      supplierLeadTimeDays: 99,
      qcRequiredAfterPurchase: true,
      qcRequiredAfterProduction: false,
    });

    await updateItemOperationsProperties(pool, tenantA, {
      itemId: itemA,
      itemType: "product",
      isSellable: true,
      isPurchasable: true,
      isProducible: false,
      minInventoryQuantity: 7,
      defaultProductionQuantity: 1,
      defaultOrderQuantity: 8,
      supplierLeadTimeDays: 9,
      qcRequiredAfterPurchase: true,
      qcRequiredAfterProduction: false,
    });

    const [tenantAItem] = await loadItems(pool, tenantA, { query: sharedSku });
    const [tenantBItem] = await loadItems(pool, tenantB, { query: sharedSku });
    expect(Number(tenantAItem?.min_inventory_quantity)).toBe(7);
    expect(Number(tenantAItem?.default_order_quantity)).toBe(8);
    expect(Number(tenantBItem?.min_inventory_quantity)).toBe(2);
    expect(Number(tenantBItem?.default_order_quantity)).toBe(6);
  });

  it("isolates purchase, receipt, inventory, and shipment process objects", async () => {
    const needA = await createPurchaseNeedForOrderLine(
      pool,
      tenantA,
      orderLineA,
      3,
    );
    expect(needA.purchaseNeedId).toBeTruthy();

    const purchaseOrderA = await createPurchaseOrderFromNeed(
      pool,
      tenantA,
      needA.purchaseNeedId,
    );
    expect(purchaseOrderA.purchaseOrderId).toBeTruthy();
    const purchaseOrderId = purchaseOrderA.purchaseOrderId!;

    const purchaseOrderDetailA = await loadPurchaseOrderDetail(
      pool,
      tenantA,
      purchaseOrderId,
    );
    const purchaseOrderDetailB = await loadPurchaseOrderDetail(
      pool,
      tenantB,
      purchaseOrderId,
    );
    expect(purchaseOrderDetailA.order?.id).toBe(purchaseOrderId);
    expect(purchaseOrderDetailA.lines).toHaveLength(1);
    expect(purchaseOrderDetailA.lines[0]?.source_order_line_id).toBe(
      orderLineA,
    );
    expect(purchaseOrderDetailB.order).toBeNull();
    expect(purchaseOrderDetailB.lines).toHaveLength(0);

    await transitionPurchaseOrder(pool, tenantA, purchaseOrderId, "approved");
    await transitionPurchaseOrder(pool, tenantA, purchaseOrderId, "sent");
    await transitionPurchaseOrder(pool, tenantA, purchaseOrderId, "acknowledged");

    const receiptA = await createGoodsReceiptForPurchaseOrder(
      pool,
      tenantA,
      purchaseOrderId,
    );
    expect(receiptA.receiptId).toBeTruthy();
    const receiptId = receiptA.receiptId!;

    const receiptDetailA = await loadReceiptDetail(pool, tenantA, receiptId);
    const receiptDetailB = await loadReceiptDetail(pool, tenantB, receiptId);
    expect(receiptDetailA.receipt?.id).toBe(receiptId);
    expect(receiptDetailA.lines).toHaveLength(1);
    expect(receiptDetailB.receipt).toBeNull();
    expect(receiptDetailB.lines).toHaveLength(0);

    const receiptLine = receiptDetailA.lines[0] as any;
    await completeReceiptLineQc(pool, tenantA, {
      goodsReceiptLineId: receiptLine.id,
      acceptedQuantity: Number(receiptLine.received_quantity),
      rejectedQuantity: 0,
    });
    await putawayReceiptLine(pool, tenantA, receiptLine.id);

    const inventoryA = await loadInventoryItemDetail(pool, tenantA, itemA);
    const inventoryBWithAItem = await loadInventoryItemDetail(
      pool,
      tenantB,
      itemA,
    );
    expect(inventoryA.item?.id).toBe(itemA);
    expect(
      inventoryA.movements.some(
        (movement: any) =>
          movement.movement_type === "putaway" &&
          movement.source_receipt_line_id === receiptLine.id,
      ),
    ).toBe(true);
    expect(inventoryBWithAItem.item).toBeNull();
    expect(inventoryBWithAItem.movements).toHaveLength(0);

    await backfillTestShippingAddressForOpenOrders(pool, tenantA);
    const shipmentA = await createShippingOrdersFromOpenOperationsOrders(
      pool,
      tenantA,
      orderA,
    );
    expect(shipmentA.shippingOrderIds).toHaveLength(1);
    const shipmentId = shipmentA.shippingOrderIds[0];

    const shipmentDetailA = await loadShippingOrderDetail(
      pool,
      tenantA,
      shipmentId,
    );
    const shipmentDetailB = await loadShippingOrderDetail(
      pool,
      tenantB,
      shipmentId,
    );
    expect(shipmentDetailA.order?.id).toBe(shipmentId);
    expect(shipmentDetailA.lines).toHaveLength(1);
    expect(shipmentDetailB.order).toBeNull();
    expect(shipmentDetailB.lines).toHaveLength(0);

    const shippingOrdersB = await loadShippingOrders(pool, tenantB);
    expect(shippingOrdersB.orders.map((order: any) => order.id)).not.toContain(
      shipmentId,
    );
  });
});

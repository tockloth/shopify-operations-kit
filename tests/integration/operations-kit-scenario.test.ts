import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  commitMrpRun,
  createProductionWorkForLatestNeed,
  createPurchaseOrdersFromReadyNeeds,
  completeProductionOrder,
  ensureDefaultOperationAccess,
  ensureTenantForShop,
  loadAccessControlSettings,
  loadDashboard,
  loadInventoryLedger,
  loadPurchaseNeeds,
  loadPurchaseOrders,
  loadProductionOrders,
  loadReceipts,
  loadWarehouseTasks,
  passQcAndCreatePutaway,
  postGoodsReceiptForAcknowledgedPurchaseOrders,
  putawayReceiptLine,
  runScenarioMrp,
  seedOperationsKitScenario,
  setOperationUserActive,
  upsertOperationUser,
} from "../../app/lib/operations-kit.server";

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

  it("posts receiving, QC and putaway evidence for acknowledged PO", async () => {
    const mrp = await runScenarioMrp(pool, tenantId, "shortage");
    await commitMrpRun(pool, tenantId, mrp.mrpRunId);
    await createPurchaseOrdersFromReadyNeeds(pool, tenantId);

    const purchaseOrders = await loadPurchaseOrders(pool, tenantId);
    const po = purchaseOrders[0] as any;
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

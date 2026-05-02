import type { QueryExecutor } from "./kit-db.server";
import { withKitTransaction } from "./kit-db.server";
import {
  decryptCustomerData,
  encryptCustomerData,
  hashCustomerLookup,
} from "./customer-privacy.server";

export type ScenarioMode = "available" | "shortage" | "operations";

export interface KitContext {
  tenantId: string;
  shopDomain: string;
}

export interface ItemRow {
  id: string;
  sku: string;
  title: string;
  item_type: string;
  unit: string;
  is_sellable: boolean;
  is_purchasable: boolean;
  is_producible: boolean;
  available_quantity: string | number;
  reserved_quantity: string | number;
  shopify_product_legacy_id?: string | null;
  shopify_variant_legacy_id?: string | null;
  product_status?: string | null;
  shopify_inventory_available?: string | number | null;
  min_inventory_quantity?: string | number;
  default_production_quantity?: string | number;
  default_order_quantity?: string | number;
  supplier_lead_time_days?: number;
  qc_required_after_purchase?: boolean;
  qc_required_after_production?: boolean;
}

export interface DashboardSummary {
  items: number;
  activeBoms: number;
  purchaseNeedsOpen: number;
  productionNeedsOpen: number;
  draftPurchaseOrders: number;
  sentPurchaseOrders: number;
  acknowledgedPurchaseOrders: number;
  openReceipts: number;
  openQcChecks: number;
  openWarehouseTasks: number;
  openCases: number;
  latestMrpRun: {
    id: string;
    status: string;
    scenario_mode: ScenarioMode;
    created_at: string;
  } | null;
}

type CustomerEncryptedRow = {
  customer_name?: string | null;
  customer_email?: string | null;
  customer_name_encrypted?: string | null;
  customer_email_encrypted?: string | null;
  [key: string]: unknown;
};

function decryptOrderRow<T extends CustomerEncryptedRow>(
  row: T,
) {
  return {
    ...row,
    customer_name: decryptCustomerData(row.customer_name_encrypted) ?? row.customer_name ?? null,
    customer_email: decryptCustomerData(row.customer_email_encrypted) ?? row.customer_email ?? null,
  };
}

export async function ensureTenantForShop(
  db: QueryExecutor,
  shopDomain: string,
  scopes?: string | null,
) {
  const tenant = await db.query<{ id: string }>(
    `
      insert into tenants (shop_domain, status)
      values ($1, 'active')
      on conflict (shop_domain)
      do update set status = 'active', updated_at = now()
      returning id
    `,
    [shopDomain],
  );
  const tenantId = tenant.rows[0].id;

  await db.query(
    `
      insert into shopify_installations (tenant_id, shop_domain, status, scopes)
      values ($1, $2, 'active', $3)
      on conflict (shop_domain)
      do update set tenant_id = excluded.tenant_id, status = 'active', scopes = excluded.scopes, updated_at = now()
    `,
    [tenantId, shopDomain, scopes ?? null],
  );

  return { tenantId, shopDomain };
}

async function upsertItem(
  db: QueryExecutor,
  tenantId: string,
  sku: string,
  title: string,
  itemType: string,
  flags: {
    sellable?: boolean;
    purchasable?: boolean;
    producible?: boolean;
  },
) {
  const result = await db.query<{ id: string }>(
    `
      insert into items (
        tenant_id, shopify_product_gid, shopify_variant_gid, shopify_inventory_item_gid,
        sku, title, item_type, unit, is_sellable, is_purchasable, is_producible
      )
      values ($1, $2, $3, $4, $5, $6, $7, 'pcs', $8, $9, $10)
      on conflict (tenant_id, sku)
      do update set
        title = excluded.title,
        item_type = excluded.item_type,
        is_sellable = excluded.is_sellable,
        is_purchasable = excluded.is_purchasable,
        is_producible = excluded.is_producible,
        updated_at = now()
      returning id
    `,
    [
      tenantId,
      `gid://shopify/Product/${sku}`,
      `gid://shopify/ProductVariant/${sku}`,
      `gid://shopify/InventoryItem/${sku}`,
      sku,
      title,
      itemType,
      flags.sellable ?? false,
      flags.purchasable ?? false,
      flags.producible ?? false,
    ],
  );

  return result.rows[0].id;
}

async function upsertSupplier(
  db: QueryExecutor,
  tenantId: string,
  name: string,
  email: string,
) {
  const result = await db.query<{ id: string }>(
    `
      insert into suppliers (tenant_id, name, email, is_active)
      values ($1, $2, $3, true)
      on conflict (tenant_id, name)
      do update set email = excluded.email, is_active = true, updated_at = now()
      returning id
    `,
    [tenantId, name, email],
  );

  return result.rows[0].id;
}

async function linkPreferredSupplier(
  db: QueryExecutor,
  tenantId: string,
  supplierId: string,
  itemId: string,
) {
  await db.query(
    "update supplier_items set is_preferred = false where tenant_id = $1 and item_id = $2",
    [tenantId, itemId],
  );
  await db.query(
    `
      insert into supplier_items (tenant_id, supplier_id, item_id, is_preferred)
      values ($1, $2, $3, true)
      on conflict (tenant_id, supplier_id, item_id)
      do update set is_preferred = true
    `,
    [tenantId, supplierId, itemId],
  );
}

async function setInventory(
  db: QueryExecutor,
  tenantId: string,
  itemId: string,
  sku: string,
  quantity: number,
  mode: ScenarioMode,
) {
  const idempotencyKey = `scenario:${mode}:inventory:${sku}`;
  await db.query(
    `
      insert into inventory_movements (
        tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
        location_code, source_type, source_id, idempotency_key
      )
      values ($1, $2, 'stock_adjustment', $3, 0, 'MAIN', 'scenario_seed', $4, $5)
      on conflict (tenant_id, idempotency_key)
      do update set quantity_delta = excluded.quantity_delta, occurred_at = now()
    `,
    [tenantId, itemId, quantity, mode, idempotencyKey],
  );
}

async function addCaseEvent(
  db: QueryExecutor,
  tenantId: string,
  title: string,
  message: string,
  sourceRef: string,
  metadata: Record<string, unknown> = {},
) {
  await db.query(
    `
      insert into case_events (
        tenant_id, event_type, title, message, actor_type, source, source_ref, metadata
      )
      values ($1, 'scenario_event', $2, $3, 'system', 'operations_kit', $4, $5)
    `,
    [tenantId, title, message, sourceRef, JSON.stringify(metadata)],
  );
}

export async function seedOperationsKitScenario(
  db: QueryExecutor,
  tenantId: string,
) {
  return withKitTransaction(db, async (tx) => {
    const kit = await upsertItem(tx, tenantId, "KIT-001", "Customer Test Kit", "assembly", {
      sellable: true,
      producible: true,
    });
    const compA = await upsertItem(tx, tenantId, "COMP-A", "Reagent A", "raw_material", {
      purchasable: true,
    });
    const compB = await upsertItem(tx, tenantId, "COMP-B", "Buffer Bottle", "component", {
      purchasable: true,
    });
    const box = await upsertItem(tx, tenantId, "PACK-BOX", "Packaging Box", "component", {
      purchasable: true,
    });
    const manual = await upsertItem(tx, tenantId, "MANUAL", "User Manual", "component", {
      purchasable: true,
    });

    const bom = await tx.query<{ id: string }>(
      `
        insert into boms (tenant_id, parent_item_id, version, is_active)
        values ($1, $2, '1', true)
        on conflict (tenant_id, parent_item_id, version)
        do update set is_active = true, updated_at = now()
        returning id
      `,
      [tenantId, kit],
    );
    const bomId = bom.rows[0].id;

    for (const componentId of [compA, compB, box, manual]) {
      await tx.query(
        `
          insert into bom_lines (tenant_id, bom_id, component_item_id, quantity, unit)
          values ($1, $2, $3, 1, 'pcs')
          on conflict (tenant_id, bom_id, component_item_id)
          do update set quantity = 1, unit = 'pcs'
        `,
        [tenantId, bomId, componentId],
      );
    }

    const supplierAlpha = await upsertSupplier(
      tx,
      tenantId,
      "Supplier Alpha",
      "orders@supplier-alpha.example",
    );
    const supplierBeta = await upsertSupplier(
      tx,
      tenantId,
      "Supplier Beta",
      "orders@supplier-beta.example",
    );
    const printSupplier = await upsertSupplier(
      tx,
      tenantId,
      "Print Supplier",
      "orders@print-supplier.example",
    );

    await linkPreferredSupplier(tx, tenantId, supplierAlpha, compA);
    await linkPreferredSupplier(tx, tenantId, supplierBeta, compB);
    await linkPreferredSupplier(tx, tenantId, printSupplier, box);
    await linkPreferredSupplier(tx, tenantId, printSupplier, manual);

    const order = await tx.query<{ id: string }>(
      `
        insert into operations_orders (tenant_id, shopify_order_gid, order_name, status)
        values ($1, 'gid://shopify/Order/1001', '#1001', 'open')
        on conflict (tenant_id, order_name)
        do update set status = 'open', updated_at = now()
        returning id
      `,
      [tenantId],
    );

    await tx.query(
      `
        insert into operations_order_lines (tenant_id, operations_order_id, item_id, quantity, unit)
        values ($1, $2, $3, 1, 'pcs')
        on conflict (tenant_id, operations_order_id, item_id)
        do update set quantity = 1, supply_status = 'unchecked'
      `,
      [tenantId, order.rows[0].id, kit],
    );

    await tx.query(
      `
        insert into operation_cases (
          tenant_id, case_type, status, priority, summary, primary_object_type, primary_object_id
        )
        values ($1, 'general_operations_case', 'open', 'normal', 'Plan and fulfill #1001 for KIT-001', 'operations_order', $2)
      `,
      [tenantId, order.rows[0].id],
    );

    await addCaseEvent(
      tx,
      tenantId,
      "Baseline operating scenario ready",
      "KIT-001, its BOM, preferred suppliers, and Shopify order #1001 are available.",
      "scenario_seed",
      { orderName: "#1001", itemSku: "KIT-001" },
    );

    return { orderId: order.rows[0].id, itemCount: 5, supplierCount: 3, bomId };
  });
}

async function loadBomLinesForKit(db: QueryExecutor, tenantId: string) {
  const result = await db.query<{
    kit_id: string;
    component_id: string;
    sku: string;
    title: string;
    item_type: string;
    is_purchasable: boolean;
    quantity: string;
    available_quantity: string;
  }>(
    `
      with balances as (
        select
          item_id,
          coalesce(sum(quantity_delta - reserved_delta) filter (where location_code = 'MAIN'), 0) as available_quantity
        from inventory_movements
        where tenant_id = $1
        group by item_id
      )
      select
        parent.id as kit_id,
        component.id as component_id,
        component.sku,
        component.title,
        component.item_type,
        component.is_purchasable,
        bom_lines.quantity,
        coalesce(balances.available_quantity, 0) as available_quantity
      from items parent
      join boms on boms.parent_item_id = parent.id and boms.tenant_id = parent.tenant_id and boms.is_active
      join bom_lines on bom_lines.bom_id = boms.id and bom_lines.tenant_id = parent.tenant_id
      join items component on component.id = bom_lines.component_item_id
      left join balances on balances.item_id = component.id
      where parent.tenant_id = $1 and parent.sku = 'KIT-001'
      order by component.sku
    `,
    [tenantId],
  );

  return result.rows;
}

async function loadBomLinesForItem(
  db: QueryExecutor,
  tenantId: string,
  parentItemId: string,
) {
  const result = await db.query<{
    parent_id: string;
    component_id: string;
    sku: string;
    title: string;
    item_type: string;
    is_purchasable: boolean;
    is_producible: boolean;
    quantity: string;
    available_quantity: string;
  }>(
    `
      with balances as (
        select
          item_id,
          coalesce(sum(quantity_delta - reserved_delta) filter (where location_code = 'MAIN'), 0) as available_quantity
        from inventory_movements
        where tenant_id = $1
        group by item_id
      )
      select
        parent.id as parent_id,
        component.id as component_id,
        component.sku,
        component.title,
        component.item_type,
        component.is_purchasable,
        component.is_producible,
        bom_lines.quantity,
        coalesce(balances.available_quantity, 0) as available_quantity
      from items parent
      join boms on boms.parent_item_id = parent.id and boms.tenant_id = parent.tenant_id and boms.is_active
      join bom_lines on bom_lines.bom_id = boms.id and bom_lines.tenant_id = parent.tenant_id
      join items component on component.id = bom_lines.component_item_id
      left join balances on balances.item_id = component.id
      where parent.tenant_id = $1 and parent.id = $2
      order by component.sku
    `,
    [tenantId, parentItemId],
  );

  return result.rows;
}

export async function runOperationsMrp(db: QueryExecutor, tenantId: string) {
  return withKitTransaction(db, async (tx) => {
    const orderLines = await tx.query<{
      order_id: string;
      order_name: string;
      line_id: string;
      item_id: string;
      sku: string;
      title: string;
      quantity: string;
      is_purchasable: boolean;
      is_producible: boolean;
      min_inventory_quantity: string;
      default_order_quantity: string;
      default_production_quantity: string;
      available_quantity: string;
    }>(
      `
        with balances as (
          select
            item_id,
            coalesce(sum(quantity_delta - reserved_delta) filter (where location_code = 'MAIN'), 0) as available_quantity
          from inventory_movements
          where tenant_id = $1
          group by item_id
        )
        select
          operations_orders.id as order_id,
          operations_orders.order_name,
          operations_order_lines.id as line_id,
          items.id as item_id,
          coalesce(operations_order_lines.sku, items.sku) as sku,
          coalesce(operations_order_lines.title, items.title) as title,
          operations_order_lines.quantity,
          items.is_purchasable,
          items.is_producible,
          items.min_inventory_quantity,
          items.default_order_quantity,
          items.default_production_quantity,
          coalesce(balances.available_quantity, 0) as available_quantity
        from operations_orders
        join operations_order_lines on operations_order_lines.operations_order_id = operations_orders.id
        join items on items.id = operations_order_lines.item_id
        left join balances on balances.item_id = items.id
        where operations_orders.tenant_id = $1
          and operations_orders.status = 'open'
          and operations_order_lines.supply_status <> 'cancelled'
        order by operations_orders.processed_at nulls last, operations_orders.created_at, operations_order_lines.created_at
      `,
      [tenantId],
    );

    const mrp = await tx.query<{ id: string }>(
      `
        insert into mrp_runs (tenant_id, status, scenario_mode, summary)
        values ($1, 'previewed', 'operations', $2)
        returning id
      `,
      [
        tenantId,
        `Planned ${orderLines.rows.length} open order line(s) against available MAIN inventory, BOMs, minimum stock, and make/buy policies.`,
      ],
    );
    const mrpRunId = mrp.rows[0].id;

    const addMrpLine = async (input: {
      itemId: string;
      sourceItemId: string | null;
      lineType: "finished_good" | "component";
      demand: number;
      available: number;
      shortage: number;
      action: "reserve" | "buy" | "make" | "review";
      explanation: string;
    }) => {
      await tx.query(
        `
          insert into mrp_run_lines (
            tenant_id, mrp_run_id, item_id, source_item_id, line_type, demand_quantity,
            available_quantity, shortage_quantity, recommended_action, explanation
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          tenantId,
          mrpRunId,
          input.itemId,
          input.sourceItemId,
          input.lineType,
          input.demand,
          input.available,
          input.shortage,
          input.action,
          input.explanation,
        ],
      );
    };

    const componentDemand = new Map<
      string,
      {
        itemId: string;
        sourceItemId: string;
        sku: string;
        available: number;
        demand: number;
        isPurchasable: boolean;
        isProducible: boolean;
      }
    >();

    for (const line of orderLines.rows) {
      const demand = Number(line.quantity);
      const minStock = Number(line.min_inventory_quantity ?? 0);
      const available = Number(line.available_quantity);
      const requirement = demand + minStock;
      const shortage = Math.max(requirement - available, 0);

      let action: "reserve" | "buy" | "make" | "review" = "review";
      if (shortage <= 0) action = "reserve";
      else if (line.is_producible) action = "make";
      else if (line.is_purchasable) action = "buy";

      await addMrpLine({
        itemId: line.item_id,
        sourceItemId: line.item_id,
        lineType: "finished_good",
        demand: requirement,
        available,
        shortage,
        action,
        explanation:
          shortage <= 0
            ? `${line.order_name}: ${line.sku} can be reserved from MAIN stock.`
            : action === "make"
              ? `${line.order_name}: ${line.sku} requires ${shortage} unit(s) to be produced including minimum stock.`
              : action === "buy"
                ? `${line.order_name}: ${line.sku} requires ${shortage} unit(s) to be purchased including minimum stock.`
                : `${line.order_name}: ${line.sku} has shortage ${shortage}, but no make/buy policy is configured.`,
      });

      if (action === "make" && shortage > 0) {
        const bomLines = await loadBomLinesForItem(tx, tenantId, line.item_id);
        if (bomLines.length === 0) {
          await addMrpLine({
            itemId: line.item_id,
            sourceItemId: line.item_id,
            lineType: "component",
            demand: shortage,
            available: 0,
            shortage,
            action: "review",
            explanation: `${line.sku} is producible, but no active BOM exists.`,
          });
        }

        for (const component of bomLines) {
          const current = componentDemand.get(component.component_id) ?? {
            itemId: component.component_id,
            sourceItemId: line.item_id,
            sku: component.sku,
            available: Number(component.available_quantity),
            demand: 0,
            isPurchasable: component.is_purchasable,
            isProducible: component.is_producible,
          };
          current.demand += shortage * Number(component.quantity);
          componentDemand.set(component.component_id, current);
        }
      }
    }

    for (const component of componentDemand.values()) {
      const shortage = Math.max(component.demand - component.available, 0);
      let action: "reserve" | "buy" | "make" | "review" = "review";
      if (shortage <= 0) action = "reserve";
      else if (component.isPurchasable) action = "buy";
      else if (component.isProducible) action = "make";

      await addMrpLine({
        itemId: component.itemId,
        sourceItemId: component.sourceItemId,
        lineType: "component",
        demand: component.demand,
        available: component.available,
        shortage,
        action,
        explanation:
          shortage <= 0
            ? `${component.sku} is available for production picks.`
            : action === "buy"
              ? `${component.sku} is short by ${shortage}; create procurement work.`
              : action === "make"
                ? `${component.sku} is short by ${shortage}; create production work.`
                : `${component.sku} is short by ${shortage}, but no make/buy policy is configured.`,
      });
    }

    await addCaseEvent(
      tx,
      tenantId,
      "Operations MRP preview created",
      `MRP run planned ${orderLines.rows.length} open order line(s).`,
      mrpRunId,
      { orderLines: orderLines.rows.length },
    );

    return { mrpRunId, orderLines: orderLines.rows.length };
  });
}

export async function runScenarioMrp(
  db: QueryExecutor,
  tenantId: string,
  mode: ScenarioMode,
) {
  return withKitTransaction(db, async (tx) => {
    await seedOperationsKitScenario(tx, tenantId);

    const items = await tx.query<{ id: string; sku: string }>(
      "select id, sku from items where tenant_id = $1 and sku in ('COMP-A', 'COMP-B', 'PACK-BOX', 'MANUAL')",
      [tenantId],
    );
    const bySku = new Map(items.rows.map((item) => [item.sku, item]));
    await tx.query(
      "delete from inventory_movements where tenant_id = $1 and source_type = 'scenario_seed'",
      [tenantId],
    );
    await setInventory(tx, tenantId, bySku.get("COMP-A")!.id, "COMP-A", 4, mode);
    await setInventory(tx, tenantId, bySku.get("COMP-B")!.id, "COMP-B", mode === "available" ? 4 : 0, mode);
    await setInventory(tx, tenantId, bySku.get("PACK-BOX")!.id, "PACK-BOX", 4, mode);
    await setInventory(tx, tenantId, bySku.get("MANUAL")!.id, "MANUAL", 4, mode);

    const order = await tx.query<{ id: string }>(
      "select id from operations_orders where tenant_id = $1 and order_name = '#1001'",
      [tenantId],
    );
    const mrp = await tx.query<{ id: string }>(
      `
        insert into mrp_runs (tenant_id, operations_order_id, status, scenario_mode, summary)
        values ($1, $2, 'previewed', $3, $4)
        returning id
      `,
      [
        tenantId,
        order.rows[0].id,
        mode,
        mode === "available"
          ? "All KIT-001 components are available; create production work."
          : "COMP-B is short; create procurement work before production.",
      ],
    );

    const kit = await tx.query<{ id: string }>(
      "select id from items where tenant_id = $1 and sku = 'KIT-001'",
      [tenantId],
    );
    const mrpRunId = mrp.rows[0].id;

    await tx.query(
      `
        insert into mrp_run_lines (
          tenant_id, mrp_run_id, item_id, source_item_id, line_type, demand_quantity,
          available_quantity, shortage_quantity, recommended_action, explanation
        )
        values ($1, $2, $3, $3, 'finished_good', 1, 0, 1, 'make', 'Customer demand is for sellable assembly KIT-001. Make one unit from its BOM.')
      `,
      [tenantId, mrpRunId, kit.rows[0].id],
    );

    const bomLines = await loadBomLinesForKit(tx, tenantId);
    for (const line of bomLines) {
      const demand = Number(line.quantity);
      const available = Number(line.available_quantity);
      const shortage = Math.max(demand - available, 0);
      await tx.query(
        `
          insert into mrp_run_lines (
            tenant_id, mrp_run_id, item_id, source_item_id, line_type, demand_quantity,
            available_quantity, shortage_quantity, recommended_action, explanation
          )
          values ($1, $2, $3, $4, 'component', $5, $6, $7, $8, $9)
        `,
        [
          tenantId,
          mrpRunId,
          line.component_id,
          kit.rows[0].id,
          demand,
          available,
          shortage,
          shortage > 0 ? "buy" : "reserve",
          shortage > 0
            ? `${line.sku} is short by ${shortage}. Buy from preferred supplier before production.`
            : `${line.sku} has enough stock. Reserve/pick for production.`,
        ],
      );
    }

    await addCaseEvent(
      tx,
      tenantId,
      mode === "available" ? "Production scenario planned" : "Procurement scenario planned",
      mode === "available"
        ? "MRP preview found all components available for KIT-001."
        : "MRP preview found COMP-B shortage for KIT-001.",
      mrpRunId,
      { mode },
    );

    return { mrpRunId };
  });
}

export async function commitMrpRun(db: QueryExecutor, tenantId: string, mrpRunId: string) {
  return withKitTransaction(db, async (tx) => {
    const lines = await tx.query<{
      id: string;
      item_id: string;
      demand_quantity: string;
      shortage_quantity: string;
      recommended_action: string;
    }>(
      "select id, item_id, demand_quantity, shortage_quantity, recommended_action from mrp_run_lines where tenant_id = $1 and mrp_run_id = $2",
      [tenantId, mrpRunId],
    );

    let purchaseNeeds = 0;
    let productionNeeds = 0;

    for (const line of lines.rows) {
      if (line.recommended_action === "buy" && Number(line.shortage_quantity) > 0) {
        const preferred = await tx.query<{ supplier_id: string }>(
          "select supplier_id from supplier_items where tenant_id = $1 and item_id = $2 and is_preferred",
          [tenantId, line.item_id],
        );
        await tx.query(
          `
            insert into purchase_needs (
              tenant_id, item_id, mrp_run_id, mrp_run_line_id, supplier_id, quantity, unit, status
            )
            values ($1, $2, $3, $4, $5, $6, 'pcs', $7)
            on conflict (tenant_id, mrp_run_line_id)
            do update set supplier_id = coalesce(purchase_needs.supplier_id, excluded.supplier_id), updated_at = now()
          `,
          [
            tenantId,
            line.item_id,
            mrpRunId,
            line.id,
            preferred.rows[0]?.supplier_id ?? null,
            line.shortage_quantity,
            preferred.rows[0]?.supplier_id ? "assigned" : "open",
          ],
        );
        purchaseNeeds += 1;
      }

      if (line.recommended_action === "make") {
        await tx.query(
          `
            insert into production_needs (tenant_id, item_id, mrp_run_id, mrp_run_line_id, quantity, unit, status)
            values ($1, $2, $3, $4, $5, 'pcs', 'open')
            on conflict (tenant_id, mrp_run_line_id)
            do nothing
          `,
          [tenantId, line.item_id, mrpRunId, line.id, line.shortage_quantity],
        );
        productionNeeds += 1;
      }
    }

    await tx.query(
      "update mrp_runs set status = 'committed', committed_at = coalesce(committed_at, now()) where tenant_id = $1 and id = $2",
      [tenantId, mrpRunId],
    );

    await addCaseEvent(
      tx,
      tenantId,
      "MRP needs committed",
      `Created or reused ${purchaseNeeds} purchase need(s) and ${productionNeeds} production need(s).`,
      mrpRunId,
      { purchaseNeeds, productionNeeds },
    );

    return { purchaseNeeds, productionNeeds };
  });
}

export async function createProductionWorkForLatestNeed(
  db: QueryExecutor,
  tenantId: string,
  productionNeedId?: string,
) {
  return withKitTransaction(db, async (tx) => {
    const need = await tx.query<{
      id: string;
      item_id: string;
      quantity: string;
      sku: string;
    }>(
      `
        select production_needs.id, production_needs.item_id, production_needs.quantity, items.sku
        from production_needs
        join items on items.id = production_needs.item_id
        where production_needs.tenant_id = $1 and production_needs.status in ('open', 'planned')
          and ($2::uuid is null or production_needs.id = $2::uuid)
        order by production_needs.created_at desc
        limit 1
      `,
      [tenantId, productionNeedId ?? null],
    );
    if (!need.rows[0]) return { productionOrderId: null, warehouseTasks: 0 };

    const displayNumber = `MO-${need.rows[0].sku}-001`;
    const productionOrder = await tx.query<{ id: string }>(
      `
        insert into production_orders (
          tenant_id, production_need_id, item_id, display_number, quantity, unit, status
        )
        values ($1, $2, $3, $4, $5, 'pcs', 'ready')
        on conflict (tenant_id, display_number)
        do update set
          production_need_id = coalesce(production_orders.production_need_id, excluded.production_need_id),
          quantity = excluded.quantity,
          updated_at = now()
        returning id
      `,
      [tenantId, need.rows[0].id, need.rows[0].item_id, displayNumber, need.rows[0].quantity],
    );

    const components = await loadBomLinesForItem(tx, tenantId, need.rows[0].item_id);
    let taskCount = 0;
    for (const component of components) {
      await tx.query(
        `
          insert into production_components (
            tenant_id, production_order_id, item_id, required_quantity, picked_quantity, status
          )
          values ($1, $2, $3, $4, 0, 'required')
          on conflict (tenant_id, production_order_id, item_id)
          do update set required_quantity = excluded.required_quantity
        `,
        [tenantId, productionOrder.rows[0].id, component.component_id, component.quantity],
      );
      await tx.query(
        `
          insert into warehouse_tasks (
            tenant_id, task_type, status, item_id, quantity, source_type, source_id, title
          )
          values ($1, 'pick', 'open', $2, $3, 'production_order', $4, $5)
          on conflict (tenant_id, task_type, source_type, source_id, item_id)
          do nothing
        `,
        [
          tenantId,
          component.component_id,
          component.quantity,
          productionOrder.rows[0].id,
          `Pick ${component.quantity} x ${component.sku} for ${displayNumber}`,
        ],
      );
      taskCount += 1;
    }

    await tx.query(
      "update production_needs set status = 'converted_to_order', updated_at = now() where tenant_id = $1 and id = $2",
      [tenantId, need.rows[0].id],
    );

    await addCaseEvent(
      tx,
      tenantId,
      "Production work created",
      `${displayNumber} and component pick tasks are ready.`,
      productionOrder.rows[0].id,
      { displayNumber, taskCount },
    );

    return { productionOrderId: productionOrder.rows[0].id, warehouseTasks: taskCount };
  });
}

export async function createPurchaseOrderFromNeed(
  db: QueryExecutor,
  tenantId: string,
  purchaseNeedId: string,
) {
  return withKitTransaction(db, async (tx) => {
    const need = await tx.query<{
      id: string;
      supplier_id: string | null;
      item_id: string;
      quantity: string;
      unit: string;
    }>(
      `
        select id, supplier_id, item_id, quantity, unit
        from purchase_needs
        where tenant_id = $1 and id = $2 and status in ('open', 'assigned', 'ready_for_po')
      `,
      [tenantId, purchaseNeedId],
    );
    const row = need.rows[0];
    if (!row) return { purchaseOrderId: null };

    let supplierId = row.supplier_id;
    if (!supplierId) {
      const preferred = await tx.query<{ supplier_id: string }>(
        "select supplier_id from supplier_items where tenant_id = $1 and item_id = $2 and is_preferred",
        [tenantId, row.item_id],
      );
      supplierId = preferred.rows[0]?.supplier_id ?? null;
    }
    if (!supplierId) {
      throw new Error("Assign a preferred supplier before creating a purchase order.");
    }

    await tx.query(
      "update purchase_needs set supplier_id = $3, status = 'ready_for_po', updated_at = now() where tenant_id = $1 and id = $2",
      [tenantId, row.id, supplierId],
    );

    const policy = await tx.query<{
      default_order_quantity: string;
      supplier_lead_time_days: number;
    }>(
      "select default_order_quantity, supplier_lead_time_days from items where tenant_id = $1 and id = $2",
      [tenantId, row.item_id],
    );
    const leadTimeDays = policy.rows[0]?.supplier_lead_time_days ?? 7;
    const orderQuantity = Math.max(
      Number(row.quantity),
      Number(policy.rows[0]?.default_order_quantity ?? 1),
    );
    const displayNumber = `PO-${supplierId.slice(0, 4).toUpperCase()}-${row.id.slice(0, 8).toUpperCase()}`;

    const po = await tx.query<{ id: string }>(
      `
        insert into purchase_orders (tenant_id, supplier_id, display_number, status, notes)
        values ($1, $2, $3, 'draft', 'Created from one Operations Kit purchase need')
        on conflict (tenant_id, display_number)
        do update set supplier_id = excluded.supplier_id, updated_at = now()
        returning id
      `,
      [tenantId, supplierId, displayNumber],
    );

    await tx.query(
      `
        insert into purchase_order_lines (
          tenant_id, purchase_order_id, purchase_need_id, item_id,
          requested_quantity, quantity, unit, status, lead_time_days, expected_delivery_date
        )
        values ($1, $2, $3, $4, $5, $5, $6, 'open', $7, current_date + $7::int)
        on conflict (tenant_id, purchase_need_id)
        do update set
          purchase_order_id = excluded.purchase_order_id,
          requested_quantity = excluded.requested_quantity,
          quantity = excluded.quantity,
          lead_time_days = excluded.lead_time_days,
          expected_delivery_date = excluded.expected_delivery_date
      `,
      [tenantId, po.rows[0].id, row.id, row.item_id, orderQuantity, row.unit, leadTimeDays],
    );

    await tx.query(
      "update purchase_needs set status = 'converted_to_po', updated_at = now() where tenant_id = $1 and id = $2",
      [tenantId, row.id],
    );

    await addCaseEvent(
      tx,
      tenantId,
      "Purchase order draft created",
      `${displayNumber} is ready for Procurement Manager approval.`,
      po.rows[0].id,
      { purchaseNeedId: row.id },
    );

    return { purchaseOrderId: po.rows[0].id };
  });
}

export async function createPurchaseOrdersFromReadyNeeds(
  db: QueryExecutor,
  tenantId: string,
) {
  return withKitTransaction(db, async (tx) => {
    await tx.query(
      "update purchase_needs set status = 'ready_for_po', updated_at = now() where tenant_id = $1 and supplier_id is not null and status in ('open', 'assigned')",
      [tenantId],
    );
    const readyNeeds = await tx.query<{
      id: string;
      supplier_id: string;
      item_id: string;
      quantity: string;
      unit: string;
    }>(
      "select id, supplier_id, item_id, quantity, unit from purchase_needs where tenant_id = $1 and status = 'ready_for_po' order by created_at",
      [tenantId],
    );

    const bySupplier = new Map<string, typeof readyNeeds.rows>();
    for (const need of readyNeeds.rows) {
      const group = bySupplier.get(need.supplier_id) ?? [];
      group.push(need);
      bySupplier.set(need.supplier_id, group);
    }

    const created: string[] = [];
    for (const [supplierId, needs] of bySupplier.entries()) {
      const displayNumber = `PO-${supplierId.slice(0, 4).toUpperCase()}-${needs.length}`;
      const po = await tx.query<{ id: string }>(
        `
          insert into purchase_orders (tenant_id, supplier_id, display_number, status, notes)
          values ($1, $2, $3, 'draft', 'Created from Operations Kit purchase needs')
          on conflict (tenant_id, display_number)
          do update set updated_at = now()
          returning id
        `,
        [tenantId, supplierId, displayNumber],
      );
      created.push(po.rows[0].id);

      for (const need of needs) {
        const policy = await tx.query<{
          default_order_quantity: string;
          supplier_lead_time_days: number;
        }>(
          "select default_order_quantity, supplier_lead_time_days from items where tenant_id = $1 and id = $2",
          [tenantId, need.item_id],
        );
        const leadTimeDays = policy.rows[0]?.supplier_lead_time_days ?? 7;
        const orderQuantity = Math.max(
          Number(need.quantity),
          Number(policy.rows[0]?.default_order_quantity ?? 1),
        );
        await tx.query(
          `
            insert into purchase_order_lines (
              tenant_id, purchase_order_id, purchase_need_id, item_id,
              requested_quantity, quantity, unit, status, lead_time_days, expected_delivery_date
            )
            values ($1, $2, $3, $4, $5, $5, $6, 'open', $7, current_date + $7::int)
            on conflict (tenant_id, purchase_need_id)
            do update set
              requested_quantity = excluded.requested_quantity,
              quantity = excluded.quantity,
              lead_time_days = excluded.lead_time_days,
              expected_delivery_date = excluded.expected_delivery_date
          `,
          [
            tenantId,
            po.rows[0].id,
            need.id,
            need.item_id,
            orderQuantity,
            need.unit,
            leadTimeDays,
          ],
        );
        await tx.query(
          "update purchase_needs set status = 'converted_to_po', updated_at = now() where tenant_id = $1 and id = $2",
          [tenantId, need.id],
        );
      }
    }

    await addCaseEvent(
      tx,
      tenantId,
      "Purchase order draft created",
      `${created.length} draft purchase order(s) are ready to send.`,
      "purchase_order_create",
      { purchaseOrderIds: created },
    );

    return { purchaseOrderIds: created };
  });
}

export async function postGoodsReceiptForAcknowledgedPurchaseOrders(
  db: QueryExecutor,
  tenantId: string,
  purchaseOrderId?: string,
) {
  return withKitTransaction(db, async (tx) => {
    const orders = await tx.query<{
      id: string;
      display_number: string;
    }>(
      `
        select id, display_number
        from purchase_orders
        where tenant_id = $1 and status = 'acknowledged'
          and ($2::uuid is null or id = $2::uuid)
        order by created_at
      `,
      [tenantId, purchaseOrderId ?? null],
    );

    let receipts = 0;
    let qcChecks = 0;

    for (const order of orders.rows) {
      const receipt = await tx.query<{ id: string }>(
        `
          insert into goods_receipts (tenant_id, purchase_order_id, receipt_number, status)
          values ($1, $2, $3, 'qc_required')
          on conflict (tenant_id, purchase_order_id)
          do update set status = goods_receipts.status, updated_at = now()
          returning id
        `,
        [tenantId, order.id, `GR-${order.display_number}`],
      );
      receipts += 1;

      const lines = await tx.query<{
        id: string;
        item_id: string;
        quantity: string;
        unit: string;
      }>(
        `
          select id, item_id, quantity, unit
          from purchase_order_lines
          where tenant_id = $1 and purchase_order_id = $2 and status = 'open'
        `,
        [tenantId, order.id],
      );

      for (const line of lines.rows) {
        const receiptLine = await tx.query<{ id: string }>(
          `
            insert into goods_receipt_lines (
              tenant_id, goods_receipt_id, purchase_order_line_id, item_id,
              received_quantity, unit, status
            )
            values ($1, $2, $3, $4, $5, $6, 'qc_hold')
            on conflict (tenant_id, purchase_order_line_id)
            do update set received_quantity = excluded.received_quantity, updated_at = now()
            returning id
          `,
          [tenantId, receipt.rows[0].id, line.id, line.item_id, line.quantity, line.unit],
        );

        await tx.query(
          `
            insert into qc_checks (
              tenant_id, goods_receipt_line_id, item_id, status, inspected_quantity
            )
            values ($1, $2, $3, 'open', $4)
            on conflict (tenant_id, goods_receipt_line_id)
            do nothing
          `,
          [tenantId, receiptLine.rows[0].id, line.item_id, line.quantity],
        );
        qcChecks += 1;

        await tx.query(
          `
            insert into inventory_movements (
              tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
              location_code, source_type, source_id, idempotency_key
            )
            values ($1, $2, 'qc_hold', $5, 0, 'QC-HOLD', 'goods_receipt_line', $3, $4)
            on conflict (tenant_id, idempotency_key)
            do nothing
          `,
          [
            tenantId,
            line.item_id,
            receiptLine.rows[0].id,
            `qc-hold:${receiptLine.rows[0].id}`,
            line.quantity,
          ],
        );
      }
    }

    await addCaseEvent(
      tx,
      tenantId,
      "Goods receipt posted",
      `${receipts} receipt(s) posted and ${qcChecks} QC check(s) created. Stock remains on QC hold until accepted.`,
      "goods_receipt",
      { receipts, qcChecks },
    );

    return { receipts, qcChecks };
  });
}

export async function completeReceiptLineQc(
  db: QueryExecutor,
  tenantId: string,
  input: {
    goodsReceiptLineId: string;
    acceptedQuantity: number;
    rejectedQuantity: number;
    notes?: string;
  },
) {
  return withKitTransaction(db, async (tx) => {
    const check = await tx.query<{
      id: string;
      goods_receipt_line_id: string;
      item_id: string;
      received_quantity: string;
      inspected_quantity: string;
      sku: string;
    }>(
      `
        select qc_checks.*, goods_receipt_lines.received_quantity, items.sku
        from qc_checks
        join goods_receipt_lines on goods_receipt_lines.id = qc_checks.goods_receipt_line_id
        join items on items.id = qc_checks.item_id
        where qc_checks.tenant_id = $1 and qc_checks.goods_receipt_line_id = $2
      `,
      [tenantId, input.goodsReceiptLineId],
    );
    const row = check.rows[0];
    if (!row) return { passed: 0, accepted: 0, rejected: 0 };

    const received = Number(row.received_quantity);
    const accepted = Math.max(input.acceptedQuantity, 0);
    const rejected = Math.max(input.rejectedQuantity, 0);
    if (accepted + rejected > received) {
      throw new Error("Accepted plus rejected quantity cannot exceed received quantity.");
    }

    const result =
      rejected > 0 && accepted > 0 ? "failed" : rejected > 0 ? "failed" : "passed";
    const lineStatus =
      rejected > 0 && accepted > 0 ? "accepted" : rejected > 0 ? "rejected" : "accepted";

    await tx.query(
      `
        update qc_checks
        set status = $3, result = $4, inspected_quantity = $5, notes = $6, completed_at = now()
        where tenant_id = $1 and id = $2
      `,
      [
        tenantId,
        row.id,
        result === "passed" ? "passed" : "failed",
        result,
        accepted + rejected,
        input.notes ?? null,
      ],
    );
    await tx.query(
      `
        update goods_receipt_lines
        set status = $3,
            accepted_quantity = $4,
            rejected_quantity = $5,
            updated_at = now()
        where tenant_id = $1 and id = $2
      `,
      [tenantId, row.goods_receipt_line_id, lineStatus, accepted, rejected],
    );

    await tx.query(
      `
        insert into inventory_movements (
          tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
          location_code, source_type, source_id, idempotency_key
        )
        values ($1, $2, 'qc_hold', $3, 0, 'QC-HOLD', 'goods_receipt_line', $4, $5)
        on conflict (tenant_id, idempotency_key)
        do nothing
      `,
      [
        tenantId,
        row.item_id,
        -received,
        row.goods_receipt_line_id,
        `qc-release:${row.goods_receipt_line_id}`,
      ],
    );

    if (accepted > 0) {
      await tx.query(
        `
          insert into warehouse_tasks (
            tenant_id, task_type, status, item_id, quantity, source_type, source_id, title
          )
          values ($1, 'putaway', 'open', $2, $3, 'goods_receipt_line', $4, $5)
          on conflict (tenant_id, task_type, source_type, source_id, item_id)
          do nothing
        `,
        [
          tenantId,
          row.item_id,
          accepted,
          row.goods_receipt_line_id,
          `Put away ${accepted} x ${row.sku} after QC`,
        ],
      );
      await tx.query(
        `
          insert into inventory_movements (
            tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
            location_code, source_type, source_id, idempotency_key
          )
          values ($1, $2, 'putaway', $3, 0, 'MAIN', 'qc_check', $4, $5)
          on conflict (tenant_id, idempotency_key)
          do nothing
        `,
        [
          tenantId,
          row.item_id,
          accepted,
          row.id,
          `putaway:${row.id}`,
        ],
      );
    }

    if (rejected > 0) {
      await tx.query(
        `
          insert into inventory_movements (
            tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
            location_code, source_type, source_id, idempotency_key
          )
          values ($1, $2, 'quarantine', $3, 0, 'QUARANTINE', 'qc_check', $4, $5)
          on conflict (tenant_id, idempotency_key)
          do nothing
        `,
        [tenantId, row.item_id, rejected, row.id, `quarantine:${row.id}`],
      );
    }

    await tx.query(
      `
        update goods_receipts
        set status = 'putaway_pending', updated_at = now()
        where tenant_id = $1
          and id in (
            select goods_receipt_id
            from goods_receipt_lines
            where tenant_id = $1 and status = 'accepted'
          )
      `,
      [tenantId],
    );

    await addCaseEvent(
      tx,
      tenantId,
      "Receipt QC completed",
      `${row.sku}: ${accepted} accepted, ${rejected} moved to quarantine.`,
      row.id,
      { accepted, rejected },
    );

    return { passed: accepted > 0 ? 1 : 0, accepted, rejected };
  });
}

export async function passQcAndCreatePutaway(db: QueryExecutor, tenantId: string) {
  return withKitTransaction(db, async (tx) => {
    const checks = await tx.query<{
      goods_receipt_line_id: string;
      inspected_quantity: string;
    }>(
      `
        select goods_receipt_line_id, inspected_quantity
        from qc_checks
        where tenant_id = $1 and status in ('open', 'in_progress')
        order by created_at
      `,
      [tenantId],
    );

    let passed = 0;
    for (const check of checks.rows) {
      const result = await completeReceiptLineQc(tx, tenantId, {
        goodsReceiptLineId: check.goods_receipt_line_id,
        acceptedQuantity: Number(check.inspected_quantity ?? 0),
        rejectedQuantity: 0,
      });
      passed += result.passed;
    }

    return { passed };
  });
}

export async function completeProductionOrder(
  db: QueryExecutor,
  tenantId: string,
  productionOrderId?: string,
) {
  return withKitTransaction(db, async (tx) => {
    const order = await tx.query<{
      id: string;
      item_id: string;
      display_number: string;
      quantity: string;
      qc_required_after_production: boolean;
    }>(
      `
        select production_orders.id, production_orders.item_id, production_orders.display_number,
          production_orders.quantity, items.qc_required_after_production
        from production_orders
        join items on items.id = production_orders.item_id
        where production_orders.tenant_id = $1 and production_orders.status in ('ready', 'in_progress', 'approved')
          and ($2::uuid is null or production_orders.id = $2::uuid)
        order by production_orders.created_at desc
        limit 1
      `,
      [tenantId, productionOrderId ?? null],
    );
    if (!order.rows[0]) return { productionOrderId: null, componentsConsumed: 0 };

    const productionOrder = order.rows[0];
    const components = await tx.query<{
      id: string;
      item_id: string;
      required_quantity: string;
    }>(
      `
        select id, item_id, required_quantity
        from production_components
        where tenant_id = $1 and production_order_id = $2
      `,
      [tenantId, productionOrder.id],
    );

    for (const component of components.rows) {
      await tx.query(
        `
          insert into inventory_movements (
            tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
            location_code, source_type, source_id, idempotency_key
          )
          values ($1, $2, 'consume', $3, 0, 'PRODUCTION', 'production_order', $4, $5)
          on conflict (tenant_id, idempotency_key)
          do nothing
        `,
        [
          tenantId,
          component.item_id,
          -Number(component.required_quantity),
          productionOrder.id,
          `consume:${productionOrder.id}:${component.item_id}`,
        ],
      );
      await tx.query(
        `
          update production_components
          set status = 'consumed', picked_quantity = required_quantity
          where tenant_id = $1 and id = $2
        `,
        [tenantId, component.id],
      );
    }

    await tx.query(
      `
        insert into inventory_movements (
          tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
          location_code, source_type, source_id, idempotency_key
        )
        values ($1, $2, 'produce', $3, 0, $6, 'production_order', $4, $5)
        on conflict (tenant_id, idempotency_key)
        do nothing
      `,
      [
        tenantId,
        productionOrder.item_id,
        productionOrder.quantity,
        productionOrder.id,
        `produce:${productionOrder.id}`,
        productionOrder.qc_required_after_production ? "QC-HOLD" : "MAIN",
      ],
    );
    await tx.query(
      `
        update production_orders
        set status = $3,
            qc_status = $4,
            accepted_quantity = case when $5::boolean then accepted_quantity else quantity end,
            completed_at = now(),
            updated_at = now()
        where tenant_id = $1 and id = $2
      `,
      [
        tenantId,
        productionOrder.id,
        productionOrder.qc_required_after_production ? "qc_hold" : "completed",
        productionOrder.qc_required_after_production ? "open" : "not_required",
        productionOrder.qc_required_after_production,
      ],
    );
    await tx.query(
      "update warehouse_tasks set status = 'done', updated_at = now() where tenant_id = $1 and source_type = 'production_order' and source_id = $2",
      [tenantId, productionOrder.id],
    );

    await addCaseEvent(
      tx,
      tenantId,
      "Production completed",
      productionOrder.qc_required_after_production
        ? `${productionOrder.display_number} consumed components and moved finished output to production QC.`
        : `${productionOrder.display_number} consumed components and posted finished output to inventory.`,
      productionOrder.id,
      { productionOrderId: productionOrder.id },
    );

    return {
      productionOrderId: productionOrder.id,
      componentsConsumed: components.rows.length,
    };
  });
}

export async function completeProductionQc(
  db: QueryExecutor,
  tenantId: string,
  input: {
    productionOrderId: string;
    acceptedQuantity: number;
    rejectedQuantity: number;
    releaseDestination: "inventory" | "logistics";
  },
) {
  return withKitTransaction(db, async (tx) => {
    const order = await tx.query<{
      id: string;
      item_id: string;
      display_number: string;
      quantity: string;
      sku: string;
    }>(
      `
        select production_orders.id, production_orders.item_id, production_orders.display_number,
          production_orders.quantity, items.sku
        from production_orders
        join items on items.id = production_orders.item_id
        where production_orders.tenant_id = $1 and production_orders.id = $2
      `,
      [tenantId, input.productionOrderId],
    );
    const productionOrder = order.rows[0];
    if (!productionOrder) return { productionOrderId: null, accepted: 0, rejected: 0 };

    const quantity = Number(productionOrder.quantity);
    const accepted = Math.max(input.acceptedQuantity, 0);
    const rejected = Math.max(input.rejectedQuantity, 0);
    if (accepted + rejected > quantity) {
      throw new Error("Accepted plus rejected quantity cannot exceed produced quantity.");
    }

    await tx.query(
      `
        insert into inventory_movements (
          tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
          location_code, source_type, source_id, idempotency_key
        )
        values ($1, $2, 'qc_hold', $3, 0, 'QC-HOLD', 'production_order', $4, $5)
        on conflict (tenant_id, idempotency_key)
        do nothing
      `,
      [
        tenantId,
        productionOrder.item_id,
        -quantity,
        productionOrder.id,
        `production-qc-release:${productionOrder.id}`,
      ],
    );

    if (accepted > 0) {
      await tx.query(
        `
          insert into inventory_movements (
            tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
            location_code, source_type, source_id, idempotency_key
          )
          values ($1, $2, 'putaway', $3, 0, $6, 'production_order', $4, $5)
          on conflict (tenant_id, idempotency_key)
          do nothing
        `,
        [
          tenantId,
          productionOrder.item_id,
          accepted,
          productionOrder.id,
          `production-putaway:${productionOrder.id}`,
          input.releaseDestination === "logistics" ? "LOGISTICS-STAGE" : "MAIN",
        ],
      );
    }

    if (rejected > 0) {
      await tx.query(
        `
          insert into inventory_movements (
            tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
            location_code, source_type, source_id, idempotency_key
          )
          values ($1, $2, 'quarantine', $3, 0, 'QUARANTINE', 'production_order', $4, $5)
          on conflict (tenant_id, idempotency_key)
          do nothing
        `,
        [
          tenantId,
          productionOrder.item_id,
          rejected,
          productionOrder.id,
          `production-quarantine:${productionOrder.id}`,
        ],
      );
    }

    await tx.query(
      `
        update production_orders
        set status = 'qc_complete',
            qc_status = $3,
            accepted_quantity = $4,
            rejected_quantity = $5,
            release_destination = $6,
            updated_at = now()
        where tenant_id = $1 and id = $2
      `,
      [
        tenantId,
        productionOrder.id,
        rejected > 0 && accepted > 0 ? "partial" : rejected > 0 ? "failed" : "passed",
        accepted,
        rejected,
        input.releaseDestination,
      ],
    );

    if (input.releaseDestination === "logistics" && accepted > 0) {
      await tx.query(
        `
          insert into warehouse_tasks (
            tenant_id, task_type, status, item_id, quantity, source_type, source_id, title
          )
          values ($1, 'pack', 'open', $2, $3, 'production_order', $4, $5)
          on conflict (tenant_id, task_type, source_type, source_id, item_id)
          do nothing
        `,
        [
          tenantId,
          productionOrder.item_id,
          accepted,
          productionOrder.id,
          `Pack ${accepted} x ${productionOrder.sku} from production output`,
        ],
      );
    }

    await addCaseEvent(
      tx,
      tenantId,
      "Production QC completed",
      `${productionOrder.display_number}: ${accepted} accepted, ${rejected} quarantined.`,
      productionOrder.id,
      { accepted, rejected, releaseDestination: input.releaseDestination },
    );

    return { productionOrderId: productionOrder.id, accepted, rejected };
  });
}

export async function transitionPurchaseOrder(
  db: QueryExecutor,
  tenantId: string,
  purchaseOrderId: string,
  transition: "pending_approval" | "approved" | "sent" | "acknowledged" | "cancelled",
) {
  const field =
    transition === "pending_approval"
      ? "submitted_for_approval_at"
      : transition === "approved"
        ? "approved_at"
        : transition === "sent"
          ? "sent_at"
          : transition === "acknowledged"
            ? "acknowledged_at"
            : "cancelled_at";
  await db.query(
    `update purchase_orders set status = $3, ${field} = now(), updated_at = now() where tenant_id = $1 and id = $2`,
    [tenantId, purchaseOrderId, transition],
  );
}

export async function loadDashboard(db: QueryExecutor, tenantId: string) {
  const result = await db.query<DashboardSummary>(
    `
      select
        (select count(*)::int from items where tenant_id = $1) as "items",
        (select count(*)::int from boms where tenant_id = $1 and is_active) as "activeBoms",
        (select count(*)::int from purchase_needs where tenant_id = $1 and status in ('open', 'assigned', 'ready_for_po')) as "purchaseNeedsOpen",
        (select count(*)::int from production_needs where tenant_id = $1 and status in ('open', 'planned')) as "productionNeedsOpen",
        (select count(*)::int from purchase_orders where tenant_id = $1 and status = 'draft') as "draftPurchaseOrders",
        (select count(*)::int from purchase_orders where tenant_id = $1 and status = 'sent') as "sentPurchaseOrders",
        (select count(*)::int from purchase_orders where tenant_id = $1 and status = 'acknowledged') as "acknowledgedPurchaseOrders",
        (select count(*)::int from goods_receipts where tenant_id = $1 and status <> 'closed') as "openReceipts",
        (select count(*)::int from qc_checks where tenant_id = $1 and status in ('open', 'in_progress')) as "openQcChecks",
        (select count(*)::int from warehouse_tasks where tenant_id = $1 and status in ('open', 'assigned', 'in_progress')) as "openWarehouseTasks",
        (select count(*)::int from operation_cases where tenant_id = $1 and status <> 'closed') as "openCases"
    `,
    [tenantId],
  );
  const latest = await db.query<DashboardSummary["latestMrpRun"]>(
    "select id, status, scenario_mode, created_at from mrp_runs where tenant_id = $1 order by created_at desc limit 1",
    [tenantId],
  );

  return {
    ...result.rows[0],
    latestMrpRun: latest.rows[0] ?? null,
  };
}

export async function loadItems(db: QueryExecutor, tenantId: string) {
  return (
    await db.query<ItemRow>(
      `
        with balances as (
          select
            item_id,
            coalesce(sum(quantity_delta - reserved_delta) filter (where location_code = 'MAIN'), 0) as available_quantity,
            coalesce(sum(reserved_delta) filter (where location_code = 'MAIN'), 0) as reserved_quantity
          from inventory_movements
          where tenant_id = $1
          group by item_id
        )
        select items.*, coalesce(balances.available_quantity, 0) as available_quantity, coalesce(balances.reserved_quantity, 0) as reserved_quantity
        from items
        left join balances on balances.item_id = items.id
        where items.tenant_id = $1
        order by items.sku
      `,
      [tenantId],
    )
  ).rows;
}

export async function createOperationsItem(
  db: QueryExecutor,
  tenantId: string,
  input: {
    sku: string;
    title: string;
    itemType: string;
    replenishmentPolicy: string;
    minInventoryQuantity: number;
    defaultProductionQuantity: number;
    defaultOrderQuantity: number;
    supplierLeadTimeDays: number;
  },
) {
  const sku = input.sku.trim();
  const title = input.title.trim();
  const allowedItemTypes = new Set(["product", "assembly", "component", "raw_material"]);
  const replenishmentPolicy = input.replenishmentPolicy;

  if (!sku || !title) {
    throw new Error("SKU and title are required to create an operations product.");
  }
  if (!allowedItemTypes.has(input.itemType)) {
    throw new Error("Unsupported product type.");
  }

  const isSellable = input.itemType === "product" || input.itemType === "assembly";
  const isPurchasable = replenishmentPolicy === "buy";
  const isProducible = replenishmentPolicy === "make";

  const result = await db.query<{ id: string }>(
    `
      insert into items (
        tenant_id, sku, title, item_type, unit, is_sellable,
        is_purchasable, is_producible, min_inventory_quantity,
        default_production_quantity, default_order_quantity,
        supplier_lead_time_days, qc_required_after_purchase,
        qc_required_after_production, product_status
      )
      values (
        $1, $2, $3, $4, 'pcs', $5,
        $6, $7, $8,
        $9, $10,
        $11, $6, $7, 'OPERATIONAL'
      )
      on conflict (tenant_id, sku)
      do update set
        title = excluded.title,
        item_type = excluded.item_type,
        is_sellable = excluded.is_sellable,
        is_purchasable = excluded.is_purchasable,
        is_producible = excluded.is_producible,
        min_inventory_quantity = excluded.min_inventory_quantity,
        default_production_quantity = excluded.default_production_quantity,
        default_order_quantity = excluded.default_order_quantity,
        supplier_lead_time_days = excluded.supplier_lead_time_days,
        qc_required_after_purchase = excluded.qc_required_after_purchase,
        qc_required_after_production = excluded.qc_required_after_production,
        is_active = true,
        updated_at = now()
      returning id
    `,
    [
      tenantId,
      sku,
      title,
      input.itemType,
      isSellable,
      isPurchasable,
      isProducible,
      Math.max(Number(input.minInventoryQuantity) || 0, 0),
      Math.max(Number(input.defaultProductionQuantity) || 1, 1),
      Math.max(Number(input.defaultOrderQuantity) || 1, 1),
      Math.max(Number(input.supplierLeadTimeDays) || 0, 0),
    ],
  );

  return { itemId: result.rows[0].id, sku, title };
}

export async function loadItemDetail(db: QueryExecutor, tenantId: string, itemId: string) {
  const item = await db.query(
    `
      with balances as (
        select
          item_id,
          coalesce(sum(quantity_delta - reserved_delta) filter (where location_code = 'MAIN'), 0) as available_quantity,
          coalesce(sum(reserved_delta) filter (where location_code = 'MAIN'), 0) as reserved_quantity
        from inventory_movements
        where tenant_id = $1
        group by item_id
      )
      select items.*, coalesce(balances.available_quantity, 0) as available_quantity, coalesce(balances.reserved_quantity, 0) as reserved_quantity
      from items
      left join balances on balances.item_id = items.id
      where items.tenant_id = $1 and items.id = $2
    `,
    [tenantId, itemId],
  );
  const bom = await db.query(
    `
      select boms.id, boms.version, boms.is_active,
        component.id as component_id,
        component.sku as component_sku,
        component.title as component_title,
        bom_lines.quantity,
        bom_lines.unit
      from boms
      left join bom_lines on bom_lines.bom_id = boms.id
      left join items component on component.id = bom_lines.component_item_id
      where boms.tenant_id = $1 and boms.parent_item_id = $2
      order by component.sku
    `,
    [tenantId, itemId],
  );
  const suppliers = await db.query(
    `
      select suppliers.*, supplier_items.is_preferred
      from supplier_items
      join suppliers on suppliers.id = supplier_items.supplier_id
      where supplier_items.tenant_id = $1 and supplier_items.item_id = $2
      order by supplier_items.is_preferred desc, suppliers.name
    `,
    [tenantId, itemId],
  );
  const components = await db.query(
    `
      select id, sku, title
      from items
      where tenant_id = $1 and item_type in ('component', 'raw_material')
      order by sku
    `,
    [tenantId],
  );

  return {
    item: item.rows[0] ?? null,
    bomLines: bom.rows,
    suppliers: suppliers.rows,
    availableComponents: components.rows,
  };
}

export async function updateItemOperationsProperties(
  db: QueryExecutor,
  tenantId: string,
  input: {
    itemId: string;
    itemType: string;
    isSellable: boolean;
    isPurchasable: boolean;
    isProducible: boolean;
    minInventoryQuantity: number;
    defaultProductionQuantity: number;
    defaultOrderQuantity: number;
    supplierLeadTimeDays: number;
    qcRequiredAfterPurchase: boolean;
    qcRequiredAfterProduction: boolean;
  },
) {
  await db.query(
    `
      update items
      set item_type = $3,
          is_sellable = $4,
          is_purchasable = $5,
          is_producible = $6,
          min_inventory_quantity = $7,
          default_production_quantity = $8,
          default_order_quantity = $9,
          supplier_lead_time_days = $10,
          qc_required_after_purchase = $11,
          qc_required_after_production = $12,
          updated_at = now()
      where tenant_id = $1 and id = $2
    `,
    [
      tenantId,
      input.itemId,
      input.itemType,
      input.isSellable,
      input.isPurchasable,
      input.isProducible,
      input.minInventoryQuantity,
      input.defaultProductionQuantity,
      input.defaultOrderQuantity,
      input.supplierLeadTimeDays,
      input.qcRequiredAfterPurchase,
      input.qcRequiredAfterProduction,
    ],
  );
}

export async function addBomLineToItem(
  db: QueryExecutor,
  tenantId: string,
  input: {
    parentItemId: string;
    componentItemId: string;
    quantity: number;
  },
) {
  return withKitTransaction(db, async (tx) => {
    const parent = await tx.query<{ is_producible: boolean }>(
      "select is_producible from items where tenant_id = $1 and id = $2",
      [tenantId, input.parentItemId],
    );
    if (!parent.rows[0]?.is_producible) {
      throw new Error("Only producible items can have an active BOM.");
    }

    const bom = await tx.query<{ id: string }>(
      `
        insert into boms (tenant_id, parent_item_id, version, is_active)
        values ($1, $2, '1', true)
        on conflict (tenant_id, parent_item_id, version)
        do update set is_active = true, updated_at = now()
        returning id
      `,
      [tenantId, input.parentItemId],
    );

    await tx.query(
      `
        insert into bom_lines (tenant_id, bom_id, component_item_id, quantity, unit)
        values ($1, $2, $3, $4, 'pcs')
        on conflict (tenant_id, bom_id, component_item_id)
        do update set quantity = excluded.quantity, unit = 'pcs'
      `,
      [tenantId, bom.rows[0].id, input.componentItemId, input.quantity],
    );
  });
}

export async function savePreferredSupplierForItem(
  db: QueryExecutor,
  tenantId: string,
  input: {
    itemId: string;
    supplierName: string;
    supplierEmail: string;
  },
) {
  return withKitTransaction(db, async (tx) => {
    if (!input.supplierName.trim()) {
      throw new Error("Supplier name is required.");
    }

    const supplierId = await upsertSupplier(
      tx,
      tenantId,
      input.supplierName.trim(),
      input.supplierEmail.trim(),
    );
    await linkPreferredSupplier(tx, tenantId, supplierId, input.itemId);
    await addCaseEvent(
      tx,
      tenantId,
      "Preferred supplier updated",
      `${input.supplierName.trim()} is now preferred for item ${input.itemId}.`,
      input.itemId,
      { supplierId },
    );

    return { supplierId };
  });
}

export async function loadOperationsOrdersList(db: QueryExecutor, tenantId: string) {
  const rows = (
    await db.query(
      `
        select operations_orders.*, count(operations_order_lines.id)::int as line_count,
          string_agg(coalesce(operations_order_lines.sku, items.sku), ', ' order by coalesce(operations_order_lines.sku, items.sku)) as skus
        from operations_orders
        left join operations_order_lines on operations_order_lines.operations_order_id = operations_orders.id
        left join items on items.id = operations_order_lines.item_id
        where operations_orders.tenant_id = $1
        group by operations_orders.id
        order by operations_orders.processed_at desc nulls last, operations_orders.created_at desc
      `,
      [tenantId],
    )
  ).rows;
  return rows.map((row) => decryptOrderRow(row as CustomerEncryptedRow));
}

export async function loadOperationsOrderLinesList(db: QueryExecutor, tenantId: string) {
  return (
    await db.query(
      `
        select
          operations_order_lines.*,
          operations_orders.order_name,
          operations_orders.status as order_status,
          operations_orders.processed_at,
          operations_orders.financial_status,
          operations_orders.fulfillment_status,
          items.sku as item_sku,
          items.title as item_title,
          items.item_type,
          items.is_sellable,
          items.is_purchasable,
          items.is_producible,
          items.default_order_quantity,
          items.default_production_quantity,
          items.min_inventory_quantity
        from operations_order_lines
        join operations_orders on operations_orders.id = operations_order_lines.operations_order_id
        join items on items.id = operations_order_lines.item_id
        where operations_order_lines.tenant_id = $1
        order by operations_orders.processed_at desc nulls last,
          operations_orders.created_at desc,
          coalesce(operations_order_lines.sku, items.sku)
      `,
      [tenantId],
    )
  ).rows;
}

export async function loadOperationsOrderLineDetail(
  db: QueryExecutor,
  tenantId: string,
  lineId: string,
) {
  const line = await db.query(
    `
      with balances as (
        select
          item_id,
          coalesce(sum(quantity_delta - reserved_delta) filter (where location_code = 'MAIN'), 0) as available_quantity,
          coalesce(sum(quantity_delta) filter (where location_code = 'QC-HOLD'), 0) as qc_hold_quantity,
          coalesce(sum(quantity_delta) filter (where location_code = 'QUARANTINE'), 0) as quarantine_quantity
        from inventory_movements
        where tenant_id = $1
        group by item_id
      )
      select
        operations_order_lines.*,
        operations_orders.order_name,
        operations_orders.status as order_status,
        operations_orders.financial_status,
        operations_orders.fulfillment_status,
        operations_orders.processed_at,
        items.sku as item_sku,
        items.title as item_title,
        items.item_type,
        items.is_sellable,
        items.is_purchasable,
        items.is_producible,
        items.min_inventory_quantity,
        items.default_order_quantity,
        items.default_production_quantity,
        items.supplier_lead_time_days,
        items.qc_required_after_purchase,
        items.qc_required_after_production,
        coalesce(balances.available_quantity, 0) as available_quantity,
        coalesce(balances.qc_hold_quantity, 0) as qc_hold_quantity,
        coalesce(balances.quarantine_quantity, 0) as quarantine_quantity
      from operations_order_lines
      join operations_orders on operations_orders.id = operations_order_lines.operations_order_id
      join items on items.id = operations_order_lines.item_id
      left join balances on balances.item_id = items.id
      where operations_order_lines.tenant_id = $1 and operations_order_lines.id = $2
    `,
    [tenantId, lineId],
  );

  return { line: line.rows[0] ?? null };
}

export async function loadSellableItemsForOrderEntry(
  db: QueryExecutor,
  tenantId: string,
) {
  return (
    await db.query(
      `
        select id, sku, title, is_producible, is_purchasable
        from items
        where tenant_id = $1 and is_sellable and is_active
        order by sku
      `,
      [tenantId],
    )
  ).rows;
}

export async function createOperationsOrderEntry(
  db: QueryExecutor,
  tenantId: string,
  input: {
    orderName: string;
    customerName: string;
    customerEmail: string;
    itemId: string;
    quantity: number;
  },
) {
  return withKitTransaction(db, async (tx) => {
    if (!input.itemId) throw new Error("Select a sellable item.");
    const privacy = await loadPrivacySettings(tx, tenantId);
    const quantity = Math.max(input.quantity, 1);
    const orderName =
      input.orderName.trim() || `INTAKE-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;

    const item = await tx.query<{ sku: string; title: string }>(
      "select sku, title from items where tenant_id = $1 and id = $2 and is_sellable",
      [tenantId, input.itemId],
    );
    if (!item.rows[0]) throw new Error("Selected item is not sellable.");

    const order = await tx.query<{ id: string }>(
      `
        insert into operations_orders (
          tenant_id, order_name, status, customer_name, customer_email,
          customer_name_encrypted, customer_email_encrypted, customer_lookup_hash,
          customer_data_retention_until, processed_at
        )
        values ($1, $2, 'open', null, null, $3, $4, $5, now() + ($6::int * interval '1 day'), now())
        on conflict (tenant_id, order_name)
        do update set
          customer_name = null,
          customer_email = null,
          customer_name_encrypted = excluded.customer_name_encrypted,
          customer_email_encrypted = excluded.customer_email_encrypted,
          customer_lookup_hash = excluded.customer_lookup_hash,
          customer_data_redacted_at = null,
          customer_data_retention_until = excluded.customer_data_retention_until,
          status = 'open',
          updated_at = now()
        returning id
      `,
      [
        tenantId,
        orderName,
        encryptCustomerData(input.customerName),
        encryptCustomerData(input.customerEmail),
        hashCustomerLookup(input.customerEmail, input.customerName),
        privacy.customer_data_retention_days,
      ],
    );

    await tx.query(
      `
        insert into operations_order_lines (
          tenant_id, operations_order_id, item_id, quantity, unit, sku, title, supply_status
        )
        values ($1, $2, $3, $4, 'pcs', $5, $6, 'unchecked')
        on conflict (tenant_id, operations_order_id, item_id)
        do update set quantity = excluded.quantity, sku = excluded.sku, title = excluded.title
      `,
      [
        tenantId,
        order.rows[0].id,
        input.itemId,
        quantity,
        item.rows[0].sku,
        item.rows[0].title,
      ],
    );

    await addCaseEvent(
      tx,
      tenantId,
      "Operations order entered",
      `${orderName} was entered for ${quantity} x ${item.rows[0].sku}.`,
      order.rows[0].id,
      { orderName, quantity },
    );

    return { orderId: order.rows[0].id, orderName };
  });
}

export async function consolidateOpenOrdersByCustomer(
  db: QueryExecutor,
  tenantId: string,
) {
  return withKitTransaction(db, async (tx) => {
    const privacy = await loadPrivacySettings(tx, tenantId);
    const customers = await tx.query<{
      customer_key: string;
      customer_name_encrypted: string | null;
      customer_email_encrypted: string | null;
      order_count: number;
    }>(
      `
        select
          coalesce(customer_lookup_hash, 'unknown-customer') as customer_key,
          max(customer_name_encrypted) as customer_name_encrypted,
          max(customer_email_encrypted) as customer_email_encrypted,
          count(*)::int as order_count
        from operations_orders
        where tenant_id = $1 and status = 'open'
        group by coalesce(customer_lookup_hash, 'unknown-customer')
        having count(*) > 1
      `,
      [tenantId],
    );

    let merged = 0;
    for (const customer of customers.rows) {
      const orderName = `MERGED-${customer.customer_key.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 24)}`;
      const mergedOrder = await tx.query<{ id: string }>(
        `
          insert into operations_orders (
            tenant_id, order_name, status, customer_name, customer_email,
            customer_name_encrypted, customer_email_encrypted, customer_lookup_hash,
            customer_data_retention_until
          )
          values ($1, $2, 'open', null, null, $3, $4, $5, now() + ($6::int * interval '1 day'))
          on conflict (tenant_id, order_name)
          do update set
            customer_name = null,
            customer_email = null,
            customer_name_encrypted = excluded.customer_name_encrypted,
            customer_email_encrypted = excluded.customer_email_encrypted,
            customer_lookup_hash = excluded.customer_lookup_hash,
            customer_data_retention_until = excluded.customer_data_retention_until,
            updated_at = now()
          returning id
        `,
        [
          tenantId,
          orderName,
          customer.customer_name_encrypted,
          customer.customer_email_encrypted,
          customer.customer_key,
          privacy.customer_data_retention_days,
        ],
      );

      const lines = await tx.query<{
        item_id: string;
        quantity: string;
        unit: string;
        sku: string | null;
        title: string | null;
      }>(
        `
          select
            operations_order_lines.item_id,
            sum(operations_order_lines.quantity) as quantity,
            max(operations_order_lines.unit) as unit,
            max(operations_order_lines.sku) as sku,
            max(operations_order_lines.title) as title
          from operations_order_lines
          join operations_orders on operations_orders.id = operations_order_lines.operations_order_id
          where operations_orders.tenant_id = $1
            and operations_orders.status = 'open'
            and operations_orders.order_name <> $2
            and coalesce(operations_orders.customer_lookup_hash, 'unknown-customer') = $3
          group by operations_order_lines.item_id
        `,
        [tenantId, orderName, customer.customer_key],
      );

      for (const line of lines.rows) {
        await tx.query(
          `
            insert into operations_order_lines (
              tenant_id, operations_order_id, item_id, quantity, unit, sku, title, supply_status
            )
            values ($1, $2, $3, $4, $5, $6, $7, 'unchecked')
            on conflict (tenant_id, operations_order_id, item_id)
            do update set quantity = excluded.quantity, sku = excluded.sku, title = excluded.title
          `,
          [
            tenantId,
            mergedOrder.rows[0].id,
            line.item_id,
            line.quantity,
            line.unit,
            line.sku,
            line.title,
          ],
        );
      }

      await tx.query(
        `
          update operations_orders
          set status = 'planned', updated_at = now()
          where tenant_id = $1
            and order_name <> $2
            and status = 'open'
            and coalesce(customer_lookup_hash, 'unknown-customer') = $3
        `,
        [tenantId, orderName, customer.customer_key],
      );
      merged += 1;
    }

    await addCaseEvent(
      tx,
      tenantId,
      "Customer orders consolidated",
      `${merged} customer order group(s) consolidated for operations planning.`,
      "order_consolidation",
      { merged },
    );

    return { merged };
  });
}

export async function loadOperationsOrderDetail(
  db: QueryExecutor,
  tenantId: string,
  orderId: string,
) {
  const order = await db.query(
    "select * from operations_orders where tenant_id = $1 and id = $2",
    [tenantId, orderId],
  );
  const lines = await db.query(
    `
      select operations_order_lines.*, items.sku as item_sku, items.title as item_title,
        items.item_type, items.is_sellable, items.is_purchasable, items.is_producible,
        items.min_inventory_quantity, items.default_order_quantity, items.default_production_quantity
      from operations_order_lines
      join items on items.id = operations_order_lines.item_id
      where operations_order_lines.tenant_id = $1 and operations_order_lines.operations_order_id = $2
      order by coalesce(operations_order_lines.sku, items.sku)
    `,
    [tenantId, orderId],
  );
  return {
    order: order.rows[0] ? decryptOrderRow(order.rows[0] as CustomerEncryptedRow) : null,
    lines: lines.rows,
  };
}

export async function redactOperationsOrderCustomerData(
  db: QueryExecutor,
  tenantId: string,
  orderId: string,
) {
  await db.query(
    `
      update operations_orders
      set customer_name = null,
          customer_email = null,
          customer_name_encrypted = null,
          customer_email_encrypted = null,
          customer_lookup_hash = null,
          customer_data_redacted_at = now(),
          updated_at = now()
      where tenant_id = $1 and id = $2
    `,
    [tenantId, orderId],
  );
}

export async function loadPrivacySettings(db: QueryExecutor, tenantId: string) {
  const result = await db.query<{
    customer_data_retention_days: number;
    encrypt_customer_data: boolean;
  }>(
    `
      insert into privacy_settings (tenant_id)
      values ($1)
      on conflict (tenant_id)
      do update set tenant_id = excluded.tenant_id
      returning customer_data_retention_days, encrypt_customer_data
    `,
    [tenantId],
  );

  return result.rows[0];
}

export async function updatePrivacySettings(
  db: QueryExecutor,
  tenantId: string,
  input: { customerDataRetentionDays: number },
) {
  const days = Math.max(Math.round(input.customerDataRetentionDays), 1);
  await db.query(
    `
      insert into privacy_settings (tenant_id, customer_data_retention_days, encrypt_customer_data)
      values ($1, $2, true)
      on conflict (tenant_id)
      do update set
        customer_data_retention_days = excluded.customer_data_retention_days,
        encrypt_customer_data = true,
        updated_at = now()
    `,
    [tenantId, days],
  );
}

export async function redactExpiredCustomerData(db: QueryExecutor, tenantId: string) {
  const result = await db.query<{ id: string }>(
    `
      update operations_orders
      set customer_name = null,
          customer_email = null,
          customer_name_encrypted = null,
          customer_email_encrypted = null,
          customer_lookup_hash = null,
          customer_data_redacted_at = now(),
          updated_at = now()
      where tenant_id = $1
        and customer_data_redacted_at is null
        and customer_data_retention_until is not null
        and customer_data_retention_until <= now()
      returning id
    `,
    [tenantId],
  );

  return { redacted: result.rows.length };
}

export async function loadBoms(db: QueryExecutor, tenantId: string) {
  return (
    await db.query(
      `
        select boms.id, boms.version, boms.is_active, parent.sku as parent_sku, parent.title as parent_title,
          parent.is_producible,
          count(bom_lines.id)::int as line_count
        from boms
        join items parent on parent.id = boms.parent_item_id
        left join bom_lines on bom_lines.bom_id = boms.id
        where boms.tenant_id = $1
        group by boms.id, parent.sku, parent.title, parent.is_producible
        order by parent.sku
      `,
      [tenantId],
    )
  ).rows;
}

export async function loadMrpRuns(db: QueryExecutor, tenantId: string) {
  return (
    await db.query(
      `
        select mrp_runs.*, count(mrp_run_lines.id)::int as line_count
        from mrp_runs
        left join mrp_run_lines on mrp_run_lines.mrp_run_id = mrp_runs.id
        where mrp_runs.tenant_id = $1
        group by mrp_runs.id
        order by mrp_runs.created_at desc
      `,
      [tenantId],
    )
  ).rows;
}

export async function loadMrpRunDetail(db: QueryExecutor, tenantId: string, mrpRunId: string) {
  const run = await db.query(
    "select * from mrp_runs where tenant_id = $1 and id = $2",
    [tenantId, mrpRunId],
  );
  const lines = await db.query(
    `
      select mrp_run_lines.*, items.sku, items.title
      from mrp_run_lines
      join items on items.id = mrp_run_lines.item_id
      where mrp_run_lines.tenant_id = $1 and mrp_run_lines.mrp_run_id = $2
      order by line_type desc, items.sku
    `,
    [tenantId, mrpRunId],
  );
  return { run: run.rows[0] ?? null, lines: lines.rows };
}

export async function loadPurchaseNeeds(db: QueryExecutor, tenantId: string) {
  return (
    await db.query(
      `
        select purchase_needs.*, items.sku, items.title, suppliers.name as supplier_name,
          preferred.name as preferred_supplier_name,
          purchase_order_lines.purchase_order_id,
          purchase_orders.display_number as purchase_order_number
        from purchase_needs
        join items on items.id = purchase_needs.item_id
        left join suppliers on suppliers.id = purchase_needs.supplier_id
        left join supplier_items on supplier_items.item_id = items.id and supplier_items.tenant_id = items.tenant_id and supplier_items.is_preferred
        left join suppliers preferred on preferred.id = supplier_items.supplier_id
        left join purchase_order_lines on purchase_order_lines.purchase_need_id = purchase_needs.id
        left join purchase_orders on purchase_orders.id = purchase_order_lines.purchase_order_id
        where purchase_needs.tenant_id = $1
        order by purchase_needs.created_at desc
      `,
      [tenantId],
    )
  ).rows;
}

export async function assignPreferredSuppliersToNeeds(db: QueryExecutor, tenantId: string) {
  await db.query(
    `
      update purchase_needs
      set supplier_id = preferred.supplier_id, status = 'assigned', updated_at = now()
      from supplier_items preferred
      where purchase_needs.tenant_id = $1
        and preferred.tenant_id = purchase_needs.tenant_id
        and preferred.item_id = purchase_needs.item_id
        and preferred.is_preferred
        and purchase_needs.supplier_id is null
    `,
    [tenantId],
  );
}

export async function loadPurchaseOrders(db: QueryExecutor, tenantId: string) {
  return (
    await db.query(
      `
        select purchase_orders.*, suppliers.name as supplier_name, count(purchase_order_lines.id)::int as line_count
        from purchase_orders
        join suppliers on suppliers.id = purchase_orders.supplier_id
        left join purchase_order_lines on purchase_order_lines.purchase_order_id = purchase_orders.id
        where purchase_orders.tenant_id = $1
        group by purchase_orders.id, suppliers.name
        order by purchase_orders.created_at desc
      `,
      [tenantId],
    )
  ).rows;
}

export async function loadReceivablePurchaseOrders(db: QueryExecutor, tenantId: string) {
  return (
    await db.query(
      `
        select purchase_orders.*, suppliers.name as supplier_name,
          count(purchase_order_lines.id)::int as line_count
        from purchase_orders
        join suppliers on suppliers.id = purchase_orders.supplier_id
        left join purchase_order_lines on purchase_order_lines.purchase_order_id = purchase_orders.id
        left join goods_receipts on goods_receipts.purchase_order_id = purchase_orders.id
        where purchase_orders.tenant_id = $1
          and purchase_orders.status = 'acknowledged'
          and goods_receipts.id is null
        group by purchase_orders.id, suppliers.name
        order by purchase_orders.acknowledged_at nulls last, purchase_orders.created_at
      `,
      [tenantId],
    )
  ).rows;
}

export async function loadPurchaseOrderDetail(
  db: QueryExecutor,
  tenantId: string,
  purchaseOrderId: string,
) {
  const order = await db.query<{
    id: string;
    display_number: string;
    supplier_name: string;
    supplier_email: string | null;
    status: string;
  }>(
    `
      select purchase_orders.*, suppliers.name as supplier_name, suppliers.email as supplier_email
      from purchase_orders
      join suppliers on suppliers.id = purchase_orders.supplier_id
      where purchase_orders.tenant_id = $1 and purchase_orders.id = $2
    `,
    [tenantId, purchaseOrderId],
  );
  const lines = await db.query<{
    id: string;
    sku: string;
    title: string;
    quantity: string;
    unit: string;
    status: string;
  }>(
    `
      select purchase_order_lines.*, items.sku, items.title
      from purchase_order_lines
      join items on items.id = purchase_order_lines.item_id
      where purchase_order_lines.tenant_id = $1 and purchase_order_lines.purchase_order_id = $2
      order by items.sku
    `,
    [tenantId, purchaseOrderId],
  );
  return { order: order.rows[0] ?? null, lines: lines.rows };
}

export async function loadProductionOrders(db: QueryExecutor, tenantId: string) {
  return (
    await db.query(
      `
        select production_orders.*, items.sku, items.title,
          count(production_components.id)::int as component_count
        from production_orders
        join items on items.id = production_orders.item_id
        left join production_components on production_components.production_order_id = production_orders.id
        where production_orders.tenant_id = $1
        group by production_orders.id, items.sku, items.title
        order by production_orders.created_at desc
      `,
      [tenantId],
    )
  ).rows;
}

export async function loadProductionNeeds(db: QueryExecutor, tenantId: string) {
  return (
    await db.query(
      `
        select production_needs.*, items.sku, items.title,
          production_orders.id as production_order_id,
          production_orders.display_number as production_order_number,
          production_orders.status as production_order_status
        from production_needs
        join items on items.id = production_needs.item_id
        left join production_orders on production_orders.production_need_id = production_needs.id
        where production_needs.tenant_id = $1
        order by production_needs.created_at desc
      `,
      [tenantId],
    )
  ).rows;
}

export async function createShippingOrdersFromOpenOperationsOrders(
  db: QueryExecutor,
  tenantId: string,
  operationsOrderId?: string,
) {
  return withKitTransaction(db, async (tx) => {
    const orders = await tx.query<{
      id: string;
      order_name: string;
    }>(
      `
        select *
        from operations_orders
        where tenant_id = $1 and status in ('open', 'planned', 'in_progress')
          and ($2::uuid is null or id = $2::uuid)
        order by processed_at nulls last, created_at
      `,
      [tenantId, operationsOrderId ?? null],
    );

    const created: string[] = [];
    for (const order of orders.rows) {
      const shipmentNumber = `SO-${order.order_name.replace(/[^a-zA-Z0-9]/g, "") || order.id.slice(0, 8)}`;
      const shipment = await tx.query<{ id: string }>(
        `
          insert into shipping_orders (
            tenant_id, operations_order_id, shipment_number, status, customer_name, customer_email
          )
          values ($1, $2, $3, 'open', null, null)
          on conflict (tenant_id, operations_order_id, shipment_number)
          do update set updated_at = now()
          returning id
        `,
        [tenantId, order.id, shipmentNumber],
      );
      created.push(shipment.rows[0].id);

      const lines = await tx.query<{
        id: string;
        item_id: string;
        quantity: string;
        unit: string;
        sku: string;
      }>(
        `
          select operations_order_lines.id, operations_order_lines.item_id,
            operations_order_lines.quantity, operations_order_lines.unit,
            coalesce(operations_order_lines.sku, items.sku) as sku
          from operations_order_lines
          join items on items.id = operations_order_lines.item_id
          where operations_order_lines.tenant_id = $1
            and operations_order_lines.operations_order_id = $2
            and operations_order_lines.supply_status <> 'cancelled'
        `,
        [tenantId, order.id],
      );

      for (const line of lines.rows) {
        await tx.query(
          `
            insert into shipping_order_lines (
              tenant_id, shipping_order_id, operations_order_line_id, item_id,
              ordered_quantity, unit, status
            )
            values ($1, $2, $3, $4, $5, $6, 'open')
            on conflict (tenant_id, shipping_order_id, operations_order_line_id)
            do update set ordered_quantity = excluded.ordered_quantity, unit = excluded.unit, updated_at = now()
          `,
          [tenantId, shipment.rows[0].id, line.id, line.item_id, line.quantity, line.unit],
        );
        await tx.query(
          `
            insert into warehouse_tasks (
              tenant_id, task_type, status, item_id, quantity, source_type, source_id, title
            )
            values ($1, 'pack', 'open', $2, $3, 'shipping_order', $4, $5)
            on conflict (tenant_id, task_type, source_type, source_id, item_id)
            do nothing
          `,
          [
            tenantId,
            line.item_id,
            line.quantity,
            shipment.rows[0].id,
            `Pack ${line.quantity} x ${line.sku} for ${shipmentNumber}`,
          ],
        );
      }

      await tx.query(
        "update operations_orders set status = 'in_progress', updated_at = now() where tenant_id = $1 and id = $2",
        [tenantId, order.id],
      );
    }

    await addCaseEvent(
      tx,
      tenantId,
      "Shipping work created",
      `${created.length} shipping order(s) are ready for logistics.`,
      "shipping_order_create",
      { shippingOrderIds: created },
    );

    return { shippingOrderIds: created };
  });
}

export async function loadShippableOperationsOrders(db: QueryExecutor, tenantId: string) {
  const rows = (
    await db.query(
      `
        select operations_orders.*, count(operations_order_lines.id)::int as line_count,
          string_agg(coalesce(operations_order_lines.sku, items.sku), ', ' order by coalesce(operations_order_lines.sku, items.sku)) as skus
        from operations_orders
        join operations_order_lines on operations_order_lines.operations_order_id = operations_orders.id
        join items on items.id = operations_order_lines.item_id
        left join shipping_orders on shipping_orders.operations_order_id = operations_orders.id
          and shipping_orders.tenant_id = operations_orders.tenant_id
          and shipping_orders.status <> 'cancelled'
        where operations_orders.tenant_id = $1
          and operations_orders.status in ('open', 'planned', 'in_progress')
          and shipping_orders.id is null
        group by operations_orders.id
        order by operations_orders.processed_at desc nulls last, operations_orders.created_at desc
      `,
      [tenantId],
    )
  ).rows;
  return rows.map((row) => decryptOrderRow(row as CustomerEncryptedRow));
}

export async function transitionShippingOrder(
  db: QueryExecutor,
  tenantId: string,
  shippingOrderId: string,
  transition: "packed" | "shipped",
) {
  return withKitTransaction(db, async (tx) => {
    const order = await tx.query<{
      id: string;
      operations_order_id: string;
      shipment_number: string;
    }>(
      "select id, operations_order_id, shipment_number from shipping_orders where tenant_id = $1 and id = $2",
      [tenantId, shippingOrderId],
    );
    if (!order.rows[0]) return { shippingOrderId: null };

    const lines = await tx.query<{
      id: string;
      item_id: string;
      ordered_quantity: string;
    }>(
      "select id, item_id, ordered_quantity from shipping_order_lines where tenant_id = $1 and shipping_order_id = $2",
      [tenantId, shippingOrderId],
    );

    if (transition === "packed") {
      for (const line of lines.rows) {
        await tx.query(
          `
            insert into inventory_movements (
              tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
              location_code, source_type, source_id, idempotency_key
            )
            values ($1, $2, 'pack', 0, $3, 'MAIN', 'shipping_order_line', $4, $5)
            on conflict (tenant_id, idempotency_key)
            do nothing
          `,
          [
            tenantId,
            line.item_id,
            Number(line.ordered_quantity),
            line.id,
            `pack:${line.id}`,
          ],
        );
      }
      await tx.query(
        "update shipping_order_lines set status = 'packed', packed_quantity = ordered_quantity, updated_at = now() where tenant_id = $1 and shipping_order_id = $2",
        [tenantId, shippingOrderId],
      );
      await tx.query(
        "update shipping_orders set status = 'packed', packed_at = now(), updated_at = now() where tenant_id = $1 and id = $2",
        [tenantId, shippingOrderId],
      );
    }

    if (transition === "shipped") {
      for (const line of lines.rows) {
        await tx.query(
          `
            insert into inventory_movements (
              tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
              location_code, source_type, source_id, idempotency_key
            )
            values ($1, $2, 'ship', $3, $3, 'MAIN', 'shipping_order_line', $4, $5)
            on conflict (tenant_id, idempotency_key)
            do nothing
          `,
          [
            tenantId,
            line.item_id,
            -Number(line.ordered_quantity),
            line.id,
            `ship:${line.id}`,
          ],
        );
      }
      await tx.query(
        "update shipping_order_lines set status = 'shipped', shipped_quantity = ordered_quantity, updated_at = now() where tenant_id = $1 and shipping_order_id = $2",
        [tenantId, shippingOrderId],
      );
      await tx.query(
        "update shipping_orders set status = 'shipped', shipped_at = now(), updated_at = now() where tenant_id = $1 and id = $2",
        [tenantId, shippingOrderId],
      );
      await tx.query(
        "update operations_orders set status = 'closed', updated_at = now() where tenant_id = $1 and id = $2",
        [tenantId, order.rows[0].operations_order_id],
      );
    }

    await addCaseEvent(
      tx,
      tenantId,
      "Shipping order updated",
      `${order.rows[0].shipment_number} marked ${transition}.`,
      shippingOrderId,
      { transition },
    );

    return { shippingOrderId };
  });
}

export async function loadShippingOrders(db: QueryExecutor, tenantId: string) {
  const orders = await db.query(
    `
      select shipping_orders.*, operations_orders.order_name,
        operations_orders.customer_name_encrypted,
        operations_orders.customer_email_encrypted,
        count(shipping_order_lines.id)::int as line_count
      from shipping_orders
      join operations_orders on operations_orders.id = shipping_orders.operations_order_id
      left join shipping_order_lines on shipping_order_lines.shipping_order_id = shipping_orders.id
      where shipping_orders.tenant_id = $1
      group by shipping_orders.id, operations_orders.order_name,
        operations_orders.customer_name_encrypted,
        operations_orders.customer_email_encrypted
      order by shipping_orders.created_at desc
    `,
    [tenantId],
  );
  const lines = await db.query(
    `
      select shipping_order_lines.*, shipping_orders.shipment_number, items.sku, items.title
      from shipping_order_lines
      join shipping_orders on shipping_orders.id = shipping_order_lines.shipping_order_id
      join items on items.id = shipping_order_lines.item_id
      where shipping_order_lines.tenant_id = $1
      order by shipping_orders.created_at desc, items.sku
    `,
    [tenantId],
  );

  return {
    orders: orders.rows.map((row) => decryptOrderRow(row as CustomerEncryptedRow)),
    lines: lines.rows,
  };
}

export async function loadWarehouseTasks(db: QueryExecutor, tenantId: string) {
  return (
    await db.query(
      `
        select warehouse_tasks.*, items.sku, items.title as item_title
        from warehouse_tasks
        left join items on items.id = warehouse_tasks.item_id
        where warehouse_tasks.tenant_id = $1
        order by warehouse_tasks.created_at desc
      `,
      [tenantId],
    )
  ).rows;
}

export async function loadOperationsOrders(db: QueryExecutor, tenantId: string) {
  return (
    await db.query(
      `
        select operations_orders.*, count(operations_order_lines.id)::int as line_count
        from operations_orders
        left join operations_order_lines on operations_order_lines.operations_order_id = operations_orders.id
        where operations_orders.tenant_id = $1
        group by operations_orders.id
        order by operations_orders.created_at desc
      `,
      [tenantId],
    )
  ).rows;
}

export async function loadOrderProcess(db: QueryExecutor, tenantId: string) {
  const order = await db.query(
    `
      select operations_orders.*, items.sku, items.title, operations_order_lines.quantity, operations_order_lines.unit
      from operations_orders
      join operations_order_lines on operations_order_lines.operations_order_id = operations_orders.id
      join items on items.id = operations_order_lines.item_id
      where operations_orders.tenant_id = $1 and operations_orders.order_name = '#1001'
      order by operations_orders.created_at desc
      limit 1
    `,
    [tenantId],
  );
  const mrpRuns = await loadMrpRuns(db, tenantId);
  const productionOrders = await loadProductionOrders(db, tenantId);
  const purchaseNeeds = await loadPurchaseNeeds(db, tenantId);
  const purchaseOrders = await loadPurchaseOrders(db, tenantId);
  const warehouseTasks = await loadWarehouseTasks(db, tenantId);
  const receipts = await loadReceipts(db, tenantId);
  const bomComponents = await loadBomLinesForKit(db, tenantId);
  const latestMrpRun = mrpRuns[0] as { id?: string } | undefined;
  const latestMrp = latestMrpRun?.id
    ? await loadMrpRunDetail(db, tenantId, latestMrpRun.id)
    : { run: null, lines: [] };
  const productionComponents = await db.query(
    `
      select production_components.*, production_orders.display_number, items.sku, items.title
      from production_components
      join production_orders on production_orders.id = production_components.production_order_id
      join items on items.id = production_components.item_id
      where production_components.tenant_id = $1
      order by production_orders.created_at desc, items.sku
    `,
    [tenantId],
  );
  const recentMovements = await db.query(
    `
      select inventory_movements.*, items.sku, items.title
      from inventory_movements
      join items on items.id = inventory_movements.item_id
      where inventory_movements.tenant_id = $1
      order by inventory_movements.occurred_at desc
      limit 12
    `,
    [tenantId],
  );
  const recentEvents = await db.query(
    `
      select title, message, source_ref, created_at
      from case_events
      where tenant_id = $1
      order by created_at desc
      limit 8
    `,
    [tenantId],
  );

  return {
    order: order.rows[0] ?? null,
    bomComponents,
    mrpRuns,
    latestMrp,
    productionOrders,
    productionComponents: productionComponents.rows,
    purchaseNeeds,
    purchaseOrders,
    warehouseTasks,
    receipts,
    recentMovements: recentMovements.rows,
    recentEvents: recentEvents.rows,
  };
}

export async function loadReceipts(db: QueryExecutor, tenantId: string) {
  const receipts = await db.query(
    `
      select goods_receipts.*, purchase_orders.display_number as purchase_order_number,
        suppliers.name as supplier_name,
        count(goods_receipt_lines.id)::int as line_count
      from goods_receipts
      join purchase_orders on purchase_orders.id = goods_receipts.purchase_order_id
      join suppliers on suppliers.id = purchase_orders.supplier_id
      left join goods_receipt_lines on goods_receipt_lines.goods_receipt_id = goods_receipts.id
      where goods_receipts.tenant_id = $1
      group by goods_receipts.id, purchase_orders.display_number, suppliers.name
      order by goods_receipts.created_at desc
    `,
    [tenantId],
  );
  const lines = await db.query(
    `
      select goods_receipt_lines.*, goods_receipts.receipt_number, items.sku, items.title,
        qc_checks.status as qc_status, qc_checks.result as qc_result
      from goods_receipt_lines
      join goods_receipts on goods_receipts.id = goods_receipt_lines.goods_receipt_id
      join items on items.id = goods_receipt_lines.item_id
      left join qc_checks on qc_checks.goods_receipt_line_id = goods_receipt_lines.id
      where goods_receipt_lines.tenant_id = $1
      order by goods_receipt_lines.created_at desc
    `,
    [tenantId],
  );

  return { receipts: receipts.rows, lines: lines.rows };
}

export async function loadInventoryLedger(db: QueryExecutor, tenantId: string) {
  const balances = await db.query(
    `
      select items.sku, items.title,
        coalesce(sum(inventory_movements.quantity_delta), 0) as physical_quantity,
        coalesce(sum(inventory_movements.reserved_delta) filter (where inventory_movements.location_code = 'MAIN'), 0) as reserved_quantity,
        coalesce(sum(inventory_movements.quantity_delta - inventory_movements.reserved_delta) filter (where inventory_movements.location_code = 'MAIN'), 0) as available_quantity,
        coalesce(sum(inventory_movements.quantity_delta) filter (where inventory_movements.location_code = 'QC-HOLD'), 0) as qc_hold_quantity,
        coalesce(sum(inventory_movements.quantity_delta) filter (where inventory_movements.location_code = 'QUARANTINE'), 0) as quarantine_quantity,
        coalesce(sum(inventory_movements.quantity_delta) filter (where inventory_movements.location_code = 'LOGISTICS-STAGE'), 0) as logistics_stage_quantity
      from items
      left join inventory_movements on inventory_movements.item_id = items.id
      where items.tenant_id = $1
      group by items.id
      order by items.sku
    `,
    [tenantId],
  );
  const movements = await db.query(
    `
      select inventory_movements.*, items.sku, items.title
      from inventory_movements
      join items on items.id = inventory_movements.item_id
      where inventory_movements.tenant_id = $1
      order by inventory_movements.occurred_at desc
      limit 50
    `,
    [tenantId],
  );

  return { balances: balances.rows, movements: movements.rows };
}

export async function postInventoryMovement(
  db: QueryExecutor,
  tenantId: string,
  input: {
    itemId: string;
    movementType: string;
    quantity: number;
    locationCode: string;
    reference: string;
  },
) {
  const allowedMovements = new Set([
    "stock_adjustment",
    "purchase_receipt",
    "putaway",
    "produce",
    "count_adjustment",
  ]);
  const allowedLocations = new Set(["MAIN", "QC-HOLD", "QUARANTINE", "LOGISTICS-STAGE"]);
  const movementType = input.movementType;
  const locationCode = input.locationCode || "MAIN";
  const quantity = Number(input.quantity);

  if (!allowedMovements.has(movementType)) {
    throw new Error("Unsupported inventory movement type.");
  }
  if (!allowedLocations.has(locationCode)) {
    throw new Error("Unsupported inventory location.");
  }
  if (!input.itemId || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Select a product and enter a positive quantity.");
  }

  const reference = input.reference.trim() || `${movementType}:${new Date().toISOString()}`;
  const idempotencyKey = `manual:${movementType}:${input.itemId}:${Date.now()}`;

  await db.query(
    `
      insert into inventory_movements (
        tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
        location_code, source_type, source_id, idempotency_key
      )
      values ($1, $2, $3, $4, 0, $5, 'manual_inventory', $6, $7)
    `,
    [
      tenantId,
      input.itemId,
      movementType,
      quantity,
      locationCode,
      reference,
      idempotencyKey,
    ],
  );

  await addCaseEvent(
    db,
    tenantId,
    "Inventory movement posted",
    `${quantity} pcs posted as ${movementType} to ${locationCode}.`,
    input.itemId,
    { movementType, quantity, locationCode, reference },
  );
}

export async function loadCases(db: QueryExecutor, tenantId: string) {
  const cases = await db.query(
    "select * from operation_cases where tenant_id = $1 order by created_at desc",
    [tenantId],
  );
  const events = await db.query(
    "select * from case_events where tenant_id = $1 order by created_at desc limit 20",
    [tenantId],
  );
  return { cases: cases.rows, events: events.rows };
}

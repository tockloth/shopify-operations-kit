import type { QueryExecutor } from "./kit-db.server";
import { withKitTransaction } from "./kit-db.server";
import {
  encryptCustomerData,
  hashCustomerLookup,
  safeDecryptCustomerData,
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
  shopify_published_at?: string | null;
  shopify_online_store_url?: string | null;
  shopify_last_seen_at?: string | null;
  shopify_inventory_available?: string | number | null;
  min_inventory_quantity?: string | number;
  default_production_quantity?: string | number;
  default_order_quantity?: string | number;
  supplier_lead_time_days?: number;
  qc_required_after_purchase?: boolean;
  qc_required_after_production?: boolean;
  product_source?: string;
  shop_product_flag?: string;
  preferred_supplier_id?: string | null;
  preferred_supplier_name?: string | null;
  active_bom_count?: string | number;
  active_bom_component_count?: string | number;
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
  shipping_address_encrypted?: string | null;
  [key: string]: unknown;
};

type NormalizedShippingAddress = {
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  provinceCode: string | null;
  zip: string | null;
  countryCodeV2: string | null;
  phone: string | null;
};

type OperationCustomerEncryptedRow = {
  display_name?: string | null;
  email?: string | null;
  display_name_encrypted?: string | null;
  email_encrypted?: string | null;
  first_name_encrypted?: string | null;
  last_name_encrypted?: string | null;
  [key: string]: unknown;
};

function decryptOrderRow<T extends CustomerEncryptedRow>(row: T) {
  const shippingAddress = safeDecryptCustomerData(
    row.shipping_address_encrypted,
  );

  return {
    ...row,
    customer_name:
      safeDecryptCustomerData(row.customer_name_encrypted) ??
      row.customer_name ??
      null,
    customer_email:
      safeDecryptCustomerData(row.customer_email_encrypted) ??
      row.customer_email ??
      null,
    shipping_address: normalizeShippingAddress(shippingAddress),
  };
}

function normalizeShippingAddress(
  encryptedValue: string | null | undefined,
): NormalizedShippingAddress | null {
  if (!encryptedValue) return null;
  try {
    const parsed = JSON.parse(encryptedValue) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const address = parsed as Record<string, unknown>;
    return {
      name: stringOrNull(address.name),
      address1: stringOrNull(address.address1 ?? address.street),
      address2: stringOrNull(address.address2),
      city: stringOrNull(address.city),
      provinceCode: stringOrNull(address.provinceCode ?? address.province),
      zip: stringOrNull(address.zip ?? address.postalCode),
      countryCodeV2: stringOrNull(
        address.countryCodeV2 ?? address.countryCode ?? address.country,
      ),
      phone: stringOrNull(address.phone),
    };
  } catch {
    return null;
  }
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasUsableShippingAddress(address: NormalizedShippingAddress | null) {
  return Boolean(address?.address1 && address.city && address.countryCodeV2);
}

function missingOrderShippingData(row: {
  customer_name?: unknown;
  customer_email?: unknown;
  shipping_address?: NormalizedShippingAddress | null;
}) {
  return [
    row.customer_name ? null : "customer name",
    row.customer_email ? null : "customer email",
    hasUsableShippingAddress(row.shipping_address ?? null)
      ? null
      : "shipping address",
  ].filter(Boolean) as string[];
}

function applyDecodedOrderDataQuality(row: any) {
  const missing = missingOrderShippingData(row);
  if (missing.length === 0) return row;
  const missingParts = missing.map((value) =>
    value === "customer email" ? "email" : value,
  );
  const missingLabel =
    missingParts.length <= 1
      ? (missingParts[0] ?? "shipping data")
      : `${missingParts.slice(0, -1).join(", ")} or ${
          missingParts[missingParts.length - 1]
        }`;

  if (row.operational_status === "Ready for logistics") {
    return {
      ...row,
      operational_status: "Logistics blocked",
      operational_status_tone: "warning",
      next_reason: `Inventory is ready, but ${missingLabel} is missing.`,
      next_action_label: "Open order",
      next_action_href: `/app/orders/${row.id}`,
    };
  }

  if (row.operational_status === "Complete") {
    return {
      ...row,
      operational_status: "Shipment complete, address missing in Operations Kit",
      operational_status_tone: "warning",
      next_reason: `Shipment is complete, but Operations Kit is missing ${missingLabel}.`,
      next_action_label: "Open order",
      next_action_href: `/app/orders/${row.id}`,
    };
  }

  return row;
}

function decryptOperationCustomerRow<T extends OperationCustomerEncryptedRow>(
  row: T,
) {
  return {
    ...row,
    display_name:
      safeDecryptCustomerData(row.display_name_encrypted) ??
      row.display_name ??
      null,
    email: safeDecryptCustomerData(row.email_encrypted) ?? row.email ?? null,
    first_name: safeDecryptCustomerData(row.first_name_encrypted),
    last_name: safeDecryptCustomerData(row.last_name_encrypted),
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

export async function ensureDefaultOperationAccess(
  db: QueryExecutor,
  tenantId: string,
) {
  const sharedPassword = "Operations123!";

  await db.query(
    `
      insert into operation_groups (tenant_id, key, name, description, is_system)
      values
        ($1, 'admin', 'Admin', 'System administration, users, roles and UI configuration.', true),
        ($1, 'procurement', 'Procurement', 'Purchase needs, purchase orders and supplier coordination.', true),
        ($1, 'masterdata', 'Masterdata', 'Product, BOM, supplier and planning master data.', true),
        ($1, 'inventory', 'Inventory', 'Inventory planning, stock movements, QC release and putaway.', true),
        ($1, 'logistics', 'Logistics', 'Outbound packing, partial delivery and customer shipping.', true)
      on conflict (tenant_id, key)
      do update set
        name = excluded.name,
        description = excluded.description,
        is_system = true,
        updated_at = now()
    `,
    [tenantId],
  );

  await db.query(
    `
      insert into operation_roles (
        tenant_id, key, name, resource, can_read, can_write, can_execute, can_admin, is_system
      )
      values
        ($1, 'admin_all', 'Administrator', '*', true, true, true, true, true),
        ($1, 'procurement_work', 'Procurement work', 'procurement', true, true, true, false, true),
        ($1, 'masterdata_work', 'Masterdata work', 'masterdata', true, true, true, false, true),
        ($1, 'inventory_work', 'Inventory work', 'inventory', true, true, true, false, true),
        ($1, 'logistics_work', 'Logistics work', 'logistics', true, true, true, false, true),
        ($1, 'operations_read', 'Operations read', 'operations', true, false, false, false, true)
      on conflict (tenant_id, key)
      do update set
        name = excluded.name,
        resource = excluded.resource,
        can_read = excluded.can_read,
        can_write = excluded.can_write,
        can_execute = excluded.can_execute,
        can_admin = excluded.can_admin,
        is_system = true,
        updated_at = now()
    `,
    [tenantId],
  );

  await db.query(
    `
      insert into operation_users (
        tenant_id, email, display_name, password_hash, is_active, is_admin
      )
      values
        ($1, 'admin@tockloth.com', 'Operations Admin', crypt($2, gen_salt('bf')), true, true),
        ($1, 'procurement@tockloth.com', 'Procurement User', crypt($2, gen_salt('bf')), true, false),
        ($1, 'masterdata@tockloth.com', 'Masterdata User', crypt($2, gen_salt('bf')), true, false),
        ($1, 'inventory@tockloth.com', 'Inventory User', crypt($2, gen_salt('bf')), true, false),
        ($1, 'logistics@tockloth.com', 'Logistics User', crypt($2, gen_salt('bf')), true, false)
      on conflict (tenant_id, email)
      do update set
        display_name = excluded.display_name,
        is_active = true,
        is_admin = excluded.is_admin,
        updated_at = now()
    `,
    [tenantId, sharedPassword],
  );

  await db.query(
    `
      with links(email, group_key) as (
        values
          ('admin@tockloth.com', 'admin'),
          ('procurement@tockloth.com', 'procurement'),
          ('masterdata@tockloth.com', 'masterdata'),
          ('inventory@tockloth.com', 'inventory'),
          ('logistics@tockloth.com', 'logistics')
      )
      insert into operation_user_groups (tenant_id, user_id, group_id)
      select $1, operation_users.id, operation_groups.id
      from links
      join operation_users
        on operation_users.tenant_id = $1
        and operation_users.email = links.email
      join operation_groups
        on operation_groups.tenant_id = $1
        and operation_groups.key = links.group_key
      on conflict (tenant_id, user_id, group_id)
      do nothing
    `,
    [tenantId],
  );

  await db.query(
    `
      with links(group_key, role_key) as (
        values
          ('admin', 'admin_all'),
          ('procurement', 'procurement_work'),
          ('procurement', 'operations_read'),
          ('masterdata', 'masterdata_work'),
          ('inventory', 'inventory_work'),
          ('inventory', 'operations_read'),
          ('logistics', 'logistics_work'),
          ('logistics', 'operations_read')
      )
      insert into operation_group_roles (tenant_id, group_id, role_id)
      select $1, operation_groups.id, operation_roles.id
      from links
      join operation_groups
        on operation_groups.tenant_id = $1
        and operation_groups.key = links.group_key
      join operation_roles
        on operation_roles.tenant_id = $1
        and operation_roles.key = links.role_key
      on conflict (tenant_id, group_id, role_id)
      do nothing
    `,
    [tenantId],
  );

  return {
    users: 5,
    groups: 5,
    password: sharedPassword,
  };
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

async function loadPurchasePolicyForSupplier(
  db: QueryExecutor,
  tenantId: string,
  itemId: string,
  supplierId: string,
) {
  const policy = await db.query<{
    default_order_quantity: string;
    supplier_lead_time_days: number;
    supplier_sku: string | null;
    unit_price: string | null;
    currency_code: string | null;
    supplier_item_lead_time_days: number | null;
    minimum_order_quantity: string | null;
  }>(
    `
      select
        items.default_order_quantity,
        items.supplier_lead_time_days,
        supplier_items.supplier_sku,
        supplier_items.unit_price,
        supplier_items.currency_code,
        supplier_items.lead_time_days as supplier_item_lead_time_days,
        supplier_items.minimum_order_quantity
      from items
      left join supplier_items
        on supplier_items.tenant_id = items.tenant_id
        and supplier_items.item_id = items.id
        and supplier_items.supplier_id = $3
      where items.tenant_id = $1 and items.id = $2
    `,
    [tenantId, itemId, supplierId],
  );

  const row = policy.rows[0];
  const leadTimeDays =
    row?.supplier_item_lead_time_days ?? row?.supplier_lead_time_days ?? 7;
  const minimumOrderQuantity = Number(row?.minimum_order_quantity ?? 0);

  return {
    leadTimeDays,
    supplierSku: row?.supplier_sku ?? null,
    unitPrice: row?.unit_price ?? null,
    currencyCode: row?.currency_code ?? "EUR",
    orderQuantityFloor: Math.max(
      Number(row?.default_order_quantity ?? 1),
      minimumOrderQuantity,
    ),
  };
}

async function linkPreferredSupplier(
  db: QueryExecutor,
  tenantId: string,
  supplierId: string,
  itemId: string,
) {
  const tenantScope = await db.query<{ exists: boolean }>(
    `
      select exists (
        select 1
        from items
        join suppliers
          on suppliers.tenant_id = items.tenant_id
          and suppliers.id = $3
        where items.tenant_id = $1
          and items.id = $2
      ) as exists
    `,
    [tenantId, itemId, supplierId],
  );
  if (!tenantScope.rows[0]?.exists) {
    throw new Error("Select a tenant item and supplier before linking them.");
  }

  await db.query(
    "update supplier_items set is_preferred = false where tenant_id = $1 and item_id = $2",
    [tenantId, itemId],
  );
  await db.query(
    `
      insert into supplier_items (tenant_id, supplier_id, item_id, is_preferred)
      values ($1, $2, $3, true)
      on conflict (tenant_id, supplier_id, item_id)
      do update set is_preferred = true, is_active = true, updated_at = now()
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
    const kit = await upsertItem(
      tx,
      tenantId,
      "KIT-001",
      "Customer Test Kit",
      "assembly",
      {
        sellable: true,
        producible: true,
      },
    );
    const compA = await upsertItem(
      tx,
      tenantId,
      "COMP-A",
      "Reagent A",
      "raw_material",
      {
        purchasable: true,
      },
    );
    const compB = await upsertItem(
      tx,
      tenantId,
      "COMP-B",
      "Buffer Bottle",
      "component",
      {
        purchasable: true,
      },
    );
    const box = await upsertItem(
      tx,
      tenantId,
      "PACK-BOX",
      "Packaging Box",
      "component",
      {
        purchasable: true,
      },
    );
    const manual = await upsertItem(
      tx,
      tenantId,
      "MANUAL",
      "User Manual",
      "component",
      {
        purchasable: true,
      },
    );

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

    await tx.query(
      `
        update items
        set min_inventory_quantity = case
              when id = $2 then 3
              when id = $3 then 2
              else min_inventory_quantity
            end,
            default_order_quantity = case
              when id = $2 then 5
              when id = $3 then 4
              else default_order_quantity
            end,
            updated_at = now()
        where tenant_id = $1 and id in ($2, $3)
      `,
      [tenantId, compB, box],
    );

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

export async function seedSampleOperatingScenario(
  db: QueryExecutor,
  tenantId: string,
) {
  return withKitTransaction(db, async (tx) => {
    const baseline = await seedOperationsKitScenario(tx, tenantId);
    const item = await tx.query<{ id: string }>(
      "select id from items where tenant_id = $1 and sku = 'COMP-B'",
      [tenantId],
    );
    const supplier = await tx.query<{ id: string }>(
      "select id from suppliers where tenant_id = $1 and name = 'Supplier Beta'",
      [tenantId],
    );
    const itemId = item.rows[0]?.id;
    const supplierId = supplier.rows[0]?.id;
    if (!itemId || !supplierId) {
      throw new Error("Sample product or supplier master data is missing.");
    }

    const purchaseOrderNumber = "PO-SAMPLE-001";
    const existingOrder = await tx.query<{ id: string }>(
      `
        select id
        from purchase_orders
        where tenant_id = $1 and display_number = $2
        limit 1
      `,
      [tenantId, purchaseOrderNumber],
    );

    let purchaseOrderCreated = false;
    const purchaseOrder =
      existingOrder.rows[0] ??
      (
        await tx.query<{ id: string }>(
          `
            insert into purchase_orders (
              tenant_id, supplier_id, display_number, status, notes,
              sent_at, acknowledged_at
            )
            values (
              $1, $2, $3, 'acknowledged',
              'Sample Operations Kit purchase order for local testing.',
              now(), now()
            )
            returning id
          `,
          [tenantId, supplierId, purchaseOrderNumber],
        )
      ).rows[0];
    purchaseOrderCreated = existingOrder.rows.length === 0;

    await tx.query(
      `
        update purchase_orders
        set supplier_id = $3,
            status = case
              when status = 'cancelled' then status
              else 'acknowledged'
            end,
            sent_at = coalesce(sent_at, now()),
            acknowledged_at = coalesce(acknowledged_at, now()),
            updated_at = now()
        where tenant_id = $1 and id = $2
      `,
      [tenantId, purchaseOrder.id, supplierId],
    );

    const existingLine = await tx.query<{ id: string }>(
      `
        select id
        from purchase_order_lines
        where tenant_id = $1 and purchase_order_id = $2
        limit 1
      `,
      [tenantId, purchaseOrder.id],
    );

    let purchaseOrderLineCreated = false;
    if (existingLine.rows.length === 0) {
      const mrpRun = await tx.query<{ id: string }>(
        `
          insert into mrp_runs (
            tenant_id, status, scenario_mode, summary, committed_at
          )
          values (
            $1, 'committed', 'shortage',
            'Sample operating scenario for local Procurement and Receiving testing.',
            now()
          )
          returning id
        `,
        [tenantId],
      );
      const mrpRunLine = await tx.query<{ id: string }>(
        `
          insert into mrp_run_lines (
            tenant_id, mrp_run_id, item_id, source_item_id, line_type,
            demand_quantity, available_quantity, shortage_quantity,
            recommended_action, explanation
          )
          values (
            $1, $2, $3, $3, 'component', 4, 0, 4, 'buy',
            'Sample shortage used to create an acknowledged purchase order.'
          )
          returning id
        `,
        [tenantId, mrpRun.rows[0].id, itemId],
      );
      const purchaseNeed = await tx.query<{ id: string }>(
        `
          insert into purchase_needs (
            tenant_id, item_id, mrp_run_id, mrp_run_line_id,
            supplier_id, quantity, unit, status
          )
          values ($1, $2, $3, $4, $5, 4, 'pcs', 'converted_to_po')
          returning id
        `,
        [
          tenantId,
          itemId,
          mrpRun.rows[0].id,
          mrpRunLine.rows[0].id,
          supplierId,
        ],
      );

      await tx.query(
        `
          insert into purchase_order_lines (
            tenant_id, purchase_order_id, purchase_need_id, item_id,
            requested_quantity, quantity, unit, status, lead_time_days,
            expected_delivery_date, unit_price, currency_code
          )
          values ($1, $2, $3, $4, 4, 4, 'pcs', 'open', 7, current_date + 7, 0, 'EUR')
        `,
        [tenantId, purchaseOrder.id, purchaseNeed.rows[0].id, itemId],
      );
      purchaseOrderLineCreated = true;
    }

    const receipt = await tx.query<{ id: string; receipt_number: string }>(
      `
        select id, receipt_number
        from goods_receipts
        where tenant_id = $1 and purchase_order_id = $2
        order by created_at desc
        limit 1
      `,
      [tenantId, purchaseOrder.id],
    );

    await addCaseEvent(
      tx,
      tenantId,
      "Sample operating scenario seeded",
      `${purchaseOrderNumber} is ready for receiving tests.`,
      purchaseOrder.id,
      {
        purchaseOrderNumber,
        purchaseOrderCreated,
        purchaseOrderLineCreated,
      },
    );

    return {
      ...baseline,
      purchaseOrderId: purchaseOrder.id,
      purchaseOrderNumber,
      purchaseOrderCreated,
      purchaseOrderLineCreated,
      receiptId: receipt.rows[0]?.id ?? null,
      receiptNumber: receipt.rows[0]?.receipt_number ?? null,
    };
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
      join items component
        on component.id = bom_lines.component_item_id
        and component.tenant_id = bom_lines.tenant_id
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
      join items component
        on component.id = bom_lines.component_item_id
        and component.tenant_id = bom_lines.tenant_id
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
    const itemRequirements = await tx.query<{
      item_id: string;
      sku: string;
      title: string;
      is_purchasable: boolean;
      is_producible: boolean;
      min_inventory_quantity: string;
      default_order_quantity: string;
      default_production_quantity: string;
      customer_demand_quantity: string;
      physical_quantity: string;
      reserved_quantity: string;
      ordered_quantity: string;
      order_names: string | null;
    }>(
      `
        with movement_balances as (
          select
            item_id,
            coalesce(sum(quantity_delta) filter (where location_code = 'MAIN'), 0) as physical_quantity,
            coalesce(sum(reserved_delta) filter (where location_code = 'MAIN'), 0) as movement_reserved_quantity
          from inventory_movements
          where tenant_id = $1
          group by item_id
        ),
        customer_demand as (
          select
            operations_order_lines.item_id,
            coalesce(sum(operations_order_lines.quantity), 0) as customer_demand_quantity,
            string_agg(distinct operations_orders.order_name, ', ') as order_names
          from operations_order_lines
          join operations_orders
            on operations_orders.id = operations_order_lines.operations_order_id
            and operations_orders.tenant_id = operations_order_lines.tenant_id
          where operations_order_lines.tenant_id = $1
            and operations_order_lines.supply_status <> 'cancelled'
            and operations_orders.status in ('open', 'planned', 'in_progress')
          group by operations_order_lines.item_id
        ),
        open_purchase_orders as (
          select
            purchase_order_lines.item_id,
            coalesce(sum(purchase_order_lines.quantity), 0) as ordered_quantity
          from purchase_order_lines
          join purchase_orders
            on purchase_orders.id = purchase_order_lines.purchase_order_id
            and purchase_orders.tenant_id = purchase_order_lines.tenant_id
          where purchase_order_lines.tenant_id = $1
            and purchase_order_lines.status = 'open'
            and purchase_orders.status in ('draft', 'pending_approval', 'approved', 'sent', 'acknowledged')
          group by purchase_order_lines.item_id
        )
        select
          items.id as item_id,
          items.sku,
          items.title,
          items.is_purchasable,
          items.is_producible,
          items.min_inventory_quantity,
          items.default_order_quantity,
          items.default_production_quantity,
          coalesce(customer_demand.customer_demand_quantity, 0) as customer_demand_quantity,
          coalesce(movement_balances.physical_quantity, 0) as physical_quantity,
          greatest(
            coalesce(customer_demand.customer_demand_quantity, 0),
            coalesce(movement_balances.movement_reserved_quantity, 0)
          ) as reserved_quantity,
          coalesce(open_purchase_orders.ordered_quantity, 0) as ordered_quantity,
          customer_demand.order_names
        from items
        left join customer_demand on customer_demand.item_id = items.id
        left join movement_balances on movement_balances.item_id = items.id
        left join open_purchase_orders on open_purchase_orders.item_id = items.id
        where items.tenant_id = $1
          and (
            coalesce(customer_demand.customer_demand_quantity, 0) > 0
            or coalesce(items.min_inventory_quantity, 0) > 0
            or coalesce(movement_balances.physical_quantity, 0) < 0
          )
        order by items.sku
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
        `Planned ${itemRequirements.rows.length} item requirement(s) against MAIN inventory, customer reservations, open purchase orders, minimum stock, BOMs, and make/buy policies.`,
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

    for (const requirementLine of itemRequirements.rows) {
      const customerDemand = Number(requirementLine.customer_demand_quantity);
      const minStock = Number(requirementLine.min_inventory_quantity ?? 0);
      const physical = Number(requirementLine.physical_quantity ?? 0);
      const incoming = Number(requirementLine.ordered_quantity ?? 0);
      const lotSize = Math.max(
        Number(requirementLine.default_order_quantity ?? 1),
        1,
      );
      const requirement = customerDemand + minStock;
      const availableForPlanning = physical + incoming;
      const shortage = Math.max(requirement - availableForPlanning, 0);
      const plannedPurchaseQuantity =
        shortage > 0 ? Math.ceil(shortage / lotSize) * lotSize : 0;

      let action: "reserve" | "buy" | "make" | "review" = "review";
      if (shortage <= 0) action = "reserve";
      else action = "buy";

      await addMrpLine({
        itemId: requirementLine.item_id,
        sourceItemId: requirementLine.item_id,
        lineType: "finished_good",
        demand: requirement,
        available: availableForPlanning,
        shortage: plannedPurchaseQuantity,
        action,
        explanation:
          shortage <= 0
            ? `${requirementLine.sku}: customer demand ${customerDemand}, minimum ${minStock}, physical ${physical}, incoming ${incoming}; no procurement shortage.`
            : physical < 0
              ? `${requirementLine.sku}: Negative stock shortage. Physical stock is ${physical}; purchase ${plannedPurchaseQuantity} using lot size ${lotSize}.`
            : customerDemand <= 0 && minStock > 0
              ? `${requirementLine.sku}: Min stock shortage. Minimum ${minStock} exceeds physical ${physical} and incoming ${incoming}; purchase ${plannedPurchaseQuantity} using lot size ${lotSize}.`
            : `${requirementLine.sku}: demand ${customerDemand} plus minimum ${minStock} exceeds physical ${physical} and incoming ${incoming}; purchase ${plannedPurchaseQuantity} using lot size ${lotSize}.`,
      });
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
      `MRP run planned ${itemRequirements.rows.length} item requirement(s).`,
      mrpRunId,
      { itemRequirements: itemRequirements.rows.length },
    );

    return { mrpRunId, orderLines: itemRequirements.rows.length };
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
    await setInventory(
      tx,
      tenantId,
      bySku.get("COMP-A")!.id,
      "COMP-A",
      4,
      mode,
    );
    await setInventory(
      tx,
      tenantId,
      bySku.get("COMP-B")!.id,
      "COMP-B",
      mode === "available" ? 4 : 0,
      mode,
    );
    await setInventory(
      tx,
      tenantId,
      bySku.get("PACK-BOX")!.id,
      "PACK-BOX",
      4,
      mode,
    );
    await setInventory(
      tx,
      tenantId,
      bySku.get("MANUAL")!.id,
      "MANUAL",
      4,
      mode,
    );

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
      mode === "available"
        ? "Production scenario planned"
        : "Procurement scenario planned",
      mode === "available"
        ? "MRP preview found all components available for KIT-001."
        : "MRP preview found COMP-B shortage for KIT-001.",
      mrpRunId,
      { mode },
    );

    return { mrpRunId };
  });
}

export async function commitMrpRun(
  db: QueryExecutor,
  tenantId: string,
  mrpRunId: string,
) {
  return withKitTransaction(db, async (tx) => {
    const lines = await tx.query<{
      id: string;
      item_id: string;
      demand_quantity: string;
      shortage_quantity: string;
      recommended_action: string;
      source_order_line_id: string | null;
    }>(
      `
        select
          mrp_run_lines.id,
          mrp_run_lines.item_id,
          mrp_run_lines.demand_quantity,
          mrp_run_lines.shortage_quantity,
          mrp_run_lines.recommended_action,
          source_line.source_order_line_id
        from mrp_run_lines
        join mrp_runs
          on mrp_runs.id = mrp_run_lines.mrp_run_id
          and mrp_runs.tenant_id = mrp_run_lines.tenant_id
        left join lateral (
          select (array_agg(operations_order_lines.id))[1] as source_order_line_id
          from operations_order_lines
          where operations_order_lines.tenant_id = mrp_run_lines.tenant_id
            and operations_order_lines.operations_order_id = mrp_runs.operations_order_id
            and operations_order_lines.item_id = mrp_run_lines.item_id
            and operations_order_lines.supply_status <> 'cancelled'
          having count(*) = 1
        ) source_line on true
        where mrp_run_lines.tenant_id = $1 and mrp_run_lines.mrp_run_id = $2
      `,
      [tenantId, mrpRunId],
    );

    await tx.query(
      `
        delete from purchase_needs
        where tenant_id = $1
          and status in ('open', 'assigned', 'ready_for_po')
          and mrp_run_id is not null
          and not exists (
            select 1
            from purchase_order_lines
            where purchase_order_lines.tenant_id = purchase_needs.tenant_id
              and purchase_order_lines.purchase_need_id = purchase_needs.id
          )
      `,
      [tenantId],
    );

    let purchaseNeeds = 0;
    let productionNeeds = 0;

    for (const line of lines.rows) {
      if (
        line.recommended_action === "buy" &&
        Number(line.shortage_quantity) > 0
      ) {
        const preferred = await tx.query<{ supplier_id: string }>(
          "select supplier_id from supplier_items where tenant_id = $1 and item_id = $2 and is_preferred",
          [tenantId, line.item_id],
        );
        await tx.query(
          `
            insert into purchase_needs (
              tenant_id, item_id, mrp_run_id, mrp_run_line_id,
              source_order_line_id, supplier_id, quantity, unit, status
            )
            values ($1, $2, $3, $4, $5, $6, $7, 'pcs', $8)
            on conflict (tenant_id, mrp_run_line_id)
            do update set
              supplier_id = coalesce(purchase_needs.supplier_id, excluded.supplier_id),
              source_order_line_id = coalesce(purchase_needs.source_order_line_id, excluded.source_order_line_id),
              updated_at = now()
          `,
          [
            tenantId,
            line.item_id,
            mrpRunId,
            line.id,
            line.source_order_line_id,
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
        join items
          on items.id = production_needs.item_id
          and items.tenant_id = production_needs.tenant_id
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
      [
        tenantId,
        need.rows[0].id,
        need.rows[0].item_id,
        displayNumber,
        need.rows[0].quantity,
      ],
    );

    const components = await loadBomLinesForItem(
      tx,
      tenantId,
      need.rows[0].item_id,
    );
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
        [
          tenantId,
          productionOrder.rows[0].id,
          component.component_id,
          component.quantity,
        ],
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

    return {
      productionOrderId: productionOrder.rows[0].id,
      warehouseTasks: taskCount,
    };
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
        `
          select supplier_items.supplier_id
          from supplier_items
          join suppliers
            on suppliers.id = supplier_items.supplier_id
            and suppliers.tenant_id = supplier_items.tenant_id
          where supplier_items.tenant_id = $1
            and supplier_items.item_id = $2
            and supplier_items.is_preferred
        `,
        [tenantId, row.item_id],
      );
      supplierId = preferred.rows[0]?.supplier_id ?? null;
    }
    if (!supplierId) {
      throw new Error(
        "Assign a preferred supplier before creating a purchase order.",
      );
    }
    const supplier = await tx.query<{ id: string }>(
      "select id from suppliers where tenant_id = $1 and id = $2",
      [tenantId, supplierId],
    );
    if (!supplier.rows[0]) {
      throw new Error(
        "Assign a tenant supplier before creating a purchase order.",
      );
    }

    await tx.query(
      "update purchase_needs set supplier_id = $3, status = 'ready_for_po', updated_at = now() where tenant_id = $1 and id = $2",
      [tenantId, row.id, supplierId],
    );

    const policy = await loadPurchasePolicyForSupplier(
      tx,
      tenantId,
      row.item_id,
      supplierId,
    );
    const orderQuantity = Math.max(
      Number(row.quantity),
      policy.orderQuantityFloor,
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
          requested_quantity, quantity, unit, status, lead_time_days,
          expected_delivery_date, supplier_sku, unit_price, currency_code
        )
        values ($1, $2, $3, $4, $5, $5, $6, 'open', $7, current_date + $7::int, $8, $9, $10)
        on conflict (tenant_id, purchase_need_id)
        do update set
          purchase_order_id = excluded.purchase_order_id,
          requested_quantity = excluded.requested_quantity,
          quantity = excluded.quantity,
          lead_time_days = excluded.lead_time_days,
          expected_delivery_date = excluded.expected_delivery_date,
          supplier_sku = excluded.supplier_sku,
          unit_price = excluded.unit_price,
          currency_code = excluded.currency_code
      `,
      [
        tenantId,
        po.rows[0].id,
        row.id,
        row.item_id,
        orderQuantity,
        row.unit,
        policy.leadTimeDays,
        policy.supplierSku,
        policy.unitPrice,
        policy.currencyCode,
      ],
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
      const supplier = await tx.query<{ id: string }>(
        "select id from suppliers where tenant_id = $1 and id = $2",
        [tenantId, supplierId],
      );
      if (!supplier.rows[0]) continue;

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
        const policy = await loadPurchasePolicyForSupplier(
          tx,
          tenantId,
          need.item_id,
          supplierId,
        );
        const orderQuantity = Math.max(
          Number(need.quantity),
          policy.orderQuantityFloor,
        );
        await tx.query(
          `
            insert into purchase_order_lines (
              tenant_id, purchase_order_id, purchase_need_id, item_id,
              requested_quantity, quantity, unit, status, lead_time_days,
              expected_delivery_date, supplier_sku, unit_price, currency_code
            )
            values ($1, $2, $3, $4, $5, $5, $6, 'open', $7, current_date + $7::int, $8, $9, $10)
            on conflict (tenant_id, purchase_need_id)
            do update set
              requested_quantity = excluded.requested_quantity,
              quantity = excluded.quantity,
              lead_time_days = excluded.lead_time_days,
              expected_delivery_date = excluded.expected_delivery_date,
              supplier_sku = excluded.supplier_sku,
              unit_price = excluded.unit_price,
              currency_code = excluded.currency_code
          `,
          [
            tenantId,
            po.rows[0].id,
            need.id,
            need.item_id,
            orderQuantity,
            need.unit,
            policy.leadTimeDays,
            policy.supplierSku,
            policy.unitPrice,
            policy.currencyCode,
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
    const receiptIds: string[] = [];

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
      const receiptId = receipt.rows[0]?.id;
      if (!receiptId) continue;
      receiptIds.push(receiptId);
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
          [
            tenantId,
            receiptId,
            line.id,
            line.item_id,
            line.quantity,
            line.unit,
          ],
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

    return { receipts, qcChecks, receiptIds };
  });
}

export async function createGoodsReceiptForPurchaseOrder(
  db: QueryExecutor,
  tenantId: string,
  purchaseOrderId: string,
) {
  const existing = await db.query<{
    id: string;
    receipt_number: string;
    status: string;
  }>(
    `
      select id, receipt_number, status
      from goods_receipts
      where tenant_id = $1
        and purchase_order_id = $2
        and status <> 'cancelled'
      order by created_at desc
      limit 1
    `,
    [tenantId, purchaseOrderId],
  );
  const existingReceipt = existing.rows[0];
  if (existingReceipt) {
    return {
      receiptId: existingReceipt.id,
      receiptNumber: existingReceipt.receipt_number,
      created: false,
    };
  }

  const result = await postGoodsReceiptForAcknowledgedPurchaseOrders(
    db,
    tenantId,
    purchaseOrderId,
  );
  const receiptId = result.receiptIds[0] ?? null;
  if (!receiptId) {
    return { receiptId: null, receiptNumber: null, created: false };
  }

  const receipt = await db.query<{ receipt_number: string }>(
    `
      select receipt_number
      from goods_receipts
      where tenant_id = $1 and id = $2
    `,
    [tenantId, receiptId],
  );

  return {
    receiptId,
    receiptNumber: receipt.rows[0]?.receipt_number ?? null,
    created: true,
  };
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
        join goods_receipt_lines
          on goods_receipt_lines.id = qc_checks.goods_receipt_line_id
          and goods_receipt_lines.tenant_id = qc_checks.tenant_id
        join items
          on items.id = qc_checks.item_id
          and items.tenant_id = qc_checks.tenant_id
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
      throw new Error(
        "Accepted plus rejected quantity cannot exceed received quantity.",
      );
    }

    const result =
      rejected > 0 && accepted > 0
        ? "failed"
        : rejected > 0
          ? "failed"
          : "passed";
    const lineStatus =
      rejected > 0 && accepted > 0
        ? "accepted"
        : rejected > 0
          ? "rejected"
          : "accepted";

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

export async function putawayReceiptLine(
  db: QueryExecutor,
  tenantId: string,
  goodsReceiptLineId: string,
) {
  return withKitTransaction(db, async (tx) => {
    const line = await tx.query<{
      id: string;
      goods_receipt_id: string;
      item_id: string;
      accepted_quantity: string;
      status: string;
      sku: string;
    }>(
      `
        select goods_receipt_lines.id, goods_receipt_lines.goods_receipt_id,
          goods_receipt_lines.item_id, goods_receipt_lines.accepted_quantity,
          goods_receipt_lines.status, items.sku
        from goods_receipt_lines
        join items
          on items.id = goods_receipt_lines.item_id
          and items.tenant_id = goods_receipt_lines.tenant_id
        where goods_receipt_lines.tenant_id = $1 and goods_receipt_lines.id = $2
      `,
      [tenantId, goodsReceiptLineId],
    );
    const row = line.rows[0];
    if (!row) return { putaway: 0 };

    const accepted = Number(row.accepted_quantity ?? 0);
    if (accepted <= 0 || row.status !== "accepted") {
      return { putaway: 0 };
    }

    await tx.query(
      `
        insert into inventory_movements (
          tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
          location_code, source_type, source_id, idempotency_key
        )
        values ($1, $2, 'putaway', $3, 0, 'MAIN', 'goods_receipt_line', $4, $5)
        on conflict (tenant_id, idempotency_key)
        do nothing
      `,
      [
        tenantId,
        row.item_id,
        accepted,
        row.id,
        `receipt-putaway:${row.id}`,
      ],
    );

    await tx.query(
      `
        update goods_receipt_lines
        set status = 'putaway_done', updated_at = now()
        where tenant_id = $1 and id = $2
      `,
      [tenantId, row.id],
    );

    await tx.query(
      `
        update warehouse_tasks
        set status = 'done', updated_at = now()
        where tenant_id = $1
          and task_type = 'putaway'
          and source_type = 'goods_receipt_line'
          and source_id = $2
      `,
      [tenantId, row.id],
    );

    const remaining = await tx.query<{ count: string }>(
      `
        select count(*)::text as count
        from goods_receipt_lines
        where tenant_id = $1
          and goods_receipt_id = $2
          and status not in ('putaway_done', 'rejected')
      `,
      [tenantId, row.goods_receipt_id],
    );

    const receiptClosed = Number(remaining.rows[0]?.count ?? 0) === 0;

    await tx.query(
      `
        update goods_receipts
        set status = case when $3::int = 0 then 'closed' else 'putaway_pending' end,
            updated_at = now()
        where tenant_id = $1 and id = $2
      `,
      [tenantId, row.goods_receipt_id, receiptClosed ? 0 : 1],
    );

    if (receiptClosed) {
      await tx.query(
        `
          update purchase_order_lines
          set status = 'fulfilled_later'
          where tenant_id = $1
            and id in (
              select purchase_order_line_id
              from goods_receipt_lines
              where tenant_id = $1 and goods_receipt_id = $2
            )
        `,
        [tenantId, row.goods_receipt_id],
      );
      await ensurePurchasePaymentForReceipt(
        tx,
        tenantId,
        row.goods_receipt_id,
      );
    }

    await addCaseEvent(
      tx,
      tenantId,
      "Receipt line put away",
      `${row.sku}: ${accepted} accepted unit(s) moved into MAIN inventory.`,
      row.id,
      { accepted },
    );

    return { putaway: accepted, receiptClosed };
  });
}

async function ensurePurchasePaymentForReceipt(
  tx: QueryExecutor,
  tenantId: string,
  goodsReceiptId: string,
) {
  const paymentBase = await tx.query<{
    purchase_order_id: string;
    display_number: string;
    supplier_id: string;
    net_amount: string;
    currency_code: string;
    due_date: string | null;
  }>(
    `
      select purchase_orders.id as purchase_order_id,
        purchase_orders.display_number,
        purchase_orders.supplier_id,
        coalesce(sum(purchase_order_lines.quantity * coalesce(purchase_order_lines.unit_price, 0)), 0) as net_amount,
        coalesce(max(purchase_order_lines.currency_code), 'EUR') as currency_code,
        (coalesce(min(purchase_order_lines.expected_delivery_date), current_date) + interval '14 days')::date as due_date
      from goods_receipts
      join purchase_orders
        on purchase_orders.id = goods_receipts.purchase_order_id
        and purchase_orders.tenant_id = goods_receipts.tenant_id
      join purchase_order_lines
        on purchase_order_lines.purchase_order_id = purchase_orders.id
        and purchase_order_lines.tenant_id = purchase_orders.tenant_id
      where goods_receipts.tenant_id = $1 and goods_receipts.id = $2
      group by purchase_orders.id, purchase_orders.display_number, purchase_orders.supplier_id
    `,
    [tenantId, goodsReceiptId],
  );
  const row = paymentBase.rows[0];
  if (!row) return null;

  const payment = await tx.query<{ id: string }>(
    `
      insert into purchase_payments (
        tenant_id, purchase_order_id, supplier_id, payment_number, status,
        due_date, currency_code, net_amount, tax_amount, shipping_amount, gross_amount
      )
      values ($1, $2, $3, $4, 'open', $5, $6, $7, 0, 0, $7)
      on conflict (tenant_id, purchase_order_id)
      do update set
        due_date = excluded.due_date,
        currency_code = excluded.currency_code,
        net_amount = excluded.net_amount,
        gross_amount = excluded.gross_amount,
        updated_at = now()
      returning id
    `,
    [
      tenantId,
      row.purchase_order_id,
      row.supplier_id,
      `PAY-${row.display_number}`,
      row.due_date,
      row.currency_code,
      row.net_amount,
    ],
  );

  return payment.rows[0]?.id ?? null;
}

export async function loadAccessControlSettings(
  db: QueryExecutor,
  tenantId: string,
) {
  const users = await db.query(
    `
      select operation_users.id, operation_users.email, operation_users.display_name,
        operation_users.is_admin, operation_users.is_active,
        string_agg(operation_groups.name, ', ' order by operation_groups.name) as groups,
        string_agg(operation_groups.key, ',' order by operation_groups.key) as group_keys
      from operation_users
      left join operation_user_groups
        on operation_user_groups.tenant_id = operation_users.tenant_id
        and operation_user_groups.user_id = operation_users.id
      left join operation_groups
        on operation_groups.id = operation_user_groups.group_id
        and operation_groups.tenant_id = operation_user_groups.tenant_id
      where operation_users.tenant_id = $1
      group by operation_users.id
      order by operation_users.is_admin desc, operation_users.email
    `,
    [tenantId],
  );
  const groups = await db.query(
    `
      select operation_groups.id, operation_groups.key, operation_groups.name,
        operation_groups.description,
        string_agg(
          operation_roles.resource || ':'
          || case when operation_roles.can_admin then 'admin' else '' end
          || case when operation_roles.can_read then ' read' else '' end
          || case when operation_roles.can_write then ' write' else '' end
          || case when operation_roles.can_execute then ' execute' else '' end,
          ', '
          order by operation_roles.resource
        ) as permissions
      from operation_groups
      left join operation_group_roles
        on operation_group_roles.tenant_id = operation_groups.tenant_id
        and operation_group_roles.group_id = operation_groups.id
      left join operation_roles
        on operation_roles.id = operation_group_roles.role_id
        and operation_roles.tenant_id = operation_group_roles.tenant_id
      where operation_groups.tenant_id = $1
      group by operation_groups.id
      order by operation_groups.key
    `,
    [tenantId],
  );

  return { users: users.rows, groups: groups.rows };
}

export async function upsertOperationUser(
  db: QueryExecutor,
  tenantId: string,
  input: {
    email: string;
    displayName: string;
    groupKey: string;
    isAdmin?: boolean;
  },
) {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const groupKey = input.groupKey.trim();
  const sharedPassword = "Operations123!";

  if (!email || !displayName || !groupKey) {
    throw new Error("Email, display name and group are required.");
  }

  return withKitTransaction(db, async (tx) => {
    const user = await tx.query<{ id: string }>(
      `
        insert into operation_users (
          tenant_id, email, display_name, password_hash, is_active, is_admin
        )
        values ($1, $2, $3, crypt($4, gen_salt('bf')), true, $5)
        on conflict (tenant_id, email)
        do update set
          display_name = excluded.display_name,
          is_active = true,
          is_admin = excluded.is_admin,
          updated_at = now()
        returning id
      `,
      [tenantId, email, displayName, sharedPassword, input.isAdmin ?? false],
    );

    const group = await tx.query<{ id: string }>(
      `
        select id
        from operation_groups
        where tenant_id = $1 and key = $2
      `,
      [tenantId, groupKey],
    );

    if (!group.rows[0]) throw new Error("Select an existing group.");

    await tx.query(
      `
        delete from operation_user_groups
        where tenant_id = $1 and user_id = $2
      `,
      [tenantId, user.rows[0].id],
    );

    await tx.query(
      `
        insert into operation_user_groups (tenant_id, user_id, group_id)
        values ($1, $2, $3)
        on conflict (tenant_id, user_id, group_id)
        do nothing
      `,
      [tenantId, user.rows[0].id, group.rows[0].id],
    );

    return { userId: user.rows[0].id, password: sharedPassword };
  });
}

export async function setOperationUserActive(
  db: QueryExecutor,
  tenantId: string,
  userId: string,
  isActive: boolean,
) {
  const result = await db.query<{ id: string }>(
    `
      update operation_users
      set is_active = $3, updated_at = now()
      where tenant_id = $1 and id = $2
      returning id
    `,
    [tenantId, userId, isActive],
  );

  return { updated: result.rows.length };
}

export async function passQcAndCreatePutaway(
  db: QueryExecutor,
  tenantId: string,
) {
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
        join items
          on items.id = production_orders.item_id
          and items.tenant_id = production_orders.tenant_id
        where production_orders.tenant_id = $1 and production_orders.status in ('ready', 'in_progress', 'approved')
          and ($2::uuid is null or production_orders.id = $2::uuid)
        order by production_orders.created_at desc
        limit 1
      `,
      [tenantId, productionOrderId ?? null],
    );
    if (!order.rows[0])
      return { productionOrderId: null, componentsConsumed: 0 };

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
        join items
          on items.id = production_orders.item_id
          and items.tenant_id = production_orders.tenant_id
        where production_orders.tenant_id = $1 and production_orders.id = $2
      `,
      [tenantId, input.productionOrderId],
    );
    const productionOrder = order.rows[0];
    if (!productionOrder)
      return { productionOrderId: null, accepted: 0, rejected: 0 };

    const quantity = Number(productionOrder.quantity);
    const accepted = Math.max(input.acceptedQuantity, 0);
    const rejected = Math.max(input.rejectedQuantity, 0);
    if (accepted + rejected > quantity) {
      throw new Error(
        "Accepted plus rejected quantity cannot exceed produced quantity.",
      );
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
        rejected > 0 && accepted > 0
          ? "partial"
          : rejected > 0
            ? "failed"
            : "passed",
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
  transition:
    | "pending_approval"
    | "approved"
    | "sent"
    | "acknowledged"
    | "cancelled",
) {
  if (transition === "approved" || transition === "sent") {
    const pricing = await db.query<{ missing_price_count: number }>(
      `
        select count(*)::int as missing_price_count
        from purchase_order_lines
        where tenant_id = $1
          and purchase_order_id = $2
          and (unit_price is null or unit_price <= 0)
      `,
      [tenantId, purchaseOrderId],
    );
    if ((pricing.rows[0]?.missing_price_count ?? 0) > 0) {
      throw new Error(
        "Add a unit price to every purchase order line before approving or sending this Purchase Order.",
      );
    }
  }

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

export async function reopenPurchaseOrderForEditing(
  db: QueryExecutor,
  tenantId: string,
  purchaseOrderId: string,
) {
  const result = await db.query<{ id: string }>(
    `
      update purchase_orders
      set status = 'draft', updated_at = now()
      where tenant_id = $1
        and id = $2
        and status in ('pending_approval', 'approved', 'sent', 'acknowledged')
        and not exists (
          select 1
          from goods_receipts
          where goods_receipts.tenant_id = purchase_orders.tenant_id
            and goods_receipts.purchase_order_id = purchase_orders.id
            and goods_receipts.status <> 'cancelled'
        )
      returning id
    `,
    [tenantId, purchaseOrderId],
  );
  if (!result.rows[0]) {
    throw new Error(
      "This Purchase Order cannot be released for editing after receiving work has started.",
    );
  }
}

export async function updatePurchaseOrderLinePricing(
  db: QueryExecutor,
  tenantId: string,
  input: {
    purchaseOrderLineId: string;
    quantity: number;
    unitPrice: number;
    currencyCode: string;
    expectedDeliveryDate?: string | null;
  },
) {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error("Quantity must be greater than zero.");
  }
  if (!Number.isFinite(input.unitPrice) || input.unitPrice <= 0) {
    throw new Error("Unit price must be greater than zero.");
  }

  const result = await db.query<{ id: string }>(
    `
      update purchase_order_lines
      set quantity = $3,
          unit_price = $4,
          currency_code = $5,
          expected_delivery_date = nullif($6, '')::date
      from purchase_orders
      where purchase_order_lines.tenant_id = $1
        and purchase_order_lines.id = $2
        and purchase_orders.id = purchase_order_lines.purchase_order_id
        and purchase_orders.tenant_id = purchase_order_lines.tenant_id
        and purchase_orders.status in ('draft', 'pending_approval')
      returning purchase_order_lines.id
    `,
    [
      tenantId,
      input.purchaseOrderLineId,
      input.quantity,
      input.unitPrice,
      input.currencyCode.trim() || "EUR",
      input.expectedDeliveryDate ?? "",
    ],
  );
  if (!result.rows[0]) {
    throw new Error(
      "Purchase Order line pricing can only be edited while the Purchase Order is in PO created status.",
    );
  }
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

export async function loadItems(
  db: QueryExecutor,
  tenantId: string,
  filters?: {
    query?: string;
    source?: string;
    shopifyStatus?: string;
    role?: string;
    supplierId?: string;
  },
) {
  const query = filters?.query?.trim() ?? "";
  const source = filters?.source ?? "all";
  const shopifyStatus = filters?.shopifyStatus ?? "all";
  const role = filters?.role ?? "all";
  const supplierId = filters?.supplierId ?? "all";
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
        ),
        preferred_supplier as (
          select distinct on (supplier_items.item_id)
            supplier_items.item_id,
            suppliers.id as preferred_supplier_id,
            suppliers.name as preferred_supplier_name
          from supplier_items
          join suppliers
            on suppliers.id = supplier_items.supplier_id
            and suppliers.tenant_id = supplier_items.tenant_id
          where supplier_items.tenant_id = $1
            and supplier_items.is_preferred
            and supplier_items.is_active
            and suppliers.is_active
          order by supplier_items.item_id, suppliers.name
        ),
        bom_summary as (
          select
            boms.parent_item_id,
            count(distinct boms.id) filter (where boms.is_active)::int as active_bom_count,
            count(bom_lines.id) filter (where boms.is_active)::int as active_bom_component_count
          from boms
          left join bom_lines on bom_lines.bom_id = boms.id
            and bom_lines.tenant_id = boms.tenant_id
          where boms.tenant_id = $1
          group by boms.parent_item_id
        )
        select items.*,
          coalesce(balances.available_quantity, 0) as available_quantity,
          coalesce(balances.reserved_quantity, 0) as reserved_quantity,
          preferred_supplier.preferred_supplier_id,
          preferred_supplier.preferred_supplier_name,
          coalesce(bom_summary.active_bom_count, 0) as active_bom_count,
          coalesce(bom_summary.active_bom_component_count, 0) as active_bom_component_count,
          case
            when items.shopify_product_gid is not null then 'shopify'
            else 'operations'
          end as product_source,
          case
            when items.shopify_product_gid is not null
              and items.is_active
              and coalesce(items.product_status, 'ACTIVE') = 'ACTIVE'
              and (items.shopify_published_at is not null or items.shopify_online_store_url is not null)
              then 'shop'
            when items.shopify_product_gid is not null then 'shopify_synced'
            else 'not_in_shop'
          end as shop_product_flag
        from items
      left join balances on balances.item_id = items.id
      left join preferred_supplier on preferred_supplier.item_id = items.id
      left join bom_summary on bom_summary.parent_item_id = items.id
        where items.tenant_id = $1
          and (
            $2 = ''
            or lower(items.sku) like '%' || lower($2) || '%'
            or lower(items.title) like '%' || lower($2) || '%'
          )
          and (
            $3 = 'all'
            or (
              $3 = 'shop'
              and items.shopify_product_gid is not null
              and items.is_active
              and coalesce(items.product_status, 'ACTIVE') = 'ACTIVE'
              and (items.shopify_published_at is not null or items.shopify_online_store_url is not null)
            )
            or ($3 = 'operations' and items.shopify_product_gid is null)
            or ($3 = 'components' and items.item_type in ('component', 'raw_material'))
          )
          and (
            $4 = 'all'
            or ($4 = 'active' and coalesce(items.product_status, 'ACTIVE') = 'ACTIVE' and items.is_active)
            or ($4 = 'draft' and items.product_status = 'DRAFT')
            or ($4 = 'archived' and items.product_status = 'ARCHIVED')
            or ($4 = 'missing' and (items.product_status = 'MISSING' or not items.is_active))
            or ($4 = 'not_published' and items.shopify_product_gid is not null and coalesce(items.product_status, 'ACTIVE') = 'ACTIVE' and items.is_active and items.shopify_published_at is null and items.shopify_online_store_url is null)
            or ($4 = 'operational' and items.shopify_product_gid is null)
          )
          and (
            $5 = 'all'
            or ($5 = 'sellable' and items.is_sellable)
            or ($5 = 'purchasable' and items.is_purchasable)
            or ($5 = 'producible' and items.is_producible)
            or ($5 = 'component' and items.item_type in ('component', 'raw_material'))
            or ($5 = 'review' and not items.is_sellable and not items.is_purchasable and not items.is_producible)
          )
          and (
            $6 = 'all'
            or ($6 = 'missing' and preferred_supplier.preferred_supplier_id is null)
            or preferred_supplier.preferred_supplier_id::text = $6
          )
        order by items.sku
      `,
      [tenantId, query, source, shopifyStatus, role, supplierId],
    )
  ).rows;
}

export async function loadSuppliers(db: QueryExecutor, tenantId: string) {
  return (
    await db.query(
      `
        select
          suppliers.*,
          count(supplier_items.id)::int as product_count,
          count(supplier_items.id) filter (where supplier_items.is_preferred)::int as preferred_count
        from suppliers
        left join supplier_items
          on supplier_items.supplier_id = suppliers.id
          and supplier_items.tenant_id = suppliers.tenant_id
        where suppliers.tenant_id = $1
        group by suppliers.id
        order by suppliers.is_active desc, suppliers.name
      `,
      [tenantId],
    )
  ).rows;
}

export async function saveSupplierMaster(
  db: QueryExecutor,
  tenantId: string,
  input: {
    supplierId?: string | null;
    name: string;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
    notes?: string | null;
    isActive: boolean;
  },
) {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Supplier name is required.");
  }

  if (input.supplierId) {
    await db.query(
      `
        update suppliers
        set name = $3,
            email = nullif($4, ''),
            phone = nullif($5, ''),
            website = nullif($6, ''),
            notes = nullif($7, ''),
            is_active = $8,
            updated_at = now()
        where tenant_id = $1 and id = $2
      `,
      [
        tenantId,
        input.supplierId,
        name,
        input.email?.trim() ?? "",
        input.phone?.trim() ?? "",
        input.website?.trim() ?? "",
        input.notes?.trim() ?? "",
        input.isActive,
      ],
    );
    return;
  }

  await db.query(
    `
      insert into suppliers (tenant_id, name, email, phone, website, notes, is_active)
      values ($1, $2, nullif($3, ''), nullif($4, ''), nullif($5, ''), nullif($6, ''), $7)
      on conflict (tenant_id, name)
      do update set
        email = excluded.email,
        phone = excluded.phone,
        website = excluded.website,
        notes = excluded.notes,
        is_active = excluded.is_active,
        updated_at = now()
    `,
    [
      tenantId,
      name,
      input.email?.trim() ?? "",
      input.phone?.trim() ?? "",
      input.website?.trim() ?? "",
      input.notes?.trim() ?? "",
      input.isActive,
    ],
  );
}

export async function createOperationsItem(
  db: QueryExecutor,
  tenantId: string,
  input: {
    sku: string;
    title: string;
    itemType: string;
    replenishmentPolicy: string;
    isSellable?: boolean;
    isPurchasable?: boolean;
    isProducible?: boolean;
    qcRequiredAfterPurchase?: boolean;
    qcRequiredAfterProduction?: boolean;
    minInventoryQuantity: number;
    defaultProductionQuantity: number;
    defaultOrderQuantity: number;
    supplierLeadTimeDays: number;
  },
) {
  const sku = input.sku.trim();
  const title = input.title.trim();
  const allowedItemTypes = new Set([
    "product",
    "assembly",
    "component",
    "raw_material",
  ]);
  const replenishmentPolicy = input.replenishmentPolicy;

  if (!sku || !title) {
    throw new Error(
      "SKU and title are required to create an operations product.",
    );
  }
  if (!allowedItemTypes.has(input.itemType)) {
    throw new Error("Unsupported product type.");
  }

  const isSellable =
    input.isSellable ??
    (input.itemType === "product" || input.itemType === "assembly");
  const isPurchasable = input.isPurchasable ?? replenishmentPolicy === "buy";
  const isProducible = input.isProducible ?? replenishmentPolicy === "make";
  const qcRequiredAfterPurchase =
    input.qcRequiredAfterPurchase ?? isPurchasable;
  const qcRequiredAfterProduction =
    input.qcRequiredAfterProduction ?? isProducible;

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
        $11, $12, $13, 'OPERATIONAL'
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
      qcRequiredAfterPurchase,
      qcRequiredAfterProduction,
    ],
  );

  return { itemId: result.rows[0].id, sku, title };
}

export async function loadItemDetail(
  db: QueryExecutor,
  tenantId: string,
  itemId: string,
) {
  const item = await db.query(
    `
      with balances as (
        select
          item_id,
          coalesce(sum(quantity_delta) filter (where location_code = 'MAIN'), 0) as physical_quantity,
          coalesce(sum(quantity_delta - reserved_delta) filter (where location_code = 'MAIN'), 0) as available_quantity,
          coalesce(sum(reserved_delta) filter (where location_code = 'MAIN'), 0) as reserved_quantity,
          coalesce(sum(quantity_delta) filter (where location_code = 'QC-HOLD'), 0) as qc_hold_quantity,
          coalesce(sum(quantity_delta) filter (where location_code = 'QUARANTINE'), 0) as quarantine_quantity
        from inventory_movements
        where tenant_id = $1
        group by item_id
      )
      select items.*,
        coalesce(balances.physical_quantity, 0) as physical_quantity,
        coalesce(balances.available_quantity, 0) as available_quantity,
        coalesce(balances.reserved_quantity, 0) as reserved_quantity,
        coalesce(balances.qc_hold_quantity, 0) as qc_hold_quantity,
        coalesce(balances.quarantine_quantity, 0) as quarantine_quantity
      from items
      left join balances on balances.item_id = items.id
      where items.tenant_id = $1 and items.id = $2
    `,
    [tenantId, itemId],
  );
  const bom = await db.query(
    `
      with component_balances as (
        select
          item_id,
          coalesce(sum(quantity_delta - reserved_delta) filter (where location_code = 'MAIN'), 0) as available_quantity
        from inventory_movements
        where tenant_id = $1
        group by item_id
      )
      select boms.id, boms.version, boms.is_active,
        component.id as component_id,
        component.sku as component_sku,
        component.title as component_title,
        component.item_type,
        component.is_purchasable,
        component.is_producible,
        coalesce(component_balances.available_quantity, 0) as component_available_quantity,
        bom_lines.quantity,
        bom_lines.unit
      from boms
      left join bom_lines
        on bom_lines.bom_id = boms.id
        and bom_lines.tenant_id = boms.tenant_id
      left join items component
        on component.id = bom_lines.component_item_id
        and component.tenant_id = bom_lines.tenant_id
      left join component_balances on component_balances.item_id = component.id
      where boms.tenant_id = $1 and boms.parent_item_id = $2
      order by component.sku
    `,
    [tenantId, itemId],
  );
  const suppliers = await db.query(
    `
      select
        suppliers.*,
        supplier_items.is_preferred,
        supplier_items.supplier_sku,
        supplier_items.unit_price,
        supplier_items.currency_code,
        supplier_items.lead_time_days,
        supplier_items.minimum_order_quantity,
        supplier_items.is_active as supplier_item_is_active
      from supplier_items
      join suppliers
        on suppliers.id = supplier_items.supplier_id
        and suppliers.tenant_id = supplier_items.tenant_id
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
  const allSuppliers = await db.query(
    `
      select id, name, email, is_active
      from suppliers
      where tenant_id = $1
      order by is_active desc, name
    `,
    [tenantId],
  );
  const orderLines = await db.query(
    `
      select
        operations_order_lines.id,
        operations_order_lines.quantity,
        operations_order_lines.unit,
        operations_order_lines.supply_status,
        operations_orders.id as operations_order_id,
        operations_orders.order_name,
        operations_orders.status as order_status,
        operations_orders.fulfillment_status
      from operations_order_lines
      join operations_orders
        on operations_orders.id = operations_order_lines.operations_order_id
        and operations_orders.tenant_id = operations_order_lines.tenant_id
      where operations_order_lines.tenant_id = $1
        and operations_order_lines.item_id = $2
        and operations_order_lines.supply_status <> 'cancelled'
        and operations_orders.status in ('open', 'planned', 'in_progress')
      order by operations_orders.processed_at desc nulls last,
        operations_orders.created_at desc
      limit 8
    `,
    [tenantId, itemId],
  );
  const purchaseWork = await db.query(
    `
      select purchase_needs.id,
        purchase_needs.status as purchase_need_status,
        purchase_needs.quantity,
        purchase_needs.unit,
        suppliers.name as supplier_name,
        purchase_orders.id as purchase_order_id,
        purchase_orders.display_number as purchase_order_number,
        purchase_orders.status as purchase_order_status
      from purchase_needs
      left join suppliers
        on suppliers.id = purchase_needs.supplier_id
        and suppliers.tenant_id = purchase_needs.tenant_id
      left join purchase_order_lines
        on purchase_order_lines.purchase_need_id = purchase_needs.id
        and purchase_order_lines.tenant_id = purchase_needs.tenant_id
      left join purchase_orders
        on purchase_orders.id = purchase_order_lines.purchase_order_id
        and purchase_orders.tenant_id = purchase_order_lines.tenant_id
      where purchase_needs.tenant_id = $1 and purchase_needs.item_id = $2
      order by purchase_needs.created_at desc
      limit 8
    `,
    [tenantId, itemId],
  );
  const productionWork = await db.query(
    `
      select production_needs.id,
        production_needs.status as production_need_status,
        production_needs.quantity,
        production_needs.unit,
        production_orders.id as production_order_id,
        production_orders.display_number as production_order_number,
        production_orders.status as production_order_status
      from production_needs
      left join production_orders
        on production_orders.production_need_id = production_needs.id
        and production_orders.tenant_id = production_needs.tenant_id
      where production_needs.tenant_id = $1 and production_needs.item_id = $2
      order by production_needs.created_at desc
      limit 8
    `,
    [tenantId, itemId],
  );

  return {
    item: item.rows[0] ?? null,
    bomLines: bom.rows,
    suppliers: suppliers.rows,
    allSuppliers: allSuppliers.rows,
    availableComponents: components.rows,
    orderLines: orderLines.rows,
    purchaseWork: purchaseWork.rows,
    productionWork: productionWork.rows,
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
  const allowedItemTypes = new Set([
    "product",
    "component",
    "raw_material",
    "assembly",
  ]);
  if (!allowedItemTypes.has(input.itemType)) {
    throw new Error("Unsupported product type.");
  }

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

export async function saveSupplierForItem(
  db: QueryExecutor,
  tenantId: string,
  input: {
    itemId: string;
    supplierId: string;
    isPreferred: boolean;
    supplierSku?: string | null;
    unitPrice?: number | null;
    currencyCode?: string | null;
    leadTimeDays?: number | null;
    minimumOrderQuantity?: number | null;
  },
) {
  if (!input.supplierId) {
    throw new Error("Select a supplier before saving purchasing terms.");
  }

  return withKitTransaction(db, async (tx) => {
    const tenantScope = await tx.query<{ exists: boolean }>(
      `
        select exists (
          select 1
          from items
          join suppliers
            on suppliers.tenant_id = items.tenant_id
            and suppliers.id = $3
          where items.tenant_id = $1
            and items.id = $2
        ) as exists
      `,
      [tenantId, input.itemId, input.supplierId],
    );
    if (!tenantScope.rows[0]?.exists) {
      throw new Error("Select a tenant item and supplier before saving purchasing terms.");
    }

    if (input.isPreferred) {
      await tx.query(
        "update supplier_items set is_preferred = false, updated_at = now() where tenant_id = $1 and item_id = $2",
        [tenantId, input.itemId],
      );
    }

    await tx.query(
      `
        insert into supplier_items (
          tenant_id, supplier_id, item_id, is_preferred, supplier_sku,
          unit_price, currency_code, lead_time_days, minimum_order_quantity,
          is_active, updated_at
        )
        values ($1, $2, $3, $4, nullif($5, ''), $6, $7, $8, $9, true, now())
        on conflict (tenant_id, supplier_id, item_id)
        do update set
          is_preferred = excluded.is_preferred,
          supplier_sku = excluded.supplier_sku,
          unit_price = excluded.unit_price,
          currency_code = excluded.currency_code,
          lead_time_days = excluded.lead_time_days,
          minimum_order_quantity = excluded.minimum_order_quantity,
          is_active = true,
          updated_at = now()
      `,
      [
        tenantId,
        input.supplierId,
        input.itemId,
        input.isPreferred,
        input.supplierSku?.trim() ?? "",
        input.unitPrice == null || Number.isNaN(input.unitPrice)
          ? null
          : input.unitPrice,
        input.currencyCode?.trim() || "EUR",
        input.leadTimeDays == null || Number.isNaN(input.leadTimeDays)
          ? null
          : Math.max(input.leadTimeDays, 0),
        input.minimumOrderQuantity == null ||
        Number.isNaN(input.minimumOrderQuantity)
          ? null
          : Math.max(input.minimumOrderQuantity, 0),
      ],
    );
  });
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
    if (!input.componentItemId) {
      throw new Error("Select a component before saving the BOM line.");
    }
    if (input.parentItemId === input.componentItemId) {
      throw new Error("A product cannot be a component of itself.");
    }

    const parent = await tx.query<{
      is_producible: boolean;
      component_is_same_tenant: boolean;
    }>(
      `
        select
          parent.is_producible,
          component.id is not null as component_is_same_tenant
        from items parent
        left join items component
          on component.tenant_id = parent.tenant_id
          and component.id = $3
        where parent.tenant_id = $1
          and parent.id = $2
      `,
      [tenantId, input.parentItemId, input.componentItemId],
    );
    if (!parent.rows[0]?.is_producible) {
      throw new Error("Only producible items can have an active BOM.");
    }
    if (!parent.rows[0]?.component_is_same_tenant) {
      throw new Error("Select a tenant component before saving the BOM line.");
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
      [
        tenantId,
        bom.rows[0].id,
        input.componentItemId,
        Math.max(Number(input.quantity) || 1, 1),
      ],
    );
  });
}

export async function updateBomLineQuantity(
  db: QueryExecutor,
  tenantId: string,
  input: {
    bomLineId: string;
    quantity: number;
    unit?: string | null;
  },
) {
  const quantity = Number(input.quantity);
  if (!input.bomLineId) {
    throw new Error("BOM line is required.");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Quantity must be greater than zero.");
  }

  const result = await db.query<{ id: string }>(
    `
      update bom_lines
      set quantity = $3,
          unit = coalesce(nullif($4, ''), unit)
      where tenant_id = $1 and id = $2
      returning id
    `,
    [tenantId, input.bomLineId, quantity, input.unit?.trim() ?? ""],
  );
  if (!result.rows[0]) {
    throw new Error("BOM component not found.");
  }
}

export async function deleteBomLine(
  db: QueryExecutor,
  tenantId: string,
  bomLineId: string,
) {
  if (!bomLineId) {
    throw new Error("BOM line is required.");
  }

  const result = await db.query<{ id: string }>(
    `
      delete from bom_lines
      where tenant_id = $1 and id = $2
      returning id
    `,
    [tenantId, bomLineId],
  );
  if (!result.rows[0]) {
    throw new Error("BOM component not found.");
  }
}

export async function createActiveBomForItem(
  db: QueryExecutor,
  tenantId: string,
  parentItemId: string,
) {
  const parent = await db.query<{
    id: string;
    is_producible: boolean;
    item_type: string;
  }>(
    "select id, is_producible, item_type from items where tenant_id = $1 and id = $2",
    [tenantId, parentItemId],
  );
  if (!parent.rows[0]) {
    throw new Error("Parent product not found.");
  }
  if (!parent.rows[0].is_producible) {
    throw new Error("Only producible products can have an active BOM.");
  }

  const bom = await db.query<{ id: string }>(
    `
      insert into boms (tenant_id, parent_item_id, version, is_active)
      values ($1, $2, '1', true)
      on conflict (tenant_id, parent_item_id, version)
      do update set is_active = true, updated_at = now()
      returning id
    `,
    [tenantId, parentItemId],
  );

  return { bomId: bom.rows[0].id };
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

export async function loadOperationsOrdersList(
  db: QueryExecutor,
  tenantId: string,
) {
  const rows = (
    await db.query(
      `
        with movement_balances as (
          select
            inventory_movements.item_id,
            coalesce(sum(inventory_movements.quantity_delta) filter (where inventory_movements.location_code = 'MAIN'), 0) as physical_quantity,
            coalesce(sum(inventory_movements.quantity_delta - inventory_movements.reserved_delta) filter (where inventory_movements.location_code = 'MAIN'), 0) as available_quantity
          from inventory_movements
          where inventory_movements.tenant_id = $1
          group by inventory_movements.item_id
        ),
        open_purchase_orders as (
          select
            purchase_order_lines.item_id,
            coalesce(sum(purchase_order_lines.quantity), 0) as ordered_quantity
          from purchase_order_lines
          join purchase_orders
            on purchase_orders.id = purchase_order_lines.purchase_order_id
            and purchase_orders.tenant_id = purchase_order_lines.tenant_id
          where purchase_order_lines.tenant_id = $1
            and purchase_order_lines.status = 'open'
            and purchase_orders.status in ('draft', 'pending_approval', 'approved', 'sent', 'acknowledged')
          group by purchase_order_lines.item_id
        ),
        item_availability as (
          select
            items.id as item_id,
            coalesce(movement_balances.physical_quantity, 0) as physical_quantity,
            coalesce(movement_balances.available_quantity, 0) as available_quantity,
            coalesce(open_purchase_orders.ordered_quantity, 0) as ordered_quantity,
            coalesce(movement_balances.available_quantity, 0)
              + coalesce(open_purchase_orders.ordered_quantity, 0) as planned_quantity
          from items
          left join movement_balances on movement_balances.item_id = items.id
          left join open_purchase_orders on open_purchase_orders.item_id = items.id
          where items.tenant_id = $1
        ),
        procurement_context as (
          select
            mrp_runs.operations_order_id,
            purchase_needs.source_order_line_id,
            purchase_needs.item_id,
            count(*)::int as procurement_count,
            count(*) filter (where purchase_order_lines.id is null)::int as proposal_count,
            count(*) filter (where purchase_orders.status in ('draft', 'pending_approval', 'approved'))::int as po_created_count,
            count(*) filter (where purchase_orders.status = 'sent')::int as po_sent_count,
            count(*) filter (where purchase_orders.status = 'acknowledged' and goods_receipts.id is null)::int as po_acknowledged_count,
            count(*) filter (where goods_receipts.status in ('posted', 'qc_required'))::int as receiving_qc_count,
            count(*) filter (where goods_receipts.status = 'putaway_pending')::int as putaway_pending_count,
            count(*) filter (
              where goods_receipts.status = 'closed'
                or goods_receipt_lines.status = 'putaway_done'
            )::int as inventory_booked_count
          from purchase_needs
          join mrp_runs
            on mrp_runs.id = purchase_needs.mrp_run_id
            and mrp_runs.tenant_id = purchase_needs.tenant_id
          left join purchase_order_lines
            on purchase_order_lines.purchase_need_id = purchase_needs.id
            and purchase_order_lines.tenant_id = purchase_needs.tenant_id
          left join purchase_orders
            on purchase_orders.id = purchase_order_lines.purchase_order_id
            and purchase_orders.tenant_id = purchase_order_lines.tenant_id
          left join goods_receipt_lines
            on goods_receipt_lines.purchase_order_line_id = purchase_order_lines.id
            and goods_receipt_lines.tenant_id = purchase_order_lines.tenant_id
          left join goods_receipts
            on goods_receipts.id = goods_receipt_lines.goods_receipt_id
            and goods_receipts.tenant_id = goods_receipt_lines.tenant_id
          where purchase_needs.tenant_id = $1
            and purchase_needs.status <> 'cancelled'
          group by mrp_runs.operations_order_id, purchase_needs.source_order_line_id, purchase_needs.item_id
        ),
        item_production as (
          select item_id, count(*)::int as production_count
          from production_needs
          where tenant_id = $1
          group by item_id
        ),
        line_logistics as (
          select
            shipping_order_lines.operations_order_line_id,
            count(*)::int as logistics_count,
            count(*) filter (where shipping_orders.status in ('open', 'picking'))::int as shipment_open_count,
            count(*) filter (where shipping_orders.status in ('packed', 'partially_shipped'))::int as shipment_packed_count,
            count(*) filter (where shipping_orders.status = 'shipped')::int as shipment_shipped_count,
            max(shipping_orders.shipped_at) filter (where shipping_orders.status = 'shipped') as latest_shipped_at,
            string_agg(distinct shipping_orders.shipment_number, ', ' order by shipping_orders.shipment_number) as shipment_numbers
          from shipping_order_lines
          join shipping_orders
            on shipping_orders.id = shipping_order_lines.shipping_order_id
            and shipping_orders.tenant_id = shipping_order_lines.tenant_id
          where shipping_order_lines.tenant_id = $1
          group by shipping_order_lines.operations_order_line_id
        ),
        line_context as (
          select
            operations_order_lines.id,
            operations_order_lines.operations_order_id,
            operations_order_lines.item_id,
            operations_order_lines.quantity,
            operations_order_lines.supply_status,
            operations_orders.status as order_status,
            operations_orders.processed_at as order_processed_at,
            operations_orders.created_at as order_created_at,
            coalesce(operations_order_lines.sku, items.sku) as sku,
            coalesce(operations_order_lines.title, items.title) as title,
            items.is_sellable,
            items.is_purchasable,
            items.is_producible,
            coalesce(item_availability.available_quantity, 0) as available_quantity,
            coalesce(item_availability.planned_quantity, 0) as planned_quantity,
            coalesce(direct_line_procurement.proposal_count, 0) + coalesce(order_procurement.proposal_count, 0) + coalesce(fallback_procurement.proposal_count, 0) as proposal_count,
            coalesce(direct_line_procurement.po_created_count, 0) + coalesce(order_procurement.po_created_count, 0) + coalesce(fallback_procurement.po_created_count, 0) as po_created_count,
            coalesce(direct_line_procurement.po_sent_count, 0) + coalesce(order_procurement.po_sent_count, 0) + coalesce(fallback_procurement.po_sent_count, 0) as po_sent_count,
            coalesce(direct_line_procurement.po_acknowledged_count, 0) + coalesce(order_procurement.po_acknowledged_count, 0) + coalesce(fallback_procurement.po_acknowledged_count, 0) as po_acknowledged_count,
            coalesce(direct_line_procurement.receiving_qc_count, 0) + coalesce(order_procurement.receiving_qc_count, 0) + coalesce(fallback_procurement.receiving_qc_count, 0) as receiving_qc_count,
            coalesce(direct_line_procurement.putaway_pending_count, 0) + coalesce(order_procurement.putaway_pending_count, 0) + coalesce(fallback_procurement.putaway_pending_count, 0) as putaway_pending_count,
            coalesce(direct_line_procurement.inventory_booked_count, 0) + coalesce(order_procurement.inventory_booked_count, 0) + coalesce(fallback_procurement.inventory_booked_count, 0) as inventory_booked_count,
            coalesce(fallback_procurement.procurement_count, 0) as fallback_procurement_count,
            coalesce(direct_line_procurement.procurement_count, 0) + coalesce(order_procurement.procurement_count, 0) + coalesce(fallback_procurement.procurement_count, 0) > 0 as has_procurement,
            coalesce(item_production.production_count, 0) > 0 as has_production,
            coalesce(line_logistics.logistics_count, 0) > 0 as has_logistics,
            coalesce(line_logistics.shipment_open_count, 0) as shipment_open_count,
            coalesce(line_logistics.shipment_packed_count, 0) as shipment_packed_count,
            coalesce(line_logistics.shipment_shipped_count, 0) as shipment_shipped_count,
            line_logistics.latest_shipped_at,
            line_logistics.shipment_numbers
          from operations_order_lines
          join operations_orders
            on operations_orders.id = operations_order_lines.operations_order_id
            and operations_orders.tenant_id = operations_order_lines.tenant_id
          join items
            on items.id = operations_order_lines.item_id
            and items.tenant_id = operations_order_lines.tenant_id
          left join item_availability on item_availability.item_id = operations_order_lines.item_id
          left join procurement_context direct_line_procurement
            on direct_line_procurement.source_order_line_id = operations_order_lines.id
          left join procurement_context order_procurement
            on order_procurement.item_id = operations_order_lines.item_id
            and order_procurement.source_order_line_id is null
            and order_procurement.operations_order_id = operations_order_lines.operations_order_id
          left join procurement_context fallback_procurement
            on fallback_procurement.item_id = operations_order_lines.item_id
            and fallback_procurement.source_order_line_id is null
            and fallback_procurement.operations_order_id is null
          left join item_production on item_production.item_id = operations_order_lines.item_id
          left join line_logistics on line_logistics.operations_order_line_id = operations_order_lines.id
          where operations_order_lines.tenant_id = $1
        ),
        line_allocations as (
          select
            line_context.*,
            coalesce(
              sum(
                case
                  when line_context.order_status in ('open', 'planned', 'in_progress')
                    and line_context.supply_status <> 'cancelled'
                  then line_context.quantity
                  else 0
                end
              ) over (
                partition by line_context.item_id
                order by line_context.order_processed_at nulls last,
                  line_context.order_created_at,
                  line_context.id
                rows between unbounded preceding and 1 preceding
              ),
              0
            ) as prior_open_demand_quantity
          from line_context
        ),
        line_decisions as (
          select
            line_allocations.*,
            (
              not line_allocations.is_sellable
              and not line_allocations.is_purchasable
              and not line_allocations.is_producible
            ) as master_data_missing,
            (
              line_allocations.has_procurement
              or line_allocations.has_production
              or line_allocations.has_logistics
            ) as has_work,
            (
              line_allocations.supply_status = 'reserved'
              or greatest(
                line_allocations.available_quantity - line_allocations.prior_open_demand_quantity,
                0
              ) >= line_allocations.quantity
            ) as stock_ready
          from line_allocations
        ),
        order_summary as (
          select
            line_decisions.operations_order_id,
            count(line_decisions.id)::int as line_count,
            string_agg(line_decisions.sku, ', ' order by line_decisions.sku) as skus,
            string_agg(
              concat(
                trim(to_char(line_decisions.quantity, 'FM999999990.####')),
                ' × ',
                line_decisions.sku,
                ' ',
                line_decisions.title
              ),
              ' || ' order by line_decisions.sku
            ) as product_summary,
            coalesce(sum(greatest(0, line_decisions.quantity - line_decisions.available_quantity)), 0) as shortage_quantity,
            coalesce(sum(greatest(0, line_decisions.quantity - line_decisions.planned_quantity)), 0) as planned_shortage_quantity,
            coalesce(sum(line_decisions.proposal_count), 0)::int as proposal_count,
            coalesce(sum(line_decisions.po_created_count), 0)::int as po_created_count,
            coalesce(sum(line_decisions.po_sent_count), 0)::int as po_sent_count,
            coalesce(sum(line_decisions.po_acknowledged_count), 0)::int as po_acknowledged_count,
            coalesce(sum(line_decisions.receiving_qc_count), 0)::int as receiving_qc_count,
            coalesce(sum(line_decisions.putaway_pending_count), 0)::int as putaway_pending_count,
            coalesce(sum(line_decisions.inventory_booked_count), 0)::int as inventory_booked_count,
            coalesce(sum(line_decisions.fallback_procurement_count), 0)::int as fallback_procurement_count,
            coalesce(sum(line_decisions.shipment_open_count), 0)::int as shipment_open_count,
            coalesce(sum(line_decisions.shipment_packed_count), 0)::int as shipment_packed_count,
            coalesce(sum(line_decisions.shipment_shipped_count), 0)::int as shipment_shipped_count,
            max(line_decisions.latest_shipped_at) as latest_shipped_at,
            (count(*) filter (
              where line_decisions.master_data_missing
                or (
                  not line_decisions.has_work
                  and not line_decisions.stock_ready
                  and not line_decisions.is_purchasable
                  and not line_decisions.is_producible
                )
            ))::int as review_lines,
            (count(*) filter (
              where line_decisions.has_procurement
                or (
                  not line_decisions.master_data_missing
                  and not line_decisions.has_work
                  and not line_decisions.stock_ready
                  and line_decisions.is_purchasable
                )
            ))::int as procurement_lines,
            (count(*) filter (
              where line_decisions.has_production
                or (
                  not line_decisions.master_data_missing
                  and not line_decisions.has_work
                  and not line_decisions.stock_ready
                  and not line_decisions.is_purchasable
                  and line_decisions.is_producible
                )
            ))::int as production_lines,
            (count(*) filter (
              where not line_decisions.master_data_missing
                and line_decisions.stock_ready
            ))::int as ready_lines,
            (count(*) filter (
              where line_decisions.has_work
            ))::int as in_progress_lines,
            (count(*) filter (
              where line_decisions.has_logistics
            ))::int as logistics_lines,
            string_agg(distinct line_decisions.shipment_numbers, ', ' order by line_decisions.shipment_numbers)
              filter (where line_decisions.shipment_numbers is not null) as shipment_numbers
          from line_decisions
          group by line_decisions.operations_order_id
        )
        select operations_orders.*,
          coalesce(order_summary.line_count, 0)::int as line_count,
          order_summary.skus,
          order_summary.product_summary,
          coalesce(order_summary.review_lines, 0)::int as review_lines,
          coalesce(order_summary.procurement_lines, 0)::int as procurement_lines,
          coalesce(order_summary.production_lines, 0)::int as production_lines,
          coalesce(order_summary.ready_lines, 0)::int as ready_lines,
          coalesce(order_summary.in_progress_lines, 0)::int as in_progress_lines,
          coalesce(order_summary.logistics_lines, 0)::int as logistics_lines,
          coalesce(order_summary.proposal_count, 0)::int as proposal_count,
          coalesce(order_summary.po_created_count, 0)::int as po_created_count,
          coalesce(order_summary.po_sent_count, 0)::int as po_sent_count,
          coalesce(order_summary.po_acknowledged_count, 0)::int as po_acknowledged_count,
          coalesce(order_summary.receiving_qc_count, 0)::int as receiving_qc_count,
          coalesce(order_summary.putaway_pending_count, 0)::int as putaway_pending_count,
          coalesce(order_summary.inventory_booked_count, 0)::int as inventory_booked_count,
          coalesce(order_summary.fallback_procurement_count, 0)::int as fallback_procurement_count,
          coalesce(order_summary.shipment_open_count, 0)::int as shipment_open_count,
          coalesce(order_summary.shipment_packed_count, 0)::int as shipment_packed_count,
          coalesce(order_summary.shipment_shipped_count, 0)::int as shipment_shipped_count,
          order_summary.latest_shipped_at,
          order_summary.shipment_numbers,
          case
            when coalesce(order_summary.line_count, 0) = 0 then 'unchecked'
            when coalesce(order_summary.shortage_quantity, 0) <= 0 then 'available'
            when coalesce(order_summary.planned_shortage_quantity, 0) <= 0 then 'incoming'
            else 'short'
          end as stock_state,
          case
            when coalesce(order_summary.line_count, 0) = 0 then 'No lines'
            when coalesce(order_summary.shortage_quantity, 0) <= 0 then 'Available'
            when coalesce(order_summary.planned_shortage_quantity, 0) <= 0 then 'Incoming covers'
            else concat('Short ', trim(to_char(order_summary.planned_shortage_quantity, 'FM999999990.####')))
          end as stock_label,
          case
            when upper(coalesce(operations_orders.fulfillment_status, '')) = 'FULFILLED'
              then 'Complete'
            when upper(coalesce(operations_orders.fulfillment_status, '')) = 'CLOSED'
              then 'Complete'
            when (
              operations_orders.status = 'closed'
              or coalesce(order_summary.shipment_shipped_count, 0) > 0
            )
              and (
                operations_orders.customer_name_encrypted is null
                or operations_orders.customer_email_encrypted is null
                or operations_orders.shipping_address_encrypted is null
              ) then 'Shipment complete, address missing in Operations Kit'
            when operations_orders.status = 'closed'
              or coalesce(order_summary.shipment_shipped_count, 0) > 0 then 'Complete'
            when coalesce(order_summary.shipment_open_count, 0) > 0
              or coalesce(order_summary.shipment_packed_count, 0) > 0 then 'Shipment created'
            when coalesce(order_summary.line_count, 0) > 0
              and coalesce(order_summary.ready_lines, 0) = coalesce(order_summary.line_count, 0)
              and (
                operations_orders.customer_name_encrypted is null
                or operations_orders.customer_email_encrypted is null
                or operations_orders.shipping_address_encrypted is null
              ) then 'Logistics blocked'
            when coalesce(order_summary.line_count, 0) > 0
              and coalesce(order_summary.ready_lines, 0) = coalesce(order_summary.line_count, 0)
              then 'Ready for logistics'
            when coalesce(order_summary.putaway_pending_count, 0) > 0 then 'Putaway pending'
            when coalesce(order_summary.receiving_qc_count, 0) > 0 then 'Receiving / QC'
            when coalesce(order_summary.po_acknowledged_count, 0) > 0 then 'Awaiting receipt'
            when coalesce(order_summary.po_sent_count, 0) > 0 then 'Sent to supplier'
            when coalesce(order_summary.po_created_count, 0) > 0 then 'Purchase Order created'
            when coalesce(order_summary.proposal_count, 0) > 0 then 'Purchase proposal ready'
            when coalesce(order_summary.review_lines, 0) > 0 then 'Review required'
            when coalesce(order_summary.procurement_lines, 0) > 0 then 'Needs planning'
            when coalesce(order_summary.production_lines, 0) > 0 then 'Production in progress'
            when coalesce(order_summary.line_count, 0) = 0 then 'Needs planning'
            else 'Needs planning'
          end as operational_status,
          case
            when upper(coalesce(operations_orders.fulfillment_status, '')) in ('FULFILLED', 'CLOSED')
              then 'success'
            when (
              operations_orders.status = 'closed'
              or coalesce(order_summary.shipment_shipped_count, 0) > 0
            )
              and (
                operations_orders.customer_name_encrypted is null
                or operations_orders.customer_email_encrypted is null
                or operations_orders.shipping_address_encrypted is null
              ) then 'warning'
            when operations_orders.status = 'closed'
              or coalesce(order_summary.shipment_shipped_count, 0) > 0 then 'success'
            when coalesce(order_summary.shipment_open_count, 0) > 0
              or coalesce(order_summary.shipment_packed_count, 0) > 0 then 'info'
            when coalesce(order_summary.line_count, 0) > 0
              and coalesce(order_summary.ready_lines, 0) = coalesce(order_summary.line_count, 0)
              and (
                operations_orders.customer_name_encrypted is null
                or operations_orders.customer_email_encrypted is null
                or operations_orders.shipping_address_encrypted is null
              ) then 'warning'
            when coalesce(order_summary.line_count, 0) > 0
              and coalesce(order_summary.ready_lines, 0) = coalesce(order_summary.line_count, 0)
              then 'success'
            when coalesce(order_summary.putaway_pending_count, 0) > 0 then 'warning'
            when coalesce(order_summary.receiving_qc_count, 0) > 0 then 'warning'
            when coalesce(order_summary.po_acknowledged_count, 0) > 0 then 'info'
            when coalesce(order_summary.po_sent_count, 0) > 0 then 'info'
            when coalesce(order_summary.po_created_count, 0) > 0 then 'info'
            when coalesce(order_summary.proposal_count, 0) > 0 then 'warning'
            when coalesce(order_summary.review_lines, 0) > 0 then 'critical'
            when coalesce(order_summary.procurement_lines, 0) > 0 then 'warning'
            when coalesce(order_summary.production_lines, 0) > 0 then 'warning'
            else 'info'
          end as operational_status_tone,
          case
            when upper(coalesce(operations_orders.fulfillment_status, '')) = 'FULFILLED'
              then 'Shopify already reports this order as fulfilled.'
            when upper(coalesce(operations_orders.fulfillment_status, '')) = 'CLOSED'
              then 'Shopify already reports this order as closed.'
            when (
              operations_orders.status = 'closed'
              or coalesce(order_summary.shipment_shipped_count, 0) > 0
            )
              and (
                operations_orders.customer_name_encrypted is null
                or operations_orders.customer_email_encrypted is null
                or operations_orders.shipping_address_encrypted is null
              )
              then 'Shipment is complete, but Operations Kit is missing customer name, email or shipping address.'
            when operations_orders.status = 'closed'
              or coalesce(order_summary.shipment_shipped_count, 0) > 0
              then 'Shipment work is complete for this order.'
            when coalesce(order_summary.shipment_open_count, 0) > 0
              or coalesce(order_summary.shipment_packed_count, 0) > 0
              then coalesce(order_summary.shipment_numbers, 'Shipping work has been created.')
            when coalesce(order_summary.line_count, 0) > 0
              and coalesce(order_summary.ready_lines, 0) = coalesce(order_summary.line_count, 0)
              and (
                operations_orders.customer_name_encrypted is null
                or operations_orders.customer_email_encrypted is null
                or operations_orders.shipping_address_encrypted is null
              )
              then 'Inventory is ready, but customer name, email or shipping address is missing.'
            when coalesce(order_summary.line_count, 0) > 0
              and coalesce(order_summary.ready_lines, 0) = coalesce(order_summary.line_count, 0)
              then 'All lines are available for logistics.'
            when coalesce(order_summary.putaway_pending_count, 0) > 0
              then 'Accepted goods are waiting to be put away to inventory.'
            when coalesce(order_summary.receiving_qc_count, 0) > 0
              then 'Goods are received and waiting for QC or inventory booking.'
            when coalesce(order_summary.po_acknowledged_count, 0) > 0
              then case
                when coalesce(order_summary.fallback_procurement_count, 0) > 0
                  then 'Supplier acknowledged the Purchase Order. This procurement context is item-level because no direct order-line link is available.'
                else 'Supplier acknowledged the Purchase Order. Create or open a goods receipt.'
              end
            when coalesce(order_summary.po_sent_count, 0) > 0
              then case
                when coalesce(order_summary.fallback_procurement_count, 0) > 0
                  then 'Purchase Order was sent to the supplier. This procurement context is item-level because no direct order-line link is available.'
                else 'Purchase Order was sent to the supplier.'
              end
            when coalesce(order_summary.po_created_count, 0) > 0
              then case
                when coalesce(order_summary.fallback_procurement_count, 0) > 0
                  then 'Purchase Order exists. This procurement context is item-level because no direct order-line link is available.'
                else 'Purchase Order exists and is waiting for the next procurement step.'
              end
            when coalesce(order_summary.proposal_count, 0) > 0
              then case
                when coalesce(order_summary.fallback_procurement_count, 0) > 0
                  then 'Purchase proposal exists. This procurement context is item-level because no direct order-line link is available.'
                else 'Purchase proposal exists. Create a Purchase Order.'
              end
            when coalesce(order_summary.review_lines, 0) > 0
              then 'At least one order line is missing operational product data.'
            when coalesce(order_summary.procurement_lines, 0) > 0
              then 'Open Procurement to refresh purchasing needs for order shortages.'
            when coalesce(order_summary.production_lines, 0) > 0
              then 'At least one line needs production or has production work.'
            else 'Open Procurement to plan required trading-goods purchasing.'
          end as next_reason,
          case
            when upper(coalesce(operations_orders.fulfillment_status, '')) in ('FULFILLED', 'CLOSED')
              then 'Open order'
            when operations_orders.status = 'closed'
              or coalesce(order_summary.shipment_shipped_count, 0) > 0 then 'Open order'
            when coalesce(order_summary.shipment_open_count, 0) > 0
              or coalesce(order_summary.shipment_packed_count, 0) > 0 then 'Open Logistics'
            when coalesce(order_summary.line_count, 0) > 0
              and coalesce(order_summary.ready_lines, 0) = coalesce(order_summary.line_count, 0)
              then 'Open Logistics'
            when coalesce(order_summary.putaway_pending_count, 0) > 0 then 'Open Receiving'
            when coalesce(order_summary.receiving_qc_count, 0) > 0 then 'Open Receiving'
            when coalesce(order_summary.po_acknowledged_count, 0) > 0 then 'Open Receiving'
            when coalesce(order_summary.po_sent_count, 0) > 0 then 'Open Procurement'
            when coalesce(order_summary.po_created_count, 0) > 0 then 'Open Procurement'
            when coalesce(order_summary.proposal_count, 0) > 0 then 'Open Procurement'
            when coalesce(order_summary.review_lines, 0) > 0 then 'Review order lines'
            when coalesce(order_summary.procurement_lines, 0) > 0 then 'Open Procurement'
            when coalesce(order_summary.production_lines, 0) > 0 then 'Open Production'
            else 'Open Procurement'
          end as next_action_label,
          case
            when upper(coalesce(operations_orders.fulfillment_status, '')) in ('FULFILLED', 'CLOSED')
              then concat('/app/orders/', operations_orders.id)
            when operations_orders.status = 'closed'
              or coalesce(order_summary.shipment_shipped_count, 0) > 0 then concat('/app/orders/', operations_orders.id)
            when coalesce(order_summary.shipment_open_count, 0) > 0
              or coalesce(order_summary.shipment_packed_count, 0) > 0 then '/app/logistics'
            when coalesce(order_summary.line_count, 0) > 0
              and coalesce(order_summary.ready_lines, 0) = coalesce(order_summary.line_count, 0)
              then '/app/logistics'
            when coalesce(order_summary.putaway_pending_count, 0) > 0 then '/app/receiving'
            when coalesce(order_summary.receiving_qc_count, 0) > 0 then '/app/receiving'
            when coalesce(order_summary.po_acknowledged_count, 0) > 0 then '/app/receiving?queue=awaiting_receipt'
            when coalesce(order_summary.po_sent_count, 0) > 0 then '/app/procurement'
            when coalesce(order_summary.po_created_count, 0) > 0 then '/app/procurement'
            when coalesce(order_summary.proposal_count, 0) > 0 then '/app/procurement'
            when coalesce(order_summary.procurement_lines, 0) > 0 then '/app/procurement'
            when coalesce(order_summary.production_lines, 0) > 0 then '/app/production'
            else concat('/app/orders/', operations_orders.id)
          end as next_action_href
        from operations_orders
        left join order_summary on order_summary.operations_order_id = operations_orders.id
        where operations_orders.tenant_id = $1
        order by operations_orders.processed_at desc nulls last, operations_orders.created_at desc
      `,
      [tenantId],
    )
  ).rows;
  return rows
    .map((row) => decryptOrderRow(row as CustomerEncryptedRow))
    .map(applyDecodedOrderDataQuality);
}

export async function loadOperationsOrderLinesList(
  db: QueryExecutor,
  tenantId: string,
) {
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
        join operations_orders
          on operations_orders.id = operations_order_lines.operations_order_id
          and operations_orders.tenant_id = operations_order_lines.tenant_id
        join items
          on items.id = operations_order_lines.item_id
          and items.tenant_id = operations_order_lines.tenant_id
        where operations_order_lines.tenant_id = $1
        order by operations_orders.processed_at desc nulls last,
          operations_orders.created_at desc,
          coalesce(operations_order_lines.sku, items.sku)
      `,
      [tenantId],
    )
  ).rows;
}

export type DashboardOrderLineStatusKey =
  | "needs_planning"
  | "procurement"
  | "receiving"
  | "putaway_pending"
  | "ready_for_logistics"
  | "shipment"
  | "fulfilled_done"
  | "blocked_review";

const dashboardOrderLineStatusLabels: Record<
  DashboardOrderLineStatusKey,
  string
> = {
  needs_planning: "Needs planning",
  procurement: "Procurement",
  receiving: "Receiving / QC",
  putaway_pending: "Putaway",
  ready_for_logistics: "Ready for logistics",
  shipment: "Shipment",
  fulfilled_done: "Fulfilled / Done",
  blocked_review: "Blocked / Review",
};

function dashboardOrderLineNextAction(
  statusKey: DashboardOrderLineStatusKey,
  orderLineId: string,
) {
  switch (statusKey) {
    case "procurement":
      return { label: "Open procurement", href: "/app/procurement" };
    case "receiving":
    case "putaway_pending":
      return { label: "Open receiving", href: "/app/receiving" };
    case "ready_for_logistics":
    case "shipment":
      return { label: "Open logistics", href: "/app/logistics" };
    case "fulfilled_done":
      return { label: "Review line", href: `/app/order-lines/${orderLineId}` };
    case "blocked_review":
      return { label: "Review blocker", href: `/app/order-lines/${orderLineId}` };
    case "needs_planning":
    default:
      return { label: "Review line", href: `/app/order-lines/${orderLineId}` };
  }
}

export async function loadDashboardOrderLineCards(
  db: QueryExecutor,
  tenantId: string,
) {
  const rows = (
    await db.query(
      `
        with movement_balances as (
          select
            tenant_id,
            item_id,
            coalesce(sum(quantity_delta) filter (where location_code = 'MAIN'), 0) as physical_quantity,
            coalesce(sum(reserved_delta) filter (where location_code = 'MAIN'), 0) as reserved_quantity
          from inventory_movements
          where tenant_id = $1
          group by tenant_id, item_id
        ),
        open_purchase_orders as (
          select
            purchase_order_lines.tenant_id,
            purchase_order_lines.item_id,
            coalesce(sum(
              case
                when purchase_orders.status in ('created', 'submitted', 'approved', 'sent', 'acknowledged')
                then purchase_order_lines.quantity
                else 0
              end
            ), 0) as ordered_quantity
          from purchase_order_lines
          join purchase_orders
            on purchase_orders.id = purchase_order_lines.purchase_order_id
            and purchase_orders.tenant_id = purchase_order_lines.tenant_id
          where purchase_order_lines.tenant_id = $1
          group by purchase_order_lines.tenant_id, purchase_order_lines.item_id
        ),
        item_availability as (
          select
            items.id as item_id,
            items.tenant_id,
            coalesce(movement_balances.physical_quantity, 0) as physical_quantity,
            abs(coalesce(movement_balances.reserved_quantity, 0)) as reserved_quantity,
            coalesce(movement_balances.physical_quantity, 0)
              - abs(coalesce(movement_balances.reserved_quantity, 0)) as available_quantity,
            coalesce(open_purchase_orders.ordered_quantity, 0) as ordered_quantity
          from items
          left join movement_balances
            on movement_balances.item_id = items.id
            and movement_balances.tenant_id = items.tenant_id
          left join open_purchase_orders
            on open_purchase_orders.item_id = items.id
            and open_purchase_orders.tenant_id = items.tenant_id
          where items.tenant_id = $1
        ),
        line_base as (
          select
            operations_order_lines.id as order_line_id,
            operations_order_lines.operations_order_id as order_id,
            operations_order_lines.tenant_id,
            operations_order_lines.item_id,
            operations_order_lines.quantity,
            operations_order_lines.unit,
            operations_order_lines.sku as line_sku,
            operations_order_lines.title as line_title,
            operations_order_lines.supply_status,
            operations_order_lines.created_at as updated_at,
            operations_orders.order_name,
            operations_orders.customer_name,
            operations_orders.customer_email,
            operations_orders.customer_name_encrypted,
            operations_orders.customer_email_encrypted,
            operations_orders.shipping_address_encrypted,
            operations_orders.status as order_status,
            operations_orders.fulfillment_status,
            operations_orders.processed_at as order_processed_at,
            operations_orders.created_at as order_created_at,
            items.sku as item_sku,
            items.title as item_title,
            items.is_sellable,
            items.is_purchasable,
            items.is_producible,
            coalesce(item_availability.available_quantity, 0) as available_quantity
          from operations_order_lines
          join operations_orders
            on operations_orders.id = operations_order_lines.operations_order_id
            and operations_orders.tenant_id = operations_order_lines.tenant_id
          join items
            on items.id = operations_order_lines.item_id
            and items.tenant_id = operations_order_lines.tenant_id
          left join item_availability
            on item_availability.item_id = operations_order_lines.item_id
            and item_availability.tenant_id = operations_order_lines.tenant_id
          where operations_order_lines.tenant_id = $1
        ),
        line_allocations as (
          select
            line_base.*,
            coalesce(
              sum(
                case
                  when line_base.order_status in ('open', 'planned', 'in_progress')
                    and line_base.supply_status <> 'cancelled'
                  then line_base.quantity
                  else 0
                end
              ) over (
                partition by line_base.item_id
                order by line_base.order_processed_at nulls last,
                  line_base.order_created_at,
                  line_base.order_line_id
                rows between unbounded preceding and 1 preceding
              ),
              0
            ) as prior_open_demand_quantity
          from line_base
        ),
        purchase_context as (
          select
            purchase_needs.source_order_line_id as order_line_id,
            count(purchase_needs.id)::int as purchase_need_count,
            count(purchase_order_lines.id)::int as purchase_order_line_count
          from purchase_needs
          left join purchase_order_lines
            on purchase_order_lines.purchase_need_id = purchase_needs.id
            and purchase_order_lines.tenant_id = purchase_needs.tenant_id
          where purchase_needs.tenant_id = $1
            and purchase_needs.source_order_line_id is not null
          group by purchase_needs.source_order_line_id
        ),
        receipt_context as (
          select
            purchase_needs.source_order_line_id as order_line_id,
            count(goods_receipt_lines.id)::int as receipt_line_count,
            coalesce(sum(goods_receipt_lines.accepted_quantity), 0) as accepted_quantity,
            coalesce(sum(
              case
                when goods_receipt_lines.status = 'putaway_done'
                then goods_receipt_lines.accepted_quantity
                else 0
              end
            ), 0) as putaway_quantity
          from purchase_needs
          join purchase_order_lines
            on purchase_order_lines.purchase_need_id = purchase_needs.id
            and purchase_order_lines.tenant_id = purchase_needs.tenant_id
          join goods_receipt_lines
            on goods_receipt_lines.purchase_order_line_id = purchase_order_lines.id
            and goods_receipt_lines.tenant_id = purchase_order_lines.tenant_id
          where purchase_needs.tenant_id = $1
            and purchase_needs.source_order_line_id is not null
          group by purchase_needs.source_order_line_id
        ),
        shipment_context as (
          select
            shipping_order_lines.operations_order_line_id as order_line_id,
            count(shipping_order_lines.id)::int as shipment_line_count,
            count(*) filter (where shipping_orders.status in ('open', 'picking', 'packed', 'partially_shipped'))::int as open_shipment_count,
            count(*) filter (where shipping_orders.status = 'shipped')::int as shipped_shipment_count
          from shipping_order_lines
          join shipping_orders
            on shipping_orders.id = shipping_order_lines.shipping_order_id
            and shipping_orders.tenant_id = shipping_order_lines.tenant_id
          where shipping_order_lines.tenant_id = $1
          group by shipping_order_lines.operations_order_line_id
        )
        select
          line_allocations.*,
          coalesce(purchase_context.purchase_need_count, 0) as purchase_need_count,
          coalesce(purchase_context.purchase_order_line_count, 0) as purchase_order_line_count,
          coalesce(receipt_context.receipt_line_count, 0) as receipt_line_count,
          coalesce(receipt_context.accepted_quantity, 0) as accepted_quantity,
          coalesce(receipt_context.putaway_quantity, 0) as putaway_quantity,
          coalesce(shipment_context.shipment_line_count, 0) as shipment_line_count,
          coalesce(shipment_context.open_shipment_count, 0) as open_shipment_count,
          coalesce(shipment_context.shipped_shipment_count, 0) as shipped_shipment_count
        from line_allocations
        left join purchase_context on purchase_context.order_line_id = line_allocations.order_line_id
        left join receipt_context on receipt_context.order_line_id = line_allocations.order_line_id
        left join shipment_context on shipment_context.order_line_id = line_allocations.order_line_id
        order by line_allocations.order_processed_at desc nulls last,
          line_allocations.order_created_at desc,
          coalesce(line_allocations.line_sku, line_allocations.item_sku)
      `,
      [tenantId],
    )
  ).rows;

  return rows.map((rawRow) => {
    const row = decryptOrderRow(rawRow as CustomerEncryptedRow) as CustomerEncryptedRow & {
      order_line_id: string;
      order_id: string;
      order_name: string | null;
      customer_name: string | null;
      line_sku: string | null;
      item_sku: string | null;
      line_title: string | null;
      item_title: string | null;
      quantity: string | number | null;
      unit: string | null;
      available_quantity: string | number | null;
      prior_open_demand_quantity: string | number | null;
      supply_status: string | null;
      order_status: string | null;
      fulfillment_status: string | null;
      is_sellable: boolean | null;
      is_purchasable: boolean | null;
      is_producible: boolean | null;
      purchase_need_count: string | number | null;
      purchase_order_line_count: string | number | null;
      receipt_line_count: string | number | null;
      accepted_quantity: string | number | null;
      putaway_quantity: string | number | null;
      shipment_line_count: string | number | null;
      open_shipment_count: string | number | null;
      shipped_shipment_count: string | number | null;
      updated_at: string | null;
      shipping_address?: NormalizedShippingAddress | null;
    };
    const quantity = Number(row.quantity ?? 0);
    const availableQuantity = Number(row.available_quantity ?? 0);
    const priorDemandQuantity = Number(row.prior_open_demand_quantity ?? 0);
    const allocatedAvailableQuantity = Math.max(
      availableQuantity - priorDemandQuantity,
      0,
    );
    const shortage = Math.max(quantity - allocatedAvailableQuantity, 0);
    const purchaseContextCount =
      Number(row.purchase_need_count ?? 0) +
      Number(row.purchase_order_line_count ?? 0);
    const receiptLineCount = Number(row.receipt_line_count ?? 0);
    const acceptedQuantity = Number(row.accepted_quantity ?? 0);
    const putawayQuantity = Number(row.putaway_quantity ?? 0);
    const shipmentLineCount = Number(row.shipment_line_count ?? 0);
    const openShipmentCount = Number(row.open_shipment_count ?? 0);
    const shippedShipmentCount = Number(row.shipped_shipment_count ?? 0);
    const fulfillmentStatus = String(row.fulfillment_status ?? "").toLowerCase();
    const stockReady =
      row.supply_status === "reserved" || allocatedAvailableQuantity >= quantity;
    const hasCustomerData = Boolean(row.customer_name && row.customer_email);
    const hasShippingAddress = hasUsableShippingAddress(row.shipping_address ?? null);
    const masterDataMissing =
      !row.is_sellable && !row.is_purchasable && !row.is_producible;

    let statusKey: DashboardOrderLineStatusKey = "needs_planning";
    let blockerReason: string | null = null;

    if (masterDataMissing) {
      statusKey = "blocked_review";
      blockerReason = "Product master data is incomplete.";
    } else if (
      shippedShipmentCount > 0 ||
      fulfillmentStatus === "fulfilled" ||
      row.order_status === "complete"
    ) {
      statusKey = "fulfilled_done";
    } else if (shipmentLineCount > 0 || openShipmentCount > 0) {
      statusKey = "shipment";
    } else if (stockReady && !hasCustomerData) {
      statusKey = "blocked_review";
      blockerReason = "Customer data is missing.";
    } else if (stockReady && !hasShippingAddress) {
      statusKey = "blocked_review";
      blockerReason = "Shipping address is missing.";
    } else if (stockReady) {
      statusKey = "ready_for_logistics";
    } else if (acceptedQuantity > putawayQuantity && acceptedQuantity > 0) {
      statusKey = "putaway_pending";
    } else if (receiptLineCount > 0) {
      statusKey = "receiving";
    } else if (purchaseContextCount > 0) {
      statusKey = "procurement";
    } else if (shortage > 0) {
      statusKey = "needs_planning";
    }

    const nextAction = dashboardOrderLineNextAction(statusKey, row.order_line_id);
    const sku = row.line_sku ?? row.item_sku;
    const title = row.line_title ?? row.item_title ?? "Untitled product";

    return {
      id: row.order_line_id,
      orderLineId: row.order_line_id,
      orderId: row.order_id,
      orderName: row.order_name ?? "Order",
      customerName: row.customer_name ?? null,
      sku,
      title,
      quantity,
      unit: row.unit ?? "pcs",
      availableQuantity: allocatedAvailableQuantity,
      shortage,
      statusKey,
      statusLabel: dashboardOrderLineStatusLabels[statusKey],
      blockerReason,
      nextActionLabel: nextAction.label,
      detailHref: `/app/order-lines/${row.order_line_id}`,
      areaHref: nextAction.href,
      updatedAt: row.updated_at,
    };
  });
}

export async function loadOperationsCustomersList(
  db: QueryExecutor,
  tenantId: string,
) {
  const rows = (
    await db.query(
      `
        select operation_customers.*
        from operation_customers
        where operation_customers.tenant_id = $1
        order by operation_customers.shopify_updated_at desc nulls last,
          operation_customers.synced_at desc
      `,
      [tenantId],
    )
  ).rows;

  return rows.map((row) =>
    decryptOperationCustomerRow(row as OperationCustomerEncryptedRow),
  );
}

export async function loadOperationsCustomerDetail(
  db: QueryExecutor,
  tenantId: string,
  customerId: string,
) {
  const customer = await db.query(
    `
      select operation_customers.*
      from operation_customers
      where operation_customers.tenant_id = $1
        and operation_customers.id = $2
    `,
    [tenantId, customerId],
  );
  const customerRow = customer.rows[0]
    ? decryptOperationCustomerRow(
        customer.rows[0] as OperationCustomerEncryptedRow,
      )
    : null;

  const orders =
    customerRow?.customer_lookup_hash
      ? await db.query(
          `
            select operations_orders.*,
              count(operations_order_lines.id)::int as line_count,
              string_agg(
                concat(
                  trim(to_char(operations_order_lines.quantity, 'FM999999990.####')),
                  ' × ',
                  coalesce(operations_order_lines.sku, items.sku),
                  ' ',
                  coalesce(operations_order_lines.title, items.title)
                ),
                ' || ' order by coalesce(operations_order_lines.sku, items.sku)
              ) as product_summary
            from operations_orders
            left join operations_order_lines
              on operations_order_lines.operations_order_id = operations_orders.id
              and operations_order_lines.tenant_id = operations_orders.tenant_id
            left join items
              on items.id = operations_order_lines.item_id
              and items.tenant_id = operations_order_lines.tenant_id
            where operations_orders.tenant_id = $1
              and operations_orders.customer_lookup_hash = $2
            group by operations_orders.id
            order by operations_orders.processed_at desc nulls last,
              operations_orders.created_at desc
            limit 20
          `,
          [tenantId, customerRow.customer_lookup_hash],
        )
      : { rows: [] };

  return {
    customer: customerRow,
    orders: orders.rows.map((row) =>
      decryptOrderRow(row as CustomerEncryptedRow),
    ),
  };
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
          coalesce(sum(quantity_delta) filter (where location_code = 'MAIN'), 0) as physical_quantity,
          coalesce(sum(quantity_delta - reserved_delta) filter (where location_code = 'MAIN'), 0) as available_quantity,
          coalesce(sum(reserved_delta) filter (where location_code = 'MAIN'), 0) as reserved_quantity,
          coalesce(sum(quantity_delta) filter (where location_code = 'QC-HOLD'), 0) as qc_hold_quantity,
          coalesce(sum(quantity_delta) filter (where location_code = 'QUARANTINE'), 0) as quarantine_quantity
        from inventory_movements
        where tenant_id = $1
        group by item_id
      ),
      open_demand as (
        select
          operations_order_lines.item_id,
          coalesce(sum(operations_order_lines.quantity), 0) as open_order_quantity
        from operations_order_lines
        join operations_orders
          on operations_orders.id = operations_order_lines.operations_order_id
          and operations_orders.tenant_id = operations_order_lines.tenant_id
        where operations_order_lines.tenant_id = $1
          and operations_orders.status in ('open', 'planned', 'in_progress')
          and operations_order_lines.supply_status <> 'cancelled'
        group by operations_order_lines.item_id
      ),
      open_purchase_orders as (
        select
          purchase_order_lines.item_id,
          coalesce(sum(purchase_order_lines.quantity), 0) as ordered_quantity
        from purchase_order_lines
        join purchase_orders
          on purchase_orders.id = purchase_order_lines.purchase_order_id
          and purchase_orders.tenant_id = purchase_order_lines.tenant_id
        where purchase_order_lines.tenant_id = $1
          and purchase_order_lines.status = 'open'
          and purchase_orders.status in ('draft', 'pending_approval', 'approved', 'sent', 'acknowledged')
        group by purchase_order_lines.item_id
      ),
      active_boms as (
        select parent_item_id as item_id, count(*)::int as active_bom_count
        from boms
        where tenant_id = $1 and is_active
        group by parent_item_id
      ),
      all_line_allocations as (
        select
          operations_order_lines.id as order_line_id,
          coalesce(
            sum(
              case
                when operations_orders.status in ('open', 'planned', 'in_progress')
                  and operations_order_lines.supply_status <> 'cancelled'
                then operations_order_lines.quantity
                else 0
              end
            ) over (
              partition by operations_order_lines.item_id
              order by operations_orders.processed_at nulls last,
                operations_orders.created_at,
                operations_order_lines.id
              rows between unbounded preceding and 1 preceding
            ),
            0
          ) as prior_open_demand_quantity
        from operations_order_lines
        join operations_orders
          on operations_orders.id = operations_order_lines.operations_order_id
          and operations_orders.tenant_id = operations_order_lines.tenant_id
        where operations_order_lines.tenant_id = $1
      )
      select
        operations_order_lines.*,
        operations_orders.order_name,
        operations_orders.status as order_status,
        operations_orders.customer_name,
        operations_orders.customer_email,
        operations_orders.customer_name_encrypted,
        operations_orders.customer_email_encrypted,
        operations_orders.shipping_address_encrypted,
        operations_orders.financial_status,
        operations_orders.fulfillment_status,
        operations_orders.processed_at,
        operations_orders.shopify_order_gid,
        operations_orders.shopify_order_legacy_id,
        items.sku as item_sku,
        items.title as item_title,
        items.shopify_product_gid,
        items.shopify_variant_gid,
        items.shopify_product_legacy_id,
        items.shopify_variant_legacy_id,
        items.product_handle,
        items.variant_title,
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
        preferred.supplier_id as preferred_supplier_id,
        suppliers.name as preferred_supplier_name,
        coalesce(balances.physical_quantity, 0) as physical_quantity,
        coalesce(balances.available_quantity, 0) as available_quantity,
        coalesce(balances.reserved_quantity, 0) as reserved_quantity,
        coalesce(balances.qc_hold_quantity, 0) as qc_hold_quantity,
        coalesce(balances.quarantine_quantity, 0) as quarantine_quantity,
        coalesce(open_demand.open_order_quantity, 0) as open_order_quantity,
        coalesce(open_purchase_orders.ordered_quantity, 0) as ordered_quantity,
        coalesce(balances.available_quantity, 0) + coalesce(open_purchase_orders.ordered_quantity, 0) as planned_quantity,
        greatest(
          coalesce(balances.available_quantity, 0) - coalesce(all_line_allocations.prior_open_demand_quantity, 0),
          0
        ) as allocated_available_quantity,
        coalesce(active_boms.active_bom_count, 0) as active_bom_count
      from operations_order_lines
      join operations_orders
        on operations_orders.id = operations_order_lines.operations_order_id
        and operations_orders.tenant_id = operations_order_lines.tenant_id
      join items
        on items.id = operations_order_lines.item_id
        and items.tenant_id = operations_order_lines.tenant_id
      left join balances on balances.item_id = items.id
      left join open_demand on open_demand.item_id = items.id
      left join open_purchase_orders on open_purchase_orders.item_id = items.id
      left join active_boms on active_boms.item_id = items.id
      left join all_line_allocations on all_line_allocations.order_line_id = operations_order_lines.id
      left join supplier_items preferred
        on preferred.item_id = items.id
        and preferred.tenant_id = items.tenant_id
        and preferred.is_preferred
      left join suppliers
        on suppliers.id = preferred.supplier_id
        and suppliers.tenant_id = preferred.tenant_id
      where operations_order_lines.tenant_id = $1 and operations_order_lines.id = $2
    `,
    [tenantId, lineId],
  );

  const lineRow = line.rows[0]
    ? decryptOrderRow(line.rows[0] as CustomerEncryptedRow)
    : null;

  if (!lineRow) return { line: null };

  const itemId = String(lineRow.item_id);
  const procurement = await db.query(
    `
      select purchase_needs.id,
        purchase_needs.status as purchase_need_status,
        purchase_needs.quantity,
        purchase_needs.unit,
        mrp_run_lines.explanation as need_explanation,
        mrp_run_lines.demand_quantity,
        mrp_run_lines.available_quantity,
        mrp_run_lines.shortage_quantity,
        mrp_run_lines.recommended_action,
        case
          when purchase_needs.source_order_line_id = $3 then 'order_line'
          when mrp_runs.operations_order_id = $4 then 'order'
          else 'item_fallback'
        end as demand_link_scope,
        purchase_needs.source_order_line_id,
        suppliers.name as supplier_name,
        purchase_orders.id as purchase_order_id,
        purchase_orders.display_number as purchase_order_number,
        purchase_orders.status as purchase_order_status,
        goods_receipts.id as receipt_id,
        goods_receipts.receipt_number,
        goods_receipts.status as receipt_status
      from purchase_needs
      join mrp_runs
        on mrp_runs.id = purchase_needs.mrp_run_id
        and mrp_runs.tenant_id = purchase_needs.tenant_id
      left join mrp_run_lines
        on mrp_run_lines.id = purchase_needs.mrp_run_line_id
        and mrp_run_lines.tenant_id = purchase_needs.tenant_id
      left join suppliers
        on suppliers.id = purchase_needs.supplier_id
        and suppliers.tenant_id = purchase_needs.tenant_id
      left join purchase_order_lines
        on purchase_order_lines.purchase_need_id = purchase_needs.id
        and purchase_order_lines.tenant_id = purchase_needs.tenant_id
      left join purchase_orders
        on purchase_orders.id = purchase_order_lines.purchase_order_id
        and purchase_orders.tenant_id = purchase_order_lines.tenant_id
      left join goods_receipts
        on goods_receipts.purchase_order_id = purchase_orders.id
        and goods_receipts.tenant_id = purchase_orders.tenant_id
      where purchase_needs.tenant_id = $1
        and purchase_needs.item_id = $2
        and (
          purchase_needs.source_order_line_id = $3
          or (
            purchase_needs.source_order_line_id is null
            and mrp_runs.operations_order_id = $4
          )
          or (
            purchase_needs.source_order_line_id is null
            and mrp_runs.operations_order_id is null
          )
        )
      order by case
          when purchase_needs.source_order_line_id = $3 then 0
          when mrp_runs.operations_order_id = $4 then 1
          else 2
        end,
        purchase_needs.created_at desc
      limit 5
    `,
    [tenantId, itemId, lineId, lineRow.operations_order_id],
  );

  const receipts = await db.query(
    `
      select goods_receipts.id as receipt_id,
        goods_receipts.receipt_number,
        goods_receipts.status as receipt_status,
        goods_receipts.received_at,
        goods_receipt_lines.status as receipt_line_status,
        goods_receipt_lines.received_quantity,
        goods_receipt_lines.accepted_quantity,
        goods_receipt_lines.rejected_quantity,
        case
          when purchase_needs.source_order_line_id = $3 then 'order_line'
          when mrp_runs.operations_order_id = $4 then 'order'
          else 'item_fallback'
        end as demand_link_scope,
        purchase_needs.source_order_line_id,
        purchase_orders.id as purchase_order_id,
        purchase_orders.display_number as purchase_order_number
      from goods_receipt_lines
      join goods_receipts
        on goods_receipts.id = goods_receipt_lines.goods_receipt_id
        and goods_receipts.tenant_id = goods_receipt_lines.tenant_id
      join purchase_order_lines
        on purchase_order_lines.id = goods_receipt_lines.purchase_order_line_id
        and purchase_order_lines.tenant_id = goods_receipt_lines.tenant_id
      join purchase_needs
        on purchase_needs.id = purchase_order_lines.purchase_need_id
        and purchase_needs.tenant_id = purchase_order_lines.tenant_id
      join mrp_runs
        on mrp_runs.id = purchase_needs.mrp_run_id
        and mrp_runs.tenant_id = purchase_needs.tenant_id
      join purchase_orders
        on purchase_orders.id = purchase_order_lines.purchase_order_id
        and purchase_orders.tenant_id = purchase_order_lines.tenant_id
      where goods_receipt_lines.tenant_id = $1
        and goods_receipt_lines.item_id = $2
        and (
          purchase_needs.source_order_line_id = $3
          or (
            purchase_needs.source_order_line_id is null
            and mrp_runs.operations_order_id = $4
          )
          or (
            purchase_needs.source_order_line_id is null
            and mrp_runs.operations_order_id is null
          )
        )
      order by case
          when purchase_needs.source_order_line_id = $3 then 0
          when mrp_runs.operations_order_id = $4 then 1
          else 2
        end,
        goods_receipts.received_at desc
      limit 5
    `,
    [tenantId, itemId, lineId, lineRow.operations_order_id],
  );

  const inventoryMovements = await db.query(
    `
      select inventory_movements.*
      from inventory_movements
      where inventory_movements.tenant_id = $1 and inventory_movements.item_id = $2
      order by inventory_movements.occurred_at desc
      limit 10
    `,
    [tenantId, itemId],
  );

  const production = await db.query(
    `
      select production_needs.id,
        production_needs.status as production_need_status,
        production_needs.quantity,
        production_needs.unit,
        production_orders.id as production_order_id,
        production_orders.display_number as production_order_number,
        production_orders.status as production_order_status
      from production_needs
      left join production_orders
        on production_orders.production_need_id = production_needs.id
        and production_orders.tenant_id = production_needs.tenant_id
      where production_needs.tenant_id = $1 and production_needs.item_id = $2
      order by production_needs.created_at desc
      limit 5
    `,
    [tenantId, itemId],
  );

  const logistics = await db.query(
    `
      select shipping_order_lines.*,
        shipping_orders.shipment_number,
        shipping_orders.status as shipping_order_status
      from shipping_order_lines
      join shipping_orders
        on shipping_orders.id = shipping_order_lines.shipping_order_id
        and shipping_orders.tenant_id = shipping_order_lines.tenant_id
      where shipping_order_lines.tenant_id = $1
        and shipping_order_lines.operations_order_line_id = $2
      order by shipping_order_lines.created_at desc
      limit 5
    `,
    [tenantId, lineId],
  );

  return {
    line: lineRow,
    procurement: procurement.rows,
    receipts: receipts.rows,
    inventoryMovements: inventoryMovements.rows,
    production: production.rows,
    logistics: logistics.rows,
  };
}

export async function createPurchaseNeedForOrderLine(
  db: QueryExecutor,
  tenantId: string,
  orderLineId: string,
  requestedQuantity: number,
) {
  return withKitTransaction(db, async (tx) => {
    const lineResult = await tx.query<{
      id: string;
      operations_order_id: string;
      item_id: string;
      quantity: string;
      unit: string;
      order_name: string;
      sku: string | null;
      item_sku: string;
      is_purchasable: boolean;
      min_inventory_quantity: string;
      default_order_quantity: string;
      available_quantity: string;
      preferred_supplier_id: string | null;
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
          operations_order_lines.id,
          operations_order_lines.operations_order_id,
          operations_order_lines.item_id,
          operations_order_lines.quantity,
          operations_order_lines.unit,
          operations_orders.order_name,
          operations_order_lines.sku,
          items.sku as item_sku,
          items.is_purchasable,
          items.min_inventory_quantity,
          items.default_order_quantity,
          coalesce(balances.available_quantity, 0) as available_quantity,
          preferred.supplier_id as preferred_supplier_id
        from operations_order_lines
        join operations_orders
          on operations_orders.id = operations_order_lines.operations_order_id
          and operations_orders.tenant_id = operations_order_lines.tenant_id
        join items
          on items.id = operations_order_lines.item_id
          and items.tenant_id = operations_order_lines.tenant_id
        left join balances on balances.item_id = items.id
        left join supplier_items preferred
          on preferred.item_id = items.id
          and preferred.tenant_id = items.tenant_id
          and preferred.is_preferred
        where operations_order_lines.tenant_id = $1
          and operations_order_lines.id = $2
      `,
      [tenantId, orderLineId],
    );
    const line = lineResult.rows[0];
    if (!line) throw new Error("Order line not found.");
    if (!line.is_purchasable) {
      throw new Error(
        "Classify the product as purchased before creating a purchase need.",
      );
    }

    const shortage = Math.max(
      Number(line.quantity) +
        Number(line.min_inventory_quantity ?? 0) -
        Number(line.available_quantity ?? 0),
      0,
    );
    const quantity = Math.max(
      Number(requestedQuantity) || 0,
      shortage,
      Number(line.default_order_quantity ?? 1),
      1,
    );

    const run = await tx.query<{ id: string }>(
      `
        insert into mrp_runs (
          tenant_id, operations_order_id, status, scenario_mode, summary, committed_at
        )
        values ($1, $2, 'committed', 'operations', $3, now())
        returning id
      `,
      [
        tenantId,
        line.operations_order_id,
        `Direct purchase need from ${line.order_name} / ${line.sku ?? line.item_sku}.`,
      ],
    );

    const runLine = await tx.query<{ id: string }>(
      `
        insert into mrp_run_lines (
          tenant_id, mrp_run_id, item_id, line_type, demand_quantity,
          available_quantity, shortage_quantity, recommended_action, explanation
        )
        values ($1, $2, $3, 'finished_good', $4, $5, $6, 'buy', $7)
        returning id
      `,
      [
        tenantId,
        run.rows[0].id,
        line.item_id,
        Number(line.quantity),
        Number(line.available_quantity ?? 0),
        shortage,
        `Direct procurement from order ${line.order_name}; quantity can be overridden by Procurement.`,
      ],
    );

    const need = await tx.query<{ id: string }>(
      `
        insert into purchase_needs (
          tenant_id, item_id, mrp_run_id, mrp_run_line_id,
          source_order_line_id, supplier_id, quantity, unit, status
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        returning id
      `,
      [
        tenantId,
        line.item_id,
        run.rows[0].id,
        runLine.rows[0].id,
        line.id,
        line.preferred_supplier_id,
        quantity,
        line.unit,
        line.preferred_supplier_id ? "assigned" : "open",
      ],
    );

    await addCaseEvent(
      tx,
      tenantId,
      "Purchase need created from order line",
      `${line.order_name}: ${quantity.toLocaleString()} ${line.unit} of ${
        line.sku ?? line.item_sku
      } requested for procurement.`,
      "purchase_need_create",
      { purchaseNeedId: need.rows[0].id, orderLineId },
    );

    return {
      purchaseNeedId: need.rows[0].id,
      quantity,
      supplierAssigned: Boolean(line.preferred_supplier_id),
    };
  });
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
      input.orderName.trim() ||
      `INTAKE-${new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, "")
        .slice(0, 14)}`;

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
          join operations_orders
            on operations_orders.id = operations_order_lines.operations_order_id
            and operations_orders.tenant_id = operations_order_lines.tenant_id
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
      with balances as (
        select
          item_id,
          coalesce(sum(quantity_delta) filter (where location_code = 'MAIN'), 0) as physical_quantity,
          coalesce(sum(quantity_delta - reserved_delta) filter (where location_code = 'MAIN'), 0) as available_quantity,
          coalesce(sum(reserved_delta) filter (where location_code = 'MAIN'), 0) as reserved_quantity,
          coalesce(sum(quantity_delta) filter (where location_code = 'QC-HOLD'), 0) as qc_hold_quantity,
          coalesce(sum(quantity_delta) filter (where location_code = 'QUARANTINE'), 0) as quarantine_quantity
        from inventory_movements
        where tenant_id = $1
        group by item_id
      ),
      open_demand as (
        select
          operations_order_lines.item_id,
          coalesce(sum(operations_order_lines.quantity), 0) as open_order_quantity
        from operations_order_lines
        join operations_orders
          on operations_orders.id = operations_order_lines.operations_order_id
          and operations_orders.tenant_id = operations_order_lines.tenant_id
        where operations_order_lines.tenant_id = $1
          and operations_orders.status in ('open', 'planned', 'in_progress')
          and operations_order_lines.supply_status <> 'cancelled'
        group by operations_order_lines.item_id
      ),
      open_purchase_orders as (
        select
          purchase_order_lines.item_id,
          coalesce(sum(purchase_order_lines.quantity), 0) as ordered_quantity
        from purchase_order_lines
        join purchase_orders
          on purchase_orders.id = purchase_order_lines.purchase_order_id
          and purchase_orders.tenant_id = purchase_order_lines.tenant_id
        where purchase_order_lines.tenant_id = $1
          and purchase_order_lines.status = 'open'
          and purchase_orders.status in ('draft', 'pending_approval', 'approved', 'sent', 'acknowledged')
        group by purchase_order_lines.item_id
      ),
      active_boms as (
        select parent_item_id as item_id, count(*)::int as active_bom_count
        from boms
        where tenant_id = $1 and is_active
        group by parent_item_id
      ),
      all_line_allocations as (
        select
          operations_order_lines.id as order_line_id,
          coalesce(
            sum(
              case
                when operations_orders.status in ('open', 'planned', 'in_progress')
                  and operations_order_lines.supply_status <> 'cancelled'
                then operations_order_lines.quantity
                else 0
              end
            ) over (
              partition by operations_order_lines.item_id
              order by operations_orders.processed_at nulls last,
                operations_orders.created_at,
                operations_order_lines.id
              rows between unbounded preceding and 1 preceding
            ),
            0
          ) as prior_open_demand_quantity
        from operations_order_lines
        join operations_orders
          on operations_orders.id = operations_order_lines.operations_order_id
          and operations_orders.tenant_id = operations_order_lines.tenant_id
        where operations_order_lines.tenant_id = $1
      )
      select operations_order_lines.*, items.sku as item_sku, items.title as item_title,
        items.shopify_product_gid, items.shopify_variant_gid, items.product_handle,
        items.variant_title, items.item_type, items.is_sellable, items.is_purchasable, items.is_producible,
        items.min_inventory_quantity, items.default_order_quantity, items.default_production_quantity,
        items.supplier_lead_time_days, items.qc_required_after_purchase,
        items.qc_required_after_production,
        preferred.supplier_id as preferred_supplier_id,
        suppliers.name as preferred_supplier_name,
        coalesce(balances.physical_quantity, 0) as physical_quantity,
        coalesce(balances.available_quantity, 0) as available_quantity,
        coalesce(balances.reserved_quantity, 0) as reserved_quantity,
        coalesce(balances.qc_hold_quantity, 0) as qc_hold_quantity,
        coalesce(balances.quarantine_quantity, 0) as quarantine_quantity,
        coalesce(open_demand.open_order_quantity, 0) as open_order_quantity,
        coalesce(open_purchase_orders.ordered_quantity, 0) as ordered_quantity,
        coalesce(balances.available_quantity, 0) + coalesce(open_purchase_orders.ordered_quantity, 0) as planned_quantity,
        greatest(
          coalesce(balances.available_quantity, 0) - coalesce(all_line_allocations.prior_open_demand_quantity, 0),
          0
        ) as allocated_available_quantity,
        coalesce(active_boms.active_bom_count, 0) as active_bom_count
      from operations_order_lines
      join items
        on items.id = operations_order_lines.item_id
        and items.tenant_id = operations_order_lines.tenant_id
      left join balances on balances.item_id = items.id
      left join open_demand on open_demand.item_id = items.id
      left join open_purchase_orders on open_purchase_orders.item_id = items.id
      left join active_boms on active_boms.item_id = items.id
      left join all_line_allocations on all_line_allocations.order_line_id = operations_order_lines.id
      left join supplier_items preferred
        on preferred.item_id = items.id
        and preferred.tenant_id = items.tenant_id
        and preferred.is_preferred
      left join suppliers
        on suppliers.id = preferred.supplier_id
        and suppliers.tenant_id = preferred.tenant_id
      where operations_order_lines.tenant_id = $1 and operations_order_lines.operations_order_id = $2
      order by coalesce(operations_order_lines.sku, items.sku)
    `,
    [tenantId, orderId],
  );
  const procurement = await db.query(
    `
      select purchase_needs.id,
        purchase_needs.item_id,
        purchase_needs.status as purchase_need_status,
        purchase_needs.quantity,
        purchase_needs.unit,
        case
          when purchase_needs.source_order_line_id is not null then 'order_line'
          when mrp_runs.operations_order_id = $2 then 'order'
          else 'item_fallback'
        end as demand_link_scope,
        purchase_needs.source_order_line_id,
        suppliers.name as supplier_name,
        purchase_orders.id as purchase_order_id,
        purchase_orders.display_number as purchase_order_number,
        purchase_orders.status as purchase_order_status,
        goods_receipts.id as receipt_id,
        goods_receipts.receipt_number,
        goods_receipts.status as receipt_status
      from purchase_needs
      join mrp_runs
        on mrp_runs.id = purchase_needs.mrp_run_id
        and mrp_runs.tenant_id = purchase_needs.tenant_id
      left join suppliers
        on suppliers.id = purchase_needs.supplier_id
        and suppliers.tenant_id = purchase_needs.tenant_id
      left join purchase_order_lines
        on purchase_order_lines.purchase_need_id = purchase_needs.id
        and purchase_order_lines.tenant_id = purchase_needs.tenant_id
      left join purchase_orders
        on purchase_orders.id = purchase_order_lines.purchase_order_id
        and purchase_orders.tenant_id = purchase_order_lines.tenant_id
      left join goods_receipts
        on goods_receipts.purchase_order_id = purchase_orders.id
        and goods_receipts.tenant_id = purchase_orders.tenant_id
      where purchase_needs.tenant_id = $1
        and purchase_needs.item_id in (
          select item_id
          from operations_order_lines
          where tenant_id = $1 and operations_order_id = $2
        )
        and (
          purchase_needs.source_order_line_id in (
            select id
            from operations_order_lines
            where tenant_id = $1 and operations_order_id = $2
          )
          or (
            purchase_needs.source_order_line_id is null
            and mrp_runs.operations_order_id = $2
          )
          or (
            purchase_needs.source_order_line_id is null
            and mrp_runs.operations_order_id is null
          )
        )
      order by case
          when purchase_needs.source_order_line_id is not null then 0
          when mrp_runs.operations_order_id = $2 then 1
          else 2
        end,
        purchase_needs.created_at desc
      limit 20
    `,
    [tenantId, orderId],
  );
  const receipts = await db.query(
    `
      select goods_receipts.id as receipt_id,
        goods_receipts.receipt_number,
        goods_receipts.status as receipt_status,
        goods_receipts.received_at,
        goods_receipt_lines.item_id,
        goods_receipt_lines.status as receipt_line_status,
        goods_receipt_lines.received_quantity,
        goods_receipt_lines.accepted_quantity,
        goods_receipt_lines.rejected_quantity,
        case
          when purchase_needs.source_order_line_id is not null then 'order_line'
          when mrp_runs.operations_order_id = $2 then 'order'
          else 'item_fallback'
        end as demand_link_scope,
        purchase_needs.source_order_line_id,
        purchase_orders.id as purchase_order_id,
        purchase_orders.display_number as purchase_order_number
      from goods_receipt_lines
      join goods_receipts
        on goods_receipts.id = goods_receipt_lines.goods_receipt_id
        and goods_receipts.tenant_id = goods_receipt_lines.tenant_id
      join purchase_order_lines
        on purchase_order_lines.id = goods_receipt_lines.purchase_order_line_id
        and purchase_order_lines.tenant_id = goods_receipt_lines.tenant_id
      join purchase_needs
        on purchase_needs.id = purchase_order_lines.purchase_need_id
        and purchase_needs.tenant_id = purchase_order_lines.tenant_id
      join mrp_runs
        on mrp_runs.id = purchase_needs.mrp_run_id
        and mrp_runs.tenant_id = purchase_needs.tenant_id
      join purchase_orders
        on purchase_orders.id = purchase_order_lines.purchase_order_id
        and purchase_orders.tenant_id = purchase_order_lines.tenant_id
      where goods_receipt_lines.tenant_id = $1
        and goods_receipt_lines.item_id in (
          select item_id
          from operations_order_lines
          where tenant_id = $1 and operations_order_id = $2
        )
        and (
          purchase_needs.source_order_line_id in (
            select id
            from operations_order_lines
            where tenant_id = $1 and operations_order_id = $2
          )
          or (
            purchase_needs.source_order_line_id is null
            and mrp_runs.operations_order_id = $2
          )
          or (
            purchase_needs.source_order_line_id is null
            and mrp_runs.operations_order_id is null
          )
        )
      order by case
          when purchase_needs.source_order_line_id is not null then 0
          when mrp_runs.operations_order_id = $2 then 1
          else 2
        end,
        goods_receipts.received_at desc
      limit 20
    `,
    [tenantId, orderId],
  );
  const production = await db.query(
    `
      select production_needs.id,
        production_needs.item_id,
        production_needs.status as production_need_status,
        production_needs.quantity,
        production_needs.unit,
        production_orders.id as production_order_id,
        production_orders.display_number as production_order_number,
        production_orders.status as production_order_status
      from production_needs
      left join production_orders
        on production_orders.production_need_id = production_needs.id
        and production_orders.tenant_id = production_needs.tenant_id
      where production_needs.tenant_id = $1
        and production_needs.item_id in (
          select item_id
          from operations_order_lines
          where tenant_id = $1 and operations_order_id = $2
        )
      order by production_needs.created_at desc
      limit 20
    `,
    [tenantId, orderId],
  );
  const logistics = await db.query(
    `
      select shipping_order_lines.*,
        shipping_orders.shipment_number,
        shipping_orders.status as shipping_order_status
      from shipping_order_lines
      join shipping_orders
        on shipping_orders.id = shipping_order_lines.shipping_order_id
        and shipping_orders.tenant_id = shipping_order_lines.tenant_id
      where shipping_order_lines.tenant_id = $1
        and shipping_orders.operations_order_id = $2
      order by shipping_order_lines.created_at desc
      limit 20
    `,
    [tenantId, orderId],
  );
  return {
    order: order.rows[0]
      ? decryptOrderRow(order.rows[0] as CustomerEncryptedRow)
      : null,
    lines: lines.rows,
    procurement: procurement.rows,
    receipts: receipts.rows,
    production: production.rows,
    logistics: logistics.rows,
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

export async function redactExpiredCustomerData(
  db: QueryExecutor,
  tenantId: string,
) {
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
        select boms.id, boms.parent_item_id, boms.version, boms.is_active,
          parent.sku as parent_sku,
          parent.title as parent_title,
          parent.is_producible,
          count(bom_lines.id)::int as line_count
        from boms
        join items parent
          on parent.id = boms.parent_item_id
          and parent.tenant_id = boms.tenant_id
        left join bom_lines
          on bom_lines.bom_id = boms.id
          and bom_lines.tenant_id = boms.tenant_id
        where boms.tenant_id = $1
        group by boms.id, parent.sku, parent.title, parent.is_producible
        order by parent.sku
      `,
      [tenantId],
    )
  ).rows;
}

export async function loadBomProductContext(
  db: QueryExecutor,
  tenantId: string,
  parentItemId: string | null,
) {
  if (!parentItemId) return null;

  const parent = await db.query<{
    id: string;
    sku: string;
    title: string;
    item_type: string;
    is_sellable: boolean;
    is_purchasable: boolean;
    is_producible: boolean;
  }>(
    `
      select id, sku, title, item_type, is_sellable, is_purchasable, is_producible
      from items
      where tenant_id = $1 and id = $2
    `,
    [tenantId, parentItemId],
  );
  if (!parent.rows[0]) return null;

  const activeBom = await db.query<{
    id: string;
    version: string;
    is_active: boolean;
    line_count: number;
  }>(
    `
      select boms.id, boms.version, boms.is_active, count(bom_lines.id)::int as line_count
      from boms
      left join bom_lines on bom_lines.bom_id = boms.id
        and bom_lines.tenant_id = boms.tenant_id
      where boms.tenant_id = $1
        and boms.parent_item_id = $2
        and boms.is_active
      group by boms.id
      order by boms.version
      limit 1
    `,
    [tenantId, parentItemId],
  );
  const bomId = activeBom.rows[0]?.id ?? null;

  const bomLines = bomId
    ? await db.query<{
        id: string;
        quantity: string | number;
        unit: string;
        component_id: string;
        component_sku: string;
        component_title: string;
        item_type: string;
        is_purchasable: boolean;
        is_producible: boolean;
      }>(
        `
          select
            bom_lines.id,
            bom_lines.quantity,
            bom_lines.unit,
            component.id as component_id,
            component.sku as component_sku,
            component.title as component_title,
            component.item_type,
            component.is_purchasable,
            component.is_producible
          from bom_lines
          join items component
            on component.id = bom_lines.component_item_id
            and component.tenant_id = bom_lines.tenant_id
          where bom_lines.tenant_id = $1 and bom_lines.bom_id = $2
          order by component.sku
        `,
        [tenantId, bomId],
      )
    : { rows: [] };

  const availableComponents = await db.query<{
    id: string;
    sku: string;
    title: string;
    item_type: string;
    is_purchasable: boolean;
    is_producible: boolean;
  }>(
    `
      select id, sku, title, item_type, is_purchasable, is_producible
      from items
      where tenant_id = $1
        and id <> $2
        and (
          item_type in ('component', 'raw_material')
          or is_purchasable
        )
      order by sku
    `,
    [tenantId, parentItemId],
  );

  return {
    parent: parent.rows[0],
    activeBom: activeBom.rows[0] ?? null,
    bomLines: bomLines.rows,
    availableComponents: availableComponents.rows,
  };
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

export async function loadMrpRunDetail(
  db: QueryExecutor,
  tenantId: string,
  mrpRunId: string,
) {
  const run = await db.query(
    "select * from mrp_runs where tenant_id = $1 and id = $2",
    [tenantId, mrpRunId],
  );
  const lines = await db.query(
    `
      select mrp_run_lines.*, items.sku, items.title
      from mrp_run_lines
      join items
        on items.id = mrp_run_lines.item_id
        and items.tenant_id = mrp_run_lines.tenant_id
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
        select purchase_needs.*, items.sku, items.title,
          items.item_type,
          items.is_sellable,
          items.is_purchasable,
          items.is_producible,
          items.supplier_lead_time_days,
          items.default_order_quantity,
          items.min_inventory_quantity,
          suppliers.name as supplier_name,
          preferred.id as preferred_supplier_id,
          preferred.name as preferred_supplier_name,
          supplier_items.supplier_sku as preferred_supplier_sku,
          supplier_items.unit_price as preferred_unit_price,
          supplier_items.currency_code as preferred_currency_code,
          mrp_run_lines.explanation as need_explanation,
          mrp_run_lines.demand_quantity,
          mrp_run_lines.available_quantity,
          mrp_run_lines.shortage_quantity,
          mrp_run_lines.recommended_action,
          purchase_order_lines.purchase_order_id,
          purchase_orders.display_number as purchase_order_number,
          purchase_orders.status as purchase_order_status,
          purchase_needs.source_order_line_id,
          mrp_runs.operations_order_id as source_order_id,
          operations_orders.order_name as source_order_name,
          source_order_lines.sku as source_line_sku,
          source_order_lines.title as source_line_title,
          case
            when purchase_needs.source_order_line_id is not null then 'order_line'
            when mrp_runs.operations_order_id is not null then 'order'
            else 'item_fallback'
          end as demand_link_scope
        from purchase_needs
        join items
          on items.id = purchase_needs.item_id
          and items.tenant_id = purchase_needs.tenant_id
        join mrp_runs on mrp_runs.id = purchase_needs.mrp_run_id
          and mrp_runs.tenant_id = purchase_needs.tenant_id
        left join mrp_run_lines
          on mrp_run_lines.id = purchase_needs.mrp_run_line_id
          and mrp_run_lines.tenant_id = purchase_needs.tenant_id
        left join operations_orders
          on operations_orders.id = mrp_runs.operations_order_id
          and operations_orders.tenant_id = mrp_runs.tenant_id
        left join operations_order_lines source_order_lines
          on source_order_lines.id = purchase_needs.source_order_line_id
          and source_order_lines.tenant_id = purchase_needs.tenant_id
        left join suppliers
          on suppliers.id = purchase_needs.supplier_id
          and suppliers.tenant_id = purchase_needs.tenant_id
        left join supplier_items on supplier_items.item_id = items.id and supplier_items.tenant_id = items.tenant_id and supplier_items.is_preferred
        left join suppliers preferred
          on preferred.id = supplier_items.supplier_id
          and preferred.tenant_id = supplier_items.tenant_id
        left join purchase_order_lines
          on purchase_order_lines.purchase_need_id = purchase_needs.id
          and purchase_order_lines.tenant_id = purchase_needs.tenant_id
        left join purchase_orders
          on purchase_orders.id = purchase_order_lines.purchase_order_id
          and purchase_orders.tenant_id = purchase_order_lines.tenant_id
        where purchase_needs.tenant_id = $1
        order by purchase_needs.created_at desc
      `,
      [tenantId],
    )
  ).rows;
}

export async function loadPurchaseNeedSupplierAssignment(
  db: QueryExecutor,
  tenantId: string,
  purchaseNeedId: string,
) {
  const result = await db.query<{
    id: string;
    supplier_id: string | null;
    status: string;
  }>(
    `
      select id, supplier_id, status
      from purchase_needs
      where tenant_id = $1 and id = $2
    `,
    [tenantId, purchaseNeedId],
  );

  return result.rows[0] ?? null;
}

export async function assignPreferredSuppliersToNeeds(
  db: QueryExecutor,
  tenantId: string,
) {
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

export async function assignSupplierToPurchaseNeed(
  db: QueryExecutor,
  tenantId: string,
  purchaseNeedId: string,
  supplierId: string,
) {
  if (!supplierId) {
    throw new Error("Select a supplier before assigning a purchase need.");
  }

  await db.query(
    `
      update purchase_needs
      set supplier_id = suppliers.id,
          status = case
            when status in ('open', 'assigned') then 'assigned'
            else status
          end,
          updated_at = now()
      from suppliers
      where purchase_needs.tenant_id = $1
        and purchase_needs.id = $2
        and purchase_needs.status <> 'converted_to_po'
        and suppliers.tenant_id = purchase_needs.tenant_id
        and suppliers.id = $3
    `,
    [tenantId, purchaseNeedId, supplierId],
  );
}

export async function loadPurchaseOrders(db: QueryExecutor, tenantId: string) {
  return (
    await db.query(
      `
        with line_summary as (
          select
            purchase_order_lines.purchase_order_id,
            count(purchase_order_lines.id)::int as line_count,
            coalesce(sum(purchase_order_lines.quantity), 0) as total_quantity,
            coalesce(max(purchase_order_lines.unit), 'pcs') as unit,
            string_agg(distinct items.sku || ' ' || items.title, ', ' order by items.sku || ' ' || items.title) as item_summary,
            bool_or(items.is_sellable) as has_sellable_item,
            bool_or(items.is_purchasable) as has_purchasable_item,
            bool_or(items.is_producible) as has_producible_item,
            max(items.supplier_lead_time_days) as max_lead_time_days,
            max(items.default_order_quantity) as max_default_order_quantity,
            max(items.min_inventory_quantity) as max_min_inventory_quantity,
            string_agg(distinct preferred.name, ', ' order by preferred.name) as preferred_supplier_names,
            string_agg(
              distinct coalesce(source_orders.order_name, mrp_orders.order_name),
              ', ' order by coalesce(source_orders.order_name, mrp_orders.order_name)
            ) filter (
              where coalesce(source_orders.order_name, mrp_orders.order_name) is not null
            ) as source_order_names,
            min(purchase_order_lines.expected_delivery_date) as next_expected_delivery_date,
            coalesce(max(purchase_order_lines.unit_price), 0) as unit_price,
            coalesce(sum(purchase_order_lines.quantity * coalesce(purchase_order_lines.unit_price, 0)), 0) as net_amount,
            coalesce(max(purchase_order_lines.currency_code), 'EUR') as currency_code
          from purchase_order_lines
          left join items
            on items.id = purchase_order_lines.item_id
            and items.tenant_id = purchase_order_lines.tenant_id
          left join purchase_needs
            on purchase_needs.id = purchase_order_lines.purchase_need_id
            and purchase_needs.tenant_id = purchase_order_lines.tenant_id
          left join operations_order_lines source_lines
            on source_lines.id = purchase_needs.source_order_line_id
            and source_lines.tenant_id = purchase_needs.tenant_id
          left join operations_orders source_orders
            on source_orders.id = source_lines.operations_order_id
            and source_orders.tenant_id = source_lines.tenant_id
          left join mrp_runs
            on mrp_runs.id = purchase_needs.mrp_run_id
            and mrp_runs.tenant_id = purchase_needs.tenant_id
          left join operations_orders mrp_orders
            on mrp_orders.id = mrp_runs.operations_order_id
            and mrp_orders.tenant_id = mrp_runs.tenant_id
          left join supplier_items preferred_item
            on preferred_item.tenant_id = items.tenant_id
            and preferred_item.item_id = items.id
            and preferred_item.is_preferred
          left join suppliers preferred
            on preferred.id = preferred_item.supplier_id
            and preferred.tenant_id = preferred_item.tenant_id
          where purchase_order_lines.tenant_id = $1
          group by purchase_order_lines.purchase_order_id
        ),
        receipt_summary as (
          select
            goods_receipts.purchase_order_id,
            max(goods_receipts.status) as receipt_status,
            (array_agg(goods_receipts.id order by goods_receipts.created_at desc))[1] as latest_receipt_id,
            (array_agg(goods_receipts.receipt_number order by goods_receipts.created_at desc))[1] as latest_receipt_number,
            count(goods_receipts.id)::int as receipt_count
          from goods_receipts
          where goods_receipts.tenant_id = $1
          group by goods_receipts.purchase_order_id
        )
        select purchase_orders.*, suppliers.name as supplier_name,
          coalesce(line_summary.line_count, 0) as line_count,
          coalesce(line_summary.total_quantity, 0) as total_quantity,
          coalesce(line_summary.unit, 'pcs') as unit,
          line_summary.item_summary,
          coalesce(line_summary.has_sellable_item, false) as has_sellable_item,
          coalesce(line_summary.has_purchasable_item, false) as has_purchasable_item,
          coalesce(line_summary.has_producible_item, false) as has_producible_item,
          line_summary.max_lead_time_days,
          line_summary.max_default_order_quantity,
          line_summary.max_min_inventory_quantity,
          line_summary.preferred_supplier_names,
          line_summary.source_order_names,
          line_summary.next_expected_delivery_date,
          coalesce(line_summary.unit_price, 0) as unit_price,
          coalesce(line_summary.net_amount, 0) as net_amount,
          coalesce(line_summary.currency_code, 'EUR') as currency_code,
          receipt_summary.receipt_status,
          receipt_summary.latest_receipt_id,
          receipt_summary.latest_receipt_number,
          coalesce(receipt_summary.receipt_count, 0) as receipt_count
        from purchase_orders
        join suppliers
          on suppliers.id = purchase_orders.supplier_id
          and suppliers.tenant_id = purchase_orders.tenant_id
        left join line_summary on line_summary.purchase_order_id = purchase_orders.id
        left join receipt_summary on receipt_summary.purchase_order_id = purchase_orders.id
        where purchase_orders.tenant_id = $1
        order by purchase_orders.created_at desc
      `,
      [tenantId],
    )
  ).rows;
}

export async function loadPaymentEntries(db: QueryExecutor, tenantId: string) {
  return (
    await db.query(
      `
        select purchase_payments.*, suppliers.name as supplier_name,
          purchase_orders.display_number as purchase_order_number
        from purchase_payments
        join purchase_orders
          on purchase_orders.id = purchase_payments.purchase_order_id
          and purchase_orders.tenant_id = purchase_payments.tenant_id
        left join suppliers
          on suppliers.id = purchase_payments.supplier_id
          and suppliers.tenant_id = purchase_payments.tenant_id
        where purchase_payments.tenant_id = $1
        order by purchase_payments.exported_at nulls first, purchase_payments.created_at desc
      `,
      [tenantId],
    )
  ).rows;
}

export async function exportPaymentEntries(
  db: QueryExecutor,
  tenantId: string,
  paymentIds: string[],
) {
  const ids = paymentIds.filter(Boolean);
  if (ids.length === 0) return { exported: 0, exportBatchId: null };

  const exportBatchId = `PAY-EXPORT-${new Date().toISOString()}`;
  const result = await db.query<{ id: string }>(
    `
      update purchase_payments
      set exported_at = now(),
          export_batch_id = $3,
          updated_at = now()
      where tenant_id = $1
        and id = any($2::uuid[])
        and exported_at is null
      returning id
    `,
    [tenantId, ids, exportBatchId],
  );

  return { exported: result.rows.length, exportBatchId };
}

export async function loadPurchaseOrderTenantDiagnostics(
  db: QueryExecutor,
  tenantId: string,
) {
  const counts = await db.query<{
    current_tenant_purchase_orders: number;
    total_purchase_orders: number;
  }>(
    `
      select
        (select count(*)::int from purchase_orders where tenant_id = $1) as current_tenant_purchase_orders,
        (select count(*)::int from purchase_orders) as total_purchase_orders
    `,
    [tenantId],
  );

  return (
    counts.rows[0] ?? {
      current_tenant_purchase_orders: 0,
      total_purchase_orders: 0,
    }
  );
}

export async function loadReceivablePurchaseOrders(
  db: QueryExecutor,
  tenantId: string,
) {
  return (
    await db.query(
      `
        select purchase_orders.*, suppliers.name as supplier_name,
          count(purchase_order_lines.id)::int as line_count,
          coalesce(sum(purchase_order_lines.quantity), 0) as total_quantity,
          coalesce(max(purchase_order_lines.unit), 'pcs') as unit,
          string_agg(distinct items.sku || ' ' || items.title, ', ' order by items.sku || ' ' || items.title) as item_summary,
          count(*) filter (
            where purchase_order_lines.unit_price is null
              or purchase_order_lines.unit_price <= 0
          )::int as missing_price_count,
          coalesce(max(purchase_order_lines.currency_code), 'EUR') as currency_code,
          coalesce(sum(purchase_order_lines.quantity * coalesce(purchase_order_lines.unit_price, 0)), 0) as net_amount
        from purchase_orders
        join suppliers
          on suppliers.id = purchase_orders.supplier_id
          and suppliers.tenant_id = purchase_orders.tenant_id
        left join purchase_order_lines
          on purchase_order_lines.purchase_order_id = purchase_orders.id
          and purchase_order_lines.tenant_id = purchase_orders.tenant_id
        left join items
          on items.id = purchase_order_lines.item_id
          and items.tenant_id = purchase_order_lines.tenant_id
        left join goods_receipts
          on goods_receipts.purchase_order_id = purchase_orders.id
          and goods_receipts.tenant_id = purchase_orders.tenant_id
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
    receipt_status: string | null;
  }>(
    `
      select purchase_orders.*, suppliers.name as supplier_name, suppliers.email as supplier_email,
        (
          select max(goods_receipts.status)
          from goods_receipts
          where goods_receipts.tenant_id = purchase_orders.tenant_id
            and goods_receipts.purchase_order_id = purchase_orders.id
        ) as receipt_status
      from purchase_orders
      join suppliers
        on suppliers.id = purchase_orders.supplier_id
        and suppliers.tenant_id = purchase_orders.tenant_id
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
    unit_price: string | null;
    currency_code: string | null;
    expected_delivery_date: string | null;
    lead_time_days: number | null;
    status: string;
    purchase_need_status: string | null;
    source_order_line_id: string | null;
    source_order_id: string | null;
    source_order_name: string | null;
    source_line_sku: string | null;
    source_line_title: string | null;
    demand_link_scope: string | null;
    need_explanation: string | null;
    demand_quantity: string | null;
    available_quantity: string | null;
    shortage_quantity: string | null;
    recommended_action: string | null;
    receipt_id: string | null;
    receipt_number: string | null;
    receipt_status: string | null;
    receipt_line_id: string | null;
    receipt_line_status: string | null;
    received_quantity: string | null;
    accepted_quantity: string | null;
    rejected_quantity: string | null;
  }>(
    `
      select purchase_order_lines.*, items.sku, items.title,
        purchase_needs.status as purchase_need_status,
        purchase_needs.source_order_line_id,
        coalesce(source_orders.id, mrp_orders.id) as source_order_id,
        coalesce(source_orders.order_name, mrp_orders.order_name) as source_order_name,
        source_order_lines.sku as source_line_sku,
        source_order_lines.title as source_line_title,
        case
          when purchase_needs.source_order_line_id is not null then 'order_line'
          when mrp_runs.operations_order_id is not null then 'order'
          else 'item_fallback'
        end as demand_link_scope,
        mrp_run_lines.explanation as need_explanation,
        mrp_run_lines.demand_quantity,
        mrp_run_lines.available_quantity,
        mrp_run_lines.shortage_quantity,
        mrp_run_lines.recommended_action,
        goods_receipts.id as receipt_id,
        goods_receipts.receipt_number,
        goods_receipts.status as receipt_status,
        goods_receipt_lines.id as receipt_line_id,
        goods_receipt_lines.status as receipt_line_status,
        goods_receipt_lines.received_quantity,
        goods_receipt_lines.accepted_quantity,
        goods_receipt_lines.rejected_quantity
      from purchase_order_lines
      join items
        on items.id = purchase_order_lines.item_id
        and items.tenant_id = purchase_order_lines.tenant_id
      left join purchase_needs
        on purchase_needs.id = purchase_order_lines.purchase_need_id
        and purchase_needs.tenant_id = purchase_order_lines.tenant_id
      left join mrp_run_lines
        on mrp_run_lines.id = purchase_needs.mrp_run_line_id
        and mrp_run_lines.tenant_id = purchase_needs.tenant_id
      left join mrp_runs
        on mrp_runs.id = purchase_needs.mrp_run_id
        and mrp_runs.tenant_id = purchase_needs.tenant_id
      left join operations_order_lines source_order_lines
        on source_order_lines.id = purchase_needs.source_order_line_id
        and source_order_lines.tenant_id = purchase_needs.tenant_id
      left join operations_orders source_orders
        on source_orders.id = source_order_lines.operations_order_id
        and source_orders.tenant_id = source_order_lines.tenant_id
      left join operations_orders mrp_orders
        on mrp_orders.id = mrp_runs.operations_order_id
        and mrp_orders.tenant_id = mrp_runs.tenant_id
      left join goods_receipt_lines
        on goods_receipt_lines.purchase_order_line_id = purchase_order_lines.id
        and goods_receipt_lines.tenant_id = purchase_order_lines.tenant_id
      left join goods_receipts
        on goods_receipts.id = goods_receipt_lines.goods_receipt_id
        and goods_receipts.tenant_id = goods_receipt_lines.tenant_id
      where purchase_order_lines.tenant_id = $1 and purchase_order_lines.purchase_order_id = $2
      order by items.sku
    `,
      [tenantId, purchaseOrderId],
    );
  const receipts = await db.query(
    `
      select goods_receipts.*,
        count(goods_receipt_lines.id)::int as line_count
      from goods_receipts
      left join goods_receipt_lines
        on goods_receipt_lines.goods_receipt_id = goods_receipts.id
        and goods_receipt_lines.tenant_id = goods_receipts.tenant_id
      where goods_receipts.tenant_id = $1
        and goods_receipts.purchase_order_id = $2
      group by goods_receipts.id
      order by goods_receipts.created_at desc
    `,
    [tenantId, purchaseOrderId],
  );
  return {
    order: order.rows[0] ?? null,
    lines: lines.rows,
    receipts: receipts.rows,
  };
}

export async function loadProductionOrders(
  db: QueryExecutor,
  tenantId: string,
) {
  return (
    await db.query(
      `
        select production_orders.*, items.sku, items.title,
          count(production_components.id)::int as component_count
        from production_orders
        join items
          on items.id = production_orders.item_id
          and items.tenant_id = production_orders.tenant_id
        left join production_components
          on production_components.production_order_id = production_orders.id
          and production_components.tenant_id = production_orders.tenant_id
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
        join items
          on items.id = production_needs.item_id
          and items.tenant_id = production_needs.tenant_id
        left join production_orders
          on production_orders.production_need_id = production_needs.id
          and production_orders.tenant_id = production_needs.tenant_id
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
      customer_name_encrypted: string | null;
      customer_email_encrypted: string | null;
      shipping_address_encrypted: string | null;
    }>(
      `
        select id, order_name, customer_name_encrypted, customer_email_encrypted,
          shipping_address_encrypted
        from operations_orders
        where tenant_id = $1 and status in ('open', 'planned', 'in_progress')
          and ($2::uuid is null or id = $2::uuid)
        order by processed_at nulls last, created_at
      `,
      [tenantId, operationsOrderId ?? null],
    );

    const created: string[] = [];
    const blockedOrders: string[] = [];
    const orderSummaries = await loadOperationsOrdersList(tx, tenantId);
    const summaryByOrderId = new Map(
      orderSummaries.map((order: any) => [order.id, order]),
    );
    for (const order of orders.rows) {
      const decryptedOrder = decryptOrderRow(order);
      const summary = summaryByOrderId.get(order.id) as any;
      if (
        !decryptedOrder.customer_name ||
        !decryptedOrder.customer_email ||
        !hasUsableShippingAddress(decryptedOrder.shipping_address) ||
        summary?.operational_status !== "Ready for logistics"
      ) {
        blockedOrders.push(order.order_name);
        continue;
      }

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
          join items
            on items.id = operations_order_lines.item_id
            and items.tenant_id = operations_order_lines.tenant_id
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
          [
            tenantId,
            shipment.rows[0].id,
            line.id,
            line.item_id,
            line.quantity,
            line.unit,
          ],
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
      `${created.length} shipping order(s) are ready for logistics.${
        blockedOrders.length
          ? ` ${blockedOrders.length} order(s) were blocked because customer name, email or shipping address is missing.`
          : ""
      }`,
      "shipping_order_create",
      { shippingOrderIds: created, blockedOrders },
    );

    return { shippingOrderIds: created, blockedOrders };
  });
}

export async function backfillTestShippingAddressForOpenOrders(
  db: QueryExecutor,
  tenantId: string,
) {
  const testAddress = {
    name: "Jörn Voigt",
    address1: "123 Test St",
    address2: null,
    city: "Washington",
    provinceCode: "DC",
    zip: "20340",
    countryCodeV2: "US",
    phone: null,
  };
  const result = await db.query<{ id: string }>(
    `
      update operations_orders
      set customer_name_encrypted = coalesce(customer_name_encrypted, $2),
          customer_email_encrypted = coalesce(customer_email_encrypted, $3),
          customer_lookup_hash = coalesce(customer_lookup_hash, $4),
          shipping_address_encrypted = coalesce(shipping_address_encrypted, $5),
          updated_at = now()
      where tenant_id = $1
        and status in ('open', 'planned', 'in_progress')
        and (
          customer_name_encrypted is null
          or customer_email_encrypted is null
          or shipping_address_encrypted is null
        )
      returning id
    `,
    [
      tenantId,
      encryptCustomerData(testAddress.name),
      encryptCustomerData("voigtjo@gmail.com"),
      hashCustomerLookup("voigtjo@gmail.com", testAddress.name),
      encryptCustomerData(JSON.stringify(testAddress)),
    ],
  );

  return { updated: result.rows.length };
}

export async function loadShippableOperationsOrders(
  db: QueryExecutor,
  tenantId: string,
) {
  const rows = (
    await db.query(
      `
        select operations_orders.*, count(operations_order_lines.id)::int as line_count,
          string_agg(coalesce(operations_order_lines.sku, items.sku), ', ' order by coalesce(operations_order_lines.sku, items.sku)) as skus,
          string_agg(
            concat(
              trim(to_char(operations_order_lines.quantity, 'FM999999990.####')),
              ' × ',
              coalesce(operations_order_lines.sku, items.sku),
              ' ',
              coalesce(operations_order_lines.title, items.title)
            ),
            '; ' order by coalesce(operations_order_lines.sku, items.sku)
          ) as product_summary
        from operations_orders
        join operations_order_lines
          on operations_order_lines.operations_order_id = operations_orders.id
          and operations_order_lines.tenant_id = operations_orders.tenant_id
        join items
          on items.id = operations_order_lines.item_id
          and items.tenant_id = operations_order_lines.tenant_id
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

export async function validateShippingOrderInventoryAvailability(
  db: QueryExecutor,
  tenantId: string,
  shippingOrderId: string,
) {
  const shortages = await db.query<{
    sku: string;
    title: string;
    ordered_quantity: string;
    physical_quantity: string;
  }>(
    `
      with movement_balances as (
        select
          inventory_movements.item_id,
          coalesce(sum(inventory_movements.quantity_delta), 0) as physical_quantity
        from inventory_movements
        where inventory_movements.tenant_id = $1
          and inventory_movements.location_code = 'MAIN'
        group by inventory_movements.item_id
      )
      select items.sku,
        items.title,
        shipping_order_lines.ordered_quantity,
        coalesce(movement_balances.physical_quantity, 0) as physical_quantity
      from shipping_order_lines
        join items
          on items.id = shipping_order_lines.item_id
          and items.tenant_id = shipping_order_lines.tenant_id
      left join movement_balances on movement_balances.item_id = shipping_order_lines.item_id
      where shipping_order_lines.tenant_id = $1
        and shipping_order_lines.shipping_order_id = $2
        and not exists (
          select 1
          from inventory_movements shipped
          where shipped.tenant_id = shipping_order_lines.tenant_id
            and shipped.source_type = 'shipping_order_line'
            and shipped.source_id = shipping_order_lines.id::text
            and shipped.movement_type = 'ship'
        )
        and coalesce(movement_balances.physical_quantity, 0) < shipping_order_lines.ordered_quantity
    `,
    [tenantId, shippingOrderId],
  );

  if (shortages.rows.length > 0) {
    const shortageList = shortages.rows
      .map(
        (line) =>
          `${line.sku} ${line.title}: need ${Number(
            line.ordered_quantity,
          ).toLocaleString()}, on hand ${Number(
            line.physical_quantity,
          ).toLocaleString()}`,
      )
      .join("; ");
    throw new Error(
      `Shipment cannot be marked shipped because physical inventory would become negative. ${shortageList}`,
    );
  }
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
      packed_quantity: string;
      status: string;
    }>(
      `
        select shipping_order_lines.id,
          shipping_order_lines.item_id,
          shipping_order_lines.ordered_quantity,
          shipping_order_lines.packed_quantity,
          shipping_order_lines.status
        from shipping_order_lines
        join items
          on items.id = shipping_order_lines.item_id
          and items.tenant_id = shipping_order_lines.tenant_id
        where shipping_order_lines.tenant_id = $1
          and shipping_order_lines.shipping_order_id = $2
      `,
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
      await validateShippingOrderInventoryAvailability(
        tx,
        tenantId,
        shippingOrderId,
      );
      for (const line of lines.rows) {
        const orderedQuantity = Number(line.ordered_quantity);
        const packedQuantity = Number(line.packed_quantity ?? 0);
        const reservedDelta =
          line.status === "packed" || packedQuantity > 0
            ? -Math.min(packedQuantity || orderedQuantity, orderedQuantity)
            : 0;
        await tx.query(
          `
            insert into inventory_movements (
              tenant_id, item_id, movement_type, quantity_delta, reserved_delta,
              location_code, source_type, source_id, idempotency_key
            )
            values ($1, $2, 'ship', $3, $4, 'MAIN', 'shipping_order_line', $5, $6)
            on conflict (tenant_id, idempotency_key)
            do nothing
          `,
          [
            tenantId,
            line.item_id,
            -orderedQuantity,
            reservedDelta,
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

export async function updateShippingOrderLineQuantity(
  db: QueryExecutor,
  tenantId: string,
  shippingOrderLineId: string,
  quantity: number,
) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { updated: false, message: "Quantity must be greater than zero." };
  }

  return withKitTransaction(db, async (tx) => {
    const line = await tx.query<{
      id: string;
      shipping_order_id: string;
      shipping_status: string;
      line_status: string;
    }>(
      `
        select shipping_order_lines.id,
          shipping_order_lines.shipping_order_id,
          shipping_orders.status as shipping_status,
          shipping_order_lines.status as line_status
        from shipping_order_lines
        join shipping_orders
          on shipping_orders.id = shipping_order_lines.shipping_order_id
          and shipping_orders.tenant_id = shipping_order_lines.tenant_id
        where shipping_order_lines.tenant_id = $1
          and shipping_order_lines.id = $2
      `,
      [tenantId, shippingOrderLineId],
    );
    const row = line.rows[0];
    if (!row) return { updated: false, message: "Shipment line not found." };
    if (
      (row.shipping_status !== "open" &&
        row.shipping_status !== "picking") ||
      (row.line_status !== "open" &&
        row.line_status !== "picked")
    ) {
      return {
        updated: false,
        message: "Shipment lines can only be corrected before packing or shipping.",
      };
    }

    await tx.query(
      `
        update shipping_order_lines
        set ordered_quantity = $3,
            updated_at = now()
        where tenant_id = $1 and id = $2
      `,
      [tenantId, shippingOrderLineId, quantity],
    );

    await addCaseEvent(
      tx,
      tenantId,
      "Shipment line quantity updated",
      `Shipment line quantity was corrected to ${quantity}.`,
      row.shipping_order_id,
      { shippingOrderLineId, quantity },
    );

    return { updated: true, message: "Shipment line quantity updated." };
  });
}

export async function loadShippingOrders(db: QueryExecutor, tenantId: string) {
  const orders = await db.query(
    `
      select shipping_orders.*, operations_orders.order_name,
        operations_orders.shopify_order_gid,
        operations_orders.shopify_order_legacy_id,
        operations_orders.fulfillment_status,
        operations_orders.customer_name_encrypted,
        operations_orders.customer_email_encrypted,
        operations_orders.shipping_address_encrypted,
        count(shipping_order_lines.id)::int as line_count
      from shipping_orders
      join operations_orders
        on operations_orders.id = shipping_orders.operations_order_id
        and operations_orders.tenant_id = shipping_orders.tenant_id
      left join shipping_order_lines
        on shipping_order_lines.shipping_order_id = shipping_orders.id
        and shipping_order_lines.tenant_id = shipping_orders.tenant_id
      where shipping_orders.tenant_id = $1
      group by shipping_orders.id, operations_orders.order_name,
        operations_orders.shopify_order_gid,
        operations_orders.shopify_order_legacy_id,
        operations_orders.fulfillment_status,
        operations_orders.customer_name_encrypted,
        operations_orders.customer_email_encrypted,
        operations_orders.shipping_address_encrypted
      order by coalesce(shipping_orders.shipped_at, shipping_orders.updated_at, shipping_orders.created_at) desc
    `,
    [tenantId],
  );
  const lines = await db.query(
    `
      select shipping_order_lines.*, shipping_orders.shipment_number, items.sku, items.title
      from shipping_order_lines
      join shipping_orders
        on shipping_orders.id = shipping_order_lines.shipping_order_id
        and shipping_orders.tenant_id = shipping_order_lines.tenant_id
      join items
        on items.id = shipping_order_lines.item_id
        and items.tenant_id = shipping_order_lines.tenant_id
      where shipping_order_lines.tenant_id = $1
      order by coalesce(shipping_orders.shipped_at, shipping_orders.updated_at, shipping_orders.created_at) desc, items.sku
    `,
    [tenantId],
  );

  return {
    orders: orders.rows.map((row) =>
      decryptOrderRow(row as CustomerEncryptedRow),
    ),
    lines: lines.rows,
  };
}

export async function loadShippingOrderDetail(
  db: QueryExecutor,
  tenantId: string,
  shippingOrderId: string,
) {
  const order = await db.query(
    `
      select shipping_orders.*, operations_orders.order_name,
        operations_orders.shopify_order_gid,
        operations_orders.shopify_order_legacy_id,
        operations_orders.customer_name_encrypted,
        operations_orders.customer_email_encrypted,
        operations_orders.shipping_address_encrypted,
        count(shipping_order_lines.id)::int as line_count
      from shipping_orders
      join operations_orders
        on operations_orders.id = shipping_orders.operations_order_id
        and operations_orders.tenant_id = shipping_orders.tenant_id
      left join shipping_order_lines
        on shipping_order_lines.shipping_order_id = shipping_orders.id
        and shipping_order_lines.tenant_id = shipping_orders.tenant_id
      where shipping_orders.tenant_id = $1 and shipping_orders.id = $2
      group by shipping_orders.id, operations_orders.order_name,
        operations_orders.shopify_order_gid,
        operations_orders.shopify_order_legacy_id,
        operations_orders.customer_name_encrypted,
        operations_orders.customer_email_encrypted,
        operations_orders.shipping_address_encrypted
    `,
    [tenantId, shippingOrderId],
  );
  const lines = await db.query(
    `
      select shipping_order_lines.*, items.sku, items.title
      from shipping_order_lines
      join items
        on items.id = shipping_order_lines.item_id
        and items.tenant_id = shipping_order_lines.tenant_id
      where shipping_order_lines.tenant_id = $1
        and shipping_order_lines.shipping_order_id = $2
      order by items.sku
    `,
    [tenantId, shippingOrderId],
  );

  return {
    order: order.rows[0]
      ? decryptOrderRow(order.rows[0] as CustomerEncryptedRow)
      : null,
    lines: lines.rows,
  };
}

export async function loadWarehouseTasks(db: QueryExecutor, tenantId: string) {
  return (
    await db.query(
      `
        select warehouse_tasks.*, items.sku, items.title as item_title
        from warehouse_tasks
        left join items
          on items.id = warehouse_tasks.item_id
          and items.tenant_id = warehouse_tasks.tenant_id
        where warehouse_tasks.tenant_id = $1
        order by warehouse_tasks.created_at desc
      `,
      [tenantId],
    )
  ).rows;
}

export async function loadOperationsOrders(
  db: QueryExecutor,
  tenantId: string,
) {
  return (
    await db.query(
      `
        select operations_orders.*, count(operations_order_lines.id)::int as line_count
        from operations_orders
        left join operations_order_lines
          on operations_order_lines.operations_order_id = operations_orders.id
          and operations_order_lines.tenant_id = operations_orders.tenant_id
        where operations_orders.tenant_id = $1
        group by operations_orders.id
        order by operations_orders.created_at desc
      `,
      [tenantId],
    )
  ).rows;
}

export async function loadShopifyFulfillmentTargetForOrder(
  db: QueryExecutor,
  tenantId: string,
  operationsOrderId: string,
) {
  const result = await db.query<{
    id: string;
    order_name: string;
    shopify_order_gid: string | null;
    fulfillment_status: string | null;
    shipped_shipment_count: number;
  }>(
    `
      select operations_orders.id,
        operations_orders.order_name,
        operations_orders.shopify_order_gid,
        operations_orders.fulfillment_status,
        count(shipping_orders.id) filter (where shipping_orders.status = 'shipped')::int as shipped_shipment_count
      from operations_orders
      left join shipping_orders
        on shipping_orders.operations_order_id = operations_orders.id
        and shipping_orders.tenant_id = operations_orders.tenant_id
        and shipping_orders.status <> 'cancelled'
      where operations_orders.tenant_id = $1
        and operations_orders.id = $2
      group by operations_orders.id
    `,
    [tenantId, operationsOrderId],
  );
  return result.rows[0] ?? null;
}

export async function updateOperationsOrderFulfillmentStatus(
  db: QueryExecutor,
  tenantId: string,
  operationsOrderId: string,
  fulfillmentStatus: string,
) {
  await db.query(
    `
      update operations_orders
      set fulfillment_status = $3,
          updated_at = now()
      where tenant_id = $1
        and id = $2
    `,
    [tenantId, operationsOrderId, fulfillmentStatus],
  );
}

export async function loadOrderProcess(db: QueryExecutor, tenantId: string) {
  const order = await db.query(
    `
      select operations_orders.*, items.sku, items.title, operations_order_lines.quantity, operations_order_lines.unit
      from operations_orders
      join operations_order_lines
        on operations_order_lines.operations_order_id = operations_orders.id
        and operations_order_lines.tenant_id = operations_orders.tenant_id
      join items
        on items.id = operations_order_lines.item_id
        and items.tenant_id = operations_order_lines.tenant_id
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
      join production_orders
        on production_orders.id = production_components.production_order_id
        and production_orders.tenant_id = production_components.tenant_id
      join items
        on items.id = production_components.item_id
        and items.tenant_id = production_components.tenant_id
      where production_components.tenant_id = $1
      order by production_orders.created_at desc, items.sku
    `,
    [tenantId],
  );
  const recentMovements = await db.query(
    `
      select inventory_movements.*, items.sku, items.title
      from inventory_movements
      join items
        on items.id = inventory_movements.item_id
        and items.tenant_id = inventory_movements.tenant_id
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
        suppliers.id as supplier_id,
        suppliers.name as supplier_name,
        count(goods_receipt_lines.id)::int as line_count,
        coalesce(sum(goods_receipt_lines.received_quantity), 0) as received_quantity,
        coalesce(max(goods_receipt_lines.unit), 'pcs') as unit,
        string_agg(distinct items.sku || ' ' || items.title, ', ' order by items.sku || ' ' || items.title) as item_summary
      from goods_receipts
      join purchase_orders
        on purchase_orders.id = goods_receipts.purchase_order_id
        and purchase_orders.tenant_id = goods_receipts.tenant_id
      join suppliers
        on suppliers.id = purchase_orders.supplier_id
        and suppliers.tenant_id = purchase_orders.tenant_id
      left join goods_receipt_lines
        on goods_receipt_lines.goods_receipt_id = goods_receipts.id
        and goods_receipt_lines.tenant_id = goods_receipts.tenant_id
      left join items
        on items.id = goods_receipt_lines.item_id
        and items.tenant_id = goods_receipt_lines.tenant_id
      where goods_receipts.tenant_id = $1
      group by goods_receipts.id, purchase_orders.display_number, suppliers.id, suppliers.name
      order by goods_receipts.created_at desc
    `,
    [tenantId],
  );
  const lines = await db.query(
    `
      select goods_receipt_lines.*, goods_receipts.receipt_number, items.sku, items.title,
        qc_checks.status as qc_status, qc_checks.result as qc_result
      from goods_receipt_lines
      join goods_receipts
        on goods_receipts.id = goods_receipt_lines.goods_receipt_id
        and goods_receipts.tenant_id = goods_receipt_lines.tenant_id
      join items
        on items.id = goods_receipt_lines.item_id
        and items.tenant_id = goods_receipt_lines.tenant_id
      left join qc_checks
        on qc_checks.goods_receipt_line_id = goods_receipt_lines.id
        and qc_checks.tenant_id = goods_receipt_lines.tenant_id
      where goods_receipt_lines.tenant_id = $1
      order by goods_receipt_lines.created_at desc
    `,
    [tenantId],
  );

  return { receipts: receipts.rows, lines: lines.rows };
}

export async function loadReceiptDetail(
  db: QueryExecutor,
  tenantId: string,
  receiptId: string,
) {
  const receipt = await db.query(
    `
      select goods_receipts.*, purchase_orders.id as purchase_order_id,
        purchase_orders.display_number as purchase_order_number,
        purchase_orders.status as purchase_order_status,
        suppliers.name as supplier_name,
        suppliers.email as supplier_email
      from goods_receipts
      join purchase_orders
        on purchase_orders.id = goods_receipts.purchase_order_id
        and purchase_orders.tenant_id = goods_receipts.tenant_id
      join suppliers
        on suppliers.id = purchase_orders.supplier_id
        and suppliers.tenant_id = purchase_orders.tenant_id
      where goods_receipts.tenant_id = $1 and goods_receipts.id = $2
    `,
    [tenantId, receiptId],
  );
  const lines = await db.query(
    `
      select goods_receipt_lines.*, items.sku, items.title,
        purchase_order_lines.id as purchase_order_line_id,
        purchase_order_lines.quantity as ordered_quantity,
        purchase_order_lines.expected_delivery_date,
        purchase_order_lines.lead_time_days,
        purchase_needs.id as purchase_need_id,
        purchase_needs.source_order_line_id,
        coalesce(source_orders.id, mrp_orders.id) as source_order_id,
        coalesce(source_orders.order_name, mrp_orders.order_name) as source_order_name,
        source_order_lines.sku as source_line_sku,
        source_order_lines.title as source_line_title,
        mrp_run_lines.explanation as need_explanation,
        qc_checks.id as qc_check_id,
        qc_checks.status as qc_status, qc_checks.result as qc_result,
        qc_checks.notes as qc_notes, qc_checks.completed_at as qc_completed_at,
        warehouse_tasks.status as putaway_task_status,
        coalesce(putaway_movements.putaway_quantity, 0) as putaway_quantity
      from goods_receipt_lines
      join items
        on items.id = goods_receipt_lines.item_id
        and items.tenant_id = goods_receipt_lines.tenant_id
      join purchase_order_lines
        on purchase_order_lines.id = goods_receipt_lines.purchase_order_line_id
        and purchase_order_lines.tenant_id = goods_receipt_lines.tenant_id
      left join purchase_needs
        on purchase_needs.id = purchase_order_lines.purchase_need_id
        and purchase_needs.tenant_id = purchase_order_lines.tenant_id
      left join mrp_run_lines
        on mrp_run_lines.id = purchase_needs.mrp_run_line_id
        and mrp_run_lines.tenant_id = purchase_needs.tenant_id
      left join mrp_runs
        on mrp_runs.id = purchase_needs.mrp_run_id
        and mrp_runs.tenant_id = purchase_needs.tenant_id
      left join operations_order_lines source_order_lines
        on source_order_lines.id = purchase_needs.source_order_line_id
        and source_order_lines.tenant_id = purchase_needs.tenant_id
      left join operations_orders source_orders
        on source_orders.id = source_order_lines.operations_order_id
        and source_orders.tenant_id = source_order_lines.tenant_id
      left join operations_orders mrp_orders
        on mrp_orders.id = mrp_runs.operations_order_id
        and mrp_orders.tenant_id = mrp_runs.tenant_id
      left join qc_checks
        on qc_checks.goods_receipt_line_id = goods_receipt_lines.id
        and qc_checks.tenant_id = goods_receipt_lines.tenant_id
      left join warehouse_tasks on warehouse_tasks.tenant_id = goods_receipt_lines.tenant_id
        and warehouse_tasks.task_type = 'putaway'
        and warehouse_tasks.source_type = 'goods_receipt_line'
        and warehouse_tasks.source_id = goods_receipt_lines.id
      left join lateral (
        select coalesce(sum(inventory_movements.quantity_delta), 0) as putaway_quantity
        from inventory_movements
        where inventory_movements.tenant_id = goods_receipt_lines.tenant_id
          and inventory_movements.source_type = 'goods_receipt_line'
          and inventory_movements.source_id = goods_receipt_lines.id::text
          and inventory_movements.movement_type = 'putaway'
      ) putaway_movements on true
      where goods_receipt_lines.tenant_id = $1
        and goods_receipt_lines.goods_receipt_id = $2
      order by items.sku
    `,
    [tenantId, receiptId],
  );
  const inventoryMovements = await db.query(
    `
      select inventory_movements.*, items.sku, items.title,
        coalesce(source_receipt_lines.id, qc_receipt_lines.id) as goods_receipt_line_id
      from inventory_movements
      join items
        on items.id = inventory_movements.item_id
        and items.tenant_id = inventory_movements.tenant_id
      left join goods_receipt_lines source_receipt_lines
        on source_receipt_lines.tenant_id = inventory_movements.tenant_id
        and inventory_movements.source_type = 'goods_receipt_line'
        and inventory_movements.source_id = source_receipt_lines.id::text
      left join qc_checks source_qc_checks
        on source_qc_checks.tenant_id = inventory_movements.tenant_id
        and inventory_movements.source_type = 'qc_check'
        and inventory_movements.source_id = source_qc_checks.id::text
      left join goods_receipt_lines qc_receipt_lines
        on qc_receipt_lines.id = source_qc_checks.goods_receipt_line_id
        and qc_receipt_lines.tenant_id = source_qc_checks.tenant_id
      where inventory_movements.tenant_id = $1
        and (
          source_receipt_lines.goods_receipt_id = $2
          or qc_receipt_lines.goods_receipt_id = $2
        )
      order by inventory_movements.occurred_at desc
    `,
    [tenantId, receiptId],
  );
  return {
    receipt: receipt.rows[0] ?? null,
    lines: lines.rows,
    inventoryMovements: inventoryMovements.rows,
  };
}

export async function loadInventoryLedger(db: QueryExecutor, tenantId: string) {
  const balances = await db.query(
    `
      with movement_balances as (
        select
          inventory_movements.item_id,
          coalesce(sum(inventory_movements.quantity_delta) filter (where inventory_movements.location_code = 'MAIN'), 0) as physical_quantity,
          coalesce(sum(inventory_movements.reserved_delta) filter (where inventory_movements.location_code = 'MAIN'), 0) as movement_reserved_quantity,
          coalesce(sum(inventory_movements.quantity_delta) filter (where inventory_movements.location_code = 'QC-HOLD'), 0) as qc_hold_quantity,
          coalesce(sum(inventory_movements.quantity_delta) filter (where inventory_movements.location_code = 'QUARANTINE'), 0) as quarantine_quantity,
          coalesce(sum(inventory_movements.quantity_delta) filter (where inventory_movements.location_code = 'LOGISTICS-STAGE'), 0) as logistics_stage_quantity
        from inventory_movements
        where inventory_movements.tenant_id = $1
        group by inventory_movements.item_id
      ),
      customer_demand as (
        select
          operations_order_lines.item_id,
          coalesce(sum(operations_order_lines.quantity), 0) as reserved_quantity
        from operations_order_lines
        join operations_orders
          on operations_orders.id = operations_order_lines.operations_order_id
          and operations_orders.tenant_id = operations_order_lines.tenant_id
        where operations_order_lines.tenant_id = $1
          and operations_order_lines.supply_status <> 'cancelled'
          and operations_orders.status in ('open', 'planned', 'in_progress')
        group by operations_order_lines.item_id
      ),
      open_purchase_orders as (
        select
          purchase_order_lines.item_id,
          coalesce(sum(purchase_order_lines.quantity), 0) as ordered_quantity,
          min(purchase_order_lines.expected_delivery_date) as next_expected_delivery_date
        from purchase_order_lines
        join purchase_orders
          on purchase_orders.id = purchase_order_lines.purchase_order_id
          and purchase_orders.tenant_id = purchase_order_lines.tenant_id
        where purchase_order_lines.tenant_id = $1
          and purchase_order_lines.status = 'open'
          and purchase_orders.status in ('draft', 'pending_approval', 'approved', 'sent', 'acknowledged')
        group by purchase_order_lines.item_id
      )
      select items.id, items.sku, items.title,
        items.min_inventory_quantity,
        items.default_order_quantity,
        items.supplier_lead_time_days,
        coalesce(movement_balances.physical_quantity, 0) as physical_quantity,
        greatest(
          coalesce(customer_demand.reserved_quantity, 0),
          coalesce(movement_balances.movement_reserved_quantity, 0)
        ) as reserved_quantity,
        coalesce(movement_balances.physical_quantity, 0)
          - greatest(
              coalesce(customer_demand.reserved_quantity, 0),
              coalesce(movement_balances.movement_reserved_quantity, 0)
            ) as available_quantity,
        coalesce(open_purchase_orders.ordered_quantity, 0) as ordered_quantity,
        coalesce(movement_balances.physical_quantity, 0)
          - greatest(
              coalesce(customer_demand.reserved_quantity, 0),
              coalesce(movement_balances.movement_reserved_quantity, 0)
            )
          + coalesce(open_purchase_orders.ordered_quantity, 0) as planned_quantity,
        open_purchase_orders.next_expected_delivery_date,
        coalesce(movement_balances.qc_hold_quantity, 0) as qc_hold_quantity,
        coalesce(movement_balances.quarantine_quantity, 0) as quarantine_quantity,
        coalesce(movement_balances.logistics_stage_quantity, 0) as logistics_stage_quantity
      from items
      left join movement_balances on movement_balances.item_id = items.id
      left join customer_demand on customer_demand.item_id = items.id
      left join open_purchase_orders on open_purchase_orders.item_id = items.id
      where items.tenant_id = $1
      order by items.sku
    `,
    [tenantId],
  );
  const locationBalances = await db.query(
    `
      select
        items.id as item_id,
        items.sku,
        items.title,
        coalesce(inventory_movements.location_code, 'Unassigned') as location_code,
        coalesce(sum(inventory_movements.quantity_delta), 0) as on_hand_quantity,
        case
          when coalesce(inventory_movements.location_code, 'MAIN') = 'MAIN'
          then coalesce(sum(inventory_movements.quantity_delta - inventory_movements.reserved_delta), 0)
          else 0
        end as available_quantity,
        case
          when coalesce(inventory_movements.location_code, '') = 'QC-HOLD'
          then coalesce(sum(inventory_movements.quantity_delta), 0)
          else 0
        end as qc_hold_quantity,
        max(inventory_movements.occurred_at) as last_movement_at
      from inventory_movements
      join items
        on items.id = inventory_movements.item_id
        and items.tenant_id = inventory_movements.tenant_id
      where inventory_movements.tenant_id = $1
      group by items.id, items.sku, items.title, inventory_movements.location_code
      having coalesce(sum(inventory_movements.quantity_delta), 0) <> 0
        or coalesce(sum(inventory_movements.reserved_delta), 0) <> 0
      order by items.sku, coalesce(inventory_movements.location_code, 'Unassigned')
    `,
    [tenantId],
  );
  const movements = await db.query(
    `
      select inventory_movements.*, items.sku, items.title,
        coalesce(source_receipts.id, qc_receipts.id) as source_receipt_id,
        coalesce(source_receipts.receipt_number, qc_receipts.receipt_number) as source_receipt_number,
        coalesce(source_purchase_orders.id, qc_purchase_orders.id) as source_purchase_order_id,
        coalesce(source_purchase_orders.display_number, qc_purchase_orders.display_number) as source_purchase_order_number
      from inventory_movements
      join items
        on items.id = inventory_movements.item_id
        and items.tenant_id = inventory_movements.tenant_id
      left join goods_receipt_lines source_receipt_lines
        on source_receipt_lines.tenant_id = inventory_movements.tenant_id
        and inventory_movements.source_type = 'goods_receipt_line'
        and inventory_movements.source_id = source_receipt_lines.id::text
      left join goods_receipts source_receipts
        on source_receipts.id = source_receipt_lines.goods_receipt_id
        and source_receipts.tenant_id = source_receipt_lines.tenant_id
      left join purchase_orders source_purchase_orders
        on source_purchase_orders.id = source_receipts.purchase_order_id
        and source_purchase_orders.tenant_id = source_receipts.tenant_id
      left join qc_checks source_qc_checks
        on source_qc_checks.tenant_id = inventory_movements.tenant_id
        and inventory_movements.source_type = 'qc_check'
        and inventory_movements.source_id = source_qc_checks.id::text
      left join goods_receipt_lines qc_receipt_lines
        on qc_receipt_lines.id = source_qc_checks.goods_receipt_line_id
        and qc_receipt_lines.tenant_id = source_qc_checks.tenant_id
      left join goods_receipts qc_receipts
        on qc_receipts.id = qc_receipt_lines.goods_receipt_id
        and qc_receipts.tenant_id = qc_receipt_lines.tenant_id
      left join purchase_orders qc_purchase_orders
        on qc_purchase_orders.id = qc_receipts.purchase_order_id
        and qc_purchase_orders.tenant_id = qc_receipts.tenant_id
      where inventory_movements.tenant_id = $1
      order by inventory_movements.occurred_at desc
      limit 50
    `,
    [tenantId],
  );

  return {
    balances: balances.rows,
    locationBalances: locationBalances.rows,
    movements: movements.rows,
  };
}

export async function loadInventoryItemDetail(
  db: QueryExecutor,
  tenantId: string,
  itemId: string,
) {
  const inventory = await loadInventoryLedger(db, tenantId);
  const balance = inventory.balances.find((row: any) => row.id === itemId);
  const item = await db.query(
    `
      select items.*
      from items
      where items.tenant_id = $1 and items.id = $2
    `,
    [tenantId, itemId],
  );
  const movements = await db.query(
    `
      select inventory_movements.*, items.sku, items.title,
        coalesce(source_receipts.id, qc_receipts.id) as source_receipt_id,
        coalesce(source_receipts.receipt_number, qc_receipts.receipt_number) as source_receipt_number,
        coalesce(source_purchase_orders.id, qc_purchase_orders.id) as source_purchase_order_id,
        coalesce(source_purchase_orders.display_number, qc_purchase_orders.display_number) as source_purchase_order_number,
        coalesce(source_receipt_lines.id, qc_receipt_lines.id) as source_receipt_line_id,
        coalesce(source_order_lines.id, qc_order_lines.id) as source_order_line_id,
        coalesce(source_orders.id, qc_orders.id) as source_order_id,
        coalesce(source_orders.order_name, qc_orders.order_name) as source_order_name,
        coalesce(source_order_lines.sku, qc_order_lines.sku) as source_order_line_sku,
        coalesce(source_order_lines.title, qc_order_lines.title) as source_order_line_title
      from inventory_movements
      join items
        on items.id = inventory_movements.item_id
        and items.tenant_id = inventory_movements.tenant_id
      left join goods_receipt_lines source_receipt_lines
        on source_receipt_lines.tenant_id = inventory_movements.tenant_id
        and inventory_movements.source_type = 'goods_receipt_line'
        and inventory_movements.source_id = source_receipt_lines.id::text
      left join goods_receipts source_receipts
        on source_receipts.id = source_receipt_lines.goods_receipt_id
        and source_receipts.tenant_id = source_receipt_lines.tenant_id
      left join purchase_order_lines source_purchase_order_lines
        on source_purchase_order_lines.id = source_receipt_lines.purchase_order_line_id
        and source_purchase_order_lines.tenant_id = source_receipt_lines.tenant_id
      left join purchase_orders source_purchase_orders
        on source_purchase_orders.id = source_purchase_order_lines.purchase_order_id
        and source_purchase_orders.tenant_id = source_purchase_order_lines.tenant_id
      left join purchase_needs source_purchase_needs
        on source_purchase_needs.id = source_purchase_order_lines.purchase_need_id
        and source_purchase_needs.tenant_id = source_purchase_order_lines.tenant_id
      left join operations_order_lines source_order_lines
        on source_order_lines.id = source_purchase_needs.source_order_line_id
        and source_order_lines.tenant_id = source_purchase_needs.tenant_id
      left join operations_orders source_orders
        on source_orders.id = source_order_lines.operations_order_id
        and source_orders.tenant_id = source_order_lines.tenant_id
      left join qc_checks source_qc_checks
        on source_qc_checks.tenant_id = inventory_movements.tenant_id
        and inventory_movements.source_type = 'qc_check'
        and inventory_movements.source_id = source_qc_checks.id::text
      left join goods_receipt_lines qc_receipt_lines
        on qc_receipt_lines.id = source_qc_checks.goods_receipt_line_id
        and qc_receipt_lines.tenant_id = source_qc_checks.tenant_id
      left join goods_receipts qc_receipts
        on qc_receipts.id = qc_receipt_lines.goods_receipt_id
        and qc_receipts.tenant_id = qc_receipt_lines.tenant_id
      left join purchase_order_lines qc_purchase_order_lines
        on qc_purchase_order_lines.id = qc_receipt_lines.purchase_order_line_id
        and qc_purchase_order_lines.tenant_id = qc_receipt_lines.tenant_id
      left join purchase_orders qc_purchase_orders
        on qc_purchase_orders.id = qc_purchase_order_lines.purchase_order_id
        and qc_purchase_orders.tenant_id = qc_purchase_order_lines.tenant_id
      left join purchase_needs qc_purchase_needs
        on qc_purchase_needs.id = qc_purchase_order_lines.purchase_need_id
        and qc_purchase_needs.tenant_id = qc_purchase_order_lines.tenant_id
      left join operations_order_lines qc_order_lines
        on qc_order_lines.id = qc_purchase_needs.source_order_line_id
        and qc_order_lines.tenant_id = qc_purchase_needs.tenant_id
      left join operations_orders qc_orders
        on qc_orders.id = qc_order_lines.operations_order_id
        and qc_orders.tenant_id = qc_order_lines.tenant_id
      where inventory_movements.tenant_id = $1 and inventory_movements.item_id = $2
      order by inventory_movements.occurred_at desc
      limit 50
    `,
    [tenantId, itemId],
  );
  const demand = await db.query(
    `
      select operations_orders.id as order_id, operations_orders.order_name,
        operations_order_lines.id as order_line_id,
        operations_orders.customer_name,
        operations_orders.customer_email,
        operations_orders.customer_name_encrypted,
        operations_orders.customer_email_encrypted,
        operations_order_lines.quantity,
        operations_order_lines.unit, operations_order_lines.supply_status as status
      from operations_order_lines
      join operations_orders
        on operations_orders.id = operations_order_lines.operations_order_id
        and operations_orders.tenant_id = operations_order_lines.tenant_id
      where operations_order_lines.tenant_id = $1
        and operations_order_lines.item_id = $2
        and operations_order_lines.supply_status <> 'cancelled'
        and operations_orders.status in ('open', 'planned', 'in_progress')
      order by operations_orders.created_at
    `,
    [tenantId, itemId],
  );
  const incoming = await db.query(
    `
      select purchase_orders.id as purchase_order_id, purchase_orders.display_number,
        purchase_orders.status as purchase_order_status,
        suppliers.name as supplier_name,
        purchase_order_lines.quantity, purchase_order_lines.unit,
        purchase_order_lines.expected_delivery_date
      from purchase_order_lines
      join purchase_orders
        on purchase_orders.id = purchase_order_lines.purchase_order_id
        and purchase_orders.tenant_id = purchase_order_lines.tenant_id
      join suppliers
        on suppliers.id = purchase_orders.supplier_id
        and suppliers.tenant_id = purchase_orders.tenant_id
      where purchase_order_lines.tenant_id = $1
        and purchase_order_lines.item_id = $2
        and purchase_order_lines.status = 'open'
        and purchase_orders.status in ('draft', 'pending_approval', 'approved', 'sent', 'acknowledged')
      order by purchase_order_lines.expected_delivery_date nulls last, purchase_orders.created_at
    `,
    [tenantId, itemId],
  );
  const receivingWork = await db.query(
    `
      select goods_receipt_lines.*, items.sku, items.title,
        goods_receipts.id as receipt_id,
        goods_receipts.receipt_number,
        goods_receipts.status as receipt_status,
        purchase_orders.id as purchase_order_id,
        purchase_orders.display_number as purchase_order_number,
        suppliers.name as supplier_name,
        qc_checks.status as qc_status,
        qc_checks.result as qc_result,
        warehouse_tasks.status as putaway_task_status
      from goods_receipt_lines
      join goods_receipts
        on goods_receipts.id = goods_receipt_lines.goods_receipt_id
        and goods_receipts.tenant_id = goods_receipt_lines.tenant_id
      join purchase_orders
        on purchase_orders.id = goods_receipts.purchase_order_id
        and purchase_orders.tenant_id = goods_receipts.tenant_id
      join suppliers
        on suppliers.id = purchase_orders.supplier_id
        and suppliers.tenant_id = purchase_orders.tenant_id
      join items
        on items.id = goods_receipt_lines.item_id
        and items.tenant_id = goods_receipt_lines.tenant_id
      left join qc_checks
        on qc_checks.goods_receipt_line_id = goods_receipt_lines.id
        and qc_checks.tenant_id = goods_receipt_lines.tenant_id
      left join warehouse_tasks on warehouse_tasks.tenant_id = goods_receipt_lines.tenant_id
        and warehouse_tasks.task_type = 'putaway'
        and warehouse_tasks.source_type = 'goods_receipt_line'
        and warehouse_tasks.source_id = goods_receipt_lines.id
      where goods_receipt_lines.tenant_id = $1
        and goods_receipt_lines.item_id = $2
        and goods_receipt_lines.status in ('qc_hold', 'accepted')
      order by goods_receipts.created_at desc
    `,
    [tenantId, itemId],
  );

  return {
    item: item.rows[0] ?? null,
    balance: balance ?? null,
    demand: demand.rows.map((row) => {
      const decrypted = decryptOrderRow(row as CustomerEncryptedRow);
      return {
        ...decrypted,
        customer_display_name: decrypted.customer_name ?? "No customer",
      };
    }),
    incoming: incoming.rows,
    receivingWork: receivingWork.rows,
    movements: movements.rows,
  };
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
  const allowedLocations = new Set([
    "MAIN",
    "QC-HOLD",
    "QUARANTINE",
    "LOGISTICS-STAGE",
  ]);
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

  const reference =
    input.reference.trim() || `${movementType}:${new Date().toISOString()}`;
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

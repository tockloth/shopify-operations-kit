# Tenant Foundation Plan

Status: tenant analysis, runtime query hardening, integration coverage, local integrity audit, and local composite-key migrations through Payments/Cases/Access-Control are in place. Supabase staging has not been changed. No UI, auth, billing, or process behavior changes are part of this step.

## Current State

Operations Kit already has a tenant foundation:

- `tenants` exists.
- `shopify_installations` maps Shopify shops to tenants.
- `requireOperationsKitContext(request)` authenticates the Shopify admin session, reads `session.shop`, calls `ensureTenantForShop(pool, session.shop, session.scope)`, and exposes `context.ctx.tenantId`.
- Current app routes pass `context.ctx.tenantId` into Operations Kit loaders and mutations.
- Most domain tables already have `tenant_id uuid not null references tenants(id) on delete cascade`.
- Most uniqueness rules are tenant-scoped, for example `(tenant_id, sku)`, `(tenant_id, order_name)`, `(tenant_id, display_number)`.

The main remaining gap is not the absence of `tenant_id`; it is hard isolation. Many foreign keys reference only `id`, and many joins join only by `id`. That works when all writes are correct, but it does not make cross-tenant references impossible at the database layer.

## Table Classification

| Table | Class | Tenant/shop field | Notes |
| --- | --- | --- | --- |
| `tenants` | tenant-global/reference | `shop_domain` | Current tenant identity table. One Shopify shop maps to one tenant today. |
| `shopify_installations` | Shopify-session/system | `tenant_id`, `shop_domain` | Installation metadata and scope snapshot. |
| `items` | tenant-owned | `tenant_id`, Shopify product/variant IDs | Tenant-owned product/master item data. |
| `suppliers` | tenant-owned | `tenant_id` | Tenant-owned supplier master. |
| `supplier_items` | tenant-owned | `tenant_id` | Tenant-owned supplier-item terms and preferred supplier mapping. |
| `boms` | tenant-owned | `tenant_id` | Tenant-owned BOM header. |
| `bom_lines` | tenant-owned | `tenant_id` | Tenant-owned BOM components. |
| `operations_orders` | tenant-owned | `tenant_id`, Shopify order IDs | Tenant-owned local order representation. |
| `operations_order_lines` | tenant-owned | `tenant_id`, Shopify line/variant IDs | Tenant-owned demand lines. |
| `operation_customers` | tenant-owned | `tenant_id`, Shopify customer IDs | Tenant-owned customer cache with encrypted/hashed PCD. |
| `mrp_runs` | tenant-owned | `tenant_id` | Tenant-owned planning run. |
| `mrp_run_lines` | tenant-owned | `tenant_id` | Tenant-owned planning result lines. |
| `purchase_needs` | tenant-owned | `tenant_id` | Tenant-owned purchase demand. |
| `production_needs` | tenant-owned | `tenant_id` | Tenant-owned production demand. |
| `purchase_orders` | tenant-owned | `tenant_id` | Tenant-owned purchase order. |
| `purchase_order_lines` | tenant-owned | `tenant_id` | Tenant-owned purchase order line. |
| `goods_receipts` | tenant-owned | `tenant_id` | Tenant-owned receipt header. |
| `goods_receipt_lines` | tenant-owned | `tenant_id` | Tenant-owned receipt line. |
| `qc_checks` | tenant-owned | `tenant_id` | Tenant-owned QC work. |
| `inventory_movements` | tenant-owned | `tenant_id` | Tenant-owned inventory ledger. |
| `shipping_orders` | tenant-owned | `tenant_id` | Tenant-owned outbound shipment. |
| `shipping_order_lines` | tenant-owned | `tenant_id` | Tenant-owned outbound shipment lines. |
| `production_orders` | tenant-owned | `tenant_id` | Tenant-owned production order. |
| `production_components` | tenant-owned | `tenant_id` | Tenant-owned production component demand. |
| `warehouse_tasks` | tenant-owned | `tenant_id` | Tenant-owned operational tasks. |
| `purchase_payments` | tenant-owned | `tenant_id` | Tenant-owned purchase payment/export tracking. |
| `privacy_settings` | audit/log/config | `tenant_id` as primary key | Tenant-specific retention configuration. |
| `operation_cases` | audit/log/config | `tenant_id` | Tenant-owned case records. |
| `case_events` | audit/log/config | `tenant_id` | Tenant-owned audit/event log. |
| `operation_users` | tenant-global/reference | `tenant_id` | Tenant-scoped future Operations user records. Not active app auth yet. |
| `operation_groups` | tenant-global/reference | `tenant_id` | Tenant-scoped groups. |
| `operation_roles` | tenant-global/reference | `tenant_id` | Tenant-scoped roles/permissions. |
| `operation_user_groups` | tenant-global/reference | `tenant_id` | Tenant-scoped user/group join table. |
| `operation_group_roles` | tenant-global/reference | `tenant_id` | Tenant-scoped group/role join table. |
| `Session` | Shopify-session/system | `shop`, `userId` | Prisma Shopify session storage, separate from Operations domain tenant tables. |

## Tenant Context Flow

Current request path:

1. Shopify Admin authentication runs through `authenticate.admin(request)`.
2. `requireOperationsKitContext(request)` reads `session.shop`.
3. `ensureTenantForShop(pool, shopDomain, scopes)` upserts:
   - `tenants(shop_domain)`
   - `shopify_installations(tenant_id, shop_domain, scopes)`
4. The route receives `context.ctx.tenantId`.
5. Loaders and actions pass `tenantId` into Operations Kit server functions.
6. The settings page displays the current tenant ID.
7. Sample/demo data is seeded under the current tenant ID.

This means tenant selection is currently Shopify-shop based, not user based and not settings based.

## Central Tenant Provider

The central function for tenant context should remain `requireOperationsKitContext(request)`, backed by `ensureTenantForShop`.

Recommended next shape:

- Keep Shopify shop as the source of tenant identity for Phase 1.
- Make `requireOperationsKitContext` the only runtime path that can provide an Operations tenant.
- Later wrap `pool` and `tenantId` into a tenant-scoped executor or service context, for example `{ db, tenantId, shopDomain }`, so routes cannot accidentally call domain functions without tenant context.
- Keep Operations user management separate until the auth/RBAC phase.

## Query And Mutation Surface

All domain functions should continue to require `tenantId`. Current exported functions already mostly follow this shape.

Functions that establish or configure tenant context:

- `ensureTenantForShop`
- `ensureDefaultOperationAccess`
- `loadAccessControlSettings`
- `upsertOperationUser`
- `setOperationUserActive`
- `loadPrivacySettings`
- `updatePrivacySettings`
- `redactExpiredCustomerData`

Shopify sync and Shopify writeback functions that must remain tenant-scoped:

- `syncShopifyProducts`
- `syncShopifyOrders`
- `syncShopifyCustomers`
- `loadShopifyFulfillmentTargetForOrder`
- `updateOperationsOrderFulfillmentStatus`

Master data and planning functions that must remain tenant-scoped:

- `seedOperationsKitScenario`
- `seedSampleOperatingScenario`
- `loadDashboard`
- `loadItems`
- `createOperationsItem`
- `loadItemDetail`
- `updateItemOperationsProperties`
- `saveSupplierForItem`
- `savePreferredSupplierForItem`
- `loadSuppliers`
- `saveSupplierMaster`
- `loadBoms`
- `loadBomProductContext`
- `addBomLineToItem`
- `updateBomLineQuantity`
- `deleteBomLine`
- `createActiveBomForItem`
- `runOperationsMrp`
- `runScenarioMrp`
- `commitMrpRun`

Order, procurement, receiving, inventory, and logistics functions that must remain tenant-scoped:

- `loadOperationsOrdersList`
- `loadOperationsOrderDetail`
- `loadOperationsOrderLinesList`
- `loadOperationsOrderLineDetail`
- `createOperationsOrderEntry`
- `consolidateOpenOrdersByCustomer`
- `createPurchaseNeedForOrderLine`
- `loadPurchaseNeeds`
- `assignPreferredSuppliersToNeeds`
- `assignSupplierToPurchaseNeed`
- `createPurchaseOrderFromNeed`
- `createPurchaseOrdersFromReadyNeeds`
- `loadPurchaseOrders`
- `loadPurchaseOrderDetail`
- `transitionPurchaseOrder`
- `reopenPurchaseOrderForEditing`
- `updatePurchaseOrderLinePricing`
- `postGoodsReceiptForAcknowledgedPurchaseOrders`
- `createGoodsReceiptForPurchaseOrder`
- `loadReceivablePurchaseOrders`
- `loadReceipts`
- `loadReceiptDetail`
- `completeReceiptLineQc`
- `putawayReceiptLine`
- `passQcAndCreatePutaway`
- `loadInventoryLedger`
- `loadInventoryItemDetail`
- `postInventoryMovement`
- `loadShippableOperationsOrders`
- `createShippingOrdersFromOpenOperationsOrders`
- `loadShippingOrders`
- `loadShippingOrderDetail`
- `transitionShippingOrder`
- `updateShippingOrderLineQuantity`
- `validateShippingOrderInventoryAvailability`

Production/payment/case functions that must remain tenant-scoped:

- `createProductionWorkForLatestNeed`
- `loadProductionNeeds`
- `loadProductionOrders`
- `completeProductionOrder`
- `completeProductionQc`
- `loadPaymentEntries`
- `exportPaymentEntries`
- `loadWarehouseTasks`
- `loadCases`

## Critical Isolation Risks

1. Cross-tenant foreign-key references are still possible in principle.

Most tables have `tenant_id`, but foreign keys reference only parent `id`, for example `operations_order_lines.item_id references items(id)`. If application code ever writes a child row with `tenant_id = A` and `item_id` from tenant B, the database allows it. The same pattern exists across orders, items, suppliers, PO lines, receipts, QC, inventory movements, shipping lines, production, access-control joins, and payments.

2. Joins often join by `id` only.

Many queries filter a base table by tenant, then join related tables by `id`. That is usually safe if the database never contains cross-tenant references, but it depends on application discipline. Future hardening should add `and related.tenant_id = base.tenant_id` to joins, especially around:

- item joins
- supplier joins
- operation order/order line joins
- MRP run/run line joins
- purchase need/order/line joins
- receipt/QC joins
- inventory movement source context joins
- shipping order/line joins
- user/group/role joins

3. Diagnostics contain an intentional all-tenant count.

`loadPurchaseOrderTenantDiagnostics` compares current-tenant purchase order count with all-tenant purchase order count. This is useful during development but should not be exposed in production tenant UX unless explicitly guarded.

4. Default access seeding mutates on every context load.

`requireOperationsKitContext` calls `ensureDefaultOperationAccess` on each configured request. The writes are tenant-scoped and idempotent, but the tenant bootstrap path currently performs more than tenant resolution. Later phases should separate tenant resolution from seed/default initialization.

5. Webhook tenant updates are shop-based.

`webhooks.app.uninstalled` updates `tenants` by `shop_domain`. That is appropriate for a Shopify app lifecycle handler, but it should also update or verify `shopify_installations` consistently in the implementation phase.

6. Tests are currently single-tenant.

The integration smoke test creates one generated shop/tenant and exercises the process inside that tenant. It does not prove that identical SKUs, orders, supplier names, or Shopify IDs in another tenant remain isolated.

7. Sample data is tenant-scoped but globally named.

Sample SKUs, supplier names, order names, PO numbers, and users are reused across tenants. Existing `(tenant_id, ...)` unique constraints make this safe, but tests should explicitly prove it.

## Migration Plan

No migration should be created in this analysis step. Recommended implementation order:

1. Baseline audit migration, no data shape change.

   Create SQL assertions or a one-off script that reports:
   - every Operations table with missing `tenant_id`
   - every FK from a tenant-owned table whose parent is tenant-owned but not tenant-enforced
   - orphaned or cross-tenant candidate rows by joining child and parent tenant IDs

2. Add composite tenant identity indexes.

   For every tenant-owned parent table referenced by another tenant-owned table, add a unique constraint or unique index on `(tenant_id, id)`.

   Examples:
   - `items(tenant_id, id)`
   - `operations_orders(tenant_id, id)`
   - `operations_order_lines(tenant_id, id)`
   - `suppliers(tenant_id, id)`
   - `purchase_needs(tenant_id, id)`
   - `purchase_orders(tenant_id, id)`
   - `purchase_order_lines(tenant_id, id)`
   - `goods_receipts(tenant_id, id)`
   - `goods_receipt_lines(tenant_id, id)`
   - `qc_checks(tenant_id, id)`
   - `shipping_orders(tenant_id, id)`
   - `shipping_order_lines(tenant_id, id)`
   - `operation_users(tenant_id, id)`
   - `operation_groups(tenant_id, id)`
   - `operation_roles(tenant_id, id)`

3. Add composite foreign keys.

   Replace or supplement single-column parent FKs with composite `(tenant_id, parent_id)` FKs where the child has the same tenant. Start with the Phase 0A flow:

   - `operations_order_lines(tenant_id, operations_order_id)`
   - `operations_order_lines(tenant_id, item_id)`
   - `purchase_needs(tenant_id, item_id)`
   - `purchase_needs(tenant_id, mrp_run_id)`
   - `purchase_needs(tenant_id, mrp_run_line_id)`
   - `purchase_needs(tenant_id, source_order_line_id)`
   - `purchase_orders(tenant_id, supplier_id)`
   - `purchase_order_lines(tenant_id, purchase_order_id)`
   - `purchase_order_lines(tenant_id, purchase_need_id)`
   - `purchase_order_lines(tenant_id, item_id)`
   - `goods_receipts(tenant_id, purchase_order_id)`
   - `goods_receipt_lines(tenant_id, goods_receipt_id)`
   - `goods_receipt_lines(tenant_id, purchase_order_line_id)`
   - `goods_receipt_lines(tenant_id, item_id)`
   - `qc_checks(tenant_id, goods_receipt_line_id)`
   - `qc_checks(tenant_id, item_id)`
   - `inventory_movements(tenant_id, item_id)`
   - `shipping_orders(tenant_id, operations_order_id)`
   - `shipping_order_lines(tenant_id, shipping_order_id)`
   - `shipping_order_lines(tenant_id, operations_order_line_id)`
   - `shipping_order_lines(tenant_id, item_id)`

   Then extend to BOM, production, payments, cases, and access control.

4. Backfill strategy for existing data.

   No tenant backfill should be necessary for current migrations because tenant-owned tables already have `tenant_id not null`. The needed backfill is integrity validation:
   - For each child table, join child to parent by `parent_id`.
   - Report rows where `child.tenant_id <> parent.tenant_id`.
   - If local/dev data contains violations, either delete and reseed or update child rows to the parent tenant only after confirming the source.
   - Stop migration if production data contains violations.

5. Query hardening.

   Update joins to include tenant equality where related rows cross table boundaries:
   - `join items on items.id = ... and items.tenant_id = ...`
   - `join suppliers on suppliers.id = ... and suppliers.tenant_id = ...`
   - `join purchase_orders on purchase_orders.id = ... and purchase_orders.tenant_id = ...`
   - analogous joins across receipt, QC, shipping, production, access-control, and payment queries.

   Also require `tenant_id` in `update` and `delete` statements that currently rely on row ID plus a filtered lookup elsewhere.

6. Context hardening.

   Keep `requireOperationsKitContext` as the central tenant provider. Add a small tenant-scoped service/context wrapper only after the DB constraints are in place. Avoid broad refactors; change call sites incrementally by route group.

7. Optional later hardening: Postgres RLS.

   If Operations Kit moves toward direct Supabase clients or broader service integrations, add RLS policies using a transaction-local tenant setting. For the current server-side `pg` pool model, composite FKs and explicit tenant predicates are the first practical step.

## Index Plan

Keep existing tenant-leading indexes. Add missing tenant-leading indexes for common lookup paths:

- `(tenant_id, id)` unique indexes for composite FK targets.
- `(tenant_id, shopify_order_gid)` on `operations_orders` already exists.
- `(tenant_id, shopify_variant_gid)` on `items` already exists.
- Add or verify `(tenant_id, operations_order_id)` for order lines and shipping orders.
- Add or verify `(tenant_id, item_id)` on inventory, supplier items, purchase needs, receipt lines, shipping lines, and production components.
- Add or verify status queues:
  - `purchase_needs(tenant_id, status)`
  - `purchase_orders(tenant_id, status)`
  - `goods_receipts(tenant_id, status)`
  - `goods_receipt_lines(tenant_id, status)`
  - `qc_checks(tenant_id, status)`
  - `shipping_orders(tenant_id, status)`
  - `warehouse_tasks(tenant_id, status)`
  - `purchase_payments(tenant_id, status)`

## Test Plan

Add a focused multi-tenant integration test after the migration/hardening step.

Scenario:

1. Create two Shopify shops with `ensureTenantForShop`:
   - `tenant-a-<timestamp>.myshopify.com`
   - `tenant-b-<timestamp>.myshopify.com`
2. Seed or insert the same SKU in both tenants, for example `TENANT-SHARED-SKU`.
3. Insert the same supplier name in both tenants.
4. Insert an order named `#1001` or equivalent in both tenants.
5. Run loaders for each tenant:
   - `loadItems`
   - `loadSuppliers`
   - `loadOperationsOrdersList`
   - `loadPurchaseNeeds`
   - `loadInventoryLedger`
6. Assert each tenant sees only its own rows, even with identical business keys.
7. Run mutations in tenant A:
   - create purchase need
   - create PO
   - create receipt
   - complete QC
   - putaway
   - create shipment
8. Assert tenant B rows and counts are unchanged.
9. Attempt negative cross-tenant writes where practical:
   - child row with `tenant_id = tenant A` and parent ID from tenant B
   - expect database constraint failure once composite FKs are added.
10. Add route-level smoke coverage later only after server-level isolation is green.

Suggested command:

```bash
OPERATIONS_KIT_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54332/postgres" npx vitest run tests/integration/operations-kit-scenario.test.ts
```

The existing smoke test can be extended, but a separate `tenant-isolation.test.ts` would be cleaner and easier to reason about.

## Tenant Isolation Test Result

Implemented in `tests/integration/tenant-isolation.test.ts`.

The test creates two Shopify-shop-derived tenants with `ensureTenantForShop`:

- `tenant-a-test-<timestamp>.myshopify.com`
- `tenant-b-test-<timestamp>.myshopify.com`

It intentionally creates matching business keys in both tenants:

- same SKU pattern: `TENANT-ISO-SHARED-<timestamp>`
- same supplier name pattern: `Tenant Isolation Supplier <timestamp>`
- same order reference pattern: `#TENANT-ISO-<timestamp>`

Verified tenant-scoped reads:

- `loadItems`
- `loadSuppliers`
- `loadOperationsOrdersList`

Verified tenant-scoped mutation:

- `updateItemOperationsProperties`

The mutation check first attempts to update tenant B's item ID while passing tenant A's `tenantId`, then verifies tenant B's item remains unchanged. It also updates tenant A's own item and verifies only tenant A changed.

Initial result against the local Supabase test database:

- tenant-isolation test: passed, 2 tests
- Phase 0A scenario smoke test: passed, 20 tests
- no current runtime cross-tenant leakage was observed in the tested read and mutation path
- no runtime code, schema, or migration changes were needed

## Runtime Query Hardening Result

Phase 0A runtime hardening was added without database migrations or process behavior changes.

Hardened loader joins now include explicit tenant equality across:

- item and supplier joins in product/item detail and supplier-item purchasing terms
- operations order and order-line joins in order lists, order detail, order-line detail, customer history, and logistics readiness
- purchase need, purchase order, purchase order line, supplier, and receipt joins in procurement and PO detail
- goods receipt, receipt line, QC, warehouse task, and inventory movement joins in receiving detail and receiving lists
- inventory ledger/source-context joins that derive receipt, PO, order-line, and QC context from movements
- shipping order and shipping order line joins in logistics lists and shipment detail
- warehouse task, production, MRP, payment, and order-process summary joins that are adjacent to the Phase 0A flow

Hardened mutation guards:

- `linkPreferredSupplier` now verifies the supplier and item belong to the same tenant before inserting `supplier_items`.
- `saveSupplierForItem` now verifies the supplier and item belong to the same tenant before saving purchasing terms.
- `assignSupplierToPurchaseNeed` assigns only a supplier from the same tenant.
- `createPurchaseOrderFromNeed` and batch PO creation verify tenant-owned suppliers before PO creation.
- `completeReceiptLineQc` and `putawayReceiptLine` load receipt lines, QC checks, and items through tenant-matched joins.
- `transitionShippingOrder` loads shipment lines through tenant-matched item joins before writing inventory movements.

Still only solvable by database constraints:

- The database can still accept some cross-tenant parent IDs if a future code path writes malformed rows directly.
- Joins are now defensive at runtime, but they do not replace composite `(tenant_id, id)` unique keys and composite foreign keys.
- Existing single-column FKs still allow structurally valid `id` references without proving the parent row belongs to the child tenant.

## Extended Tenant Isolation Test Result

`tests/integration/tenant-isolation.test.ts` was extended to cover process objects, not only master data.

The extended test creates a tenant-A purchase flow and verifies tenant B cannot read tenant-A object IDs:

- creates a Purchase Need from a tenant-A Order Line
- creates and transitions a tenant-A Purchase Order
- creates a Goods Receipt
- completes QC and Putaway
- verifies Inventory detail and movement context remain tenant-scoped
- creates a Shipment and verifies tenant-B logistics reads cannot see it

Latest local Supabase result:

- tenant-isolation test: passed, 3 tests
- no current runtime cross-tenant leakage was observed in the tested Phase 0A read and mutation paths

## Local Integrity Audit

Audit file:

```bash
supabase/audit/phase-0a-tenant-integrity.sql
```

Run locally with:

```bash
OPERATIONS_KIT_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54332/postgres" npm run tenant:audit
```

The audit returns one row per tenant mismatch. A clean local database returns 0 rows.

Current audit scope:

- `supplier_items -> suppliers`
- `supplier_items -> items`
- `operations_order_lines -> operations_orders`
- `operations_order_lines -> items`
- `mrp_runs -> operations_orders`
- `mrp_run_lines -> mrp_runs`
- `mrp_run_lines -> items`
- `mrp_run_lines -> source items`
- `boms -> items`
- `bom_lines -> boms`
- `bom_lines -> items`
- `purchase_needs -> items`
- `purchase_needs -> suppliers`
- `purchase_needs -> mrp_runs`
- `purchase_needs -> mrp_run_lines`
- `purchase_needs -> source operations_order_lines`
- `purchase_orders -> suppliers`
- `purchase_order_lines -> purchase_orders`
- `purchase_order_lines -> purchase_needs`
- `purchase_order_lines -> items`
- `goods_receipts -> purchase_orders`
- `goods_receipt_lines -> goods_receipts`
- `goods_receipt_lines -> purchase_order_lines`
- `goods_receipt_lines -> items`
- `qc_checks -> goods_receipt_lines`
- `qc_checks -> items`
- `inventory_movements -> items`
- `inventory_movements` source links to receipt headers, receipt lines, shipment headers, shipping lines, order lines, and QC checks
- `shipping_orders -> operations_orders`
- `shipping_order_lines -> shipping_orders`
- `shipping_order_lines -> operations_order_lines`
- `shipping_order_lines -> items`
- `production_needs -> items`
- `production_needs -> mrp_runs`
- `production_needs -> mrp_run_lines`
- `production_orders -> production_needs`
- `production_orders -> items`
- `production_components -> production_orders`
- `production_components -> items`
- `warehouse_tasks -> items`
- `warehouse_tasks` source links to goods receipt lines, production orders, and shipping orders
- `purchase_payments -> purchase_orders`
- `purchase_payments -> suppliers`
- `operation_cases` primary-object links to operations orders, purchase needs, and items
- `case_events -> operation_cases`
- `operation_user_groups -> operation_users`
- `operation_user_groups -> operation_groups`
- `operation_group_roles -> operation_groups`
- `operation_group_roles -> operation_roles`

Current local result:

- 0 rows returned
- no local Phase 0A cross-tenant violations found before applying the first composite-key migration
- 0 rows returned again after applying the migration locally
- 0 rows returned before and after the second Procurement/Receiving/QC composite-key migration
- 0 rows returned before and after the third Inventory/Shipping composite-key migration
- 0 rows returned before and after the fourth BOM/Production/Warehouse composite-key migration
- 0 rows returned before and after the fifth Payments/Cases/Access-Control composite-key migration

## First Local Composite-Key Migration

Migration file:

```bash
supabase/migrations/20260524103000_phase_0a_tenant_composite_keys.sql
```

This first migration intentionally hardens only the central order/master-data block:

- `items`
- `suppliers`
- `supplier_items`
- `operations_orders`
- `operations_order_lines`

Added unique constraints:

- `items_tenant_id_id_key` on `items(tenant_id, id)`
- `suppliers_tenant_id_id_key` on `suppliers(tenant_id, id)`
- `supplier_items_tenant_id_id_key` on `supplier_items(tenant_id, id)`
- `operations_orders_tenant_id_id_key` on `operations_orders(tenant_id, id)`
- `operations_order_lines_tenant_id_id_key` on `operations_order_lines(tenant_id, id)`

Added composite foreign keys:

- `supplier_items_tenant_supplier_fk`: `supplier_items(tenant_id, supplier_id)` -> `suppliers(tenant_id, id)`
- `supplier_items_tenant_item_fk`: `supplier_items(tenant_id, item_id)` -> `items(tenant_id, id)`
- `operations_order_lines_tenant_order_fk`: `operations_order_lines(tenant_id, operations_order_id)` -> `operations_orders(tenant_id, id)`
- `operations_order_lines_tenant_item_fk`: `operations_order_lines(tenant_id, item_id)` -> `items(tenant_id, id)`

Existing single-column foreign keys were left in place. No constraint-name-specific drops were needed.

Local migration result:

- applied locally with `npm run db:migrate`
- new constraints verified in `pg_constraint`
- Supabase staging was not touched

Still open for later migration slices:

- `mrp_runs`
- `mrp_run_lines`
- `purchase_needs`
- `purchase_orders`
- `purchase_order_lines`
- `goods_receipts`
- `goods_receipt_lines`
- `qc_checks`
- `inventory_movements`
- `shipping_orders`
- `shipping_order_lines`
- BOM, production, payments, cases, warehouse tasks, and access-control tables

## Second Local Composite-Key Migration

Migration file:

```bash
supabase/migrations/20260524110000_phase_0a_procurement_receiving_composite_keys.sql
```

This second migration hardens the Procurement, Receiving, and QC block:

- `mrp_runs`
- `mrp_run_lines`
- `purchase_needs`
- `purchase_orders`
- `purchase_order_lines`
- `goods_receipts`
- `goods_receipt_lines`
- `qc_checks`

Added unique constraints:

- `mrp_runs_tenant_id_id_key` on `mrp_runs(tenant_id, id)`
- `mrp_run_lines_tenant_id_id_key` on `mrp_run_lines(tenant_id, id)`
- `purchase_needs_tenant_id_id_key` on `purchase_needs(tenant_id, id)`
- `purchase_orders_tenant_id_id_key` on `purchase_orders(tenant_id, id)`
- `purchase_order_lines_tenant_id_id_key` on `purchase_order_lines(tenant_id, id)`
- `goods_receipts_tenant_id_id_key` on `goods_receipts(tenant_id, id)`
- `goods_receipt_lines_tenant_id_id_key` on `goods_receipt_lines(tenant_id, id)`
- `qc_checks_tenant_id_id_key` on `qc_checks(tenant_id, id)`

Added composite foreign keys:

- `mrp_runs_tenant_operations_order_fk`: `mrp_runs(tenant_id, operations_order_id)` -> `operations_orders(tenant_id, id)`
- `mrp_run_lines_tenant_mrp_run_fk`: `mrp_run_lines(tenant_id, mrp_run_id)` -> `mrp_runs(tenant_id, id)`
- `mrp_run_lines_tenant_item_fk`: `mrp_run_lines(tenant_id, item_id)` -> `items(tenant_id, id)`
- `mrp_run_lines_tenant_source_item_fk`: `mrp_run_lines(tenant_id, source_item_id)` -> `items(tenant_id, id)`
- `purchase_needs_tenant_item_fk`: `purchase_needs(tenant_id, item_id)` -> `items(tenant_id, id)`
- `purchase_needs_tenant_mrp_run_fk`: `purchase_needs(tenant_id, mrp_run_id)` -> `mrp_runs(tenant_id, id)`
- `purchase_needs_tenant_mrp_run_line_fk`: `purchase_needs(tenant_id, mrp_run_line_id)` -> `mrp_run_lines(tenant_id, id)`
- `purchase_needs_tenant_supplier_fk`: `purchase_needs(tenant_id, supplier_id)` -> `suppliers(tenant_id, id)`
- `purchase_needs_tenant_source_order_line_fk`: `purchase_needs(tenant_id, source_order_line_id)` -> `operations_order_lines(tenant_id, id)`
- `purchase_orders_tenant_supplier_fk`: `purchase_orders(tenant_id, supplier_id)` -> `suppliers(tenant_id, id)`
- `purchase_order_lines_tenant_purchase_order_fk`: `purchase_order_lines(tenant_id, purchase_order_id)` -> `purchase_orders(tenant_id, id)`
- `purchase_order_lines_tenant_purchase_need_fk`: `purchase_order_lines(tenant_id, purchase_need_id)` -> `purchase_needs(tenant_id, id)`
- `purchase_order_lines_tenant_item_fk`: `purchase_order_lines(tenant_id, item_id)` -> `items(tenant_id, id)`
- `goods_receipts_tenant_purchase_order_fk`: `goods_receipts(tenant_id, purchase_order_id)` -> `purchase_orders(tenant_id, id)`
- `goods_receipt_lines_tenant_receipt_fk`: `goods_receipt_lines(tenant_id, goods_receipt_id)` -> `goods_receipts(tenant_id, id)`
- `goods_receipt_lines_tenant_purchase_order_line_fk`: `goods_receipt_lines(tenant_id, purchase_order_line_id)` -> `purchase_order_lines(tenant_id, id)`
- `goods_receipt_lines_tenant_item_fk`: `goods_receipt_lines(tenant_id, item_id)` -> `items(tenant_id, id)`
- `qc_checks_tenant_receipt_line_fk`: `qc_checks(tenant_id, goods_receipt_line_id)` -> `goods_receipt_lines(tenant_id, id)`
- `qc_checks_tenant_item_fk`: `qc_checks(tenant_id, item_id)` -> `items(tenant_id, id)`

Existing single-column foreign keys were left in place. Optional relationships such as `mrp_runs.operations_order_id`, `mrp_run_lines.source_item_id`, `purchase_needs.supplier_id`, and `purchase_needs.source_order_line_id` remain optional because nullable composite FKs are only enforced when all referencing values are present.

No `mrp_run_lines -> operations_order_lines` composite FK was added because `mrp_run_lines` does not currently have an order-line reference column. The relationship is only indirectly represented through `purchase_needs.source_order_line_id`.

Local migration result:

- audit before migration: 0 rows
- applied locally with `npm run db:migrate`
- audit after migration: 0 rows
- 27 new constraints verified in `pg_constraint`
- Supabase staging was not touched

Still open after the second migration and addressed partly in the third:

- `inventory_movements`
- `shipping_orders`
- `shipping_order_lines`
- BOM, production, payments, cases, warehouse tasks, and access-control tables
- source-specific hardening for polymorphic `inventory_movements.source_type/source_id`

## Third Local Composite-Key Migration

Migration file:

```bash
supabase/migrations/20260524113000_phase_0a_inventory_shipping_composite_keys.sql
```

This third migration hardens the Inventory and Shipping block:

- `inventory_movements`
- `shipping_orders`
- `shipping_order_lines`

Added unique constraints:

- `inventory_movements_tenant_id_id_key` on `inventory_movements(tenant_id, id)`
- `shipping_orders_tenant_id_id_key` on `shipping_orders(tenant_id, id)`
- `shipping_order_lines_tenant_id_id_key` on `shipping_order_lines(tenant_id, id)`

Added composite foreign keys:

- `inventory_movements_tenant_item_fk`: `inventory_movements(tenant_id, item_id)` -> `items(tenant_id, id)`
- `shipping_orders_tenant_operations_order_fk`: `shipping_orders(tenant_id, operations_order_id)` -> `operations_orders(tenant_id, id)`
- `shipping_order_lines_tenant_shipping_order_fk`: `shipping_order_lines(tenant_id, shipping_order_id)` -> `shipping_orders(tenant_id, id)`
- `shipping_order_lines_tenant_operations_order_line_fk`: `shipping_order_lines(tenant_id, operations_order_line_id)` -> `operations_order_lines(tenant_id, id)`
- `shipping_order_lines_tenant_item_fk`: `shipping_order_lines(tenant_id, item_id)` -> `items(tenant_id, id)`

Polymorphic source fields intentionally remain open:

- `inventory_movements.source_type`
- `inventory_movements.source_id`

Reason: `source_id` can point at different tables depending on `source_type`, for example receipt lines, QC checks, shipping lines, order lines, production orders, scenario seeds, or future source objects. A single classical FK would either be wrong or too narrow. These relationships are tenant-audited in `supabase/audit/phase-0a-tenant-integrity.sql` for known Phase 0A source types. A later schema change could introduce explicit nullable source columns if hard FK enforcement becomes necessary.

Local migration result:

- audit before migration: 0 rows
- applied locally with `npm run db:migrate`
- audit after migration: 0 rows
- 8 new constraints verified in `pg_constraint`
- Supabase staging was not touched

Still open for later migration slices:

- payments
- cases/events
- access-control tables
- source-specific hardening for polymorphic `inventory_movements.source_type/source_id`

## Fourth Local Composite-Key Migration

Migration file:

```bash
supabase/migrations/20260524120000_phase_0a_bom_production_warehouse_composite_keys.sql
```

This fourth migration hardens the existing BOM, Production, and Warehouse Task block:

- `boms`
- `bom_lines`
- `production_needs`
- `production_orders`
- `production_components`
- `warehouse_tasks`

The inspected schema does not currently contain `production_order_lines` or `warehouse_task_lines`.

Added unique constraints:

- `boms_tenant_id_id_key` on `boms(tenant_id, id)`
- `bom_lines_tenant_id_id_key` on `bom_lines(tenant_id, id)`
- `production_needs_tenant_id_id_key` on `production_needs(tenant_id, id)`
- `production_orders_tenant_id_id_key` on `production_orders(tenant_id, id)`
- `production_components_tenant_id_id_key` on `production_components(tenant_id, id)`
- `warehouse_tasks_tenant_id_id_key` on `warehouse_tasks(tenant_id, id)`

Added composite foreign keys:

- `boms_tenant_parent_item_fk`: `boms(tenant_id, parent_item_id)` -> `items(tenant_id, id)`
- `bom_lines_tenant_bom_fk`: `bom_lines(tenant_id, bom_id)` -> `boms(tenant_id, id)`
- `bom_lines_tenant_component_item_fk`: `bom_lines(tenant_id, component_item_id)` -> `items(tenant_id, id)`
- `production_needs_tenant_item_fk`: `production_needs(tenant_id, item_id)` -> `items(tenant_id, id)`
- `production_needs_tenant_mrp_run_fk`: `production_needs(tenant_id, mrp_run_id)` -> `mrp_runs(tenant_id, id)`
- `production_needs_tenant_mrp_run_line_fk`: `production_needs(tenant_id, mrp_run_line_id)` -> `mrp_run_lines(tenant_id, id)`
- `production_orders_tenant_production_need_fk`: `production_orders(tenant_id, production_need_id)` -> `production_needs(tenant_id, id)`
- `production_orders_tenant_item_fk`: `production_orders(tenant_id, item_id)` -> `items(tenant_id, id)`
- `production_components_tenant_production_order_fk`: `production_components(tenant_id, production_order_id)` -> `production_orders(tenant_id, id)`
- `production_components_tenant_item_fk`: `production_components(tenant_id, item_id)` -> `items(tenant_id, id)`
- `warehouse_tasks_tenant_item_fk`: `warehouse_tasks(tenant_id, item_id)` -> `items(tenant_id, id)`

Polymorphic source fields intentionally remain open:

- `warehouse_tasks.source_type`
- `warehouse_tasks.source_id`

Reason: `warehouse_tasks.source_id` can point at different operational objects depending on `source_type`, including receipt lines, production orders, and shipping orders in the current code. A single classical FK would be unsafe. Known source relationships are tenant-audited in `supabase/audit/phase-0a-tenant-integrity.sql`; a later schema design can add explicit nullable source columns if hard FK enforcement becomes necessary.

Runtime hardening in this slice was limited to existing BOM paths:

- BOM list/detail joins now match component/parent items by both `id` and `tenant_id`.
- BOM line creation now rejects a component item that is not in the current tenant.

Local migration result:

- audit before migration: 0 rows
- applied locally with `npm run db:migrate`
- audit after migration: 0 rows
- 17 new constraints verified in `pg_constraint`
- Supabase staging was not touched

Still open for later migration slices:

- source-specific hardening for polymorphic `inventory_movements.source_type/source_id`
- source-specific hardening for polymorphic `warehouse_tasks.source_type/source_id`

## Fifth Local Composite-Key Migration

Migration file:

```bash
supabase/migrations/20260524123000_phase_0a_payments_cases_access_control_composite_keys.sql
```

This fifth migration hardens the existing Payments, Cases, and Access-Control block:

- `purchase_payments`
- `operation_cases`
- `case_events`
- `operation_users`
- `operation_groups`
- `operation_roles`
- `operation_user_groups`
- `operation_group_roles`

Active usage today is limited:

- `purchase_payments` is created from purchase receipts and shown/exported in the Payments screen.
- `operation_cases` and `case_events` are listed as lightweight operational case/event records.
- `operation_users`, `operation_groups`, `operation_roles`, `operation_user_groups`, and `operation_group_roles` are seeded and shown in Settings, but they do not yet drive app authentication or permission enforcement.

Added unique constraints:

- `purchase_payments_tenant_id_id_key` on `purchase_payments(tenant_id, id)`
- `operation_cases_tenant_id_id_key` on `operation_cases(tenant_id, id)`
- `case_events_tenant_id_id_key` on `case_events(tenant_id, id)`
- `operation_users_tenant_id_id_key` on `operation_users(tenant_id, id)`
- `operation_groups_tenant_id_id_key` on `operation_groups(tenant_id, id)`
- `operation_roles_tenant_id_id_key` on `operation_roles(tenant_id, id)`
- `operation_user_groups_tenant_id_id_key` on `operation_user_groups(tenant_id, id)`
- `operation_group_roles_tenant_id_id_key` on `operation_group_roles(tenant_id, id)`

Added composite foreign keys:

- `purchase_payments_tenant_purchase_order_fk`: `purchase_payments(tenant_id, purchase_order_id)` -> `purchase_orders(tenant_id, id)`
- `purchase_payments_tenant_supplier_fk`: `purchase_payments(tenant_id, supplier_id)` -> `suppliers(tenant_id, id)`
- `case_events_tenant_operation_case_fk`: `case_events(tenant_id, operation_case_id)` -> `operation_cases(tenant_id, id)`
- `operation_user_groups_tenant_user_fk`: `operation_user_groups(tenant_id, user_id)` -> `operation_users(tenant_id, id)`
- `operation_user_groups_tenant_group_fk`: `operation_user_groups(tenant_id, group_id)` -> `operation_groups(tenant_id, id)`
- `operation_group_roles_tenant_group_fk`: `operation_group_roles(tenant_id, group_id)` -> `operation_groups(tenant_id, id)`
- `operation_group_roles_tenant_role_fk`: `operation_group_roles(tenant_id, role_id)` -> `operation_roles(tenant_id, id)`

Polymorphic case parent fields intentionally remain open:

- `operation_cases.primary_object_type`
- `operation_cases.primary_object_id`

Reason: the primary object can point at different operational objects depending on `primary_object_type`. Known current references are tenant-audited for operations orders, purchase needs, and items. A single classical FK would be unsafe unless the schema changes to explicit nullable source columns.

Runtime hardening in this slice was limited to existing Access-Control settings loaders:

- `operation_user_groups -> operation_groups` joins now match by both `id` and `tenant_id`.
- `operation_group_roles -> operation_roles` joins now match by both `id` and `tenant_id`.

Local migration result:

- audit before migration: 0 rows
- applied locally with `npm run db:migrate`
- audit after migration: 0 rows
- 15 new constraints verified in `pg_constraint`
- Supabase staging was not touched

Still open after the fifth migration:

- source-specific hardening for polymorphic `inventory_movements.source_type/source_id`
- source-specific hardening for polymorphic `warehouse_tasks.source_type/source_id`
- source-specific hardening for polymorphic `operation_cases.primary_object_type/primary_object_id`

## Full Local Reset Verification

Command used:

```bash
npm run db:reset
```

This runs:

```bash
supabase db reset
```

Result:

- local database was recreated from scratch
- all migrations applied in order through `20260524123000_phase_0a_payments_cases_access_control_composite_keys.sql`
- Supabase seeded global roles from `roles.sql`
- no project `supabase/seed.sql` file was present, so no project seed data was applied
- no migration fixes were required
- Supabase staging was not touched

Post-reset commands:

```bash
OPERATIONS_KIT_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54332/postgres" npm run tenant:audit
OPERATIONS_KIT_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54332/postgres" npx vitest run tests/integration/tenant-isolation.test.ts
OPERATIONS_KIT_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54332/postgres" npx vitest run tests/integration/operations-kit-scenario.test.ts
npm run build
npm test
```

Post-reset result:

- `tenant:audit`: 0 rows
- `tenant-isolation.test.ts`: 3 tests passed
- `operations-kit-scenario.test.ts`: 20 tests passed
- `npm run build`: passed
- `npm test`: 5 tests passed, 23 skipped

Still open after full reset verification:

- source-specific hardening for polymorphic `inventory_movements.source_type/source_id`
- source-specific hardening for polymorphic `warehouse_tasks.source_type/source_id`
- source-specific hardening for polymorphic `operation_cases.primary_object_type/primary_object_id`
- Supabase staging migration execution, using `docs/deployment/supabase-staging-tenant-migration.md`

## Recommended Implementation Slices

1. Supabase staging migration preparation.

   Follow `docs/deployment/supabase-staging-tenant-migration.md`: because staging currently has public objects but empty migration history, first use the documented empty-DB reset/rebuild decision path. Then run preflight audit, confirm backup, dry-run pending migrations, and apply in a controlled separate step.

2. Optional source-column design for inventory movements.

   Keep `source_type/source_id` audited unless a deliberate schema change introduces explicit nullable FK columns per source category.

3. Bootstrap cleanup.

   Keep `ensureTenantForShop` tenant-focused and move default access/sample initialization behind explicit setup or idempotent setup actions.

## Next Prompt Recommendation

Implement the next local platform-hardening step:

- Use `docs/deployment/supabase-staging-tenant-migration.md` for the controlled staging apply.
- First resolve the empty staging DB reset/rebuild path, then run preflight audit and confirm backup/snapshot outside of Codex.
- Only then start a separate controlled apply prompt.
- Keep polymorphic source references under audit unless a source-column schema change is intentionally planned.
- Keep auth, user management, billing behavior, and UI out of scope.

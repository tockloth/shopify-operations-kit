# Operations Kit Blueprint v0.3 Implementation Audit

Date: 2026-05-16

Scope: compare the current application implementation against Blueprint v0.3. This audit does not implement changes.

Blueprint sources:
- `03-entities.html`
- `04-status-models.html`
- `05-ui-pages.html`
- `10-ui-patterns.html`
- `11-page-specs.html`
- `15-detail-ui-wireframes.html`
- `16-blueprint-compliance-tests.html`

Application areas inspected:
- App shell and routes under `app/routes`
- Server helpers in `app/lib/operations-kit.server.ts`
- Shopify sync in `app/lib/shopify-sync.server.ts`
- Supabase migrations
- Integration and unit tests

## Executive Summary

Operations Kit already has a useful MVP spine: Shopify products/orders sync into operational records; product master data, procurement, receiving/QC/putaway, inventory, logistics, BOM editing, customers, and settings are represented. The current implementation is strongest in the trading-goods execution path and weakest in Blueprint-level consistency: table filters, tabbed detail layouts, page ownership boundaries, workflow configuration, status normalization, and entity-level audit/event timelines.

The highest-risk implementation gap is not visual. Order and procurement status derivation can still be item-based instead of demand-line-based, so work or stock for the same item can affect multiple orders. That should be corrected before deeper UI polish because it affects trust in the operational work queues.

## 1. Entities And Attributes

| Blueprint entity | Existing tables/helpers | Gap | Risk | Suggested slice |
|---|---|---|---|---|
| Item | `items`; helpers `loadItems`, `loadItemDetail`, `updateItemMasterData`; Shopify sync stores product status, handle, publication fields, last seen | Good coverage. `loadItems(source="shop")` does not appear to require `is_sellable` in the SQL filter even though the displayed "On shop" flag does | Products on shop can include active published Shopify items that are operationally not sellable | Product sync/list consistency slice |
| Supplier | `suppliers`; routes list/detail/new; helper coverage through supplier loaders and mutations | Supplier Detail lacks Blueprint tabs, supplied products table, purchase orders table, deactivate toolbar action | Supplier master data cannot be reviewed in context | Supplier Detail completion slice |
| SupplierItem | `supplier_items`; helpers for preferred supplier and purchasing settings | Data exists, but UI only exposes preferred/current supplier settings on Product Detail; no Supplier Detail supplied-products management table | Hard to maintain supplier catalog from supplier perspective | Supplier Detail completion slice |
| Customer | `operation_customers`; encrypted fields and customer detail route exist | Customer addresses are not first-class customer records; detail page depends mostly on order shipping address | Customer/address readiness is transparent but not complete | Customer address visibility slice |
| OperationsOrder | `operations_orders`; encrypted customer and shipping fields; loaders for list/detail/logistics | Good order header coverage. Shipping address mapping exists, but historic/test orders can still be missing address | Logistics can be blocked unless backfill/order data is present | Customer/address stabilization slice |
| OperationsOrderLine | `operations_order_lines`; order/detail/order-line loaders | Sync upsert appears keyed by `(tenant_id, operations_order_id, item_id)`, which can collapse duplicate Shopify order lines for the same item | Customer demand can be misrepresented for duplicate item lines | Demand traceability slice |
| PurchaseNeed | `purchase_needs`; MRP/planning helpers, procurement queue | Current statuses include `open`/`assigned`; Blueprint uses `needs_supplier`/`ready_for_po`/`converted_to_po`/`cancelled`. Source demand linkage is indirect through planning data | Status mismatch and possible weak traceability back to order line | Status normalization and demand traceability slice |
| PurchaseOrder | `purchase_orders`; PO detail route and lifecycle helpers | Current lifecycle includes `pending_approval`; Blueprint status model does not list it directly and treats approval as configurable. `closed` is not consistently represented | Hard-coded workflow can conflict with configurable Blueprint | Workflow configuration/status normalization slice |
| PurchaseOrderLine | `purchase_order_lines`; PO detail shows quantity, unit price, line value | Good MVP coverage. Price falls back when missing | Low | Procurement detail polish slice |
| GoodsReceipt | `goods_receipts`; receiving list/detail; PO detail receipt creation | Receiving list can create/post receipt; Blueprint primarily puts receipt creation on PO Detail and receipt execution on Receipt Detail | Page ownership ambiguity | Receiving ownership cleanup slice |
| GoodsReceiptLine | `goods_receipt_lines`; QC and putaway forms on Receipt Detail | Good MVP execution coverage. UI lacks tabbed structure/events | Medium UI consistency risk | Receipt Detail wireframe slice |
| InventoryMovement | `inventory_movements`; inventory list/detail and putaway posting | Inventory Item Detail includes manual movement posting, which is not clearly part of Blueprint MVP guardrails | Inventory can bypass process ownership if not clearly scoped | Inventory guardrail slice |
| ShippingOrder | `shipping_orders`; logistics list and lifecycle inline actions | No Shipment Detail route. Shipping address appears derived from order rather than stored as a shipment snapshot | Shipment lifecycle is not inspectable as a single record; historic shipment address snapshot risk | Shipment Detail slice |
| ShippingOrderLine | `shipping_order_lines`; logistics line display | Basic coverage. No detail page ownership | Medium | Shipment Detail slice |
| BOM | `boms`; contextual BOM page; Product Detail summary | Active BOM creation exists and is idempotent | Low | BOM/Kitting UI completion slice |
| BOMLine | `bom_lines`; add/update/delete helpers and UI | Contextual editor exists. Product Detail read-only table exists. Missing available stock and availability panel | BOM cannot yet explain component shortages inline | BOM/Kitting UI completion slice |
| Event/Audit | Blueprint expects generic event timeline | Current implementation has case events and some operational messages, not a generic entity event model | Detail pages cannot provide audit history consistently | Event/audit foundation slice |

## 2. Status Models

| Blueprint status | Current implementation | Gap | Suggested correction |
|---|---|---|---|
| Order: Needs planning | Orders list derives `Needs planning` for unplanned/incomplete work | Present, but derivation relies on aggregate item/work context | Tie status to order-line demand/source records |
| Order: Purchase proposal ready | Derived when purchase needs exist | Present | Ensure purchase need is linked to specific order line/shortage |
| Order: Purchase Order created / Sent / Awaiting receipt | Derived from PO status | Present at list level | Normalize PO statuses and avoid item-level leakage |
| Order: Receiving/QC / Putaway pending | Derived from receipt and receipt line state | Present | Ensure receipt/PO linkage maps back to exact order demand |
| Order: Ready for logistics / Logistics blocked / Shipment created / Complete | Derived from stock, address, shipment records | Present | Add order-specific reservations or stronger ready calculation |
| Order line decision | Order Line Detail shows decision/context | Present | Remove create-work actions from Order Line if Blueprint ownership forbids them |
| Purchase Need: needs_supplier | Current implementation uses `open` and `assigned` alongside `ready_for_po` | Naming/status mismatch | Map or migrate to Blueprint names, or document aliases explicitly |
| Purchase Need: ready_for_po | Present | Good | Keep |
| Purchase Need: converted_to_po / cancelled | Present | Good | Keep |
| Purchase Order: draft | Present | Good | Keep |
| Purchase Order: approved/sent/acknowledged | Present | Good, but approval is hard-coded through `pending_approval` | Move approval behavior behind workflow configuration |
| Purchase Order: closed | Blueprint includes `closed`; current status checks do not consistently expose it | Missing/partial | Add `closed` support or update Blueprint if intentionally deferred |
| Goods Receipt / QC / Putaway | Receipt detail supports QC and putaway; list groups are basic | Status exists in behavior, but work queue tabs missing | Add receiving tabs and status filters |
| Inventory movement states | Movements exist; stock position is derived | No explicit Blueprint state problem | Add guardrails around manual adjustments |
| Logistics / shipment status | Shipping orders support lifecycle inline | Missing Shipment Detail and possible status vocabulary mismatch (`picking`, `partially_shipped`) | Add Shipment Detail and normalize display labels |
| Shopify product sync status | Product sync stores ACTIVE/DRAFT/ARCHIVED/MISSING and publication signals | Good. Product list/filter logic needs one consistency fix | Require the same "On shop" predicate in display and filter |

## 3. Page Ownership

| Page | Blueprint purpose | Current behavior | Violation | Fix priority |
|---|---|---|---|---|
| App shell | Highlight current app area for nested routes | `app-nav` helper exists and has unit tests | No major violation found | Low |
| Products | Work queue/list for product master data | Product list, product sync, simple source/search filters | Missing full filter pattern and next-action/data-quality columns | Medium |
| Product Detail | Master data form only | Compact single Save/Cancel form, purchasing/QC/BOM read-only summary | Good; no operational actions found | Low |
| Suppliers | Supplier master data list | Supplier list and create action | Missing filters/saved views/export | Medium |
| Supplier Detail | Maintain supplier header and supplied products | Header form only | Missing tabs, supplied products, PO context, deactivate toolbar | High |
| Customers | Customer list | List and Shopify sync action | Missing filters and address completeness filtering | Medium |
| Customer Detail | Read-only customer/address/order context | Summary, address readiness, related orders | Missing tabs, addresses table, privacy/events toolbar actions | Medium |
| Orders | Demand work queue | Strong operational status and product/quantity display | Missing filters/saved views; has planning/logistics/consolidate actions in toolbar | Medium |
| Order Detail | Demand situation and related work | Summary, shipping section, line table, related work | Missing tabs, Open in Shopify, Refresh planning toolbar | Medium |
| Order Line Detail | Decision explanation | Shows decision/context and can create purchase need | Create Purchase Need belongs to planning/procurement, not line detail | High |
| Procurement | Purchase needs and purchase orders work queue | Auto refresh planning, proposal/PO rows, lifecycle shortcuts | No tabs/filters; PO lifecycle actions on overview blur ownership | High |
| Purchase Order Detail | Own PO lifecycle and receipt creation | PO lifecycle and receipt creation mostly present | Missing tabs, Cancel PO, total lifecycle summary; labels need alignment | Medium |
| Receiving | Receipt work queue | Can create/post receipts and list receipts | Missing tabs/filters; receipt creation on list may violate ownership | Medium |
| Receipt Detail | Own QC and putaway | QC and putaway actions present | Missing normal Back to Procurement/PO links and tabs/events | Medium |
| Inventory | Stock visibility | Summary and ledger visibility | Missing filters/export; no saved views | Medium |
| Inventory Item Detail | Stock position, ledger, reservations, supply | Also has manual inventory movement posting | Manual movement can bypass process ownership if not explicitly scoped | High |
| Logistics | Shipping readiness and shipment work queue | Ready/blocked/shipment sections and dev backfill | No Shipment Detail; lifecycle actions inline | High |
| BOM/Kitting | BOM master data and kitting later | Contextual BOM editor works; general page still includes MRP planning | Missing tabs/availability; MRP still lives on general BOM page | Medium |
| Settings | Configuration, privacy, test data | Privacy/test seed/access settings | Workflow switches absent | High |

## 4. UI Implementation Against Detail Wireframes

| Page | Wireframe requirement | Current implementation | Missing/incorrect | Suggested slice |
|---|---|---|---|---|
| Product Detail | Toolbar, compact summary, classification row, purchasing grid, QC row, BOM table | Mostly implemented | No tabs/events; acceptable for MVP | Keep stable |
| Supplier Detail | Toolbar, tabs Header/Supplied products/Purchase Orders/Events | Header-only edit form | Supplied products, PO table, tabs, deactivate toolbar | Supplier Detail completion |
| Customer Detail | Toolbar, tabs, address table, orders table, privacy/events | Summary, shipping readiness, related orders | No tabs; no addresses table; no redact/test-address toolbar | Customer Detail completion |
| Order Detail | Toolbar, tabs Summary/Lines/Related work/Events | Sections without tabs | Missing Open in Shopify, Refresh planning, tabs/events | Order Detail wireframe slice |
| Order Line Detail | Toolbar, decision/inventory/procurement/receiving/logistics panels | Mostly section-based implementation | Action ownership issue; no tabs/events | Order Line ownership slice |
| Procurement Work Queue | Tabs Purchase Needs/Purchase Orders/Goods Receipts/Completed, filters, next action | Single combined queue, process guide, no filters | Tabs and filters missing; duplicate ownership of PO lifecycle | Procurement work queue slice |
| Purchase Need handling | Inline in Procurement only | Present | Needs clearer status naming and source order columns | Procurement work queue slice |
| Purchase Order Detail | Toolbar, tabs Header/Lines/Receipts/Events | Lifecycle actions, lines, receipts | No tabs/events; missing Cancel PO; status labels differ | PO Detail slice |
| Receiving Work Queue | Tabs Expected/QC/Putaway/Completed and filters | Ready to receive and receipts sections | Tabs/filters missing; labels differ | Receiving work queue slice |
| Receipt Detail | Toolbar with three backs plus QC/Putaway, tabs, forms | QC/Putaway present | Normal header lacks Back to Procurement/PO; no tabs/events | Receipt Detail slice |
| Inventory Item Detail | Toolbar Back/Open Product/Export ledger, tabs | Stock/reservations/supply/ledger visible | Missing Open Product, Export, tabs; manual movement action questionable | Inventory detail slice |
| Logistics Work Queue | Toolbar, tabs Ready/Blocked/Shipments/Completed | Sections and dev backfill | No tabs/filters; no Shipment Detail | Logistics/Shipment slice |
| Shipment Detail | Target MVP route `/app/logistics/:shipmentId` | Not implemented | Entire detail page missing | Logistics/Shipment slice |
| BOM/Kitting Detail | Tabs BOM lines/Availability/Events/Kitting later; available stock | Contextual component editor | Missing tabs, availability, available stock column; MRP on general page | BOM/Kitting slice |
| Settings | Toolbar, tabs Workflow/Privacy/Users/Test data | Settings sections | Workflow switches absent; no tabbed layout | Settings/workflow config slice |

## 5. Table And Filter Behavior

| Table | Required filters | Current filters | Gap |
|---|---|---|---|
| Products | Text, status, source/shop, type, role, supplier, BOM missing, active/stale | Text query and source select | Missing most Excel-like filters |
| Suppliers | Text, status, currency, active, missing product data | None found | Filters absent |
| Customers | Text, privacy status, address completeness, order count/date | None found | Filters absent |
| Orders | Text/order/customer, payment, fulfillment, operations status, missing address, product, date | None found | Filters absent |
| Procurement | Status, supplier, product, source order, expected date, price missing | None found | Filters absent |
| Receiving | Receipt status, supplier, PO, QC status, expected/received date | None found | Filters absent |
| Inventory | Product, location, stock status, available min/max, reserved, QC hold | None found | Filters absent |
| Logistics | Ready/blocked status, missing address, inventory status, shipment status, customer | None found | Filters absent |
| BOM/Kitting | Parent product, component, active, missing components, shortage | Contextual parent query only | Work queue filters absent |

## 6. Tests Against Blueprint Compliance

| Blueprint scenario | Existing test | Missing assertion | Suggested test |
|---|---|---|---|
| App nav nested route active state | `tests/unit/app-nav.test.ts` | Coverage exists for key nested routes | Keep |
| No cryptic one-letter toolbar buttons | None | Static UI text scan | Add static route/component compliance test |
| Every work queue has filters and next-action column | None | Products/Orders/Procurement/etc. filter presence | Add static UI compliance tests |
| Product Detail has Save and Cancel | Partial via implementation, no static assertion | Visible single Save/Cancel only | Add route markup/static test |
| Procurement does not execute QC | Not directly tested | Page ownership boundaries | Add static/action-intent compliance test |
| Receipt Detail owns QC and Putaway | Integration tests cover QC/putaway behavior | UI ownership assertion missing | Add static route action test |
| Shopify order with zero stock creates purchase need | Covered in integration scenario | Source-demand traceability to exact order line | Add duplicate-item/order-line traceability test |
| Customer quantity 3 creates purchase need/PO quantity 3 | Covered | Partial stock shortage case and duplicate SKU case | Add shortage/duplicate tests |
| PO lifecycle draft to acknowledged | Covered in trading-goods flow | Configurable approval off/on behavior | Add workflow configuration tests after config exists |
| Goods receipt creates QC/putaway state | Covered | Receiving work queue tab/status display | Add UI/browser check |
| Accepted QC putaway books inventory | Covered | Idempotent UI messaging/browser flow | Add browser check |
| Order logistics-ready when stock and address exist | Covered in integration scenario | Order-specific reservations preventing double-readiness | Add multi-order same-item test |
| Order blocked when address missing | Covered or partially covered | Blocked reason detail in UI | Add browser/static assertion |
| Shipment can be created only from logistics-ready order | Covered in helper/integration behavior | Shipment Detail route lifecycle | Add after route exists |
| Missing supplier blocks procurement | Not found | Product without preferred supplier status/blocker | Add DB-backed test |
| Product without BOM blocks kitting/production | Not found | BOM blocker and UI warning | Add DB-backed/UI test |
| Draft/archived/stale Shopify products not on shop | Product sync tests cover status/missing | Product list source=shop requires same predicate as badge | Add list helper assertion |
| Browser happy path | None | End-to-end browser coverage | Add Playwright/browser scenario later |

## 7. Top 10 Gaps

1. Demand/status traceability can be item-based instead of order-line-based, so procurement, receipt, inventory, or shipment context for the same item can influence unrelated orders.
2. Excel-like filters are missing from nearly every major work queue.
3. Supplier Detail is far below Blueprint: no supplied products tab, purchase order tab, events, or deactivate toolbar action.
4. Procurement lacks Blueprint tabs and filters, and PO lifecycle shortcuts on the overview blur page ownership.
5. Logistics lacks Shipment Detail; shipment lifecycle actions are inline on the Logistics overview.
6. Settings does not expose workflow switches for PO approval, supplier acknowledgement, QC policy, putaway mode, shipping strictness, packing, payables, or kitting approval.
7. Status vocabularies differ from Blueprint: Purchase Need uses `open/assigned`, PO uses hard-coded `pending_approval`, and PO `closed` is missing or not consistently exposed.
8. Generic audit/event timelines are missing; detail pages cannot show consistent Events tabs.
9. Receiving and Receipt Detail need ownership/layout cleanup: Receiving lacks tabs/filters, and Receipt Detail lacks normal Back to Procurement/PO links plus tabs/events.
10. BOM/Kitting lacks availability/shortage UI and still keeps operational MRP planning on the general BOM page.

Additional notable gaps:
- Product list "Products on shop" filter should use the same predicate as the displayed On shop badge.
- Order Line Detail can create purchase needs, which conflicts with Blueprint page ownership.
- Inventory Item Detail exposes manual inventory movement posting without clear Blueprint guardrails.
- Shipment address is not clearly snapshotted on the shipment entity.
- No browser compliance scenarios exist yet.

## 8. Prioritized Implementation Plan

### Slice 1: Demand Traceability And Order Status Correctness

- Blueprint sections: `03 Entities`, `04 Status Models`, `11 Page Specs > Orders / Order Detail / Procurement`, `16 Compliance Tests`
- Likely files: `app/lib/operations-kit.server.ts`, `app/routes/app.orders.tsx`, `app/routes/app.orders_.$orderId.tsx`, `app/routes/app.procurement.tsx`, migrations only if existing demand linkage is insufficient, `tests/integration/*`
- Tests: duplicate same-item order lines, multi-order same-item stock/procurement isolation, quantity shortage preservation, order status progression by exact order line
- Browser retest path: Storefront order with quantity 3 and another order for same item -> Orders -> Procurement -> PO -> Receiving -> Inventory -> Orders
- Why first: status accuracy is the foundation for every work queue and next action. UI polish on incorrect derived state would reduce trust.

### Slice 2: Status Vocabulary And Workflow Configuration

- Blueprint sections: `04 Status Models`, `13 Configuration`, `11 Page Specs > Settings / Purchase Order Detail`
- Likely files: `app/routes/app.settings.tsx`, `app/lib/operations-kit.server.ts`, PO routes, migrations if workflow settings need persistence, integration tests
- Tests: PO approval off/on, supplier acknowledgement required/off, QC policy by product/always/never, putaway manual/automatic
- Browser retest path: Settings -> toggle workflow -> Procurement -> PO Detail -> Receipt Detail
- Why second: configurable workflow switches determine which buttons and statuses should appear across procurement and receiving.

### Slice 3: Work Queue Filter Foundation

- Blueprint sections: `10 UI Patterns`, `11 Page Specs`, `16 Compliance Tests`
- Likely files: Products, Suppliers, Customers, Orders, Procurement, Receiving, Inventory, Logistics, BOM routes; small shared filter helper/component if appropriate
- Tests: static UI compliance for filter controls; helper tests for filter predicates
- Browser retest path: each work queue -> apply/clear filters -> open detail
- Why third: filters are a cross-cutting Blueprint requirement and improve usability without changing domain logic.

### Slice 4: Procurement And Receiving Page Ownership Cleanup

- Blueprint sections: `05 UI Pages`, `11 Page Specs > Procurement / Receiving / PO Detail / Receipt Detail`, `15 Detail UI Wireframes`
- Likely files: `app/routes/app.procurement.tsx`, `app/routes/app.procurement_.$purchaseOrderId.tsx`, `app/routes/app.receiving.tsx`, `app/routes/app.receiving_.$receiptId.tsx`
- Tests: action ownership static tests; PO/receipt lifecycle integration tests remain green
- Browser retest path: Procurement -> Purchase Needs tab -> PO Detail -> Create Goods Receipt -> Receipt Detail -> QC -> Putaway
- Why fourth: this removes confusing action placement after statuses and config are reliable.

### Slice 5: Shipment Detail And Logistics Ownership

- Blueprint sections: `03 Entities > ShippingOrder`, `11 Page Specs > Logistics / Shipment Detail`, `15 Detail UI Wireframes`
- Likely files: `app/routes/app.logistics.tsx`, new `app/routes/app.logistics_.$shipmentId.tsx`, server helpers, tests
- Tests: shipment create/open/pack/ship/cancel, blocked reason, address snapshot
- Browser retest path: Logistics -> Ready -> Create shipment -> Shipment Detail -> Mark packed -> Mark shipped
- Why fifth: logistics currently works but lacks the single-record page needed for reliable operations.

### Slice 6: Supplier And Customer Detail Completion

- Blueprint sections: `11 Page Specs > Supplier Detail / Customer Detail`, `15 Detail UI Wireframes`
- Likely files: supplier/customer routes and server helpers
- Tests: supplier supplied-products table, customer address/order visibility, privacy/redaction visibility
- Browser retest path: Suppliers -> open supplier -> supplied products; Customers -> open customer -> addresses/orders/privacy
- Why sixth: completes master-data and address context without altering core process execution.

### Slice 7: BOM/Kitting Detail Completion And MRP Separation

- Blueprint sections: `05 UI Pages > BOM/Kitting`, `11 Page Specs > BOM/Kitting`, `15 Detail UI Wireframes`
- Likely files: `app/routes/app.boms.tsx`, possible future MRP route, server read helpers
- Tests: BOM availability/shortage, missing component blocker, no MRP in contextual BOM editor
- Browser retest path: Product Detail -> BOM editor -> add/update/remove component -> Availability
- Why seventh: BOM editing works; availability and ownership cleanup can follow trading-goods stabilization.

### Slice 8: Generic Event/Audit Foundation

- Blueprint sections: `03 Entities > Event/Audit`, `10 UI Patterns > Audit/Event Timeline`, `11 Page Specs detail pages`
- Likely files: migrations, server event helper, selected mutations, detail routes
- Tests: mutation records event, detail page event timeline renders
- Browser retest path: edit Product/Supplier -> PO lifecycle -> Receipt QC -> Events tabs
- Why eighth: useful across the app, but less urgent than correctness and page ownership.

### Slice 9: Inventory Guardrails

- Blueprint sections: `05 UI Pages > Inventory`, `11 Page Specs > Inventory Item Detail`, `16 Compliance Tests`
- Likely files: inventory routes and helpers
- Tests: manual adjustments hidden or permission/config-gated; inventory cannot create procurement/shipment
- Browser retest path: Inventory -> item detail -> verify stock/ledger/reservations/supply and guarded actions
- Why ninth: prevents process bypass after core flows are reliable.

### Slice 10: Browser Compliance Harness

- Blueprint sections: `16 Blueprint Compliance Tests`
- Likely files: test setup, browser tests, fixtures
- Tests: named browser scenarios from the Blueprint
- Browser retest path: Trading goods happy path, missing supplier, missing address, QC rejected, product sync hygiene
- Why tenth: best added once page structure and ownership stabilize.

## 9. Command To Read The Audit

From the repository root:

```bash
sed -n '1,260p' docs/operations-kit-blueprint-v0.3/17-implementation-audit.md
```

To browse the Blueprint:

```bash
cd /Users/jvoigt/Projects/shopify-apps/operations-kit/docs/operations-kit-blueprint-v0.3
python3 -m http.server 8080
```


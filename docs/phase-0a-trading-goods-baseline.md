# Phase 0A — Trading-Goods Baseline

## 1. Purpose

This document defines the repeatable baseline test path for the current Operations Kit trading-goods MVP.

The goal is to prove the current customer-order-to-fulfillment process before deployment, tenant management, authentication, roles, billing, or broader production features are added.

Baseline process:

Shopify Order -> Operations Order / Order Line -> Product / Supplier master data -> Purchase Need -> Purchase Order -> Goods Receipt -> QC -> Putaway -> Inventory -> Shipment -> Shopify Fulfillment Writeback

## 2. Preconditions

- Operations Kit starts locally or in the selected dev/staging environment.
- Supabase/Postgres is reachable.
- The Shopify development store is connected to the current Shopify app configuration.
- The Shopify app has been reinstalled or re-approved after scope changes.
- A Shopify product exists and can be ordered in the dev store.
- The product is synced into Operations Kit.
- A supplier exists in Operations Kit.
- The product is configured as a purchasable trading good.
- The product has either no stock or insufficient stock, so procurement is required.
- The Shopify order has a real shipping address.
- Customer protected data access is approved for the data fields used in the baseline.

## 3. Required Shopify Scopes

Minimum expected Admin API scopes for this baseline:

- `read_orders`
- `read_customers`
- `read_products`
- `read_inventory`
- `write_orders`
- `write_products`
- `read_merchant_managed_fulfillment_orders`
- `write_merchant_managed_fulfillment_orders`

Currently used metaobject scopes may remain in the app configuration if the app still needs them:

- `write_metaobject_definitions`
- `write_metaobjects`

Important check:

After starting the dev app, the terminal output must list the required scopes under `Access scopes auto-granted`. If `read_customers` or fulfillment scopes are missing, customer data sync or Shopify fulfillment writeback will not work reliably.

## 4. Required Protected Customer Data Access

The Shopify Partner Dashboard must approve access to:

- Customer name
- Customer email
- Shipping address / address fields

Expected behavior:

- Customer name and email sync into Operations Kit.
- Shipping address is stored as an order snapshot.
- Existing valid shipping addresses are not erased by later syncs that cannot access address data.
- Orders without usable shipping address remain blocked for logistics.

If address access is not approved, procurement and receiving can still be tested, but logistics and fulfillment are not a valid baseline pass.

## 5. Required Local Env Variables

Local database:

```sh
export OPERATIONS_KIT_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54332/postgres"
```

Common local start command:

```sh
npm run dev:ledger
```

Alternative localhost start command when Cloudflare tunnel is unavailable:

```sh
npm run dev:ledger:localhost
```

Before test execution, verify:

- The app opens in Shopify Admin.
- The active Shopify dev store is the intended store.
- The app configuration contains the expected scopes.
- The connected database is the intended local/staging database.

## 6. Integration Smoke Test

The Phase 0A integration smoke test reads the Operations Kit Postgres
connection string from:

- `OPERATIONS_KIT_DATABASE_URL`
- fallback: `OPERATIONS_LEDGER_DATABASE_URL`

It does not read `DATABASE_URL`.

Run it against the local Supabase test database with:

```sh
OPERATIONS_KIT_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54332/postgres" npx vitest run tests/integration/operations-kit-scenario.test.ts
```

Run it against a Supabase staging test database with:

```sh
OPERATIONS_KIT_DATABASE_URL="<supabase-postgres-test-url>" npx vitest run tests/integration/operations-kit-scenario.test.ts
```

Do not commit real database URLs or secrets. Set the variable only in the local
shell or CI environment.

## 7. Required Product Setup

For a trading-goods baseline product, configure the product in Operations Kit Product Detail:

- Product is sellable.
- Product is purchased.
- Product is not produced.
- Product has no BOM requirement for this baseline.
- `QC after receipt` is enabled if the receipt/QC process should be tested.
- `QC after production` is disabled.
- Minimum inventory is set according to the test scenario.
- Default order quantity / lot size is set.
- Supplier lead time is set.
- Preferred supplier is selected.
- Supplier unit price and currency are maintained.

Baseline recommendation:

- Use one Shopify product with zero available stock.
- Use one ordered quantity from the Shopify order.
- Use default order quantity / lot size `1` unless testing lot rounding.

## 8. Required Supplier Setup

Supplier master data must exist before Purchase Orders can be created.

Required fields:

- Supplier name
- Email if PO email is tested later
- Status active

Required product-supplier relationship:

- Supplier is assigned to the product.
- Supplier is preferred for the product.
- Supplier SKU if available.
- Unit price.
- Currency.
- Lead time.

Expected behavior:

- Purchase Needs can be assigned to the preferred supplier.
- Purchase Orders inherit supplier, unit price, currency and expected delivery date from product/supplier setup where available.

## 9. Current Browser Route Map

The current clickable Phase 0A path follows the UX rule:

List/Table -> row click -> detail page/form -> action on detail page.

| Process step | Browser route | Current clickable action or target |
| --- | --- | --- |
| Dashboard / work board | `/app` | Status cards link into Orders, Order Lines, Procurement, Receiving or Logistics. |
| Shopify products sync | `/app/items` | `Sync Shopify products` if the product is not already visible. |
| Product master data | `/app/items`, `/app/items/:itemId` | Product row -> Product detail -> `Save`. |
| Supplier master data | `/app/suppliers`, `/app/suppliers/new`, `/app/suppliers/:supplierId` | `Create supplier` or supplier row -> supplier form -> `Save supplier`. |
| Shopify orders sync | `/app/orders` | `Sync Shopify orders`. |
| Operations order detail | `/app/orders/:orderId` | Order row -> detail; `Refresh planning` is available. |
| Operations order line detail | `/app/order-lines/:lineId` | `Open line`; links to product, procurement, receiving and logistics context; Procurement context shows need reason, supplier status, PO status and next action. |
| Purchase Need planning | `/app/procurement` | Page load auto-runs planning; `Refresh` is also available. Purchase Need rows show source, reason, shortage, supplier status, PO status and next action. Minimum-stock and negative-stock shortages create Purchase Needs when product purchasing setup exists. |
| Purchase Need supplier assignment | `/app/procurement` | `Assign preferred supplier` or `Assign supplier` when a need has no assigned supplier. |
| Purchase Order creation | `/app/procurement` | `Create PO`. |
| Purchase Order lifecycle | `/app/procurement/:purchaseOrderId` | PO detail shows supplier, total value, source Purchase Need / Order Line, need reason and receiving status; actions are `Approve` -> `Sent to supplier` -> `Supplier acknowledged` -> `Create Goods Receipt`. |
| Goods Receipt list | `/app/receiving` | `Create Goods Receipt` for acknowledged POs, or open existing receipt row. |
| Goods Receipt QC and putaway | `/app/receiving/:receiptId` | Receipt detail shows PO link, supplier, ordered / received / accepted / rejected / putaway quantities, source Order Line context and next action; use `Complete QC`, then `Put away to inventory`. |
| Inventory verification | `/app/inventory`, `/app/inventory/:itemId` | Open inventory from navigation or receipt movement link; item detail shows physical / reserved / available / incoming quantities, receipt / PO / order-line movement sources and shipment next action. |
| Shipment creation | `/app/logistics` | `Create shipment` when the order is address-ready and inventory-ready. |
| Shipment detail | `/app/logistics/:shipmentId` | `Back to list`, `Mark packed`, `Mark shipped`, and if needed `Update Shopify fulfillment`. `Mark shipped` is blocked when physical MAIN inventory would become negative. |
| Shopify fulfillment verification | Shopify Admin order page | The local `Mark shipped` action attempts Shopify fulfillment writeback; `Update Shopify fulfillment` is the retry action. |

## 10. Full Browser Test Path

1. Open Shopify Dev Store.
2. Create a paid or otherwise operationally valid order with one test product and a usable shipping address.
3. Open Shopify Admin.
4. Open Operations Kit.
5. Optional if the product is not visible yet: go to Products and click `Sync Shopify products`.
6. Go to Orders.
7. Click `Sync Shopify orders`.
8. Click the synced order row.
9. Verify customer name, customer email and shipping address on the Order detail.
10. In the Lines table, click `Open line`.
11. From the Order Line detail, click `Open product`.
12. On Product detail, configure the item as the trading-goods baseline product:
    - `Sellable` checked
    - `Purchasable` checked
    - `Producible` unchecked
    - `Minimum stock` according to the test scenario
    - `Standard order qty` / lot size
    - `Lead time`
    - `QC required on receiving` checked if QC should be tested
    - `QC required after production` unchecked
13. In Product detail purchasing settings, select or keep the preferred supplier and maintain:
    - Supplier SKU
    - Preferred
    - Supplier MOQ if needed
    - Supplier price
    - Currency
14. Click `Save`.
15. If no supplier exists, go to Suppliers, click `Create supplier`, save an active supplier, then return to the product and save the supplier purchasing settings.
16. Go to Orders, open the order, and click `Refresh planning`, or go directly to Procurement.
17. Go to Procurement.
18. If the Purchase Need has no assigned supplier, click `Assign preferred supplier` or choose a supplier and click `Assign supplier`.
19. Verify the Purchase Need quantity equals the shortage from the order line and stock position.
20. Click `Create PO`.
21. Open the created Purchase Order from the Procurement table.
22. Verify the PO detail shows supplier, total value, source Purchase Need / Order Line, need reason and the next receiving action.
23. If line terms are missing or wrong, update quantity, unit price, currency or expected delivery date and click `Update terms`.
24. Click `Approve`.
25. Click `Sent to supplier`.
26. Click `Supplier acknowledged`.
27. Click `Create Goods Receipt`.
28. On Receipt detail, verify the Purchase Order link, supplier, ordered / received quantities, QC status and source Order Line context.
29. Complete the QC action for the received line by entering accepted and rejected quantities and clicking `Complete QC`.
30. Verify the Receipt line now shows accepted / rejected quantities and `Put away to inventory` as the next action.
31. Click `Put away to inventory` for the accepted quantity.
32. Verify the Receipt line shows the putaway quantity and that no further receiving step is open.
33. Return to the PO detail and verify the line links to the Goods Receipt and shows received / accepted / rejected quantities.
34. Open Inventory from the receipt movement link or the main navigation.
35. Open the item detail and verify physical / reserved / available / incoming quantities, the putaway movement source Receipt / PO, and the related customer Order Line.
36. Go to Logistics.
37. For the ready order, click `Create shipment`.
38. On Shipment detail, optionally click `Mark packed`.
39. Click `Mark shipped`.
40. If Shopify was not updated during `Mark shipped`, click `Update Shopify fulfillment`.
41. Open the Shopify order and verify fulfillment status.

## 11. Expected Status After Every Step

| Step | Expected status/result |
| --- | --- |
| Shopify order created | Shopify order is paid or otherwise valid for operations sync; fulfillment is unfulfilled. |
| Products synced or order synced | Operations item exists for the Shopify product or order line. |
| Orders synced | Operations Order exists; Operations Order Lines exist. |
| Customer data verified | Customer name, email and shipping address snapshot are present if protected data access is approved. |
| Product configured | Product review state is ready for planning; product is sellable and purchasable, not producible. |
| Supplier configured | Product has preferred supplier and purchasing data. |
| Planning refreshed | Purchase Need exists for order shortage, minimum-stock shortage or existing negative-stock shortage when available plus incoming supply does not cover demand plus minimum stock. |
| Supplier assigned | Purchase Need status is ready for PO. |
| Purchase Order created | Purchase Order status is draft / Purchase Order created. |
| PO approved | Purchase Order status is approved / PO approved. |
| PO sent | Purchase Order status is sent / Sent to supplier. |
| Supplier acknowledged | Purchase Order status is acknowledged / Awaiting receipt. |
| Goods Receipt created | Receipt exists and references the Purchase Order. |
| QC completed | Accepted and rejected quantities are recorded per receipt line. |
| Putaway completed | Receipt line is put away and accepted quantity is posted into inventory. |
| Inventory checked | Physical stock increased; reserved stock reflects customer demand; available stock is calculated. |
| Shipment created | Shipment exists for the Operations Order. |
| Shipment packed | Shipment status is packed if the optional pack step was used. |
| Shipment shipped | Local shipment status is shipped; inventory is reduced/reservation consumed. If shipment quantity exceeds physical MAIN stock, shipping is blocked and no negative movement is posted. |
| Shopify fulfillment writeback | Shopify fulfillment is created or confirmed already fulfilled; retry action remains available if Shopify writeback failed. |
| Shopify order verified | Shopify order fulfillment status is fulfilled. |

## 12. Expected Database Objects After Every Step

| Step | Expected database objects |
| --- | --- |
| Shopify order sync | `operations_orders`, `operations_order_lines`, customer/order address encrypted snapshots. |
| Product setup | `items` updated with sellable/purchased/not-produced flags and planning properties. |
| Supplier setup | `suppliers`, `supplier_items`. |
| Purchase planning | `mrp_runs`, `mrp_run_lines`, `purchase_needs`. |
| Purchase Order creation | `purchase_orders`, `purchase_order_lines`; linked `purchase_needs` converted to PO. |
| PO lifecycle | `purchase_orders.status` transitions through `draft`, `approved`, `sent`, `acknowledged`. |
| Goods Receipt | `goods_receipts`, `goods_receipt_lines`, initial QC hold state if QC applies. |
| QC | `qc_checks`, updated `goods_receipt_lines.accepted_quantity` / `rejected_quantity`, QC inventory movements if implemented. |
| Putaway | `inventory_movements` with putaway movement; receipt line status updated to putaway done. |
| Inventory | Inventory ledger/read model reflects physical, reserved, available, ordered and planned quantities. |
| Shipment | `shipping_orders`, `shipping_order_lines`, related warehouse/pick/pack task if implemented. |
| Shipment shipped | Shipping status updated; inventory movement for shipping; Operations Order can close. |
| Shopify fulfillment writeback | Operations Order fulfillment status updated from Shopify result; Shopify fulfillment created via Admin API. |

## 13. Baseline Documentation Gap Closed

The previous browser-test section described the right business process, but it did not match the current clickable UI exactly. In particular, Procurement now auto-runs planning on page load and exposes `Refresh`; PO actions are performed from `/app/procurement/:purchaseOrderId`; Receiving uses `Complete QC` and `Put away to inventory`; and Logistics attempts Shopify fulfillment writeback when `Mark shipped` is clicked.

No blocking code gap was found in the inspected baseline path. The current stabilization change is documentation-only.

## 14. Known Gaps

- Hosted staging deployment is not part of Phase 0A.
- Tenant switch/global admin is not implemented in this baseline.
- Tenant user authentication and role enforcement are not part of this baseline.
- Email notifications are not part of this baseline.
- Attachments, supplier delivery notes, invoices and payables are not part of this baseline.
- Production/BOM/kitting is intentionally excluded.
- UI polish remains a separate phase.
- Audit/event timeline may be incomplete.
- Live Shopify fulfillment writeback should be tested manually in the dev store even if automated tests mock it.
- Protected customer data approval can make customer/address test results differ between stores.

## 15. Troubleshooting

### Customer name, email or address is missing

Check:

- `read_customers` is present in `shopify.app.toml`.
- The app was restarted and re-approved after scope changes.
- Protected Customer Data access includes Name, Email and Address.
- The Shopify order actually has a customer and shipping address.

### Orders sync but logistics is blocked

Check:

- The Operations Order has a valid shipping address snapshot.
- The ordered product exists as an Operations Kit item.
- Inventory has enough stock after receiving and putaway.
- The order line is not still waiting for procurement or receiving.

### Purchase Need is not created

Check:

- Product is marked purchased.
- Product is not marked produced for this trading-goods baseline.
- The order is open and has an order line quantity.
- Available plus incoming supply is less than demand plus minimum inventory.
- Preferred supplier is configured or supplier is assigned manually.

### Purchase Order cannot be created

Check:

- Purchase Need has an assigned supplier.
- Supplier is active.
- Supplier item data exists for the product if required by the current workflow.

### Goods Receipt cannot be created

Check:

- Purchase Order has reached the status required for receiving, usually supplier acknowledged.
- The PO still has open lines.
- A receipt was not already created for the PO.

### Putaway does not increase inventory

Check:

- QC accepted quantity is greater than zero.
- Receipt line status allows putaway.
- Putaway was not already posted idempotently for the same receipt line.

### Shopify fulfillment writeback fails

Check:

- The app has fulfillment write scopes.
- The Shopify order has fulfillable fulfillment order lines.
- The local shipment is ready to be marked shipped.
- The Shopify order is not already fulfilled.
- The app is running against the correct Shopify store and app configuration.

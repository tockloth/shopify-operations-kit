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

## 6. Required Product Setup

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

## 7. Required Supplier Setup

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

## 8. Full Browser Test Path

1. Open Shopify Dev Store.
2. Create an order with a product and a shipping address.
3. Open Shopify Admin.
4. Open Operations Kit.
5. Go to Orders.
6. Click `Sync Shopify orders`.
7. Verify customer name, customer email and shipping address are visible on the order or order detail.
8. Verify products and ordered quantities are visible.
9. Go to Products.
10. Open the ordered product.
11. Configure Product Detail as purchasable trading good:
    - sellable
    - purchased
    - not produced
    - minimum inventory
    - default order quantity / lot size
    - lead time
    - QC after receipt if applicable
12. Configure supplier relationship:
    - preferred supplier
    - supplier item data
    - unit price
    - currency
13. Go to Procurement.
14. Create or refresh Purchase Need for open demand.
15. Verify Purchase Need quantity equals the shortage.
16. Create Purchase Order.
17. Open Purchase Order detail.
18. Approve Purchase Order.
19. Send Purchase Order.
20. Mark Supplier acknowledged.
21. Create Goods Receipt.
22. Open Receipt detail.
23. Complete QC for received quantity.
24. Put away accepted quantity to inventory.
25. Go to Inventory.
26. Verify stock movement and inventory position.
27. Go to Logistics.
28. Create shipment for ready order.
29. Open Shipment detail.
30. Mark shipment shipped.
31. Trigger or verify Shopify fulfillment writeback.
32. Open Shopify order.
33. Verify Shopify order is fulfilled.

## 9. Expected Status After Every Step

| Step | Expected status/result |
| --- | --- |
| Shopify order created | Shopify order is paid or otherwise valid for operations sync; fulfillment is unfulfilled. |
| Orders synced | Operations Order exists; Operations Order Lines exist. |
| Customer data verified | Customer name, email and shipping address snapshot are present if protected data access is approved. |
| Product configured | Product is sellable and purchased, not produced. |
| Supplier configured | Product has preferred supplier and purchasing data. |
| Purchase Need created | Need quantity equals shortage from order demand, inventory and incoming supply. |
| Purchase Order created | PO status is draft/created according to current workflow. |
| PO approved | PO approval status is complete. |
| PO sent | PO status indicates sent or awaiting supplier acknowledgement. |
| Supplier acknowledged | PO is ready for receipt. |
| Goods Receipt created | Receipt exists and references the Purchase Order. |
| QC completed | Accepted and rejected quantities are recorded per receipt line. |
| Putaway completed | Accepted quantity is posted into inventory. |
| Inventory checked | Physical stock increased; reserved stock reflects customer demand; available stock is calculated. |
| Shipment created | Shipment exists for the Operations Order. |
| Shipment shipped | Local shipment status is shipped; inventory is reduced/reservation consumed. |
| Shopify fulfillment writeback | Shopify fulfillment is created or confirmed already fulfilled. |
| Shopify order verified | Shopify order fulfillment status is fulfilled. |

## 10. Expected Database Objects After Every Step

| Step | Expected database objects |
| --- | --- |
| Shopify order sync | `operations_orders`, `operations_order_lines`, customer/order address encrypted snapshots. |
| Product setup | `items` updated with sellable/purchased/not-produced flags and planning properties. |
| Supplier setup | `suppliers`, `supplier_items`. |
| Purchase planning | `mrp_runs`, `mrp_run_lines`, `purchase_needs`. |
| Purchase Order creation | `purchase_orders`, `purchase_order_lines`; linked `purchase_needs` converted to PO. |
| PO lifecycle | `purchase_orders.status` transitions through current approval/send/acknowledge states. |
| Goods Receipt | `goods_receipts`, `goods_receipt_lines`, initial QC hold state if QC applies. |
| QC | `qc_checks`, updated `goods_receipt_lines.accepted_quantity` / `rejected_quantity`, QC inventory movements if implemented. |
| Putaway | `inventory_movements` with putaway movement; receipt line status updated to putaway done. |
| Inventory | Inventory ledger/read model reflects physical, reserved, available, ordered and planned quantities. |
| Shipment | `shipping_orders`, `shipping_order_lines`, related warehouse/pick/pack task if implemented. |
| Shipment shipped | Shipping status updated; inventory movement for shipping; Operations Order can close. |
| Shopify fulfillment writeback | Operations Order fulfillment status updated from Shopify result; Shopify fulfillment created via Admin API. |

## 11. Known Gaps

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

## 12. Troubleshooting

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

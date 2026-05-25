# Domain Model

## Tenant And Installation

- `tenants`: one Operations Kit tenant per Shopify shop.
- `shopify_installations`: active Shopify installation data for a shop and tenant.

## Sellable Product Read Model

- `shopify_products`: local read model for Shopify products.
- `shopify_product_variants`: local read model for Shopify variants.
- `items`: Operations Kit item master. A Shopify variant can create or link to a sellable item.

Shopify product/variant GIDs are unique only together with `tenant_id`.

The Product read model is introduced by `20260525090000_shopify_product_read_model.sql`. This is the only current migration defining `shopify_products` and `shopify_product_variants`.

## Operations Item Model

Not every Operations Kit item is a Shopify product. Internal items can include:

- components
- packaging
- raw materials
- purchasing-only items
- intermediate production items

Shopify Product sync only updates Shopify-origin fields and links. It must preserve operational item data.

Fields and relationships that are operationally owned by Operations Kit must remain untouched by Product sync, including supplier setup, lead time, minimum stock, BOM, purchase context, internal cost assumptions, operational statuses, and audit/history records.

## Core Operations Tables

- Orders: `operations_orders`, `operations_order_lines`
- Procurement: `purchase_needs`, `purchase_orders`, `purchase_order_lines`
- Receiving/QC: `goods_receipts`, `goods_receipt_lines`, `qc_checks`
- Inventory: `inventory_movements`
- Logistics: `shipping_orders`, `shipping_order_lines`
- Audit/system: `case_events`, `webhook_events`

## Sync Visibility

`webhook_events` is the first app-visible sync log. It links Shopify topics and resources to local Orders or Products when a tenant and entity can be resolved.

`case_events` remains the tenant-owned operational event log for known-tenant failures and system actions. A tenantless global platform event table is still future work.

## Product Delete Semantics

Shopify product deletion does not hard-delete Operations Kit history. Local Shopify read-model rows are marked with `deleted_at`, and linked sellable items are marked inactive/missing. BOM, purchase, inventory, audit, and historical order data are preserved.

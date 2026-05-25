# Architecture

## System Role

Operations Kit is a Shopify-native mini ERP and operations layer. It sits close to Shopify and helps merchants execute purchasing, receiving, QC, inventory, and fulfillment work without making Shopify a full ERP.

## Product Data Ownership

Shopify is the source of truth for sellable products and variants:

- product titles
- variant titles
- handles
- vendor/product type/status
- SKU/barcode as Shopify variant identifiers
- sellable product lifecycle

Operations Kit reads this data from Shopify. It does not write product changes back to Shopify.

Operations Kit must not call Shopify Product mutations such as product create/update or variant write operations as part of the Product sync. Product titles, prices, variants, images, and product status are read from Shopify and stored locally as a read model only.

## Operations Data Ownership

Operations Kit is the source of truth for operational data:

- BOM and components
- purchase needs and MRP context
- purchase orders
- suppliers and supplier item data
- receiving, QC, putaway, and inventory movements
- logistics and shipment work
- documents, audit, and system events

Shopify Product sync must not overwrite operational fields such as supplier, lead time, internal cost, min stock, BOM links, procurement status, or warehouse history.

## Sync Shape

- Manual sync is used for initial import, repair, and reconciliation.
- Webhooks are used for incremental updates.
- Future reconciliation sync should compare Shopify and Operations Kit periodically.
- Webhooks do not replace repair sync; they reduce day-to-day manual syncing.

## Order Sync Architecture

Order sync follows a shared upsert model:

- Manual sync loads recent Shopify orders and calls the Operations Kit order upsert path.
- Webhook sync receives `orders/create` and `orders/updated`, resolves the shop to a tenant, fetches the full order by GID, then calls the same upsert path.
- The webhook payload is used as a trigger and identity source, not as the full trusted domain object.

The current implementation processes webhook events synchronously. This is acceptable for the current staging/platform phase, but the intended production direction is to keep webhook receipt fast and move the full fetch/upsert into a job or worker queue.

Protected customer data is encrypted before storage. Diagnostics and sync summaries should expose booleans and counters, not names, emails, addresses, tokens, or secrets.

Sync and webhook visibility is part of the operator experience. Sync timestamps, webhook topics, processing status, and errors should be visible from the app without requiring direct database access.

## Product Sync Architecture

Product sync follows the same sync shape:

- Manual sync reads Shopify products and variants for initial import or repair.
- Webhook sync receives `products/create`, `products/update`, and `products/delete`.
- Create/update webhooks fetch the full Product through Admin GraphQL, then call the same local upsert path as manual sync.
- Delete webhooks mark local Shopify product/variant read-model rows as deleted and mark linked sellable items missing/inactive.

Product sync never deletes Operations Kit operational history and never writes product data back to Shopify.

## Tenant Shape

Each Shopify shop is treated as one tenant/shop installation. Local identifiers and Shopify GIDs must be scoped by tenant. A Shopify GID alone is not globally safe inside Operations Kit.

## Relevant Shopify References

- Product object: https://shopify.dev/docs/api/admin-graphql/latest/objects/Product
- ProductVariant object: https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductVariant
- Webhook topics: https://shopify.dev/docs/api/admin-graphql/latest/enums/WebhookSubscriptionTopic

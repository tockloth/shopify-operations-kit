# Sync Strategy

## Product Sync

Product sync is one-way:

```text
Shopify Products / Variants -> Operations Kit
```

There is no reverse product sync from Operations Kit to Shopify.

Operations Kit does not call Shopify Product mutations and does not write title, price, variant, image, inventory, or product status changes back to Shopify.

## Manual Sync

Manual Product sync is available as an initial, repair, or reconciliation action. It reads Shopify products and variants through Admin GraphQL and upserts:

- `shopify_products`
- `shopify_product_variants`
- linked sellable `items`

It does not hard-delete missing products and does not overwrite operational data.

Manual Product sync is the supported initial/repair path. It can be re-run to refresh local Shopify read-model data without resetting operational item setup.

## Webhook Sync

Incremental Product sync uses Shopify webhook topics:

- `products/create`
- `products/update`
- `products/delete`

Create/update webhooks fetch the product through Admin GraphQL and reuse the same upsert path as manual sync. Delete webhooks mark local Shopify links as deleted/missing and preserve operational history.

Product webhook processing is currently synchronous. The same future worker/retry direction documented for order webhooks applies to product webhooks.

## Order Sync

Order sync uses the same shape:

- manual sync for initial/repair sync
- webhook sync for incremental order create/update

Manual sync remains the recovery path if webhooks were missed, delayed, or failed. Webhook sync is an incremental path, not the only source of operational truth.

For order webhooks, Operations Kit:

1. authenticates the Shopify webhook request
2. resolves `shop` to an active `shopify_installations` and `tenants` row
3. inserts a `webhook_events` receipt row
4. deduplicates by `webhook_id`
5. fetches the full order by Shopify Admin GraphQL
6. reuses the single-order upsert used by manual sync
7. stores customer data only in encrypted fields

## Dedupe And Audit

Webhook deliveries are tracked in `webhook_events` with a unique `webhook_id`. Duplicate deliveries are ignored without reprocessing.

Operationally relevant sync problems are recorded as system events through `case_events`.

Unknown-shop webhooks cannot write a tenant-owned `case_events` row because no tenant has been resolved. In that case `webhook_events` is the system event of record.

Duplicate webhook deliveries return a clean ignored result. The original `webhook_events` row remains the canonical delivery record; duplicates do not create new business writes.

## Synchronous Processing Today

The current webhook path processes synchronously during the request. This keeps the implementation simple and testable, but it means long Admin API fetches or database work happen before the response is returned. A later worker-based design should keep the same `webhook_events` receipt/dedupe model and process pending events asynchronously.

## Future Reconciliation

Webhooks are not treated as the only source of truth. A future reconciliation sync should periodically detect missed webhook deliveries, stale products, and mismatched local read-model state.

Global platform/system events are also future work. Today, known-tenant sync failures use `case_events`; unknown-shop failures remain visible in `webhook_events`.

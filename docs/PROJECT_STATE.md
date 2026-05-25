# Project State

Operations Kit is a Shopify-native operations app for order-to-fulfillment workflows. The app runs on Render, uses Supabase/Postgres for Operations Kit data, and integrates with Shopify Admin APIs and webhooks.

## Current Platform Baseline

- Shopify app is embedded in Shopify Admin.
- Supabase/Postgres stores Operations Kit domain data.
- Each Shopify shop maps to an Operations Kit tenant through `tenants` and `shopify_installations`.
- Phase 0A trading-goods flow is implemented and covered by integration smoke tests.
- Multi-tenant runtime filtering and local composite-key hardening are in place for the core domain tables.
- Shopify Order sync supports manual repair sync and webhook-based incremental sync for order create/update events.
- Shopify Product sync is one-way from Shopify into Operations Kit.

## Order Sync State

Order sync has two active entry points:

- Manual sync from the Orders page for initial import, repair, and reconciliation-style refresh.
- Webhook incremental sync for `orders/create` and `orders/updated`.

The webhook path is currently processed synchronously inside the webhook request. It authenticates through Shopify webhook authentication, resolves the shop to an active tenant/shop installation, records a `webhook_events` row, fetches the full order through Admin GraphQL, and reuses the same single-order upsert path as manual sync.

Customer name, email, and shipping address are encrypted before storage when Shopify grants Protected Customer Data access.

## Current Slice

This slice adds Shopify Product read sync:

- Manual initial/repair sync from the Products page.
- Webhook incremental sync for `products/create`, `products/update`, and `products/delete`.
- Local read model tables for Shopify products and variants.
- Links from synced Shopify variants to Operations Kit `items`.
- No Shopify product writeback.
- Final local Product read-model migration: `20260525090000_shopify_product_read_model.sql`.
- No competing `shopify_products` / `shopify_product_variants` migration is present in this worktree.

## Known Technical Debt

- Order and Product webhook processing is synchronous today. A later platform slice should move processing to a job/worker style flow with retry semantics while keeping the webhook receipt and dedupe path fast.
- `npm run typecheck` is known not to be a green gate yet because of existing test typing issues. Build and Vitest are the current enforced checks.

## Important Boundaries

- Shopify is master for sellable products and variants.
- Operations Kit is master for operational data such as BOM, components, MRP, purchasing, suppliers, documents, status, audit, and system events.
- Product data flows from Shopify to Operations Kit only.
- Operational item attributes must not be overwritten by Shopify Product sync.
- External ERP-style integrations are future work and should be generic, not one-off adapters.
- Global platform-level `system_events` is not implemented yet. Until then, known-tenant webhook/system events use tenant-owned `case_events`; unknown-shop webhook failures are traceable through `webhook_events`.
- Sync and webhook history is visible in Settings under Audit & Health -> Sync log.
- Order statuses now distinguish product classification blockers from generic review states.

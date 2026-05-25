# Roadmap

## Completed Foundation

- Render deployment hotfixes for Node and Prisma.
- Supabase staging reset and migration-history alignment.
- Phase 0A browser baseline and integration smoke test.
- Procurement, purchase order, receiving, inventory, and logistics refinements.
- Multi-tenant analysis, tenant isolation tests, runtime hardening, and local DB constraint hardening.
- Shopify Order manual sync, customer-data storage repair, diagnostics, and order webhook incremental sync.

## Current Step

Shopify Product sync, one-way from Shopify to Operations Kit:

- Initial/repair product sync.
- Product create/update/delete webhooks.
- Local Shopify product and variant read model.
- Mapping Shopify variants to Operations Kit items.
- Documentation of central system decisions.

## Next Recommended Platform Steps

1. Deploy and verify Product sync on Render/Supabase staging.
2. Run Shopify app config deploy so product webhook subscriptions are active.
3. Add product reconciliation sync as a scheduled or manual safety net.
4. Move synchronous webhook processing toward a job/worker model with explicit retry, dead-letter, and replay handling.
5. Add global platform/system events for events that cannot be attached to a resolved tenant.
6. Review and remove unused Shopify write scopes after template/demo features are cleaned up.
7. Add privacy/compliance webhooks required for App Store listing.
8. Add webhook retry observability and an operator-facing event view.

## Product Sync Roadmap

- Current: manual initial/repair sync plus synchronous `products/create`, `products/update`, and `products/delete` webhook incremental sync.
- Current: Shopify Product/Variant read models are local and tenant-scoped.
- Next: staging migration/deploy verification and Shopify app config deploy.
- Later: reconciliation sync to detect missed or stale product webhook state.
- Later: scope-minimization review; `write_products` existed before this slice and should not remain for listing if no active feature requires it.

## Order Sync Roadmap

- Current: manual initial/repair sync plus synchronous `orders/create` and `orders/updated` webhook incremental sync.
- Next: reconciliation sync that can compare recent Shopify orders with Operations Kit state.
- Later: async worker processing for webhook events so Shopify delivery acknowledgement is decoupled from full Admin API fetch and database upsert.

## Future Functional Steps

- BOM and production workflows.
- Supplier document/DMS workflows.
- Reconciliation reporting.
- Generic external integration layer through Supabase Edge Functions.
- User management, roles, billing, and email in later platform phases.

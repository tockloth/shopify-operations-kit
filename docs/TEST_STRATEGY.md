# Test Strategy

## Baseline Commands

Run these for larger implementation slices:

```bash
npm run build
npm test
OPERATIONS_KIT_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54332/postgres" npx vitest run tests/integration/operations-kit-scenario.test.ts
OPERATIONS_KIT_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54332/postgres" npx vitest run tests/integration/tenant-isolation.test.ts
```

For Product sync:

```bash
OPERATIONS_KIT_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54332/postgres" npx vitest run tests/integration/shopify-product-sync.test.ts
```

For Order webhook sync:

```bash
OPERATIONS_KIT_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54332/postgres" npx vitest run tests/integration/shopify-order-webhooks.test.ts
```

Known gap: `npm run typecheck` is not currently a green gate because existing integration-test typing issues remain. Do not treat it as the release gate until those tests are cleaned up.

## Test Expectations Per Slice

Each larger slice should add or update:

- automated tests when behavior can be exercised without real Shopify calls
- documented smoke checks when live Shopify behavior is required
- final notes explaining what changed, where it is visible, and how to verify it locally and on staging

## Product Sync Coverage

Product sync should cover:

- initial manual sync creates Shopify product and variant read-model rows
- repeated manual sync is idempotent
- product webhooks create/update local Shopify read-model state
- delete webhooks mark local product links deleted instead of hard-deleting operational history
- duplicate webhook IDs are ignored
- unknown shops do not create cross-tenant data
- same SKU in two tenants remains isolated
- operational item fields are preserved
- migration reset from an empty local DB should create the Shopify Product read model once, without competing definitions

## Order Webhook Coverage

Order webhook tests should cover:

- `orders/create` creates or refreshes an Operations Kit order
- `orders/updated` updates the same tenant's order
- encrypted customer name, email, and shipping address are stored when Shopify returns them
- duplicate `webhook_id` is ignored
- unknown shop records a failed `webhook_events` row
- Tenant A cannot mutate Tenant B data
- manual order sync remains available for initial and repair sync

## Migration Checks

Before staging deploy of sync schema changes, run a full local reset:

```bash
npm run db:reset
```

Then run tenant audit and DB-backed integration tests. Product sync currently has one read-model migration: `20260525090000_shopify_product_read_model.sql`.

## Smoke Checks

For live staging verification:

1. Open Operations Kit in Shopify Admin.
2. Use Products -> Sync Shopify products.
3. Confirm synced sellable items appear.
4. Create or update a product in the Shopify dev store.
5. Confirm the Product webhook updates Operations Kit after deploy/config registration.
6. Delete a test product and confirm local rows are marked deleted/missing, not hard-deleted.

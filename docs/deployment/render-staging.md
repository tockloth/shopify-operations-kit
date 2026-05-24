# Render Staging Deployment

## Purpose

This document describes how to run Operations Kit as a hosted Shopify staging app on Render, backed by a separate Supabase staging database. The goal is a product-like environment without a local Shopify tunnel, while keeping the existing local `npm run dev:ledger` workflow unchanged.

## Render Web Service Settings

| Setting | Value | Notes |
| --- | --- | --- |
| Service type | Web Service | Render Free Web Service is enough for the first staging test. |
| Runtime | Node | Use Node 22 LTS, or Node >=20.19. The package engine is `>=20.19 <22 || >=22.12`. |
| Root directory | Repository root, or `operations-kit` | Use `operations-kit` only if the GitHub repository root is the parent `shopify-apps` directory. |
| Build command | `npm run setup:render && npm run build` | Generates the Prisma client, then builds React Router. No database mutation runs during Render build. |
| Start command | `npm run start:render` | Initializes the Shopify session SQLite table on boot, then starts `react-router-serve`. |
| Health check path | `/healthz` | Unauthenticated app/database health endpoint. |
| Branch | staging branch or `main` | Use the branch that should represent hosted staging. |

## Required Environment Variables

Set these in the Render service environment.

| Variable | Required | Example / Notes |
| --- | --- | --- |
| `NODE_ENV` | Yes | `production` |
| `SHOPIFY_API_KEY` | Yes | Shopify staging app client ID/API key. |
| `SHOPIFY_API_SECRET` | Yes | Shopify staging app client secret. Also used as a fallback customer-data encryption key, but staging should set `OPERATIONS_KIT_CUSTOMER_DATA_KEY`. |
| `SHOPIFY_APP_URL` | Yes | `https://<render-service>.onrender.com` |
| `SCOPES` | Yes | `read_customers,read_inventory,read_merchant_managed_fulfillment_orders,read_orders,read_products,write_merchant_managed_fulfillment_orders,write_metaobject_definitions,write_metaobjects,write_orders,write_products` |
| `OPERATIONS_KIT_DATABASE_URL` | Yes | Supabase staging Postgres connection string. Preferred variable for Operations Kit data. |
| `OPERATIONS_KIT_CUSTOMER_DATA_KEY` | Yes | Stable random secret for encrypted customer fields. Do not rotate casually; rotation would require data migration. |
| `SHOP_CUSTOM_DOMAIN` | Optional | Only set if the staging shop uses a custom domain. Usually empty for dev stores. |

The code also recognizes `OPERATIONS_LEDGER_DATABASE_URL` and `SUPABASE_DB_URL` as database URL fallbacks, but new staging environments should use `OPERATIONS_KIT_DATABASE_URL`.

No Supabase REST URL or anon/service role key is currently required by the app server. Operations Kit talks directly to Postgres through `OPERATIONS_KIT_DATABASE_URL`.

## Local vs Staging Environment

Local development keeps using:

```bash
npm run dev:ledger
```

That script sets `OPERATIONS_KIT_DATABASE_URL` for the local Supabase database and starts `shopify app dev`.

Hosted staging does not use the Shopify CLI tunnel. Render must provide all environment variables directly, especially `SHOPIFY_APP_URL`, Shopify credentials, scopes, the staging database URL, and the customer-data encryption key.

The Prisma database in `prisma/schema.prisma` is only the Shopify session store. Operations Kit business data lives in the Supabase/Postgres database. On Render Free, the local SQLite session file is ephemeral across restarts. That is acceptable for first staging tests, but a persistent session store should be planned before production beta.

## Supabase Staging Setup

1. Create a separate Supabase project for staging.
2. Apply all SQL migrations from `supabase/migrations`.
3. Use the Supabase staging Postgres connection string as `OPERATIONS_KIT_DATABASE_URL`.
4. Keep local and staging databases separate. Do not point Render at the local Supabase database.
5. After deployment, open `/healthz` and verify that `database` is `reachable`.

## Shopify Dev Dashboard Settings

Create or select a Shopify staging app in the Partner Dashboard, then configure:

| Setting | Value |
| --- | --- |
| App URL | `https://<render-service>.onrender.com` |
| Allowed redirection URL | `https://<render-service>.onrender.com/auth/callback` |
| Webhooks | Keep relative URIs from `shopify.app.toml`: `/webhooks/app/scopes_update`, `/webhooks/app/uninstalled` |
| Embedded app | Enabled |
| Scopes | Same value as `SCOPES` above |

Protected Customer Data should include the fields needed by the trading-goods baseline:

- Name
- Email
- Address

The app can sync orders without all customer fields, but logistics and shipment work need the shipping address snapshot.

## How to Deploy

1. Push the staging branch to GitHub.
2. Create a Render Web Service from the repository.
3. Enter the Render settings from this document.
4. Add all required environment variables.
5. Deploy the service.
6. Open:

```text
https://<render-service>.onrender.com/healthz
```

Expected result:

```json
{
  "ok": true,
  "service": "operations-kit",
  "database": "reachable"
}
```

7. Update Shopify Dev Dashboard URLs to the Render URL.
8. Install the staging app into the selected Shopify development store.
9. Run the Phase 0A trading-goods browser path.

## How to Test After Deploy

1. Open `/healthz`.
2. Open the app from Shopify Admin.
3. Sync Shopify products.
4. Create a Shopify test order with customer name, email, and shipping address.
5. Sync Shopify orders.
6. Verify Orders, Customers, Products, Procurement, Receiving, Inventory, and Logistics still render.
7. Run the documented Phase 0A trading-goods baseline through fulfillment writeback.

## Troubleshooting

### `/healthz` returns `database: "not_checked"`

Check that `OPERATIONS_KIT_DATABASE_URL` is set in Render and points to the Supabase staging database. Also confirm that Supabase allows the Render connection and that the connection string includes required SSL parameters if Supabase requires them.

### Shopify redirects fail

Confirm that the Shopify App URL and redirect URL exactly match the Render URL:

```text
https://<render-service>.onrender.com
https://<render-service>.onrender.com/auth/callback
```

Then reinstall or reapprove the app in the development store.

### Scopes are missing after install

Confirm `SCOPES` in Render and `[access_scopes]` in `shopify.app.toml` contain the same scopes. Reinstall or reapprove the app after changing scopes.

### Customer name, email, or address is missing

Confirm Protected Customer Data approval for Name, Email, and Address in the Shopify Partner Dashboard. Confirm the app was reapproved after the protected fields were changed.

### Render deploy succeeds but sessions disappear after restart

The current Shopify session store is Prisma SQLite. Render Free storage is ephemeral. For staging this can be tolerated, but before a production beta move sessions to persistent storage or attach persistent disk.

### Supabase migrations are missing

Apply `supabase/migrations` to the staging database before testing the app. The Render app does not currently run Supabase migrations automatically.

For the tenant-isolation hardening rollout, use the dedicated staging runbook before applying remote migrations:

```text
docs/deployment/supabase-staging-tenant-migration.md
```

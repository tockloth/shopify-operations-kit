# Tenancy And Security

## Tenant Principle

Each Shopify shop maps to one Operations Kit tenant/shop installation. All Operations Kit domain data is tenant-bound.

## Identifier Principle

Shopify GIDs must be scoped with `tenant_id` or `shop_installation_id`. A Shopify product GID, variant GID, order GID, SKU, or webhook resource ID is not sufficient as a cross-tenant key by itself.

## Webhook Security

Webhook routes must use Shopify's webhook authentication flow:

- use `authenticate.webhook(request)`
- do not use `authenticate.admin(request)` for webhook requests
- trust `shop`, `topic`, `payload`, and `webhookId` only after Shopify webhook authentication succeeds

## Webhook Dedupe

`webhook_events.webhook_id` is unique. Repeated deliveries are ignored and do not re-run business logic.

The dedupe insert uses a database-level unique constraint and `on conflict do nothing`, so two near-simultaneous deliveries of the same webhook ID cannot both proceed into processing.

## Unknown Shops

If a webhook arrives for an unknown or inactive shop, Operations Kit stores the webhook event as failed when possible and returns a controlled response. Unknown-shop webhooks must not create tenant data under the wrong tenant.

Because `case_events` is tenant-owned, unknown-shop events are recorded in `webhook_events` rather than `case_events`. Once a tenant is resolved, failed fetches, missing resource IDs, and failed upserts can also be written as tenant-scoped `case_events`.

## Customer Data

Protected customer data must be encrypted before storage. Diagnostics may expose availability booleans and counters, but must not show tokens, secrets, names, emails, or addresses.

Order sync must never overwrite existing encrypted customer data with null when Shopify does not return Protected Customer Data later. If Shopify returns customer data again, existing empty encrypted fields may be filled on re-sync.

## Product Scopes

Product sync requires read access to Shopify products. Product write scopes and Shopify product mutations are out of scope for Operations Kit Product sync.

The current app configuration still contains legacy/template write scopes, including `write_products`. This slice does not rely on Product writeback. Do not remove scopes blindly in the middle of a sync slice; use a dedicated scope-minimization step to confirm no template/demo feature or deployment expectation still requires them.

## Product Tenant Safety

`shopify_products` and `shopify_product_variants` use tenant-scoped uniqueness. Product sync and Product webhook processing must always resolve a tenant before writing Shopify read-model or item data.

Two shops may contain the same SKU or even similar Shopify payloads. The local model must keep them separate through `tenant_id` and active `shopify_installations` resolution.

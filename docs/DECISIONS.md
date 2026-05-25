# Decisions

## D001: Shopify Is Master For Sellable Products

Shopify owns sellable product and variant data. Operations Kit reads this data but does not write product changes back to Shopify.

## D002: Operations Kit Owns Operational Data

Operations Kit owns BOM, components, needs/MRP, purchasing, suppliers, documents, status, audit, and system events. Shopify Product sync must not overwrite operational fields.

## D003: Manual Sync Plus Webhook Incremental Sync

Manual sync remains available for initial sync, repair sync, and reconciliation. Webhooks provide incremental updates. A future scheduled reconciliation sync should act as a safety net.

For orders, `orders/create` and `orders/updated` webhooks currently process synchronously and reuse the same single-order upsert as manual sync. This avoids duplicate business logic. Async/job-based processing is intentionally deferred.

## D004: Tenant-Scoped Shopify Identifiers

Shopify GIDs, SKUs, order names, webhook IDs, and variant IDs are not used as unscoped business keys. Local persistence must include tenant or shop-installation context.

## D005: Product Delete Preserves History

Shopify Product delete events mark local Shopify links as deleted/missing. They do not hard-delete Operations Kit items, BOM, order history, purchase data, inventory history, or audit events.

## D006: No ERP-Specific Adapter In Core Platform

Future external systems should be connected through generic integration patterns, likely Supabase Edge Functions. Core Operations Kit should not grow one-off ERP adapters during the current platform phase.

## D007: Product Write Scope Minimization Is A Follow-Up

The current app configuration still contains legacy/template write scopes. This slice does not introduce new Shopify product write behavior. A later listing-readiness slice should remove unused product write scopes after confirming no remaining template/demo feature requires them.

## D008: Webhook Events Are The Cross-Cutting Receipt Log

`webhook_events` is the durable receipt and dedupe table for Shopify webhooks. Tenant-scoped `case_events` are used for operationally relevant system events only after a tenant is known. Unknown-shop webhook failures remain in `webhook_events` because no tenant-owned audit row can be written safely.

## D009: Product Read Model Has One Final Migration

The Product read model is defined by `20260525090000_shopify_product_read_model.sql`. A second competing read-model migration must not be added unless it is a forward-only alteration. If an obsolete duplicate appears before staging deployment, consolidate it before applying remote migrations.

## D010: Global Platform Events Are Deferred

There is no tenantless global `system_events` table yet. Unknown-shop webhook failures are therefore tracked in `webhook_events`. A future platform slice should add global platform events for installation, webhook, and infrastructure issues that cannot safely be assigned to a tenant.

## D011: UI Statuses Must Name The Blocker

Operational statuses should identify the concrete blocker when the system knows it. For example, an order with synced Shopify products but unclassified Operations Kit items should show `Product classification required`, not generic `Review required`.

## D012: Clickability Must Be Explicit

List tables should use visible links or buttons for navigation. Main identifiers and right-side actions are clickable; ordinary cells should not look or behave like links.

## D013: Lists Stay Compact; Details Carry Diagnosis

Operational list views are for scanning work queues. They show concise statuses and next actions. Long business reasons, webhook topics, sync timestamps, resource GIDs, and processing errors belong in detail views or Settings -> Audit & Health -> Sync log.

## D014: Summary Headers Stay Compact

Detail-page summary tables show compact state only. Longer business reasons move into the relevant line/detail section, while technical sync diagnostics move into collapsed disclosures or the Sync log. List labels may use shortened wording when detail pages preserve the full meaning.

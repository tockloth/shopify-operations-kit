# UI Guidelines

## Status Text

Status labels must name the next business problem clearly. Avoid generic states when the system knows the reason.

Examples:

- Use `Product classification required` when order lines are linked to Shopify products but the Operations Kit item has no sell/buy/make role.
- Use `Logistics blocked` when inventory is ready but customer or shipping data is missing.
- Use `BOM required` when a producible item needs production but has no active BOM.

## Table Interaction

Tables use explicit links and buttons:

- Main identifiers are links, for example order number, product name, supplier name, or PO number.
- Right-side action links use consistent labels such as `Open order` and `Open product`.
- Pointer cursor or row click affordance is only appropriate when the row is genuinely clickable.
- Plain table cells must not look clickable.

## Compact Lists

List tables are for fast work steering. They should show compact state and the next action, not full diagnostics.

- Order lists show the order number, date, customer, compact product summary, operational status badge, payment, Shopify fulfillment, address readiness, and next action.
- Product lists show product name, Shopify status, type, role/classification, supplier, stock, BOM, data quality, and next action.
- Long reason text belongs on the detail page for the affected order, order line, product, PO, receipt, or shipment.
- Technical sync and webhook details such as timestamps, topics, webhook status, resource GIDs, and errors belong on detail pages or Settings -> Audit & Health -> Sync log.
- A list may use one short sync indicator such as `Synced` or `Missing` only when it materially changes the work queue.
- List labels may use short forms such as `Classification required` when the detail view explains the full status.

## Compact Summaries

Summary tables at the top of detail pages should stay compact.

- Show short state such as `Synced`, `Failed`, `Ready`, or `Blocked`.
- Keep next actions short, for example `Classify products`, `Open procurement`, or `Review lines`.
- Put longer reasons in the affected line/detail section or a short `Why this action is needed` section.
- Put technical sync diagnostics in a collapsed `Sync details` disclosure or Settings -> Audit & Health -> Sync log.
- Do not show webhook topics, processing states, resource IDs, or long explanation text in summary cells.

## Settings Structure

Settings should stay within three levels:

- Main area
- Rubric
- Detail

Current target areas:

- Tenant & Shopify: shop installation, scopes, webhooks, sync status, customer data diagnostics
- Operations: product classification, BOM defaults, procurement defaults, logistics defaults
- Users & Access: users, roles, permissions
- Integrations: export, API clients, DMS, accounting / ERP handoff
- Audit & Health: sync log, webhook events, data quality, tenant health

## Sync And Audit Visibility

Sync status must be visible inside the app:

- Product overview should show a compact Product sync status panel with last sync, source, status, product/variant counts, and a link to the sync log.
- Order detail should show whether the last order sync came from webhook or manual/unknown sync.
- Settings -> Audit & Health -> Sync log shows webhook events with topic, status, received/processed timestamps, shop, resource, error, and entity link when available.

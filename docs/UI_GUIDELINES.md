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

- Products should show last Product sync time, source, webhook topic/status, and product/variant counts.
- Orders should show whether the last order sync came from webhook or manual/unknown sync.
- Settings -> Audit & Health -> Sync log shows webhook events with topic, status, received/processed timestamps, shop, resource, error, and entity link when available.

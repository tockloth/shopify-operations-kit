# Integrations

## Shopify

Shopify is the primary integration and source of truth for sellable commerce data:

- products
- variants
- orders
- fulfillment-facing Shopify status

Operations Kit reads Shopify data and adds operational context.

## Supabase

Supabase/Postgres stores Operations Kit domain data, tenant mappings, local Shopify read models, audit trails, and webhook processing events.

## External Systems

Future integrations should be generic and adapter-friendly. The current direction is:

- use Supabase Edge Functions for external integration endpoints
- avoid ERP-specific one-off adapters in the core app
- keep Operations Kit usable as a Shopify-native operations layer for small shops
- allow larger shops to connect external systems later without changing core domain ownership

## Non-Goals

- no bidirectional Shopify Product sync
- no Shopify Product writeback from Operations Kit
- no inventory writeback in the Product sync slice
- no ERP-specific connector in the Product sync slice

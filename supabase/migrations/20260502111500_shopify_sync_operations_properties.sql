alter table items
  add column if not exists shopify_product_legacy_id text,
  add column if not exists shopify_variant_legacy_id text,
  add column if not exists product_handle text,
  add column if not exists product_status text,
  add column if not exists variant_title text,
  add column if not exists shopify_inventory_available numeric(14, 4),
  add column if not exists min_inventory_quantity numeric(14, 4) not null default 0,
  add column if not exists default_production_quantity numeric(14, 4) not null default 1,
  add column if not exists default_order_quantity numeric(14, 4) not null default 1,
  add column if not exists supplier_lead_time_days integer not null default 7,
  add column if not exists qc_required_after_purchase boolean not null default true,
  add column if not exists qc_required_after_production boolean not null default true,
  add column if not exists inventory_location_policy text not null default 'shopify_primary';

alter table operations_orders
  add column if not exists shopify_order_legacy_id text,
  add column if not exists customer_name text,
  add column if not exists customer_email text,
  add column if not exists financial_status text,
  add column if not exists fulfillment_status text,
  add column if not exists processed_at timestamptz;

alter table operations_order_lines
  add column if not exists shopify_line_item_gid text,
  add column if not exists shopify_variant_gid text,
  add column if not exists sku text,
  add column if not exists title text;

create index if not exists items_shopify_variant_gid_idx on items(tenant_id, shopify_variant_gid);
create index if not exists operations_orders_shopify_order_gid_idx on operations_orders(tenant_id, shopify_order_gid);

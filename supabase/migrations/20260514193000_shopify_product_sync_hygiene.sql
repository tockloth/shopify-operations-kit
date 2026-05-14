alter table items
  add column if not exists shopify_published_at timestamptz,
  add column if not exists shopify_online_store_url text,
  add column if not exists shopify_last_seen_at timestamptz;

create index if not exists items_shopify_last_seen_idx
  on items(tenant_id, shopify_last_seen_at)
  where shopify_product_gid is not null;

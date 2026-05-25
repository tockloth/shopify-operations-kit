create table if not exists shopify_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  shop_installation_id uuid references shopify_installations(id) on delete set null,
  shop_domain text not null,
  shopify_product_gid text not null,
  shopify_product_legacy_id text,
  title text not null,
  handle text,
  vendor text,
  product_type text,
  status text,
  tags_json jsonb not null default '[]'::jsonb,
  raw_payload_json jsonb,
  synced_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, shopify_product_gid)
);

create table if not exists shopify_product_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  shopify_product_id uuid references shopify_products(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  shopify_product_gid text not null,
  shopify_variant_gid text not null,
  shopify_variant_legacy_id text,
  sku text,
  barcode text,
  title text,
  price numeric(14, 4),
  inventory_item_gid text,
  inventory_item_legacy_id text,
  raw_payload_json jsonb,
  synced_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, shopify_variant_gid),
  foreign key (tenant_id, shopify_product_gid)
    references shopify_products(tenant_id, shopify_product_gid)
    on delete cascade
);

create index if not exists shopify_products_shop_domain_idx
  on shopify_products (shop_domain, synced_at desc);

create index if not exists shopify_products_status_idx
  on shopify_products (tenant_id, status, deleted_at);

create index if not exists shopify_product_variants_product_idx
  on shopify_product_variants (tenant_id, shopify_product_gid);

create index if not exists shopify_product_variants_sku_idx
  on shopify_product_variants (tenant_id, sku);

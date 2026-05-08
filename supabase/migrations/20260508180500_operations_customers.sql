create table if not exists operation_customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  shopify_customer_gid text,
  shopify_customer_legacy_id text,
  display_name text,
  email text,
  display_name_encrypted text,
  email_encrypted text,
  customer_lookup_hash text,
  first_name_encrypted text,
  last_name_encrypted text,
  number_of_orders integer not null default 0,
  amount_spent numeric(14, 4),
  amount_spent_currency text,
  shopify_created_at timestamptz,
  shopify_updated_at timestamptz,
  customer_data_redacted_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, shopify_customer_gid)
);

create index if not exists operation_customers_lookup_hash_idx
  on operation_customers(tenant_id, customer_lookup_hash);

create index if not exists operation_customers_shopify_updated_idx
  on operation_customers(tenant_id, shopify_updated_at desc);

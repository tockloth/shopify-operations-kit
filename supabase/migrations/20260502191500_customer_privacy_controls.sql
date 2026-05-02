alter table operations_orders
  add column if not exists customer_name_encrypted text,
  add column if not exists customer_email_encrypted text,
  add column if not exists customer_lookup_hash text,
  add column if not exists customer_data_redacted_at timestamptz,
  add column if not exists customer_data_retention_until timestamptz;

create table if not exists privacy_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  customer_data_retention_days integer not null default 365 check (customer_data_retention_days > 0),
  encrypt_customer_data boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists operations_orders_customer_lookup_hash_idx
  on operations_orders(tenant_id, customer_lookup_hash);

create index if not exists operations_orders_customer_data_retention_idx
  on operations_orders(tenant_id, customer_data_retention_until)
  where customer_data_redacted_at is null;

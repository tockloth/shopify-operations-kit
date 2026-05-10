alter table suppliers
  add column if not exists phone text,
  add column if not exists website text,
  add column if not exists notes text;

alter table supplier_items
  add column if not exists supplier_sku text,
  add column if not exists unit_price numeric(14, 4),
  add column if not exists currency_code text not null default 'EUR',
  add column if not exists lead_time_days integer,
  add column if not exists minimum_order_quantity numeric(14, 4),
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

alter table purchase_order_lines
  add column if not exists supplier_sku text,
  add column if not exists unit_price numeric(14, 4),
  add column if not exists currency_code text not null default 'EUR';

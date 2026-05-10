create table purchase_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  purchase_order_id uuid not null references purchase_orders(id) on delete restrict,
  supplier_id uuid references suppliers(id) on delete set null,
  payment_number text not null,
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  due_date date,
  currency_code text not null default 'EUR',
  net_amount numeric(14, 4) not null default 0,
  tax_amount numeric(14, 4) not null default 0,
  shipping_amount numeric(14, 4) not null default 0,
  gross_amount numeric(14, 4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, purchase_order_id),
  unique (tenant_id, payment_number)
);

create index purchase_payments_status_idx on purchase_payments(tenant_id, status);

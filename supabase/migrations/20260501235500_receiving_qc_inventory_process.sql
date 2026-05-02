create table goods_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  purchase_order_id uuid not null references purchase_orders(id) on delete restrict,
  receipt_number text not null,
  status text not null default 'posted' check (status in ('draft', 'posted', 'qc_required', 'putaway_pending', 'closed', 'cancelled')),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, purchase_order_id)
);

create table goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  goods_receipt_id uuid not null references goods_receipts(id) on delete cascade,
  purchase_order_line_id uuid not null references purchase_order_lines(id) on delete restrict,
  item_id uuid not null references items(id) on delete restrict,
  received_quantity numeric(14, 4) not null check (received_quantity > 0),
  accepted_quantity numeric(14, 4) not null default 0,
  rejected_quantity numeric(14, 4) not null default 0,
  unit text not null default 'pcs',
  status text not null default 'qc_hold' check (status in ('received', 'qc_hold', 'accepted', 'rejected', 'putaway_done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, purchase_order_line_id)
);

create table qc_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  goods_receipt_line_id uuid not null references goods_receipt_lines(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'in_progress', 'passed', 'failed', 'waived')),
  result text check (result in ('passed', 'failed', 'waived')),
  inspected_quantity numeric(14, 4),
  notes text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, goods_receipt_line_id)
);

create index goods_receipts_status_idx on goods_receipts(tenant_id, status);
create index goods_receipt_lines_status_idx on goods_receipt_lines(tenant_id, status);
create index qc_checks_status_idx on qc_checks(tenant_id, status);

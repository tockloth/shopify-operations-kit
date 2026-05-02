alter table mrp_runs
  drop constraint if exists mrp_runs_scenario_mode_check;

alter table mrp_runs
  add constraint mrp_runs_scenario_mode_check
  check (scenario_mode in ('available', 'shortage', 'operations'));

alter table inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;

alter table inventory_movements
  add constraint inventory_movements_movement_type_check
  check (
    movement_type in (
      'stock_adjustment',
      'reservation',
      'reservation_release',
      'purchase_receipt',
      'qc_hold',
      'putaway',
      'quarantine',
      'pick',
      'pack',
      'ship',
      'consume',
      'produce',
      'count_adjustment'
    )
  );

alter table purchase_orders
  drop constraint if exists purchase_orders_status_check;

alter table purchase_orders
  add constraint purchase_orders_status_check
  check (status in ('draft', 'pending_approval', 'approved', 'sent', 'acknowledged', 'cancelled'));

alter table purchase_orders
  add column if not exists submitted_for_approval_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by_role text,
  add column if not exists requested_by_role text not null default 'procurement';

alter table purchase_order_lines
  add column if not exists lead_time_days integer not null default 7,
  add column if not exists expected_delivery_date date,
  add column if not exists requested_quantity numeric(14, 4);

update purchase_order_lines
set requested_quantity = quantity
where requested_quantity is null;

alter table production_orders
  drop constraint if exists production_orders_status_check;

alter table production_orders
  add constraint production_orders_status_check
  check (
    status in (
      'planned',
      'pending_approval',
      'approved',
      'material_missing',
      'ready',
      'in_progress',
      'qc_hold',
      'qc_complete',
      'released',
      'completed',
      'cancelled'
    )
  );

alter table production_orders
  add column if not exists submitted_for_approval_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by_role text,
  add column if not exists completed_at timestamptz,
  add column if not exists qc_status text not null default 'not_required',
  add column if not exists accepted_quantity numeric(14, 4) not null default 0,
  add column if not exists rejected_quantity numeric(14, 4) not null default 0,
  add column if not exists release_destination text not null default 'inventory';

alter table production_orders
  drop constraint if exists production_orders_qc_status_check;

alter table production_orders
  add constraint production_orders_qc_status_check
  check (qc_status in ('not_required', 'open', 'in_progress', 'passed', 'partial', 'failed'));

alter table production_orders
  drop constraint if exists production_orders_release_destination_check;

alter table production_orders
  add constraint production_orders_release_destination_check
  check (release_destination in ('inventory', 'logistics'));

create table if not exists shipping_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  operations_order_id uuid not null references operations_orders(id) on delete cascade,
  shipment_number text not null,
  status text not null default 'open' check (status in ('open', 'picking', 'packed', 'partially_shipped', 'shipped', 'cancelled')),
  customer_name text,
  customer_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  packed_at timestamptz,
  shipped_at timestamptz,
  unique (tenant_id, operations_order_id, shipment_number)
);

create table if not exists shipping_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  shipping_order_id uuid not null references shipping_orders(id) on delete cascade,
  operations_order_line_id uuid not null references operations_order_lines(id) on delete restrict,
  item_id uuid not null references items(id) on delete restrict,
  ordered_quantity numeric(14, 4) not null check (ordered_quantity > 0),
  packed_quantity numeric(14, 4) not null default 0,
  shipped_quantity numeric(14, 4) not null default 0,
  unit text not null default 'pcs',
  status text not null default 'open' check (status in ('open', 'picked', 'packed', 'partially_shipped', 'shipped', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, shipping_order_id, operations_order_line_id)
);

create index if not exists shipping_orders_status_idx on shipping_orders(tenant_id, status);
create index if not exists shipping_order_lines_status_idx on shipping_order_lines(tenant_id, status);

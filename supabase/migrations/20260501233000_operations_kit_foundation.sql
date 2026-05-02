create extension if not exists "pgcrypto";

create table tenants (
  id uuid primary key default gen_random_uuid(),
  shop_domain text not null unique,
  status text not null default 'active' check (status in ('active', 'suspended', 'uninstalled', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table shopify_installations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  shop_domain text not null unique,
  status text not null default 'active' check (status in ('active', 'token_rotated', 'uninstalled', 'revoked')),
  scopes text,
  installed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  shopify_product_gid text,
  shopify_variant_gid text,
  shopify_inventory_item_gid text,
  sku text not null,
  title text not null,
  item_type text not null check (item_type in ('product', 'component', 'raw_material', 'assembly')),
  unit text not null default 'pcs',
  is_sellable boolean not null default false,
  is_purchasable boolean not null default false,
  is_producible boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sku),
  unique (tenant_id, shopify_variant_gid)
);

create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  movement_type text not null check (movement_type in ('stock_adjustment', 'reservation', 'reservation_release', 'purchase_receipt', 'qc_hold', 'putaway', 'pick', 'consume', 'produce', 'count_adjustment')),
  quantity_delta numeric(14, 4) not null default 0,
  reserved_delta numeric(14, 4) not null default 0,
  location_code text,
  source_type text not null,
  source_id text not null,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

create table boms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  parent_item_id uuid not null references items(id) on delete restrict,
  version text not null default '1',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, parent_item_id, version)
);

create table bom_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  bom_id uuid not null references boms(id) on delete cascade,
  component_item_id uuid not null references items(id) on delete restrict,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit text not null default 'pcs',
  created_at timestamptz not null default now(),
  unique (tenant_id, bom_id, component_item_id)
);

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create table supplier_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  is_preferred boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, supplier_id, item_id)
);

create unique index supplier_items_one_preferred_per_item
  on supplier_items(tenant_id, item_id)
  where is_preferred;

create table operations_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  shopify_order_gid text,
  order_name text not null,
  status text not null default 'open' check (status in ('open', 'planned', 'in_progress', 'closed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, order_name)
);

create table operations_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  operations_order_id uuid not null references operations_orders(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit text not null default 'pcs',
  supply_status text not null default 'unchecked' check (supply_status in ('unchecked', 'checked', 'reserved', 'shortage', 'blocked', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (tenant_id, operations_order_id, item_id)
);

create table mrp_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  operations_order_id uuid references operations_orders(id) on delete set null,
  status text not null default 'previewed' check (status in ('draft', 'running', 'previewed', 'committed', 'cancelled', 'failed')),
  scenario_mode text not null default 'shortage' check (scenario_mode in ('available', 'shortage')),
  summary text,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

create table mrp_run_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  mrp_run_id uuid not null references mrp_runs(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  source_item_id uuid references items(id) on delete set null,
  line_type text not null check (line_type in ('finished_good', 'component')),
  demand_quantity numeric(14, 4) not null,
  available_quantity numeric(14, 4) not null,
  shortage_quantity numeric(14, 4) not null,
  recommended_action text not null check (recommended_action in ('reserve', 'buy', 'make', 'review')),
  explanation text not null,
  created_at timestamptz not null default now()
);

create table purchase_needs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  mrp_run_id uuid not null references mrp_runs(id) on delete cascade,
  mrp_run_line_id uuid not null references mrp_run_lines(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit text not null default 'pcs',
  status text not null default 'open' check (status in ('open', 'assigned', 'ready_for_po', 'converted_to_po', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, mrp_run_line_id)
);

create table production_needs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  mrp_run_id uuid not null references mrp_runs(id) on delete cascade,
  mrp_run_line_id uuid not null references mrp_run_lines(id) on delete cascade,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit text not null default 'pcs',
  status text not null default 'open' check (status in ('open', 'planned', 'converted_to_order', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, mrp_run_line_id)
);

create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete restrict,
  display_number text not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'acknowledged', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  cancelled_at timestamptz,
  unique (tenant_id, display_number)
);

create table purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  purchase_need_id uuid not null references purchase_needs(id) on delete restrict,
  item_id uuid not null references items(id) on delete restrict,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit text not null default 'pcs',
  status text not null default 'open' check (status in ('open', 'cancelled', 'fulfilled_later')),
  created_at timestamptz not null default now(),
  unique (tenant_id, purchase_need_id)
);

create table production_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  production_need_id uuid references production_needs(id) on delete set null,
  item_id uuid not null references items(id) on delete restrict,
  display_number text not null,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit text not null default 'pcs',
  status text not null default 'planned' check (status in ('planned', 'material_missing', 'ready', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, display_number),
  unique (tenant_id, production_need_id)
);

create table production_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  production_order_id uuid not null references production_orders(id) on delete cascade,
  item_id uuid not null references items(id) on delete restrict,
  required_quantity numeric(14, 4) not null,
  picked_quantity numeric(14, 4) not null default 0,
  status text not null default 'required' check (status in ('required', 'reserved', 'picked', 'consumed', 'shortage', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (tenant_id, production_order_id, item_id)
);

create table warehouse_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  task_type text not null check (task_type in ('pick', 'putaway', 'cycle_count', 'pack')),
  status text not null default 'open' check (status in ('open', 'assigned', 'in_progress', 'submitted', 'done', 'blocked', 'cancelled')),
  item_id uuid references items(id) on delete set null,
  quantity numeric(14, 4),
  source_type text not null,
  source_id uuid,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, task_type, source_type, source_id, item_id)
);

create table operation_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  case_type text not null check (case_type in ('order_clarification', 'fulfillment_exception', 'refund_approval', 'return_case', 'inventory_discrepancy', 'purchase_need', 'general_operations_case')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'blocked', 'waiting_for_decision', 'closed', 'cancelled')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  summary text not null,
  primary_object_type text,
  primary_object_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table case_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  operation_case_id uuid references operation_cases(id) on delete cascade,
  event_type text not null,
  title text not null,
  message text,
  actor_type text not null default 'system',
  source text not null default 'operations_kit',
  source_ref text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index items_tenant_type_idx on items(tenant_id, item_type);
create index inventory_movements_balance_idx on inventory_movements(tenant_id, item_id);
create index purchase_needs_status_idx on purchase_needs(tenant_id, status);
create index production_needs_status_idx on production_needs(tenant_id, status);
create index purchase_orders_status_idx on purchase_orders(tenant_id, status);
create index warehouse_tasks_status_idx on warehouse_tasks(tenant_id, status);
create index operation_cases_status_idx on operation_cases(tenant_id, status);

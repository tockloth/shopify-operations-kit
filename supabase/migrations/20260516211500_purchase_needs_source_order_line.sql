alter table purchase_needs
  add column if not exists source_order_line_id uuid references operations_order_lines(id) on delete set null;

create index if not exists purchase_needs_source_order_line_idx
  on purchase_needs(tenant_id, source_order_line_id);

with unambiguous_order_lines as (
  select
    purchase_needs.id as purchase_need_id,
    (array_agg(operations_order_lines.id))[1] as source_order_line_id,
    count(*) as matching_line_count
  from purchase_needs
  join mrp_runs
    on mrp_runs.id = purchase_needs.mrp_run_id
    and mrp_runs.tenant_id = purchase_needs.tenant_id
  join operations_order_lines
    on operations_order_lines.tenant_id = purchase_needs.tenant_id
    and operations_order_lines.operations_order_id = mrp_runs.operations_order_id
    and operations_order_lines.item_id = purchase_needs.item_id
    and operations_order_lines.supply_status <> 'cancelled'
  where purchase_needs.source_order_line_id is null
    and mrp_runs.operations_order_id is not null
  group by purchase_needs.id
)
update purchase_needs
set source_order_line_id = unambiguous_order_lines.source_order_line_id,
    updated_at = now()
from unambiguous_order_lines
where purchase_needs.id = unambiguous_order_lines.purchase_need_id
  and unambiguous_order_lines.matching_line_count = 1;

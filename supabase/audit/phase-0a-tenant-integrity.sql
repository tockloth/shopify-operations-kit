-- Phase 0A tenant-integrity audit.
--
-- Run against a local Operations Kit database before applying composite
-- tenant foreign keys. A clean database returns 0 rows.

with violations as (
  select
    'supplier_items -> suppliers' as audit_check,
    'supplier_items' as child_table,
    supplier_items.id::text as child_id,
    supplier_items.tenant_id::text as child_tenant_id,
    'suppliers' as parent_table,
    suppliers.id::text as parent_id,
    suppliers.tenant_id::text as parent_tenant_id,
    'supplier_items.supplier_id references a supplier from another tenant' as issue
  from supplier_items
  join suppliers on suppliers.id = supplier_items.supplier_id
  where supplier_items.tenant_id <> suppliers.tenant_id

  union all

  select
    'supplier_items -> items' as audit_check,
    'supplier_items' as child_table,
    supplier_items.id::text as child_id,
    supplier_items.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'supplier_items.item_id references an item from another tenant' as issue
  from supplier_items
  join items on items.id = supplier_items.item_id
  where supplier_items.tenant_id <> items.tenant_id

  union all

  select
    'operations_order_lines -> operations_orders' as audit_check,
    'operations_order_lines' as child_table,
    operations_order_lines.id::text as child_id,
    operations_order_lines.tenant_id::text as child_tenant_id,
    'operations_orders' as parent_table,
    operations_orders.id::text as parent_id,
    operations_orders.tenant_id::text as parent_tenant_id,
    'operations_order_lines.operations_order_id references an order from another tenant' as issue
  from operations_order_lines
  join operations_orders
    on operations_orders.id = operations_order_lines.operations_order_id
  where operations_order_lines.tenant_id <> operations_orders.tenant_id

  union all

  select
    'operations_order_lines -> items' as audit_check,
    'operations_order_lines' as child_table,
    operations_order_lines.id::text as child_id,
    operations_order_lines.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'operations_order_lines.item_id references an item from another tenant' as issue
  from operations_order_lines
  join items on items.id = operations_order_lines.item_id
  where operations_order_lines.tenant_id <> items.tenant_id

  union all

  select
    'mrp_runs -> operations_orders' as audit_check,
    'mrp_runs' as child_table,
    mrp_runs.id::text as child_id,
    mrp_runs.tenant_id::text as child_tenant_id,
    'operations_orders' as parent_table,
    operations_orders.id::text as parent_id,
    operations_orders.tenant_id::text as parent_tenant_id,
    'mrp_runs.operations_order_id references an order from another tenant' as issue
  from mrp_runs
  join operations_orders on operations_orders.id = mrp_runs.operations_order_id
  where mrp_runs.tenant_id <> operations_orders.tenant_id

  union all

  select
    'mrp_run_lines -> mrp_runs' as audit_check,
    'mrp_run_lines' as child_table,
    mrp_run_lines.id::text as child_id,
    mrp_run_lines.tenant_id::text as child_tenant_id,
    'mrp_runs' as parent_table,
    mrp_runs.id::text as parent_id,
    mrp_runs.tenant_id::text as parent_tenant_id,
    'mrp_run_lines.mrp_run_id references an MRP run from another tenant' as issue
  from mrp_run_lines
  join mrp_runs on mrp_runs.id = mrp_run_lines.mrp_run_id
  where mrp_run_lines.tenant_id <> mrp_runs.tenant_id

  union all

  select
    'mrp_run_lines -> items' as audit_check,
    'mrp_run_lines' as child_table,
    mrp_run_lines.id::text as child_id,
    mrp_run_lines.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'mrp_run_lines.item_id references an item from another tenant' as issue
  from mrp_run_lines
  join items on items.id = mrp_run_lines.item_id
  where mrp_run_lines.tenant_id <> items.tenant_id

  union all

  select
    'mrp_run_lines -> source items' as audit_check,
    'mrp_run_lines' as child_table,
    mrp_run_lines.id::text as child_id,
    mrp_run_lines.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'mrp_run_lines.source_item_id references an item from another tenant' as issue
  from mrp_run_lines
  join items on items.id = mrp_run_lines.source_item_id
  where mrp_run_lines.tenant_id <> items.tenant_id

  union all

  select
    'boms -> items' as audit_check,
    'boms' as child_table,
    boms.id::text as child_id,
    boms.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'boms.parent_item_id references an item from another tenant' as issue
  from boms
  join items on items.id = boms.parent_item_id
  where boms.tenant_id <> items.tenant_id

  union all

  select
    'bom_lines -> boms' as audit_check,
    'bom_lines' as child_table,
    bom_lines.id::text as child_id,
    bom_lines.tenant_id::text as child_tenant_id,
    'boms' as parent_table,
    boms.id::text as parent_id,
    boms.tenant_id::text as parent_tenant_id,
    'bom_lines.bom_id references a BOM from another tenant' as issue
  from bom_lines
  join boms on boms.id = bom_lines.bom_id
  where bom_lines.tenant_id <> boms.tenant_id

  union all

  select
    'bom_lines -> items' as audit_check,
    'bom_lines' as child_table,
    bom_lines.id::text as child_id,
    bom_lines.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'bom_lines.component_item_id references an item from another tenant' as issue
  from bom_lines
  join items on items.id = bom_lines.component_item_id
  where bom_lines.tenant_id <> items.tenant_id

  union all

  select
    'purchase_needs -> items' as audit_check,
    'purchase_needs' as child_table,
    purchase_needs.id::text as child_id,
    purchase_needs.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'purchase_needs.item_id references an item from another tenant' as issue
  from purchase_needs
  join items on items.id = purchase_needs.item_id
  where purchase_needs.tenant_id <> items.tenant_id

  union all

  select
    'purchase_needs -> suppliers' as audit_check,
    'purchase_needs' as child_table,
    purchase_needs.id::text as child_id,
    purchase_needs.tenant_id::text as child_tenant_id,
    'suppliers' as parent_table,
    suppliers.id::text as parent_id,
    suppliers.tenant_id::text as parent_tenant_id,
    'purchase_needs.supplier_id references a supplier from another tenant' as issue
  from purchase_needs
  join suppliers on suppliers.id = purchase_needs.supplier_id
  where purchase_needs.tenant_id <> suppliers.tenant_id

  union all

  select
    'purchase_needs -> mrp_runs' as audit_check,
    'purchase_needs' as child_table,
    purchase_needs.id::text as child_id,
    purchase_needs.tenant_id::text as child_tenant_id,
    'mrp_runs' as parent_table,
    mrp_runs.id::text as parent_id,
    mrp_runs.tenant_id::text as parent_tenant_id,
    'purchase_needs.mrp_run_id references an MRP run from another tenant' as issue
  from purchase_needs
  join mrp_runs on mrp_runs.id = purchase_needs.mrp_run_id
  where purchase_needs.tenant_id <> mrp_runs.tenant_id

  union all

  select
    'purchase_needs -> mrp_run_lines' as audit_check,
    'purchase_needs' as child_table,
    purchase_needs.id::text as child_id,
    purchase_needs.tenant_id::text as child_tenant_id,
    'mrp_run_lines' as parent_table,
    mrp_run_lines.id::text as parent_id,
    mrp_run_lines.tenant_id::text as parent_tenant_id,
    'purchase_needs.mrp_run_line_id references an MRP run line from another tenant' as issue
  from purchase_needs
  join mrp_run_lines on mrp_run_lines.id = purchase_needs.mrp_run_line_id
  where purchase_needs.tenant_id <> mrp_run_lines.tenant_id

  union all

  select
    'purchase_needs -> source operations_order_lines' as audit_check,
    'purchase_needs' as child_table,
    purchase_needs.id::text as child_id,
    purchase_needs.tenant_id::text as child_tenant_id,
    'operations_order_lines' as parent_table,
    operations_order_lines.id::text as parent_id,
    operations_order_lines.tenant_id::text as parent_tenant_id,
    'purchase_needs.source_order_line_id references an order line from another tenant' as issue
  from purchase_needs
  join operations_order_lines
    on operations_order_lines.id = purchase_needs.source_order_line_id
  where purchase_needs.tenant_id <> operations_order_lines.tenant_id

  union all

  select
    'purchase_orders -> suppliers' as audit_check,
    'purchase_orders' as child_table,
    purchase_orders.id::text as child_id,
    purchase_orders.tenant_id::text as child_tenant_id,
    'suppliers' as parent_table,
    suppliers.id::text as parent_id,
    suppliers.tenant_id::text as parent_tenant_id,
    'purchase_orders.supplier_id references a supplier from another tenant' as issue
  from purchase_orders
  join suppliers on suppliers.id = purchase_orders.supplier_id
  where purchase_orders.tenant_id <> suppliers.tenant_id

  union all

  select
    'purchase_order_lines -> purchase_orders' as audit_check,
    'purchase_order_lines' as child_table,
    purchase_order_lines.id::text as child_id,
    purchase_order_lines.tenant_id::text as child_tenant_id,
    'purchase_orders' as parent_table,
    purchase_orders.id::text as parent_id,
    purchase_orders.tenant_id::text as parent_tenant_id,
    'purchase_order_lines.purchase_order_id references a purchase order from another tenant' as issue
  from purchase_order_lines
  join purchase_orders
    on purchase_orders.id = purchase_order_lines.purchase_order_id
  where purchase_order_lines.tenant_id <> purchase_orders.tenant_id

  union all

  select
    'purchase_order_lines -> purchase_needs' as audit_check,
    'purchase_order_lines' as child_table,
    purchase_order_lines.id::text as child_id,
    purchase_order_lines.tenant_id::text as child_tenant_id,
    'purchase_needs' as parent_table,
    purchase_needs.id::text as parent_id,
    purchase_needs.tenant_id::text as parent_tenant_id,
    'purchase_order_lines.purchase_need_id references a purchase need from another tenant' as issue
  from purchase_order_lines
  join purchase_needs on purchase_needs.id = purchase_order_lines.purchase_need_id
  where purchase_order_lines.tenant_id <> purchase_needs.tenant_id

  union all

  select
    'purchase_order_lines -> items' as audit_check,
    'purchase_order_lines' as child_table,
    purchase_order_lines.id::text as child_id,
    purchase_order_lines.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'purchase_order_lines.item_id references an item from another tenant' as issue
  from purchase_order_lines
  join items on items.id = purchase_order_lines.item_id
  where purchase_order_lines.tenant_id <> items.tenant_id

  union all

  select
    'goods_receipts -> purchase_orders' as audit_check,
    'goods_receipts' as child_table,
    goods_receipts.id::text as child_id,
    goods_receipts.tenant_id::text as child_tenant_id,
    'purchase_orders' as parent_table,
    purchase_orders.id::text as parent_id,
    purchase_orders.tenant_id::text as parent_tenant_id,
    'goods_receipts.purchase_order_id references a purchase order from another tenant' as issue
  from goods_receipts
  join purchase_orders on purchase_orders.id = goods_receipts.purchase_order_id
  where goods_receipts.tenant_id <> purchase_orders.tenant_id

  union all

  select
    'goods_receipt_lines -> goods_receipts' as audit_check,
    'goods_receipt_lines' as child_table,
    goods_receipt_lines.id::text as child_id,
    goods_receipt_lines.tenant_id::text as child_tenant_id,
    'goods_receipts' as parent_table,
    goods_receipts.id::text as parent_id,
    goods_receipts.tenant_id::text as parent_tenant_id,
    'goods_receipt_lines.goods_receipt_id references a receipt from another tenant' as issue
  from goods_receipt_lines
  join goods_receipts on goods_receipts.id = goods_receipt_lines.goods_receipt_id
  where goods_receipt_lines.tenant_id <> goods_receipts.tenant_id

  union all

  select
    'goods_receipt_lines -> purchase_order_lines' as audit_check,
    'goods_receipt_lines' as child_table,
    goods_receipt_lines.id::text as child_id,
    goods_receipt_lines.tenant_id::text as child_tenant_id,
    'purchase_order_lines' as parent_table,
    purchase_order_lines.id::text as parent_id,
    purchase_order_lines.tenant_id::text as parent_tenant_id,
    'goods_receipt_lines.purchase_order_line_id references a PO line from another tenant' as issue
  from goods_receipt_lines
  join purchase_order_lines
    on purchase_order_lines.id = goods_receipt_lines.purchase_order_line_id
  where goods_receipt_lines.tenant_id <> purchase_order_lines.tenant_id

  union all

  select
    'goods_receipt_lines -> items' as audit_check,
    'goods_receipt_lines' as child_table,
    goods_receipt_lines.id::text as child_id,
    goods_receipt_lines.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'goods_receipt_lines.item_id references an item from another tenant' as issue
  from goods_receipt_lines
  join items on items.id = goods_receipt_lines.item_id
  where goods_receipt_lines.tenant_id <> items.tenant_id

  union all

  select
    'qc_checks -> goods_receipt_lines' as audit_check,
    'qc_checks' as child_table,
    qc_checks.id::text as child_id,
    qc_checks.tenant_id::text as child_tenant_id,
    'goods_receipt_lines' as parent_table,
    goods_receipt_lines.id::text as parent_id,
    goods_receipt_lines.tenant_id::text as parent_tenant_id,
    'qc_checks.goods_receipt_line_id references a receipt line from another tenant' as issue
  from qc_checks
  join goods_receipt_lines
    on goods_receipt_lines.id = qc_checks.goods_receipt_line_id
  where qc_checks.tenant_id <> goods_receipt_lines.tenant_id

  union all

  select
    'qc_checks -> items' as audit_check,
    'qc_checks' as child_table,
    qc_checks.id::text as child_id,
    qc_checks.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'qc_checks.item_id references an item from another tenant' as issue
  from qc_checks
  join items on items.id = qc_checks.item_id
  where qc_checks.tenant_id <> items.tenant_id

  union all

  select
    'production_needs -> items' as audit_check,
    'production_needs' as child_table,
    production_needs.id::text as child_id,
    production_needs.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'production_needs.item_id references an item from another tenant' as issue
  from production_needs
  join items on items.id = production_needs.item_id
  where production_needs.tenant_id <> items.tenant_id

  union all

  select
    'production_needs -> mrp_runs' as audit_check,
    'production_needs' as child_table,
    production_needs.id::text as child_id,
    production_needs.tenant_id::text as child_tenant_id,
    'mrp_runs' as parent_table,
    mrp_runs.id::text as parent_id,
    mrp_runs.tenant_id::text as parent_tenant_id,
    'production_needs.mrp_run_id references an MRP run from another tenant' as issue
  from production_needs
  join mrp_runs on mrp_runs.id = production_needs.mrp_run_id
  where production_needs.tenant_id <> mrp_runs.tenant_id

  union all

  select
    'production_needs -> mrp_run_lines' as audit_check,
    'production_needs' as child_table,
    production_needs.id::text as child_id,
    production_needs.tenant_id::text as child_tenant_id,
    'mrp_run_lines' as parent_table,
    mrp_run_lines.id::text as parent_id,
    mrp_run_lines.tenant_id::text as parent_tenant_id,
    'production_needs.mrp_run_line_id references an MRP run line from another tenant' as issue
  from production_needs
  join mrp_run_lines on mrp_run_lines.id = production_needs.mrp_run_line_id
  where production_needs.tenant_id <> mrp_run_lines.tenant_id

  union all

  select
    'production_orders -> production_needs' as audit_check,
    'production_orders' as child_table,
    production_orders.id::text as child_id,
    production_orders.tenant_id::text as child_tenant_id,
    'production_needs' as parent_table,
    production_needs.id::text as parent_id,
    production_needs.tenant_id::text as parent_tenant_id,
    'production_orders.production_need_id references a production need from another tenant' as issue
  from production_orders
  join production_needs on production_needs.id = production_orders.production_need_id
  where production_orders.tenant_id <> production_needs.tenant_id

  union all

  select
    'production_orders -> items' as audit_check,
    'production_orders' as child_table,
    production_orders.id::text as child_id,
    production_orders.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'production_orders.item_id references an item from another tenant' as issue
  from production_orders
  join items on items.id = production_orders.item_id
  where production_orders.tenant_id <> items.tenant_id

  union all

  select
    'production_components -> production_orders' as audit_check,
    'production_components' as child_table,
    production_components.id::text as child_id,
    production_components.tenant_id::text as child_tenant_id,
    'production_orders' as parent_table,
    production_orders.id::text as parent_id,
    production_orders.tenant_id::text as parent_tenant_id,
    'production_components.production_order_id references a production order from another tenant' as issue
  from production_components
  join production_orders on production_orders.id = production_components.production_order_id
  where production_components.tenant_id <> production_orders.tenant_id

  union all

  select
    'production_components -> items' as audit_check,
    'production_components' as child_table,
    production_components.id::text as child_id,
    production_components.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'production_components.item_id references an item from another tenant' as issue
  from production_components
  join items on items.id = production_components.item_id
  where production_components.tenant_id <> items.tenant_id

  union all

  select
    'warehouse_tasks -> items' as audit_check,
    'warehouse_tasks' as child_table,
    warehouse_tasks.id::text as child_id,
    warehouse_tasks.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'warehouse_tasks.item_id references an item from another tenant' as issue
  from warehouse_tasks
  join items on items.id = warehouse_tasks.item_id
  where warehouse_tasks.tenant_id <> items.tenant_id

  union all

  select
    'warehouse_tasks source -> goods_receipt_lines' as audit_check,
    'warehouse_tasks' as child_table,
    warehouse_tasks.id::text as child_id,
    warehouse_tasks.tenant_id::text as child_tenant_id,
    'goods_receipt_lines' as parent_table,
    goods_receipt_lines.id::text as parent_id,
    goods_receipt_lines.tenant_id::text as parent_tenant_id,
    'warehouse_tasks.source_id references a receipt line from another tenant' as issue
  from warehouse_tasks
  join goods_receipt_lines
    on warehouse_tasks.source_type = 'goods_receipt_line'
    and warehouse_tasks.source_id = goods_receipt_lines.id
  where warehouse_tasks.tenant_id <> goods_receipt_lines.tenant_id

  union all

  select
    'warehouse_tasks source -> production_orders' as audit_check,
    'warehouse_tasks' as child_table,
    warehouse_tasks.id::text as child_id,
    warehouse_tasks.tenant_id::text as child_tenant_id,
    'production_orders' as parent_table,
    production_orders.id::text as parent_id,
    production_orders.tenant_id::text as parent_tenant_id,
    'warehouse_tasks.source_id references a production order from another tenant' as issue
  from warehouse_tasks
  join production_orders
    on warehouse_tasks.source_type = 'production_order'
    and warehouse_tasks.source_id = production_orders.id
  where warehouse_tasks.tenant_id <> production_orders.tenant_id

  union all

  select
    'warehouse_tasks source -> shipping_orders' as audit_check,
    'warehouse_tasks' as child_table,
    warehouse_tasks.id::text as child_id,
    warehouse_tasks.tenant_id::text as child_tenant_id,
    'shipping_orders' as parent_table,
    shipping_orders.id::text as parent_id,
    shipping_orders.tenant_id::text as parent_tenant_id,
    'warehouse_tasks.source_id references a shipment from another tenant' as issue
  from warehouse_tasks
  join shipping_orders
    on warehouse_tasks.source_type = 'shipping_order'
    and warehouse_tasks.source_id = shipping_orders.id
  where warehouse_tasks.tenant_id <> shipping_orders.tenant_id

  union all

  select
    'purchase_payments -> purchase_orders' as audit_check,
    'purchase_payments' as child_table,
    purchase_payments.id::text as child_id,
    purchase_payments.tenant_id::text as child_tenant_id,
    'purchase_orders' as parent_table,
    purchase_orders.id::text as parent_id,
    purchase_orders.tenant_id::text as parent_tenant_id,
    'purchase_payments.purchase_order_id references a purchase order from another tenant' as issue
  from purchase_payments
  join purchase_orders on purchase_orders.id = purchase_payments.purchase_order_id
  where purchase_payments.tenant_id <> purchase_orders.tenant_id

  union all

  select
    'purchase_payments -> suppliers' as audit_check,
    'purchase_payments' as child_table,
    purchase_payments.id::text as child_id,
    purchase_payments.tenant_id::text as child_tenant_id,
    'suppliers' as parent_table,
    suppliers.id::text as parent_id,
    suppliers.tenant_id::text as parent_tenant_id,
    'purchase_payments.supplier_id references a supplier from another tenant' as issue
  from purchase_payments
  join suppliers on suppliers.id = purchase_payments.supplier_id
  where purchase_payments.tenant_id <> suppliers.tenant_id

  union all

  select
    'operation_cases primary object -> operations_orders' as audit_check,
    'operation_cases' as child_table,
    operation_cases.id::text as child_id,
    operation_cases.tenant_id::text as child_tenant_id,
    'operations_orders' as parent_table,
    operations_orders.id::text as parent_id,
    operations_orders.tenant_id::text as parent_tenant_id,
    'operation_cases.primary_object_id references an order from another tenant' as issue
  from operation_cases
  join operations_orders
    on operation_cases.primary_object_type = 'operations_order'
    and operation_cases.primary_object_id = operations_orders.id::text
  where operation_cases.tenant_id <> operations_orders.tenant_id

  union all

  select
    'operation_cases primary object -> purchase_needs' as audit_check,
    'operation_cases' as child_table,
    operation_cases.id::text as child_id,
    operation_cases.tenant_id::text as child_tenant_id,
    'purchase_needs' as parent_table,
    purchase_needs.id::text as parent_id,
    purchase_needs.tenant_id::text as parent_tenant_id,
    'operation_cases.primary_object_id references a purchase need from another tenant' as issue
  from operation_cases
  join purchase_needs
    on operation_cases.primary_object_type = 'purchase_need'
    and operation_cases.primary_object_id = purchase_needs.id::text
  where operation_cases.tenant_id <> purchase_needs.tenant_id

  union all

  select
    'operation_cases primary object -> items' as audit_check,
    'operation_cases' as child_table,
    operation_cases.id::text as child_id,
    operation_cases.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'operation_cases.primary_object_id references an item from another tenant' as issue
  from operation_cases
  join items
    on operation_cases.primary_object_type = 'item'
    and operation_cases.primary_object_id = items.id::text
  where operation_cases.tenant_id <> items.tenant_id

  union all

  select
    'case_events -> operation_cases' as audit_check,
    'case_events' as child_table,
    case_events.id::text as child_id,
    case_events.tenant_id::text as child_tenant_id,
    'operation_cases' as parent_table,
    operation_cases.id::text as parent_id,
    operation_cases.tenant_id::text as parent_tenant_id,
    'case_events.operation_case_id references a case from another tenant' as issue
  from case_events
  join operation_cases on operation_cases.id = case_events.operation_case_id
  where case_events.tenant_id <> operation_cases.tenant_id

  union all

  select
    'operation_user_groups -> operation_users' as audit_check,
    'operation_user_groups' as child_table,
    operation_user_groups.id::text as child_id,
    operation_user_groups.tenant_id::text as child_tenant_id,
    'operation_users' as parent_table,
    operation_users.id::text as parent_id,
    operation_users.tenant_id::text as parent_tenant_id,
    'operation_user_groups.user_id references a user from another tenant' as issue
  from operation_user_groups
  join operation_users on operation_users.id = operation_user_groups.user_id
  where operation_user_groups.tenant_id <> operation_users.tenant_id

  union all

  select
    'operation_user_groups -> operation_groups' as audit_check,
    'operation_user_groups' as child_table,
    operation_user_groups.id::text as child_id,
    operation_user_groups.tenant_id::text as child_tenant_id,
    'operation_groups' as parent_table,
    operation_groups.id::text as parent_id,
    operation_groups.tenant_id::text as parent_tenant_id,
    'operation_user_groups.group_id references a group from another tenant' as issue
  from operation_user_groups
  join operation_groups on operation_groups.id = operation_user_groups.group_id
  where operation_user_groups.tenant_id <> operation_groups.tenant_id

  union all

  select
    'operation_group_roles -> operation_groups' as audit_check,
    'operation_group_roles' as child_table,
    operation_group_roles.id::text as child_id,
    operation_group_roles.tenant_id::text as child_tenant_id,
    'operation_groups' as parent_table,
    operation_groups.id::text as parent_id,
    operation_groups.tenant_id::text as parent_tenant_id,
    'operation_group_roles.group_id references a group from another tenant' as issue
  from operation_group_roles
  join operation_groups on operation_groups.id = operation_group_roles.group_id
  where operation_group_roles.tenant_id <> operation_groups.tenant_id

  union all

  select
    'operation_group_roles -> operation_roles' as audit_check,
    'operation_group_roles' as child_table,
    operation_group_roles.id::text as child_id,
    operation_group_roles.tenant_id::text as child_tenant_id,
    'operation_roles' as parent_table,
    operation_roles.id::text as parent_id,
    operation_roles.tenant_id::text as parent_tenant_id,
    'operation_group_roles.role_id references a role from another tenant' as issue
  from operation_group_roles
  join operation_roles on operation_roles.id = operation_group_roles.role_id
  where operation_group_roles.tenant_id <> operation_roles.tenant_id

  union all

  select
    'inventory_movements -> items' as audit_check,
    'inventory_movements' as child_table,
    inventory_movements.id::text as child_id,
    inventory_movements.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'inventory_movements.item_id references an item from another tenant' as issue
  from inventory_movements
  join items on items.id = inventory_movements.item_id
  where inventory_movements.tenant_id <> items.tenant_id

  union all

  select
    'inventory_movements source -> goods_receipt_lines' as audit_check,
    'inventory_movements' as child_table,
    inventory_movements.id::text as child_id,
    inventory_movements.tenant_id::text as child_tenant_id,
    'goods_receipt_lines' as parent_table,
    goods_receipt_lines.id::text as parent_id,
    goods_receipt_lines.tenant_id::text as parent_tenant_id,
    'inventory_movements.source_id references a receipt line from another tenant' as issue
  from inventory_movements
  join goods_receipt_lines
    on inventory_movements.source_type = 'goods_receipt_line'
    and inventory_movements.source_id = goods_receipt_lines.id::text
  where inventory_movements.tenant_id <> goods_receipt_lines.tenant_id

  union all

  select
    'inventory_movements source -> goods_receipts' as audit_check,
    'inventory_movements' as child_table,
    inventory_movements.id::text as child_id,
    inventory_movements.tenant_id::text as child_tenant_id,
    'goods_receipts' as parent_table,
    goods_receipts.id::text as parent_id,
    goods_receipts.tenant_id::text as parent_tenant_id,
    'inventory_movements.source_id references a receipt from another tenant' as issue
  from inventory_movements
  join goods_receipts
    on inventory_movements.source_type = 'goods_receipt'
    and inventory_movements.source_id = goods_receipts.id::text
  where inventory_movements.tenant_id <> goods_receipts.tenant_id

  union all

  select
    'inventory_movements source -> shipping_order_lines' as audit_check,
    'inventory_movements' as child_table,
    inventory_movements.id::text as child_id,
    inventory_movements.tenant_id::text as child_tenant_id,
    'shipping_order_lines' as parent_table,
    shipping_order_lines.id::text as parent_id,
    shipping_order_lines.tenant_id::text as parent_tenant_id,
    'inventory_movements.source_id references a shipping line from another tenant' as issue
  from inventory_movements
  join shipping_order_lines
    on inventory_movements.source_type = 'shipping_order_line'
    and inventory_movements.source_id = shipping_order_lines.id::text
  where inventory_movements.tenant_id <> shipping_order_lines.tenant_id

  union all

  select
    'inventory_movements source -> shipping_orders' as audit_check,
    'inventory_movements' as child_table,
    inventory_movements.id::text as child_id,
    inventory_movements.tenant_id::text as child_tenant_id,
    'shipping_orders' as parent_table,
    shipping_orders.id::text as parent_id,
    shipping_orders.tenant_id::text as parent_tenant_id,
    'inventory_movements.source_id references a shipment from another tenant' as issue
  from inventory_movements
  join shipping_orders
    on inventory_movements.source_type = 'shipping_order'
    and inventory_movements.source_id = shipping_orders.id::text
  where inventory_movements.tenant_id <> shipping_orders.tenant_id

  union all

  select
    'inventory_movements source -> operations_order_lines' as audit_check,
    'inventory_movements' as child_table,
    inventory_movements.id::text as child_id,
    inventory_movements.tenant_id::text as child_tenant_id,
    'operations_order_lines' as parent_table,
    operations_order_lines.id::text as parent_id,
    operations_order_lines.tenant_id::text as parent_tenant_id,
    'inventory_movements.source_id references an order line from another tenant' as issue
  from inventory_movements
  join operations_order_lines
    on inventory_movements.source_type = 'operations_order_line'
    and inventory_movements.source_id = operations_order_lines.id::text
  where inventory_movements.tenant_id <> operations_order_lines.tenant_id

  union all

  select
    'inventory_movements source -> qc_checks' as audit_check,
    'inventory_movements' as child_table,
    inventory_movements.id::text as child_id,
    inventory_movements.tenant_id::text as child_tenant_id,
    'qc_checks' as parent_table,
    qc_checks.id::text as parent_id,
    qc_checks.tenant_id::text as parent_tenant_id,
    'inventory_movements.source_id references a QC check from another tenant' as issue
  from inventory_movements
  join qc_checks
    on inventory_movements.source_type = 'qc_check'
    and inventory_movements.source_id = qc_checks.id::text
  where inventory_movements.tenant_id <> qc_checks.tenant_id

  union all

  select
    'shipping_orders -> operations_orders' as audit_check,
    'shipping_orders' as child_table,
    shipping_orders.id::text as child_id,
    shipping_orders.tenant_id::text as child_tenant_id,
    'operations_orders' as parent_table,
    operations_orders.id::text as parent_id,
    operations_orders.tenant_id::text as parent_tenant_id,
    'shipping_orders.operations_order_id references an order from another tenant' as issue
  from shipping_orders
  join operations_orders on operations_orders.id = shipping_orders.operations_order_id
  where shipping_orders.tenant_id <> operations_orders.tenant_id

  union all

  select
    'shipping_order_lines -> shipping_orders' as audit_check,
    'shipping_order_lines' as child_table,
    shipping_order_lines.id::text as child_id,
    shipping_order_lines.tenant_id::text as child_tenant_id,
    'shipping_orders' as parent_table,
    shipping_orders.id::text as parent_id,
    shipping_orders.tenant_id::text as parent_tenant_id,
    'shipping_order_lines.shipping_order_id references a shipment from another tenant' as issue
  from shipping_order_lines
  join shipping_orders on shipping_orders.id = shipping_order_lines.shipping_order_id
  where shipping_order_lines.tenant_id <> shipping_orders.tenant_id

  union all

  select
    'shipping_order_lines -> operations_order_lines' as audit_check,
    'shipping_order_lines' as child_table,
    shipping_order_lines.id::text as child_id,
    shipping_order_lines.tenant_id::text as child_tenant_id,
    'operations_order_lines' as parent_table,
    operations_order_lines.id::text as parent_id,
    operations_order_lines.tenant_id::text as parent_tenant_id,
    'shipping_order_lines.operations_order_line_id references an order line from another tenant' as issue
  from shipping_order_lines
  join operations_order_lines
    on operations_order_lines.id = shipping_order_lines.operations_order_line_id
  where shipping_order_lines.tenant_id <> operations_order_lines.tenant_id

  union all

  select
    'shipping_order_lines -> items' as audit_check,
    'shipping_order_lines' as child_table,
    shipping_order_lines.id::text as child_id,
    shipping_order_lines.tenant_id::text as child_tenant_id,
    'items' as parent_table,
    items.id::text as parent_id,
    items.tenant_id::text as parent_tenant_id,
    'shipping_order_lines.item_id references an item from another tenant' as issue
  from shipping_order_lines
  join items on items.id = shipping_order_lines.item_id
  where shipping_order_lines.tenant_id <> items.tenant_id
)
select *
from violations
order by audit_check, child_table, child_id;

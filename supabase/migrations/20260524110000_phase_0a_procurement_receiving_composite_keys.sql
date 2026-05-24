-- Phase 0A tenant hardening, slice 2: Procurement + Receiving + QC.
--
-- Existing single-column foreign keys remain in place. These additive
-- constraints enforce that tenant-owned children reference parents from the
-- same tenant.

alter table mrp_runs
  add constraint mrp_runs_tenant_id_id_key unique (tenant_id, id);

alter table mrp_run_lines
  add constraint mrp_run_lines_tenant_id_id_key unique (tenant_id, id);

alter table purchase_needs
  add constraint purchase_needs_tenant_id_id_key unique (tenant_id, id);

alter table purchase_orders
  add constraint purchase_orders_tenant_id_id_key unique (tenant_id, id);

alter table purchase_order_lines
  add constraint purchase_order_lines_tenant_id_id_key unique (tenant_id, id);

alter table goods_receipts
  add constraint goods_receipts_tenant_id_id_key unique (tenant_id, id);

alter table goods_receipt_lines
  add constraint goods_receipt_lines_tenant_id_id_key unique (tenant_id, id);

alter table qc_checks
  add constraint qc_checks_tenant_id_id_key unique (tenant_id, id);

alter table mrp_runs
  add constraint mrp_runs_tenant_operations_order_fk
  foreign key (tenant_id, operations_order_id)
  references operations_orders(tenant_id, id)
  on delete set null;

alter table mrp_run_lines
  add constraint mrp_run_lines_tenant_mrp_run_fk
  foreign key (tenant_id, mrp_run_id)
  references mrp_runs(tenant_id, id)
  on delete cascade;

alter table mrp_run_lines
  add constraint mrp_run_lines_tenant_item_fk
  foreign key (tenant_id, item_id)
  references items(tenant_id, id)
  on delete restrict;

alter table mrp_run_lines
  add constraint mrp_run_lines_tenant_source_item_fk
  foreign key (tenant_id, source_item_id)
  references items(tenant_id, id)
  on delete set null;

alter table purchase_needs
  add constraint purchase_needs_tenant_item_fk
  foreign key (tenant_id, item_id)
  references items(tenant_id, id)
  on delete restrict;

alter table purchase_needs
  add constraint purchase_needs_tenant_mrp_run_fk
  foreign key (tenant_id, mrp_run_id)
  references mrp_runs(tenant_id, id)
  on delete cascade;

alter table purchase_needs
  add constraint purchase_needs_tenant_mrp_run_line_fk
  foreign key (tenant_id, mrp_run_line_id)
  references mrp_run_lines(tenant_id, id)
  on delete cascade;

alter table purchase_needs
  add constraint purchase_needs_tenant_supplier_fk
  foreign key (tenant_id, supplier_id)
  references suppliers(tenant_id, id)
  on delete set null;

alter table purchase_needs
  add constraint purchase_needs_tenant_source_order_line_fk
  foreign key (tenant_id, source_order_line_id)
  references operations_order_lines(tenant_id, id)
  on delete set null;

alter table purchase_orders
  add constraint purchase_orders_tenant_supplier_fk
  foreign key (tenant_id, supplier_id)
  references suppliers(tenant_id, id)
  on delete restrict;

alter table purchase_order_lines
  add constraint purchase_order_lines_tenant_purchase_order_fk
  foreign key (tenant_id, purchase_order_id)
  references purchase_orders(tenant_id, id)
  on delete cascade;

alter table purchase_order_lines
  add constraint purchase_order_lines_tenant_purchase_need_fk
  foreign key (tenant_id, purchase_need_id)
  references purchase_needs(tenant_id, id)
  on delete restrict;

alter table purchase_order_lines
  add constraint purchase_order_lines_tenant_item_fk
  foreign key (tenant_id, item_id)
  references items(tenant_id, id)
  on delete restrict;

alter table goods_receipts
  add constraint goods_receipts_tenant_purchase_order_fk
  foreign key (tenant_id, purchase_order_id)
  references purchase_orders(tenant_id, id)
  on delete restrict;

alter table goods_receipt_lines
  add constraint goods_receipt_lines_tenant_receipt_fk
  foreign key (tenant_id, goods_receipt_id)
  references goods_receipts(tenant_id, id)
  on delete cascade;

alter table goods_receipt_lines
  add constraint goods_receipt_lines_tenant_purchase_order_line_fk
  foreign key (tenant_id, purchase_order_line_id)
  references purchase_order_lines(tenant_id, id)
  on delete restrict;

alter table goods_receipt_lines
  add constraint goods_receipt_lines_tenant_item_fk
  foreign key (tenant_id, item_id)
  references items(tenant_id, id)
  on delete restrict;

alter table qc_checks
  add constraint qc_checks_tenant_receipt_line_fk
  foreign key (tenant_id, goods_receipt_line_id)
  references goods_receipt_lines(tenant_id, id)
  on delete cascade;

alter table qc_checks
  add constraint qc_checks_tenant_item_fk
  foreign key (tenant_id, item_id)
  references items(tenant_id, id)
  on delete restrict;

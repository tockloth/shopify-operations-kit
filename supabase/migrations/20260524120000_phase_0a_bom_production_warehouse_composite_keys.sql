-- Phase 0A tenant hardening, slice 4: BOM + Production + Warehouse Tasks.
--
-- Existing single-column foreign keys remain in place. These additive
-- constraints enforce tenant-safe relationships where the schema has explicit
-- parent columns. warehouse_tasks.source_type/source_id remains polymorphic
-- and is covered by audit SQL instead of unsafe foreign keys.

alter table boms
  add constraint boms_tenant_id_id_key unique (tenant_id, id);

alter table bom_lines
  add constraint bom_lines_tenant_id_id_key unique (tenant_id, id);

alter table production_needs
  add constraint production_needs_tenant_id_id_key unique (tenant_id, id);

alter table production_orders
  add constraint production_orders_tenant_id_id_key unique (tenant_id, id);

alter table production_components
  add constraint production_components_tenant_id_id_key unique (tenant_id, id);

alter table warehouse_tasks
  add constraint warehouse_tasks_tenant_id_id_key unique (tenant_id, id);

alter table boms
  add constraint boms_tenant_parent_item_fk
  foreign key (tenant_id, parent_item_id)
  references items(tenant_id, id)
  on delete restrict;

alter table bom_lines
  add constraint bom_lines_tenant_bom_fk
  foreign key (tenant_id, bom_id)
  references boms(tenant_id, id)
  on delete cascade;

alter table bom_lines
  add constraint bom_lines_tenant_component_item_fk
  foreign key (tenant_id, component_item_id)
  references items(tenant_id, id)
  on delete restrict;

alter table production_needs
  add constraint production_needs_tenant_item_fk
  foreign key (tenant_id, item_id)
  references items(tenant_id, id)
  on delete restrict;

alter table production_needs
  add constraint production_needs_tenant_mrp_run_fk
  foreign key (tenant_id, mrp_run_id)
  references mrp_runs(tenant_id, id)
  on delete cascade;

alter table production_needs
  add constraint production_needs_tenant_mrp_run_line_fk
  foreign key (tenant_id, mrp_run_line_id)
  references mrp_run_lines(tenant_id, id)
  on delete cascade;

alter table production_orders
  add constraint production_orders_tenant_production_need_fk
  foreign key (tenant_id, production_need_id)
  references production_needs(tenant_id, id)
  on delete set null;

alter table production_orders
  add constraint production_orders_tenant_item_fk
  foreign key (tenant_id, item_id)
  references items(tenant_id, id)
  on delete restrict;

alter table production_components
  add constraint production_components_tenant_production_order_fk
  foreign key (tenant_id, production_order_id)
  references production_orders(tenant_id, id)
  on delete cascade;

alter table production_components
  add constraint production_components_tenant_item_fk
  foreign key (tenant_id, item_id)
  references items(tenant_id, id)
  on delete restrict;

alter table warehouse_tasks
  add constraint warehouse_tasks_tenant_item_fk
  foreign key (tenant_id, item_id)
  references items(tenant_id, id)
  on delete set null;

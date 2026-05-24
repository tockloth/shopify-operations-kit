-- Phase 0A tenant hardening, slice 1.
--
-- This migration intentionally adds composite tenant keys for the first
-- central table block only. Existing single-column foreign keys are left in
-- place; the new constraints add tenant-safe guarantees without relying on
-- constraint-name-specific drops.

alter table items
  add constraint items_tenant_id_id_key unique (tenant_id, id);

alter table suppliers
  add constraint suppliers_tenant_id_id_key unique (tenant_id, id);

alter table supplier_items
  add constraint supplier_items_tenant_id_id_key unique (tenant_id, id);

alter table operations_orders
  add constraint operations_orders_tenant_id_id_key unique (tenant_id, id);

alter table operations_order_lines
  add constraint operations_order_lines_tenant_id_id_key unique (tenant_id, id);

alter table supplier_items
  add constraint supplier_items_tenant_supplier_fk
  foreign key (tenant_id, supplier_id)
  references suppliers(tenant_id, id)
  on delete cascade;

alter table supplier_items
  add constraint supplier_items_tenant_item_fk
  foreign key (tenant_id, item_id)
  references items(tenant_id, id)
  on delete cascade;

alter table operations_order_lines
  add constraint operations_order_lines_tenant_order_fk
  foreign key (tenant_id, operations_order_id)
  references operations_orders(tenant_id, id)
  on delete cascade;

alter table operations_order_lines
  add constraint operations_order_lines_tenant_item_fk
  foreign key (tenant_id, item_id)
  references items(tenant_id, id)
  on delete restrict;

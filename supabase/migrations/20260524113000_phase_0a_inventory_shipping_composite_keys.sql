-- Phase 0A tenant hardening, slice 3: Inventory + Shipping.
--
-- This migration adds tenant-safe constraints only where the relationship is
-- structurally explicit. inventory_movements.source_type/source_id remains
-- polymorphic and is intentionally covered by audit SQL instead of unsafe FKs.

alter table inventory_movements
  add constraint inventory_movements_tenant_id_id_key unique (tenant_id, id);

alter table shipping_orders
  add constraint shipping_orders_tenant_id_id_key unique (tenant_id, id);

alter table shipping_order_lines
  add constraint shipping_order_lines_tenant_id_id_key unique (tenant_id, id);

alter table inventory_movements
  add constraint inventory_movements_tenant_item_fk
  foreign key (tenant_id, item_id)
  references items(tenant_id, id)
  on delete restrict;

alter table shipping_orders
  add constraint shipping_orders_tenant_operations_order_fk
  foreign key (tenant_id, operations_order_id)
  references operations_orders(tenant_id, id)
  on delete cascade;

alter table shipping_order_lines
  add constraint shipping_order_lines_tenant_shipping_order_fk
  foreign key (tenant_id, shipping_order_id)
  references shipping_orders(tenant_id, id)
  on delete cascade;

alter table shipping_order_lines
  add constraint shipping_order_lines_tenant_operations_order_line_fk
  foreign key (tenant_id, operations_order_line_id)
  references operations_order_lines(tenant_id, id)
  on delete restrict;

alter table shipping_order_lines
  add constraint shipping_order_lines_tenant_item_fk
  foreign key (tenant_id, item_id)
  references items(tenant_id, id)
  on delete restrict;

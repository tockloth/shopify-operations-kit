-- Phase 0A tenant hardening, slice 5: Payments, Cases, and Access Control.
--
-- Existing single-column foreign keys remain in place. These additive
-- constraints enforce tenant-safe relationships where the schema has explicit
-- parent columns. operation_cases.primary_object_type/primary_object_id remains
-- polymorphic and is covered by audit SQL instead of unsafe foreign keys.

alter table purchase_payments
  add constraint purchase_payments_tenant_id_id_key unique (tenant_id, id);

alter table operation_cases
  add constraint operation_cases_tenant_id_id_key unique (tenant_id, id);

alter table case_events
  add constraint case_events_tenant_id_id_key unique (tenant_id, id);

alter table operation_users
  add constraint operation_users_tenant_id_id_key unique (tenant_id, id);

alter table operation_groups
  add constraint operation_groups_tenant_id_id_key unique (tenant_id, id);

alter table operation_roles
  add constraint operation_roles_tenant_id_id_key unique (tenant_id, id);

alter table operation_user_groups
  add constraint operation_user_groups_tenant_id_id_key unique (tenant_id, id);

alter table operation_group_roles
  add constraint operation_group_roles_tenant_id_id_key unique (tenant_id, id);

alter table purchase_payments
  add constraint purchase_payments_tenant_purchase_order_fk
  foreign key (tenant_id, purchase_order_id)
  references purchase_orders(tenant_id, id)
  on delete restrict;

alter table purchase_payments
  add constraint purchase_payments_tenant_supplier_fk
  foreign key (tenant_id, supplier_id)
  references suppliers(tenant_id, id)
  on delete set null;

alter table case_events
  add constraint case_events_tenant_operation_case_fk
  foreign key (tenant_id, operation_case_id)
  references operation_cases(tenant_id, id)
  on delete cascade;

alter table operation_user_groups
  add constraint operation_user_groups_tenant_user_fk
  foreign key (tenant_id, user_id)
  references operation_users(tenant_id, id)
  on delete cascade;

alter table operation_user_groups
  add constraint operation_user_groups_tenant_group_fk
  foreign key (tenant_id, group_id)
  references operation_groups(tenant_id, id)
  on delete cascade;

alter table operation_group_roles
  add constraint operation_group_roles_tenant_group_fk
  foreign key (tenant_id, group_id)
  references operation_groups(tenant_id, id)
  on delete cascade;

alter table operation_group_roles
  add constraint operation_group_roles_tenant_role_fk
  foreign key (tenant_id, role_id)
  references operation_roles(tenant_id, id)
  on delete cascade;

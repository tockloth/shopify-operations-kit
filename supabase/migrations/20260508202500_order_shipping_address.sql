alter table operations_orders
  add column if not exists shipping_address_encrypted text;

create index if not exists operations_orders_shipping_address_idx
  on operations_orders(tenant_id)
  where shipping_address_encrypted is not null;

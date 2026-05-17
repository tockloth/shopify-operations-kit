alter table purchase_payments
  add column if not exists exported_at timestamptz,
  add column if not exists export_batch_id text;

create index if not exists purchase_payments_export_idx
  on purchase_payments(tenant_id, exported_at);

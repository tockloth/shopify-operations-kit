create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  shop_domain text not null,
  shop_installation_id uuid references shopify_installations(id) on delete set null,
  tenant_id uuid references tenants(id) on delete set null,
  topic text not null,
  webhook_id text not null,
  resource_gid text,
  status text not null default 'received' check (
    status in ('received', 'processed', 'failed', 'ignored_duplicate')
  ),
  error_message text,
  payload_json jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (webhook_id)
);

create index if not exists webhook_events_tenant_topic_idx
  on webhook_events (tenant_id, topic, received_at desc);

create index if not exists webhook_events_shop_topic_idx
  on webhook_events (shop_domain, topic, received_at desc);

create index if not exists webhook_events_status_idx
  on webhook_events (status, received_at desc);

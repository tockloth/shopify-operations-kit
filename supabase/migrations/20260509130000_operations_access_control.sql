create table if not exists operation_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  display_name text not null,
  password_hash text not null,
  is_active boolean not null default true,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table if not exists operation_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create table if not exists operation_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,
  name text not null,
  resource text not null,
  can_read boolean not null default false,
  can_write boolean not null default false,
  can_execute boolean not null default false,
  can_admin boolean not null default false,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);

create table if not exists operation_user_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references operation_users(id) on delete cascade,
  group_id uuid not null references operation_groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id, group_id)
);

create table if not exists operation_group_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  group_id uuid not null references operation_groups(id) on delete cascade,
  role_id uuid not null references operation_roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (tenant_id, group_id, role_id)
);

create index if not exists operation_users_email_idx
  on operation_users(tenant_id, email);

create index if not exists operation_group_roles_group_idx
  on operation_group_roles(tenant_id, group_id);

create index if not exists operation_user_groups_user_idx
  on operation_user_groups(tenant_id, user_id);

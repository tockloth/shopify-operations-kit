# Supabase Staging Tenant Migration Runbook

## Purpose

This runbook prepares the Supabase staging migration for the Operations Kit tenant-isolation hardening. It is a checklist only. Do not run the remote apply steps until the user explicitly starts the controlled staging apply.

Supabase staging has not yet been changed by the local tenant-hardening work.

## Scope

The local database has already been rebuilt from scratch with `npm run db:reset`, and the tenant audit plus integration tests passed locally.

The staging migration should apply only the tenant-hardening migrations that are not yet on Supabase staging:

1. `20260524103000_phase_0a_tenant_composite_keys.sql`
   - Stammdaten and Orders
   - `items`, `suppliers`, `supplier_items`, `operations_orders`, `operations_order_lines`
   - Locally tested: yes
   - Supabase staging status: pending
2. `20260524110000_phase_0a_procurement_receiving_composite_keys.sql`
   - Procurement, Receiving, and QC
   - `mrp_runs`, `mrp_run_lines`, `purchase_needs`, `purchase_orders`, `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`, `qc_checks`
   - Locally tested: yes
   - Supabase staging status: pending
3. `20260524113000_phase_0a_inventory_shipping_composite_keys.sql`
   - Inventory and Shipping
   - `inventory_movements`, `shipping_orders`, `shipping_order_lines`
   - Locally tested: yes
   - Supabase staging status: pending
4. `20260524120000_phase_0a_bom_production_warehouse_composite_keys.sql`
   - BOM, Production, and Warehouse Tasks
   - `boms`, `bom_lines`, `production_needs`, `production_orders`, `production_components`, `warehouse_tasks`
   - Locally tested: yes
   - Supabase staging status: pending
5. `20260524123000_phase_0a_payments_cases_access_control_composite_keys.sql`
   - Payments, Cases, and Access Control
   - `purchase_payments`, `operation_cases`, `case_events`, `operation_users`, `operation_groups`, `operation_roles`, `operation_user_groups`, `operation_group_roles`
   - Locally tested: yes
   - Supabase staging status: pending

Earlier baseline migrations are assumed to already exist on staging because the Render staging app is live. Verify this with the dry-run step before applying anything.

## Environment Variables

Do not write real credentials into repository files.

Use a shell-only variable for the staging database URL:

```bash
export SUPABASE_STAGING_DATABASE_URL="<staging-postgres-connection-string>"
```

For commands that use the app test/audit tooling, pass it through as `OPERATIONS_KIT_DATABASE_URL`:

```bash
OPERATIONS_KIT_DATABASE_URL="$SUPABASE_STAGING_DATABASE_URL" npm run tenant:audit
```

The connection string should point to the Supabase staging Postgres database, not local Supabase and not production.

## Preflight Audit

Run the tenant integrity audit against staging before applying migrations:

```bash
OPERATIONS_KIT_DATABASE_URL="$SUPABASE_STAGING_DATABASE_URL" npm run tenant:audit
```

Expected result:

```text
(0 rows)
```

If the audit returns any rows, stop. Do not apply the migrations. The returned rows identify existing cross-tenant references that must be repaired or explicitly accepted before constraints are added.

## Dry Run

Ask Supabase CLI which migrations it would apply to staging:

```bash
supabase db push --db-url "$SUPABASE_STAGING_DATABASE_URL" --dry-run
```

Expected result:

- The pending list contains only the tenant-hardening migrations listed in this runbook.
- No old baseline migration unexpectedly appears as pending.

If old baseline migrations appear as pending, stop and inspect staging migration history before applying anything.

## Empty Staging DB With Existing Objects

Current reported staging state:

- Supabase staging is reachable.
- `tenant:audit` against staging returned `0 rows`.
- `supabase migration list --db-url "$SUPABASE_STAGING_DATABASE_URL"` shows local migrations, but no remote migration history.
- Public application tables already exist on staging.
- The application tables are reported empty.
- No orders were imported and no productive Operations Kit data was created.

In this state, a direct `supabase db push --db-url "$SUPABASE_STAGING_DATABASE_URL"` would try to run every migration from the beginning. That can fail because the first migrations use `create table ...` statements for tables that already exist. The target state should be a clean staging database whose schema and migration history are both created by the migration files.

### Remote Objects To Account For

Only application-owned objects in the `public` schema are in scope:

- public tables
- public constraints
- public indexes
- public functions, if any are introduced by migrations
- public triggers, if any are introduced by migrations
- public extension objects only where migrations explicitly create them, for example `pgcrypto`

Do not manually drop or alter Supabase system schemas, including but not limited to:

- `auth`
- `storage`
- `realtime`
- `extensions`
- `graphql`
- `graphql_public`
- `vault`
- `net`
- `supabase_functions`
- `supabase_migrations`

The goal is to let Supabase and the migration engine manage system schemas and migration history.

### Verify Tables Are Empty First

Before choosing any reset strategy, verify there is no staging data to preserve.

Run a row-count check against public application tables. Example SQL:

```sql
select
  schemaname,
  relname as table_name,
  n_live_tup::bigint as estimated_rows
from pg_stat_user_tables
where schemaname = 'public'
order by relname;
```

For an exact check, run counts for the known app tables:

```sql
select 'tenants' as table_name, count(*) from tenants
union all select 'shopify_installations', count(*) from shopify_installations
union all select 'items', count(*) from items
union all select 'suppliers', count(*) from suppliers
union all select 'supplier_items', count(*) from supplier_items
union all select 'operations_orders', count(*) from operations_orders
union all select 'operations_order_lines', count(*) from operations_order_lines
union all select 'operation_customers', count(*) from operation_customers
union all select 'mrp_runs', count(*) from mrp_runs
union all select 'mrp_run_lines', count(*) from mrp_run_lines
union all select 'purchase_needs', count(*) from purchase_needs
union all select 'purchase_orders', count(*) from purchase_orders
union all select 'purchase_order_lines', count(*) from purchase_order_lines
union all select 'goods_receipts', count(*) from goods_receipts
union all select 'goods_receipt_lines', count(*) from goods_receipt_lines
union all select 'qc_checks', count(*) from qc_checks
union all select 'inventory_movements', count(*) from inventory_movements
union all select 'shipping_orders', count(*) from shipping_orders
union all select 'shipping_order_lines', count(*) from shipping_order_lines
union all select 'boms', count(*) from boms
union all select 'bom_lines', count(*) from bom_lines
union all select 'production_needs', count(*) from production_needs
union all select 'production_orders', count(*) from production_orders
union all select 'production_components', count(*) from production_components
union all select 'warehouse_tasks', count(*) from warehouse_tasks
union all select 'purchase_payments', count(*) from purchase_payments
union all select 'privacy_settings', count(*) from privacy_settings
union all select 'operation_cases', count(*) from operation_cases
union all select 'case_events', count(*) from case_events
union all select 'operation_users', count(*) from operation_users
union all select 'operation_groups', count(*) from operation_groups
union all select 'operation_roles', count(*) from operation_roles
union all select 'operation_user_groups', count(*) from operation_user_groups
union all select 'operation_group_roles', count(*) from operation_group_roles;
```

Expected result for the reset/rebuild path:

- every count is `0`
- if any row count is greater than `0`, stop and decide whether that data must be exported or preserved

### Strategy Options

#### Variant A: Supabase Dashboard Reset Or Fresh Staging Database

Use Supabase's Dashboard reset/recreate capability for the staging database or create a fresh staging project/database, then apply migrations from the repository.

Pros:

- cleanest alignment between schema and migration history
- avoids hand-written destructive SQL
- avoids accidentally touching Supabase system schemas
- best fit when the current staging tables are empty and migration history is empty

Cons:

- may require re-entering the new database connection string in Render if a new project/database is created
- requires checking Supabase dashboard availability and plan support

Recommended for the current situation.

#### Variant B: Controlled Drop/Recreate Of Public App Objects

If Dashboard reset is unavailable, use a reviewed SQL cleanup that drops only application-owned objects in `public`, then run migrations.

This is a fallback, not the preferred path.

Rules:

- only touch the `public` schema
- do not touch Supabase system schemas
- do not delete migration history manually unless the chosen command explicitly manages it
- use a transaction if possible
- save the exact SQL before running it

The cleanup must include public tables and any dependent public constraints, indexes, triggers, and functions. Dropping tables with `cascade` can remove dependent public constraints/indexes/triggers, but it must be reviewed before execution.

This runbook intentionally does not include executable drop SQL because remote destructive cleanup should be prepared and approved as its own step.

#### Variant C: Migration Repair / Baseline

`supabase migration repair --db-url "$SUPABASE_STAGING_DATABASE_URL" --status applied ...` can mark migrations as applied in remote migration history.

This is not recommended as the primary path here.

Reason:

- the remote schema was not created by the repository migration engine
- marking all migrations as applied can hide drift between staging schema and local migration files
- the goal is to prove staging can be rebuilt from migrations, not merely to silence the migration history

Use repair/baseline only if a clean reset is impossible and a schema diff confirms staging exactly matches the repository migrations.

### Recommended Reset/Rebuild Path

For the reported state, use Variant A:

1. Confirm `tenant:audit` is still `0 rows`.
2. Confirm all public app table row counts are `0`.
3. Create a Supabase staging backup/snapshot anyway, even if the tables are empty.
4. Use Supabase Dashboard reset/recreate for the staging database, or create a fresh staging database/project.
5. If a new database URL is created, update Render's `OPERATIONS_KIT_DATABASE_URL` after migrations are applied and verified.
6. Run:

```bash
supabase db push --db-url "$SUPABASE_STAGING_DATABASE_URL"
```

7. Verify remote migration history:

```bash
supabase migration list --db-url "$SUPABASE_STAGING_DATABASE_URL"
```

8. Run post-apply audit:

```bash
OPERATIONS_KIT_DATABASE_URL="$SUPABASE_STAGING_DATABASE_URL" npm run tenant:audit
```

9. Run app smoke checks:

- Render `/healthz`
- Shopify embedded app opens
- Settings shows the expected shop/tenant context
- Orders, Products, Procurement, Receiving, Inventory, Logistics, Payments, Cases, and Settings render

Do not run this reset/rebuild path until the user explicitly approves the remote reset.

## Backup And Recovery

Before applying remote migrations, create a staging backup or snapshot.

Preferred options:

- Supabase Dashboard backup/snapshot for the staging project.
- `pg_dump` of the staging database, if direct dump/restore access is available.

Do not store dump files or credentials in the repository.

Recovery expectation:

- If migration apply fails before any schema changes are committed, inspect the error and do not retry blindly.
- If migration apply partially succeeds and staging becomes unusable, restore the Supabase dashboard snapshot or restore the SQL dump with `pg_restore` according to the chosen backup method.
- Keep the exact failed migration name and error output with the incident notes.

## Apply Order

Manual staging apply sequence:

1. Set `SUPABASE_STAGING_DATABASE_URL` in the current shell only.
2. Run preflight audit and confirm `0 rows`.
3. Confirm staging backup/snapshot exists and restore path is known.
4. Run dry-run and confirm only the five tenant-hardening migrations are pending.
5. Apply migrations:

```bash
supabase db push --db-url "$SUPABASE_STAGING_DATABASE_URL"
```

6. Save the terminal output, especially the applied migration list.
7. Run the post-apply audit and checks below.

Do not use `--include-seed`; the local reset confirmed there is no project `supabase/seed.sql`, and this migration step should not create staging test data.

## Post-Apply Checks

Run the tenant audit against staging:

```bash
OPERATIONS_KIT_DATABASE_URL="$SUPABASE_STAGING_DATABASE_URL" npm run tenant:audit
```

Expected result:

```text
(0 rows)
```

Run tenant-isolation test against staging only if the staging database may safely receive test tenants and test rows:

```bash
OPERATIONS_KIT_DATABASE_URL="$SUPABASE_STAGING_DATABASE_URL" npx vitest run tests/integration/tenant-isolation.test.ts
```

Run the Phase 0A scenario test against staging only if it is acceptable to create/modify scenario data in the staging database:

```bash
OPERATIONS_KIT_DATABASE_URL="$SUPABASE_STAGING_DATABASE_URL" npx vitest run tests/integration/operations-kit-scenario.test.ts
```

Then verify the hosted app:

1. Open the Render health endpoint:

```text
https://operations-kit-staging.onrender.com/healthz
```

2. Confirm the response is OK and database is reachable.
3. Open the Shopify embedded app on staging.
4. Open Settings and verify the current shop/tenant context is shown.
5. Spot-check Orders, Products, Procurement, Receiving, Inventory, Logistics, Payments, Cases, and Settings.

## Risk Notes

- These migrations add constraints. If staging already contains cross-tenant references, the migration should fail. That is correct behavior.
- Existing single-column foreign keys remain in place. The new composite foreign keys are additive hardening.
- Polymorphic references remain audit/runtime protected, not hard-FK protected:
  - `inventory_movements.source_type/source_id`
  - `warehouse_tasks.source_type/source_id`
  - `operation_cases.primary_object_type/primary_object_id`
- The integration tests can create staging data. Run them against staging only when that is acceptable.
- Do not run this runbook against production.

## Completion Criteria

The staging migration is ready to be considered complete only when:

- preflight audit was `0 rows`
- backup/snapshot was confirmed
- dry-run showed only expected migrations
- `supabase db push --db-url "$SUPABASE_STAGING_DATABASE_URL"` completed
- post-apply audit was `0 rows`
- chosen staging tests/checks passed
- Render `/healthz` remained healthy
- Shopify embedded app still opened for the staging shop

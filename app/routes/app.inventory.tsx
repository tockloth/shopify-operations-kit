import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { DataTable, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { loadInventoryLedger } from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    inventory: await loadInventoryLedger(context.pool, context.ctx.tenantId),
  };
};

function quantity(value: unknown) {
  return Number(value ?? 0).toLocaleString();
}

function formatDate(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

export default function Inventory() {
  const data = useLoaderData<typeof loader>();
  if (!data.configured || !("inventory" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }
  const inventory = data.inventory ?? {
    balances: [],
    locationBalances: [],
    movements: [],
  };
  const summaryRows = inventory.locationBalances ?? [];
  const balanceByItemId = new Map(
    (inventory.balances ?? []).map((row: any) => [row.id, row]),
  );

  return (
    <s-page heading="Inventory">
      <s-section>
        <div className="kit-toolbar">
          <s-heading>Inventory</s-heading>
          <div className="kit-toolbar-actions">
            <s-link href="/app/inventory">
              <s-button>Refresh</s-button>
            </s-link>
            <Link to="/app/inventory/movements">
              <s-button>Open movements</s-button>
            </Link>
          </div>
        </div>
        <DataTable
          headings={[
            "Item",
            "Location",
            "On hand",
            "Available",
            "Reserved",
            "Planned",
            "Ordered / incoming",
            "QC hold",
            "Last movement",
          ]}
          rows={summaryRows.map((row: any) => {
            const balance = balanceByItemId.get(row.item_id) as any;
            return {
              id: `${row.item_id}-${row.location_code}`,
              href: `/app/inventory/${row.item_id}`,
              cells: [
                <strong>
                  {row.sku} {row.title}
                </strong>,
                row.location_code,
                quantity(row.on_hand_quantity),
                quantity(row.available_quantity),
                quantity(balance?.reserved_quantity),
                quantity(balance?.planned_quantity),
                quantity(balance?.ordered_quantity),
                quantity(row.qc_hold_quantity),
                formatDate(row.last_movement_at),
              ],
            };
          })}
        />
      </s-section>

    </s-page>
  );
}

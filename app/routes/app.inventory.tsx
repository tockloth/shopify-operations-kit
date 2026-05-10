import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
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

export default function Inventory() {
  const data = useLoaderData<typeof loader>();
  if (!data.configured || !("inventory" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }
  const inventory = data.inventory ?? { balances: [], movements: [] };

  return (
    <s-page heading="Inventory">
      <s-section>
        <s-paragraph>
          Shopify remains the system of record for store inventory. Operations
          Kit adds the planning view for trading goods: Physical minus Reserved
          is Available, and Planned is Available plus already ordered supply.
        </s-paragraph>
      </s-section>

      <s-section heading="Trading-goods stock">
        <DataTable
          headings={[
            "Item",
            "Physical",
            "Reserved",
            "Available",
            "Ordered",
            "Planned",
            "Minimum",
            "Lot size",
            "Lead time",
            "Next supplier delivery",
          ]}
          rows={(inventory.balances ?? []).map((row: any) => ({
            id: row.id,
            href: `/app/inventory/${row.id}`,
            cells: [
              <strong>{row.sku} {row.title}</strong>,
              Number(row.physical_quantity).toLocaleString(),
              Number(row.reserved_quantity).toLocaleString(),
              Number(row.available_quantity).toLocaleString(),
              Number(row.ordered_quantity ?? 0).toLocaleString(),
              Number(row.planned_quantity ?? 0).toLocaleString(),
              Number(row.min_inventory_quantity ?? 0).toLocaleString(),
              Number(row.default_order_quantity ?? 1).toLocaleString(),
              `${Number(row.supplier_lead_time_days ?? 0).toLocaleString()} days`,
              row.next_expected_delivery_date ?? "",
            ],
          }))}
        />
      </s-section>

      <s-section heading="Recent ledger movements">
        <DataTable
          headings={["Item", "Movement", "Quantity delta", "Location", "Source"]}
          rows={(inventory.movements ?? []).map((movement: any) => [
            <strong>{movement.sku} {movement.title}</strong>,
            <MoneylessBadge>{movement.movement_type}</MoneylessBadge>,
            Number(movement.quantity_delta).toLocaleString(),
            movement.location_code ?? "",
            `${movement.source_type}`,
          ])}
        />
      </s-section>
    </s-page>
  );
}

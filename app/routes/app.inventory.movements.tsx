import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { loadInventoryLedger } from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) {
    return { configured: false, setupError: context.setupError };
  }

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

function movementLabel(value: unknown) {
  const movement = String(value || "");
  const labels: Record<string, string> = {
    stock_adjustment: "Inventory adjustment",
    reservation: "Reservation",
    reservation_release: "Reservation release",
    purchase_receipt: "Purchase receipt",
    qc_hold: "QC hold",
    putaway: "Putaway",
    quarantine: "Quarantine",
    pick: "Pick",
    pack: "Pack",
    ship: "Ship",
    consume: "Consume",
    produce: "Produce",
    count_adjustment: "Count adjustment",
  };
  return labels[movement] ?? movement.replaceAll("_", " ");
}

function sourceLabel(movement: any) {
  if (movement.source_receipt_id && movement.source_receipt_number) {
    return (
      <Link to={`/app/receiving/${movement.source_receipt_id}`}>
        Receipt {movement.source_receipt_number}
      </Link>
    );
  }

  if (movement.source_type === "goods_receipt_line") return "Receipt line";
  if (movement.source_type === "qc_check") return "QC check";
  if (
    movement.source_type === "manual_adjustment" ||
    movement.source_type === "manual_inventory"
  ) {
    return "Manual adjustment";
  }

  return String(movement.source_type || "");
}

export default function InventoryMovements() {
  const data = useLoaderData<typeof loader>();
  if (!data.configured || !("inventory" in data)) {
    return (
      <SetupBanner
        message={data.setupError ?? "Database setup is incomplete."}
      />
    );
  }

  const movements = data.inventory?.movements ?? [];

  return (
    <s-page heading="Inventory movements">
      <s-section>
        <Link to="/app/inventory">
          <s-button>Back to Inventory</s-button>
        </Link>
      </s-section>

      <s-section heading="Movements">
        <DataTable
          headings={[
            "Item",
            "Quantity",
            "Movement",
            "Location",
            "Source",
            "Booked date",
          ]}
          rows={movements.map((movement: any) => ({
            id: movement.id,
            href: `/app/inventory/${movement.item_id}`,
            cells: [
              <strong>
                {movement.sku} {movement.title}
              </strong>,
              quantity(movement.quantity_delta),
              <MoneylessBadge>
                {movementLabel(movement.movement_type)}
              </MoneylessBadge>,
              movement.location_code ?? "Unassigned",
              sourceLabel(movement),
              formatDate(movement.occurred_at),
            ],
          }))}
        />
      </s-section>
    </s-page>
  );
}

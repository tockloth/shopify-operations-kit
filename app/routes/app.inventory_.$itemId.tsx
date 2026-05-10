import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  loadInventoryItemDetail,
  postInventoryMovement,
} from "../lib/operations-kit.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    detail: await loadInventoryItemDetail(
      context.pool,
      context.ctx.tenantId,
      params.itemId!,
    ),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "postInventoryMovement") {
    await postInventoryMovement(context.pool, context.ctx.tenantId, {
      itemId: params.itemId!,
      movementType: String(form.get("movementType") || "stock_adjustment"),
      quantity: Number(form.get("quantity") || 0),
      locationCode: String(form.get("locationCode") || "MAIN"),
      reference: String(form.get("reference") || ""),
    });
    return { message: "Inventory movement posted." };
  }

  return { message: "No inventory action was performed." };
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

function sourceLabel(value: unknown) {
  const source = String(value || "");
  const labels: Record<string, string> = {
    goods_receipt_line: "Receipt line",
    qc_check: "QC check",
    manual_adjustment: "Manual adjustment",
    manual_inventory: "Manual adjustment",
    scenario_seed: "Opening stock",
    production_order: "Production order",
    shipping_order_line: "Shipping work",
  };
  return labels[source] ?? source.replaceAll("_", " ");
}

export default function InventoryItemDetail() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("detail" in data)) {
    return (
      <SetupBanner
        message={data.setupError ?? "Database setup is incomplete."}
      />
    );
  }

  const detail = data.detail ?? {
    item: null,
    balance: null,
    demand: [],
    incoming: [],
    movements: [],
  };
  const item = detail.item as any;
  const balance = (detail.balance ?? {}) as any;

  if (!item) {
    return (
      <s-page heading="Inventory item not found">
        <s-section>
          <s-link href="/app/inventory">Back to inventory</s-link>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading={`${item.sku} · ${item.title}`}>
      <s-section>
        <s-stack direction="block" gap="base">
          <Link to="/app/inventory">
            <s-button>Back to inventory</s-button>
          </Link>
          <s-paragraph>
            Operational stock position for this product, including demand,
            incoming supply and ledger movements.
          </s-paragraph>
          {actionData?.message ? (
            <s-banner tone="success">{actionData.message}</s-banner>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Stock position">
        <DataTable
          headings={["Physical", "Reserved", "Available", "Ordered", "Planned"]}
          rows={[
            [
              quantity(balance.physical_quantity),
              quantity(balance.reserved_quantity),
              quantity(balance.available_quantity),
              quantity(balance.ordered_quantity),
              quantity(balance.planned_quantity),
            ],
          ]}
        />
      </s-section>

      <s-section heading="Customer reservations">
        {(detail.demand ?? []).length > 0 ? (
          <DataTable
            headings={["Order", "Customer", "Quantity", "Status"]}
            rows={(detail.demand ?? []).map((line: any) => ({
              id: `demand-${line.order_id}`,
              href: `/app/orders/${line.order_id}`,
              cells: [
                <strong>{line.order_name}</strong>,
                line.customer_display_name ?? "No customer",
                `${quantity(line.quantity)} ${line.unit}`,
                <MoneylessBadge>{line.status}</MoneylessBadge>,
              ],
            }))}
          />
        ) : (
          <s-paragraph>No customer reservations.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Incoming purchase orders">
        {(detail.incoming ?? []).length > 0 ? (
          <DataTable
            headings={[
              "PO",
              "Supplier",
              "Quantity",
              "Expected delivery",
              "Status",
            ]}
            rows={(detail.incoming ?? []).map((line: any) => ({
              id: `incoming-${line.purchase_order_id}`,
              href: `/app/procurement?purchaseOrderId=${line.purchase_order_id}`,
              cells: [
                <strong>{line.display_number}</strong>,
                line.supplier_name,
                `${quantity(line.quantity)} ${line.unit}`,
                line.expected_delivery_date ?? "",
                <MoneylessBadge>{line.purchase_order_status}</MoneylessBadge>,
              ],
            }))}
          />
        ) : (
          <s-paragraph>No incoming purchase orders.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Ledger movements">
        {(detail.movements ?? []).length > 0 ? (
          <DataTable
            headings={["Date", "Movement", "Quantity", "Location", "Source"]}
            rows={(detail.movements ?? []).map((movement: any) => [
              formatDate(movement.occurred_at),
              <MoneylessBadge>
                {movementLabel(movement.movement_type)}
              </MoneylessBadge>,
              quantity(movement.quantity_delta),
              movement.location_code ?? "Unassigned",
              sourceLabel(movement.source_type),
            ])}
          />
        ) : (
          <s-paragraph>No ledger movements.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

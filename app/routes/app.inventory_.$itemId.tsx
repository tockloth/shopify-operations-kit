import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  completeReceiptLineQc,
  loadInventoryItemDetail,
  putawayReceiptLine,
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

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "completeLineQc") {
    const result = await completeReceiptLineQc(context.pool, context.ctx.tenantId, {
      goodsReceiptLineId: String(form.get("goodsReceiptLineId")),
      acceptedQuantity: Number(form.get("acceptedQuantity") || 0),
      rejectedQuantity: Number(form.get("rejectedQuantity") || 0),
      notes: String(form.get("notes") || ""),
    });
    return {
      message: `QC completed: ${result.accepted} accepted, ${result.rejected} quarantined.`,
    };
  }

  if (intent === "putawayReceiptLine") {
    const result = await putawayReceiptLine(
      context.pool,
      context.ctx.tenantId,
      String(form.get("goodsReceiptLineId")),
    );
    if (result.putaway <= 0) {
      return { message: "No putaway was performed for this receipt line." };
    }
    return {
      message: "Putaway completed. Accepted quantity was booked into inventory.",
    };
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

function movementReason(movement: any) {
  if (
    movement.movement_type === "putaway" &&
    movement.source_type === "goods_receipt_line"
  ) {
    return "Putaway from receipt";
  }
  if (
    movement.movement_type === "qc_hold" &&
    movement.source_type === "goods_receipt_line"
  ) {
    return "Received into QC hold";
  }
  if (movement.movement_type === "quarantine" && movement.source_type === "qc_check") {
    return "Rejected during QC";
  }
  if (movement.movement_type === "reservation") return "Reserved for customer order";
  if (movement.movement_type === "ship") return "Shipped to customer";
  return movementLabel(movement.movement_type);
}

function MovementSource({ movement }: { movement: any }) {
  const hasTrace = Boolean(
    movement.source_receipt_id ||
      movement.source_purchase_order_id ||
      movement.source_order_line_id,
  );

  if (!hasTrace) {
    return <s-text>{sourceLabel(movement.source_type)}</s-text>;
  }

  return (
    <s-stack direction="block" gap="small">
      {movement.source_receipt_id ? (
        <s-link href={`/app/receiving/${movement.source_receipt_id}`}>
          {movement.source_receipt_number ?? "Source receipt"}
        </s-link>
      ) : null}
      {movement.source_purchase_order_id ? (
        <s-link href={`/app/procurement/${movement.source_purchase_order_id}`}>
          {movement.source_purchase_order_number ?? "Source PO"}
        </s-link>
      ) : null}
      {movement.source_order_line_id ? (
        <s-link href={`/app/order-lines/${movement.source_order_line_id}`}>
          {movement.source_order_name
            ? `${movement.source_order_name} order line`
            : "Source order line"}
        </s-link>
      ) : null}
      {movement.source_order_line_sku || movement.source_order_line_title ? (
        <s-text>
          {movement.source_order_line_sku} {movement.source_order_line_title}
        </s-text>
      ) : null}
    </s-stack>
  );
}

function qcLabel(line: any) {
  if (!line.qc_status) return "Not required";
  if (line.qc_result) return `${line.qc_status} · ${line.qc_result}`;
  return `${line.qc_status} · pending`;
}

function putawayLabel(line: any) {
  if (line.status === "accepted") return "Ready";
  if (line.status === "putaway_done") return "Done";
  return "Waiting for QC";
}

function orderLineNextAction(line: any, balance: any) {
  const physical = Number(balance?.physical_quantity ?? 0);
  const reserved = Number(balance?.reserved_quantity ?? 0);
  const required = Number(line.quantity ?? 0);
  if (physical >= required && physical >= reserved && reserved > 0) {
    return "Open Logistics";
  }
  if (physical >= required) return "Stock available";
  return "Waiting for stock";
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
    receivingWork: [],
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
          <div className="kit-toolbar">
            <Link to="/app/inventory">
              <s-button>Back to Inventory</s-button>
            </Link>
            <div className="kit-toolbar-actions">
              <Link to={`/app/items/${item.id}`}>
                <s-button>Open Product</s-button>
              </Link>
              <Link to="/app/inventory/movements">
                <s-button>Open Movements</s-button>
              </Link>
            </div>
          </div>
          {actionData?.message ? (
            <s-banner tone="success">{actionData.message}</s-banner>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Inventory">
        <DataTable
          headings={[
            "On hand",
            "Reserved / needed",
            "Available",
            "Ordered / incoming",
            "Planned",
          ]}
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

      <s-section heading="Inventory work">
        {(detail.receivingWork ?? []).length > 0 ? (
          <DataTable
            headings={[
              "Receipt",
              "Supplier",
              "Received",
              "QC",
              "Putaway",
              "Next action",
            ]}
            rows={(detail.receivingWork ?? []).map((line: any) => [
              <s-link href={`/app/receiving/${line.receipt_id}`}>
                {line.receipt_number}
              </s-link>,
              line.supplier_name,
              `${quantity(line.received_quantity)} ${line.unit}`,
              qcLabel(line),
              putawayLabel(line),
              line.status === "qc_hold" ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="completeLineQc" />
                  <input type="hidden" name="goodsReceiptLineId" value={line.id} />
                  <input
                    type="hidden"
                    name="acceptedQuantity"
                    value={Number(line.received_quantity ?? 0)}
                  />
                  <input type="hidden" name="rejectedQuantity" value="0" />
                  <s-button type="submit">Complete QC</s-button>
                </Form>
              ) : line.status === "accepted" ? (
                <Form method="post">
                  <input
                    type="hidden"
                    name="intent"
                    value="putawayReceiptLine"
                  />
                  <input type="hidden" name="goodsReceiptLineId" value={line.id} />
                  <s-button variant="primary" type="submit">
                    Put away to inventory
                  </s-button>
                </Form>
              ) : (
                <s-link href={`/app/receiving/${line.receipt_id}`}>
                  Open Receipt
                </s-link>
              ),
            ])}
          />
        ) : (
          <s-paragraph>No open QC or putaway work for this item.</s-paragraph>
        )}
      </s-section>

      <details className="kit-compact-disclosure" open>
        <summary>Open orders / reservations</summary>
        {(detail.demand ?? []).length > 0 ? (
          <DataTable
            headings={["Order", "Order Line", "Customer", "Quantity", "Status", "Next action"]}
            rows={(detail.demand ?? []).map((line: any) => ({
              id: `demand-${line.order_id}`,
              href: `/app/orders/${line.order_id}`,
              cells: [
                <strong>{line.order_name}</strong>,
                <s-link href={`/app/order-lines/${line.order_line_id}`}>
                  Open line
                </s-link>,
                line.customer_display_name ?? "No customer",
                `${quantity(line.quantity)} ${line.unit}`,
                <MoneylessBadge>{line.status}</MoneylessBadge>,
                orderLineNextAction(line, balance) === "Open Logistics" ? (
                  <s-link href="/app/logistics">Open Logistics</s-link>
                ) : (
                  orderLineNextAction(line, balance)
                ),
              ],
            }))}
          />
        ) : (
          <s-paragraph>No customer reservations.</s-paragraph>
        )}
      </details>

      <details className="kit-compact-disclosure" open>
        <summary>Incoming purchase orders</summary>
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
              href: `/app/procurement/${line.purchase_order_id}`,
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
      </details>

      <details className="kit-compact-disclosure">
        <summary>Ledger movements</summary>
        {(detail.movements ?? []).length > 0 ? (
          <DataTable
            headings={[
              "Date",
              "Movement",
              "Quantity",
              "Location",
              "Business reason",
              "Source",
            ]}
            rows={(detail.movements ?? []).map((movement: any) => [
              formatDate(movement.occurred_at),
              <MoneylessBadge>
                {movementLabel(movement.movement_type)}
              </MoneylessBadge>,
              quantity(movement.quantity_delta),
              movement.location_code ?? "Unassigned",
              movementReason(movement),
              <MovementSource movement={movement} />,
            ])}
          />
        ) : (
          <s-paragraph>No ledger movements.</s-paragraph>
        )}
      </details>
    </s-page>
  );
}

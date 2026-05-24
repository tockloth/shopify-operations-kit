import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  completeReceiptLineQc,
  loadReceiptDetail,
  putawayReceiptLine,
} from "../lib/operations-kit.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    detail: await loadReceiptDetail(
      context.pool,
      context.ctx.tenantId,
      params.receiptId!,
    ),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent"));

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

  return { message: "No action was performed." };
};

function formatDate(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function formatDateTime(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatQuantity(value: unknown) {
  return Number(value ?? 0).toLocaleString();
}

function formatQuantityWithUnit(value: unknown, unit?: string | null) {
  return `${formatQuantity(value)} ${unit ?? "pcs"}`;
}

function sumQuantity(lines: any[], field: string) {
  return lines.reduce((sum, line) => sum + Number(line[field] ?? 0), 0);
}

function receiptNextAction(receipt: any, lines: any[]) {
  if (receipt.status === "closed") return "Complete / closed";
  if (
    lines.some(
      (line) =>
        line.qc_status === "open" ||
        line.qc_status === "in_progress" ||
        line.status === "qc_hold",
    )
  ) {
    return "QC required";
  }
  if (lines.some((line) => line.status === "accepted")) {
    return "Putaway pending";
  }
  return "Review";
}

function lineNextAction(line: any) {
  if (
    line.qc_status === "open" ||
    line.qc_status === "in_progress" ||
    line.status === "qc_hold"
  ) {
    return "Complete QC";
  }
  if (line.status === "accepted") return "Put away to inventory";
  if (line.status === "putaway_done") return "Inventory updated";
  if (line.status === "rejected") return "No receiving action open";
  return "Review";
}

function qcLabel(line: any) {
  if (!line.qc_status) return "Not required";
  if (line.qc_result) return `${line.qc_status} · ${line.qc_result}`;
  return `${line.qc_status} · pending`;
}

function putawayLabel(line: any) {
  if (line.status === "putaway_done") return "Done";
  if (line.status === "accepted") {
    return line.putaway_task_status
      ? `${line.putaway_task_status} task`
      : "Ready";
  }
  if (line.status === "rejected") return "Not required";
  return "Waiting for QC";
}

function sourceLabelForLine(line: any) {
  if (line.source_order_line_id) return "Order Line";
  if (line.source_order_id) return "Order";
  return "Item-level planning";
}

function sourceLabel(movement: any) {
  if (movement.source_type === "goods_receipt_line") return "Receipt line";
  if (movement.source_type === "qc_check") return "QC check";
  return movement.source_type;
}

export default function ReceiptDetail() {
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
    receipt: null,
    lines: [],
    inventoryMovements: [],
  };
  const receipt = detail.receipt as any;
  if (!receipt) {
    return (
      <s-page heading="Receipt not found">
        <s-section>
          <s-stack direction="inline" gap="small">
            <s-link href="/app/receiving">Back to Receiving</s-link>
            <s-link href="/app/procurement">Back to Procurement</s-link>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const qcLines = (detail.lines ?? []).filter(
    (line: any) =>
      line.qc_status === "open" || line.qc_status === "in_progress",
  );
  const putawayLines = (detail.lines ?? []).filter(
    (line: any) => line.status === "accepted",
  );
  const inventoryMovements = (detail.inventoryMovements ?? []) as any[];
  const receiptLines = (detail.lines ?? []) as any[];
  const totals = {
    ordered: sumQuantity(receiptLines, "ordered_quantity"),
    received: sumQuantity(receiptLines, "received_quantity"),
    accepted: sumQuantity(receiptLines, "accepted_quantity"),
    rejected: sumQuantity(receiptLines, "rejected_quantity"),
    putaway: sumQuantity(receiptLines, "putaway_quantity"),
  };
  const summaryUnit = receiptLines[0]?.unit ?? "pcs";
  const earliestExpectedDate = receiptLines
    .map((line: any) => line.expected_delivery_date)
    .filter(Boolean)
    .sort()[0];

  return (
    <s-page heading={`Receipt ${receipt.receipt_number}`}>
      <s-section>
        <s-stack direction="block" gap="small">
          <s-link href="/app/receiving">Back to Receiving</s-link>
          {actionData?.message ? (
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-paragraph>{actionData.message}</s-paragraph>
            </s-box>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Receipt summary">
        <DataTable
          headings={[
            "Receipt",
            "Purchase Order",
            "Supplier",
            "Status",
            "Expected",
            "Received at",
            "Next action",
          ]}
          rows={[
            [
              <strong>{receipt.receipt_number}</strong>,
              <s-link href={`/app/procurement/${receipt.purchase_order_id}`}>
                {receipt.purchase_order_number}
              </s-link>,
              `${receipt.supplier_name}${receipt.supplier_email ? ` (${receipt.supplier_email})` : ""}`,
              <MoneylessBadge>{receipt.status}</MoneylessBadge>,
              formatDate(earliestExpectedDate) || "Not set",
              formatDate(receipt.received_at ?? receipt.created_at),
              receiptNextAction(receipt, detail.lines ?? []),
            ],
          ]}
        />
      </s-section>

      <s-section heading="Quantity summary">
        <DataTable
          headings={["Ordered", "Received", "Accepted", "Rejected", "Put away"]}
          rows={[
            [
              formatQuantityWithUnit(totals.ordered, summaryUnit),
              formatQuantityWithUnit(totals.received, summaryUnit),
              formatQuantityWithUnit(totals.accepted, summaryUnit),
              formatQuantityWithUnit(totals.rejected, summaryUnit),
              formatQuantityWithUnit(totals.putaway, summaryUnit),
            ],
          ]}
        />
      </s-section>

      <s-section heading="Receipt lines">
        <DataTable
          headings={[
            "Item",
            "Ordered",
            "Received",
            "Accepted",
            "Rejected",
            "Put away",
            "QC",
            "Putaway",
            "Source",
            "Next action",
          ]}
          rows={(detail.lines ?? []).map((line: any) => [
            <s-stack direction="block" gap="small">
              <strong>
                {line.sku} {line.title}
              </strong>
              <s-link href={`/app/inventory/${line.item_id}`}>
                Open inventory
              </s-link>
            </s-stack>,
            formatQuantityWithUnit(line.ordered_quantity, line.unit),
            formatQuantityWithUnit(line.received_quantity, line.unit),
            formatQuantityWithUnit(line.accepted_quantity, line.unit),
            formatQuantityWithUnit(line.rejected_quantity, line.unit),
            formatQuantityWithUnit(line.putaway_quantity, line.unit),
            qcLabel(line),
            putawayLabel(line),
            <s-stack direction="block" gap="small">
              <MoneylessBadge>{sourceLabelForLine(line)}</MoneylessBadge>
              <s-link href={`/app/procurement/${receipt.purchase_order_id}`}>
                PO line
              </s-link>
              {line.source_order_line_id ? (
                <s-link href={`/app/order-lines/${line.source_order_line_id}`}>
                  {line.source_order_name
                    ? `${line.source_order_name} order line`
                    : "Source order line"}
                </s-link>
              ) : line.source_order_id ? (
                <s-link href={`/app/orders/${line.source_order_id}`}>
                  {line.source_order_name ?? "Source order"}
                </s-link>
              ) : null}
              {line.need_explanation ? (
                <s-text>{line.need_explanation}</s-text>
              ) : null}
            </s-stack>,
            <s-stack direction="block" gap="small">
              <MoneylessBadge>{line.status}</MoneylessBadge>
              <s-text>{lineNextAction(line)}</s-text>
            </s-stack>,
          ])}
        />
      </s-section>

      {qcLines.length > 0 ? (
        <s-section heading="QC actions">
          <s-stack direction="block" gap="base">
            {qcLines.map((line: any) => (
              <s-box
                key={line.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <Form method="post">
                  <input type="hidden" name="intent" value="completeLineQc" />
                  <input
                    type="hidden"
                    name="goodsReceiptLineId"
                    value={line.id}
                  />
                  <s-stack direction="block" gap="base">
                    <s-heading>
                      QC · {line.sku} {line.title}
                    </s-heading>
                    <s-grid grid-template-columns="1fr 1fr" gap="base">
                      <s-number-field
                        label="Accepted quantity"
                        name="acceptedQuantity"
                        min={0}
                        step={1}
                        value={String(line.received_quantity)}
                      ></s-number-field>
                      <s-number-field
                        label="Rejected quantity"
                        name="rejectedQuantity"
                        min={0}
                        step={1}
                        value="0"
                      ></s-number-field>
                    </s-grid>
                    <s-text-field label="Notes" name="notes"></s-text-field>
                    <s-button type="submit">Complete QC</s-button>
                  </s-stack>
                </Form>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      ) : null}

      {putawayLines.length > 0 ? (
        <s-section heading="Putaway / Einlagerung actions">
          <s-paragraph>
            Accepted goods are booked into inventory when they are put away.
          </s-paragraph>
          <s-stack direction="block" gap="base">
            {putawayLines.map((line: any) => (
              <s-box
                key={line.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <Form method="post">
                  <input
                    type="hidden"
                    name="intent"
                    value="putawayReceiptLine"
                  />
                  <input
                    type="hidden"
                    name="goodsReceiptLineId"
                    value={line.id}
                  />
                  <s-stack direction="block" gap="small">
                    <s-heading>
                      Putaway / Einlagerung · {line.sku} {line.title}
                    </s-heading>
                    <s-paragraph>
                      {Number(line.accepted_quantity).toLocaleString()}{" "}
                      {line.unit} ready to book into MAIN inventory.
                    </s-paragraph>
                    <s-button variant="primary" type="submit">
                      Put away to inventory
                    </s-button>
                  </s-stack>
                </Form>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      ) : null}

      {inventoryMovements.length > 0 ? (
        <s-section heading="Inventory booking outcome">
          <DataTable
            headings={[
              "Item",
              "Quantity",
              "Movement",
              "Location",
              "Booked",
              "Source",
              "Open inventory",
            ]}
            rows={inventoryMovements.map((movement: any) => [
              <strong>
                {movement.sku} {movement.title}
              </strong>,
              formatQuantity(movement.quantity_delta),
              movement.movement_type,
              movement.location_code ?? "No location",
              formatDateTime(movement.occurred_at),
              sourceLabel(movement),
              <s-link href={`/app/inventory/${movement.item_id}`}>
                Open inventory
              </s-link>,
            ])}
          />
        </s-section>
      ) : null}
    </s-page>
  );
}

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  createGoodsReceiptForPurchaseOrder,
  loadPurchaseOrderDetail,
  reopenPurchaseOrderForEditing,
  transitionPurchaseOrder,
  updatePurchaseOrderLinePricing,
} from "../lib/operations-kit.server";

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  const purchaseOrderId = params.purchaseOrderId;
  if (!purchaseOrderId) {
    return {
      configured: true,
      purchaseOrderDetail: { order: null, lines: [], receipts: [] },
    };
  }

  return {
    configured: true,
    purchaseOrderDetail: await loadPurchaseOrderDetail(
      context.pool,
      context.ctx.tenantId,
      purchaseOrderId,
    ),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "poStatus") {
    try {
      await transitionPurchaseOrder(
        context.pool,
        context.ctx.tenantId,
        String(form.get("purchaseOrderId")),
        String(form.get("status")) as
          | "pending_approval"
          | "approved"
          | "sent"
          | "acknowledged"
          | "cancelled",
      );
      return { message: "Purchase order status updated." };
    } catch (error) {
      return {
        message:
          error instanceof Error
            ? error.message
            : "Purchase order status could not be updated.",
      };
    }
  }

  if (intent === "reopenForEditing") {
    try {
      await reopenPurchaseOrderForEditing(
        context.pool,
        context.ctx.tenantId,
        String(form.get("purchaseOrderId")),
      );
      return {
        message: "Purchase Order returned to PO created. Update terms, then approve again.",
      };
    } catch (error) {
      return {
        message:
          error instanceof Error
            ? error.message
            : "Purchase Order could not be released for editing.",
      };
    }
  }

  if (intent === "createGoodsReceipt") {
    const result = await createGoodsReceiptForPurchaseOrder(
      context.pool,
      context.ctx.tenantId,
      String(form.get("purchaseOrderId")),
    );

    if (!result.receiptId) {
      return {
        message:
          "Goods Receipt could not be created. The Purchase Order must be supplier acknowledged first.",
      };
    }

    return redirect(`/app/receiving/${result.receiptId}`);
  }

  if (intent === "updateLinePricing") {
    try {
      await updatePurchaseOrderLinePricing(context.pool, context.ctx.tenantId, {
        purchaseOrderLineId: String(form.get("purchaseOrderLineId")),
        quantity: Number(form.get("quantity")),
        unitPrice: Number(form.get("unitPrice")),
        currencyCode: String(form.get("currencyCode") || "EUR"),
        expectedDeliveryDate: String(form.get("expectedDeliveryDate") || ""),
      });
      return { message: "Purchase Order line terms updated." };
    } catch (error) {
      return {
        message:
          error instanceof Error
            ? error.message
            : "Purchase Order line price could not be updated.",
      };
    }
  }

  return { message: "No action was performed." };
};

function purchaseOrderBusinessStatus(po: any) {
  if (po.status === "cancelled") return "cancelled";
  if (po.receipt_status === "closed") return "Inventory booked";
  if (po.receipt_status === "putaway_pending") return "Putaway pending";
  if (po.receipt_status === "qc_required" || po.receipt_status === "posted")
    return "Receiving / QC";
  if (po.status === "acknowledged") return "Awaiting receipt";
  if (po.status === "sent") return "Sent to supplier";
  if (po.status === "approved") return "PO approved";
  return "Purchase Order created";
}

type BadgeTone =
  | "info"
  | "auto"
  | "neutral"
  | "success"
  | "caution"
  | "warning"
  | "critical";

function purchaseOrderStatusTone(status: string): BadgeTone {
  if (status === "Inventory booked") return "success";
  if (
    status === "Sent to supplier" ||
    status === "Awaiting receipt" ||
    status === "Receiving / QC"
  )
    return "info";
  if (status === "cancelled") return "critical";
  return "warning";
}

function formatDate(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function hasUsablePrice(line: any) {
  return line.unit_price != null && Number(line.unit_price) > 0;
}

function formatLineUnitPrice(line: any) {
  if (!hasUsablePrice(line)) return "No price";
  return `${Number(line.unit_price).toLocaleString()} ${line.currency_code ?? "EUR"}`;
}

function formatLineValue(line: any) {
  if (!hasUsablePrice(line)) return "Not calculated";
  return `${(
    Number(line.quantity ?? 0) * Number(line.unit_price)
  ).toLocaleString()} ${line.currency_code ?? "EUR"}`;
}

function formatQuantity(value: unknown, unit?: string | null) {
  const quantity = Number(value ?? 0);
  return `${quantity.toLocaleString()} ${unit ?? "pcs"}`;
}

function lineValue(line: any) {
  if (!hasUsablePrice(line)) return null;
  return Number(line.quantity ?? 0) * Number(line.unit_price);
}

function formatAmount(value: number | null, currencyCode: string) {
  if (value == null) return "Not calculated";
  return `${value.toLocaleString()} ${currencyCode}`;
}

function receiptLineStatusLabel(status: string | null | undefined) {
  if (status === "putaway_done") return "Put away";
  if (status === "accepted") return "Accepted";
  if (status === "rejected") return "Rejected";
  if (status === "qc_hold") return "QC hold";
  if (status === "received") return "Received";
  return "Not received";
}

function purchaseOrderNextAction(
  order: any,
  hasOpenReceipt: boolean,
  hasMissingPrices: boolean,
  latestReceipt: any,
) {
  if (latestReceipt?.status === "closed") return "Continue with Inventory / Logistics";
  if (latestReceipt?.status === "putaway_pending") return "Put away to inventory";
  if (latestReceipt?.status === "posted" || latestReceipt?.status === "qc_required")
    return "Complete QC";
  if (order.status === "acknowledged" && !hasOpenReceipt) return "Create Goods Receipt";
  if (order.status === "sent") return "Supplier acknowledged";
  if (order.status === "approved") return "Sent to supplier";
  if ((order.status === "draft" || order.status === "pending_approval") && hasMissingPrices)
    return "Enter line terms";
  if (order.status === "draft" || order.status === "pending_approval") return "Approve";
  return "Review";
}

function lineNextAction(line: any, order: any, hasOpenReceipt: boolean) {
  if (line.receipt_line_status === "putaway_done") return "Receiving complete";
  if (line.receipt_line_status === "accepted") return "Put away to inventory";
  if (line.receipt_line_status === "received" || line.receipt_line_status === "qc_hold")
    return "Complete QC";
  if (line.receipt_id) return "Open Goods Receipt";
  if (order.status === "acknowledged" && !hasOpenReceipt) return "Create Goods Receipt";
  if (order.status === "sent") return "Supplier acknowledged";
  if (order.status === "approved") return "Sent to supplier";
  if (!hasUsablePrice(line)) return "Enter line terms";
  if (order.status === "draft" || order.status === "pending_approval") return "Approve";
  return "Review";
}

function SourceCell({ line }: { line: any }) {
  return (
    <s-stack direction="block" gap="small">
      <s-text>{line.purchase_need_id ? `Purchase Need ${String(line.purchase_need_id).slice(0, 8)}` : "No Purchase Need"}</s-text>
      {line.source_order_line_id ? (
        <Link to={`/app/order-lines/${line.source_order_line_id}`}>
          {line.source_order_name ? `${line.source_order_name} line` : "Open source order line"}
        </Link>
      ) : line.source_order_id ? (
        <Link to={`/app/orders/${line.source_order_id}`}>
          {line.source_order_name ?? "Open source order"}
        </Link>
      ) : (
        <s-text>Item-level planning</s-text>
      )}
      {line.source_line_sku || line.source_line_title ? (
        <s-text>
          {line.source_line_sku} {line.source_line_title}
        </s-text>
      ) : null}
    </s-stack>
  );
}

function NeedReasonCell({ line }: { line: any }) {
  return (
    <s-stack direction="block" gap="small">
      <s-text>{line.need_explanation ?? "No planning reason stored."}</s-text>
      <s-text>
        Demand {formatQuantity(line.demand_quantity, line.unit)} / Available{" "}
        {formatQuantity(line.available_quantity, line.unit)} / Short{" "}
        {formatQuantity(line.shortage_quantity, line.unit)}
      </s-text>
      <MoneylessBadge>{line.recommended_action ?? "review"}</MoneylessBadge>
    </s-stack>
  );
}

function ReceivingCell({ line }: { line: any }) {
  if (!line.receipt_id) {
    return <MoneylessBadge tone="warning">Not received</MoneylessBadge>;
  }

  return (
    <s-stack direction="block" gap="small">
      <MoneylessBadge>{receiptLineStatusLabel(line.receipt_line_status)}</MoneylessBadge>
      <Link to={`/app/receiving/${line.receipt_id}`}>
        {line.receipt_number ?? "Open Goods Receipt"}
      </Link>
      <s-text>
        Received {formatQuantity(line.received_quantity, line.unit)} / Accepted{" "}
        {formatQuantity(line.accepted_quantity, line.unit)} / Rejected{" "}
        {formatQuantity(line.rejected_quantity, line.unit)}
      </s-text>
    </s-stack>
  );
}

function StatusAction({
  orderId,
  status,
  label,
  primary,
  disabled,
}: {
  orderId: string;
  status: "pending_approval" | "approved" | "sent" | "acknowledged";
  label: string;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="poStatus" />
      <input type="hidden" name="purchaseOrderId" value={orderId} />
      <input type="hidden" name="status" value={status} />
      <s-button
        variant={primary ? "primary" : undefined}
        type="submit"
        disabled={disabled}
      >
        {label}
      </s-button>
    </Form>
  );
}

export default function PurchaseOrderDetail() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (
    !data.configured ||
    !("purchaseOrderDetail" in data) ||
    !data.purchaseOrderDetail
  ) {
    return (
      <SetupBanner
        message={data.setupError ?? "Database setup is incomplete."}
      />
    );
  }

  const detail = data.purchaseOrderDetail;
  const order = detail.order;
  const receipts = (detail.receipts ?? []) as any[];
  if (!order) {
    return (
      <s-page heading="Purchase order">
        <s-section>
          <s-stack direction="block" gap="small">
            <Link to="/app/procurement">Back to Procurement</Link>
            <s-heading>Purchase order not found</s-heading>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const businessStatus = purchaseOrderBusinessStatus(order);
  const hasOpenReceipt = receipts.some(
    (receipt: any) => receipt.status !== "cancelled",
  );
  const latestReceipt = receipts.find(
    (receipt: any) => receipt.status !== "cancelled",
  );
  const hasMissingPrices = detail.lines.some((line: any) => !hasUsablePrice(line));
  const canEditLines = order.status === "draft" || order.status === "pending_approval";
  const canReleaseForEditing =
    !["draft", "pending_approval", "cancelled"].includes(String(order.status)) &&
    !hasOpenReceipt;
  const currencyCode =
    detail.lines.find((line: any) => line.currency_code)?.currency_code ?? "EUR";
  const totalValue = detail.lines.reduce((sum: number, line: any) => {
    const value = lineValue(line);
    return value == null ? sum : sum + value;
  }, 0);
  const hasAnyValue = detail.lines.some((line: any) => lineValue(line) != null);
  const earliestExpectedDate = detail.lines
    .map((line: any) => line.expected_delivery_date)
    .filter(Boolean)
    .sort()[0];
  const maxLeadTimeDays = Math.max(
    ...detail.lines.map((line: any) => Number(line.lead_time_days ?? 0)),
    0,
  );
  const nextAction = purchaseOrderNextAction(
    order,
    hasOpenReceipt,
    hasMissingPrices,
    latestReceipt,
  );

  return (
    <s-page heading={`Purchase order ${order.display_number}`}>
      <s-section>
        <s-stack direction="block" gap="small">
          <s-stack direction="inline" gap="small">
            <Link to="/app/procurement">Back to Procurement</Link>
            <MoneylessBadge tone={purchaseOrderStatusTone(businessStatus)}>
              {businessStatus}
            </MoneylessBadge>
            {hasOpenReceipt && latestReceipt ? (
              <s-link href={`/app/receiving/${latestReceipt.id}`}>
                Open Goods Receipt
              </s-link>
            ) : null}
          </s-stack>
          {actionData?.message ? <s-paragraph>{actionData.message}</s-paragraph> : null}
          <s-stack direction="inline" gap="small">
            {canReleaseForEditing ? (
              <Form method="post">
                <input type="hidden" name="intent" value="reopenForEditing" />
                <input type="hidden" name="purchaseOrderId" value={order.id} />
                <s-button type="submit">Edit</s-button>
              </Form>
            ) : null}
            {order.status === "draft" ? (
              <StatusAction
                orderId={order.id}
                status="approved"
                label="Approve"
                primary
                disabled={hasMissingPrices}
              />
            ) : null}
            {order.status === "pending_approval" ? (
              <StatusAction
                orderId={order.id}
                status="approved"
                label="Approve"
                primary
                disabled={hasMissingPrices}
              />
            ) : null}
            {order.status === "approved" ? (
              <StatusAction
                orderId={order.id}
                status="sent"
                label="Sent to supplier"
                primary
                disabled={hasMissingPrices}
              />
            ) : null}
            {order.status === "sent" ? (
              <StatusAction
                orderId={order.id}
                status="acknowledged"
                label="Supplier acknowledged"
                primary
              />
            ) : null}
            {order.status === "acknowledged" && !hasOpenReceipt ? (
              <Form method="post">
                <input type="hidden" name="intent" value="createGoodsReceipt" />
                <input type="hidden" name="purchaseOrderId" value={order.id} />
                <s-button variant="primary" type="submit">
                  Create Goods Receipt
                </s-button>
              </Form>
            ) : null}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Purchase order context">
        <DataTable
          headings={["Area", "Current state"]}
          rows={[
            [
              "PO status",
              <s-stack direction="inline" gap="small">
                <MoneylessBadge tone={purchaseOrderStatusTone(businessStatus)}>
                  {businessStatus}
                </MoneylessBadge>
                <MoneylessBadge>{order.status}</MoneylessBadge>
              </s-stack>,
            ],
            ["Supplier", `${order.supplier_name}${order.supplier_email ? ` (${order.supplier_email})` : ""}`],
            ["Total value", formatAmount(hasAnyValue ? totalValue : null, currencyCode)],
            [
              "Expected / lead time",
              `${formatDate(earliestExpectedDate) || "Not set"} / ${
                maxLeadTimeDays || 7
              } days`,
            ],
            [
              "Receiving",
              latestReceipt ? (
                <s-stack direction="inline" gap="small">
                  <MoneylessBadge>{latestReceipt.status}</MoneylessBadge>
                  <Link to={`/app/receiving/${latestReceipt.id}`}>
                    {latestReceipt.receipt_number ?? "Open Goods Receipt"}
                  </Link>
                </s-stack>
              ) : (
                <MoneylessBadge tone="warning">No Goods Receipt yet</MoneylessBadge>
              ),
            ],
            ["Next Action", nextAction],
          ]}
        />
      </s-section>

      <s-section heading="Line items">
        <DataTable
          headings={[
            "Line item",
            "Quantity",
            "Unit price",
            "Line value",
            "Source",
            "Need reason",
            "Receiving",
            "Lead time",
            "Expected",
            "Edit terms",
            "Next Action",
          ]}
          rows={detail.lines.map((line: any) => [
            <s-stack direction="block" gap="small">
              <strong>
                {line.sku} {line.title}
              </strong>
              <Link to={`/app/items/${line.item_id}`}>Open Product</Link>
            </s-stack>,
            `${Number(line.quantity).toLocaleString()} ${line.unit}`,
            formatLineUnitPrice(line),
            formatLineValue(line),
            <SourceCell line={line} />,
            <NeedReasonCell line={line} />,
            <ReceivingCell line={line} />,
            `${line.lead_time_days ?? 7} days`,
            formatDate(line.expected_delivery_date) || "Not set",
            canEditLines ? (
              <Form method="post" className="kit-po-line-price-form">
                <input type="hidden" name="intent" value="updateLinePricing" />
                <input
                  type="hidden"
                  name="purchaseOrderLineId"
                  value={line.id}
                />
                <input
                  aria-label="Quantity"
                  name="quantity"
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  defaultValue={Number(line.quantity ?? 1)}
                />
                <input
                  aria-label="Unit price"
                  name="unitPrice"
                  type="number"
                  min="0.0001"
                  step="0.0001"
                  defaultValue={
                    hasUsablePrice(line) ? Number(line.unit_price) : ""
                  }
                />
                <input
                  aria-label="Currency"
                  name="currencyCode"
                  defaultValue={line.currency_code ?? "EUR"}
                />
                <input
                  aria-label="Expected delivery date"
                  name="expectedDeliveryDate"
                  type="date"
                  defaultValue={
                    line.expected_delivery_date
                      ? String(line.expected_delivery_date).slice(0, 10)
                      : ""
                  }
                />
                <s-button type="submit">Update terms</s-button>
              </Form>
            ) : (
              "Locked"
            ),
            <s-stack direction="block" gap="small">
              <MoneylessBadge>{line.status}</MoneylessBadge>
              <s-text>{lineNextAction(line, order, hasOpenReceipt)}</s-text>
            </s-stack>,
          ])}
        />
      </s-section>
    </s-page>
  );
}

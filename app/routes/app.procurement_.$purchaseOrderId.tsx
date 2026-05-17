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

      <s-section heading="Line items">
        <DataTable
          headings={[
            "Line item",
            "Quantity",
            "Unit price",
            "Line value",
            "Lead time",
            "Expected",
            "Edit terms",
            "Status",
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
            line.status,
          ])}
        />
      </s-section>
    </s-page>
  );
}

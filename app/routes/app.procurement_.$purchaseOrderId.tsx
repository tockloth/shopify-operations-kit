import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  createGoodsReceiptForPurchaseOrder,
  loadPurchaseOrderDetail,
  transitionPurchaseOrder,
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
  }

  if (intent === "createGoodsReceipt") {
    const purchaseOrderId = String(form.get("purchaseOrderId"));
    const purchaseOrderNumber = String(form.get("purchaseOrderNumber"));
    const result = await createGoodsReceiptForPurchaseOrder(
      context.pool,
      context.ctx.tenantId,
      purchaseOrderId,
    );
    if (!result.receiptId) {
      return {
        message:
          "No goods receipt was created. Confirm the purchase order is acknowledged before receiving.",
      };
    }

    return {
      message: result.created
        ? `Goods receipt created for ${purchaseOrderNumber}. Continue with QC and putaway.`
        : `Goods receipt already exists for ${purchaseOrderNumber}. Continue with QC and putaway.`,
      receiptId: result.receiptId,
    };
  }

  return { message: "No action was performed." };
};

function purchaseOrderBusinessStatus(po: any) {
  if (po.status === "cancelled") return "cancelled";
  if (po.receipt_status === "closed") return "stocked";
  if (po.receipt_status === "putaway_pending") return "qc-approved";
  if (po.receipt_status === "qc_required" || po.receipt_status === "posted")
    return "delivered";
  if (po.status === "acknowledged" || po.status === "sent") return "ordered";
  if (po.status === "approved") return "approved";
  return "created";
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
  if (status === "stocked" || status === "qc-approved") return "success";
  if (status === "ordered" || status === "delivered") return "info";
  if (status === "cancelled") return "critical";
  return "warning";
}

function receivingStatus(order: any, receipts: any[]) {
  const openReceipt = receipts.find((receipt) => receipt.status !== "cancelled");
  if (openReceipt) return openReceipt.status;
  if (order.status === "acknowledged") return "ready to receive";
  if (order.status === "sent") return "awaiting acknowledgement";
  return "not ready";
}

function nextReceivingAction(order: any, receipts: any[]) {
  const openReceipt = receipts.find((receipt) => receipt.status !== "cancelled");
  if (openReceipt) {
    if (openReceipt.status === "closed") return "Complete";
    if (openReceipt.status === "putaway_pending") return "Putaway";
    return "QC";
  }
  if (order.status === "acknowledged") return "Create goods receipt";
  return "Wait for acknowledgement";
}

function formatDate(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function StatusAction({
  orderId,
  status,
  label,
  primary,
}: {
  orderId: string;
  status: "pending_approval" | "approved" | "sent" | "acknowledged";
  label: string;
  primary?: boolean;
}) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="poStatus" />
      <input type="hidden" name="purchaseOrderId" value={orderId} />
      <input type="hidden" name="status" value={status} />
      <s-button variant={primary ? "primary" : undefined} type="submit">
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
            <Link to="/app/procurement">Back to purchase orders</Link>
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
  const canCreateReceipt = order.status === "acknowledged" && !hasOpenReceipt;

  return (
    <s-page heading={`Purchase order ${order.display_number}`}>
      <s-section>
        <s-stack direction="block" gap="small">
          <Link to="/app/procurement">Back to purchase orders</Link>
          {actionData?.message ? (
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-paragraph>{actionData.message}</s-paragraph>
                {"receiptId" in actionData && actionData.receiptId ? (
                  <s-link href={`/app/receiving/${actionData.receiptId}`}>
                    Open Receipt detail
                  </s-link>
                ) : null}
              </s-stack>
            </s-box>
          ) : null}
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-stack direction="inline" gap="small">
                <s-heading>{order.supplier_name}</s-heading>
                <MoneylessBadge tone={purchaseOrderStatusTone(businessStatus)}>
                  {businessStatus}
                </MoneylessBadge>
              </s-stack>
              <s-paragraph>
                Lifecycle: Draft {"->"} Procurement Manager approval {"->"} Sent{" "}
                {"->"} Acknowledged {"->"} Receiving/QC.
              </s-paragraph>
              <s-stack direction="inline" gap="small">
                {order.status === "draft" ? (
                  <StatusAction
                    orderId={order.id}
                    status="pending_approval"
                    label="Submit for approval"
                  />
                ) : null}
                {order.status === "pending_approval" ? (
                  <StatusAction
                    orderId={order.id}
                    status="approved"
                    label="Procurement Manager approve"
                    primary
                  />
                ) : null}
                {order.status === "approved" ? (
                  <StatusAction
                    orderId={order.id}
                    status="sent"
                    label="Send to supplier"
                    primary
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
                {order.status === "acknowledged" ? (
                  <s-text>Awaiting receipt</s-text>
                ) : null}
              </s-stack>
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>

      <s-section heading="Receiving">
        <s-stack direction="block" gap="base">
          <DataTable
            headings={[
              "Purchase Order",
              "Receiving status",
              "Goods Receipt",
              "Lines",
              "Next action",
            ]}
            rows={[
              [
                <strong>{order.display_number}</strong>,
                <MoneylessBadge>
                  {receivingStatus(order, receipts)}
                </MoneylessBadge>,
                hasOpenReceipt
                  ? receipts
                      .filter((receipt: any) => receipt.status !== "cancelled")
                      .map((receipt: any) => (
                        <s-link
                          key={receipt.id}
                          href={`/app/receiving/${receipt.id}`}
                        >
                          {receipt.receipt_number}
                        </s-link>
                      ))
                  : "No goods receipt yet",
                hasOpenReceipt
                  ? receipts
                      .filter((receipt: any) => receipt.status !== "cancelled")
                      .reduce(
                        (total: number, receipt: any) =>
                          total + Number(receipt.line_count ?? 0),
                        0,
                      )
                  : detail.lines.length,
                nextReceivingAction(order, receipts),
              ],
            ]}
          />
          {canCreateReceipt ? (
            <Form method="post">
              <input type="hidden" name="intent" value="createGoodsReceipt" />
              <input type="hidden" name="purchaseOrderId" value={order.id} />
              <input
                type="hidden"
                name="purchaseOrderNumber"
                value={order.display_number}
              />
              <s-button variant="primary" type="submit">
                Create goods receipt
              </s-button>
            </Form>
          ) : hasOpenReceipt ? (
            <s-stack direction="inline" gap="small">
              {receipts
                .filter((receipt: any) => receipt.status !== "cancelled")
                .map((receipt: any) => (
                  <s-link key={receipt.id} href={`/app/receiving/${receipt.id}`}>
                    Open {receipt.receipt_number}
                  </s-link>
                ))}
            </s-stack>
          ) : (
            <s-paragraph>
              Receiving is available after the supplier acknowledges this
              Purchase Order.
            </s-paragraph>
          )}
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
            "Status",
          ]}
          rows={detail.lines.map((line: any) => [
            <strong>
              {line.sku} {line.title}
            </strong>,
            `${Number(line.quantity).toLocaleString()} ${line.unit}`,
            `${Number(line.unit_price ?? 0).toLocaleString()} ${line.currency_code ?? "EUR"}`,
            `${(
              Number(line.quantity ?? 0) * Number(line.unit_price ?? 0)
            ).toLocaleString()} ${line.currency_code ?? "EUR"}`,
            `${line.lead_time_days ?? 7} days`,
            formatDate(line.expected_delivery_date) || "Not set",
            line.status,
          ])}
        />
      </s-section>
    </s-page>
  );
}

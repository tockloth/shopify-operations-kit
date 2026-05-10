import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
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
      purchaseOrderDetail: { order: null, lines: [] },
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

  return (
    <s-page heading={`Purchase order ${order.display_number}`}>
      <s-section>
        <s-stack direction="block" gap="small">
          <Link to="/app/procurement">Back to purchase orders</Link>
          {actionData?.message ? (
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-paragraph>{actionData.message}</s-paragraph>
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

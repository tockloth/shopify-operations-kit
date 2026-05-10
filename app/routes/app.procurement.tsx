import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  assignSupplierToPurchaseNeed,
  commitMrpRun,
  createPurchaseOrderFromNeed,
  loadPurchaseNeeds,
  loadPurchaseOrders,
  loadSuppliers,
  runOperationsMrp,
  transitionPurchaseOrder,
} from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    needs: await loadPurchaseNeeds(context.pool, context.ctx.tenantId),
    purchaseOrders: await loadPurchaseOrders(
      context.pool,
      context.ctx.tenantId,
    ),
    suppliers: await loadSuppliers(context.pool, context.ctx.tenantId),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "planPurchaseNeeds") {
    const run = await runOperationsMrp(context.pool, context.ctx.tenantId);
    const result = await commitMrpRun(
      context.pool,
      context.ctx.tenantId,
      run.mrpRunId,
    );
    return {
      message: `${result.purchaseNeeds} purchase need(s) planned from open order shortages, stock, incoming purchase orders and minimum stock.`,
    };
  }

  if (intent === "createPoForNeed") {
    const result = await createPurchaseOrderFromNeed(
      context.pool,
      context.ctx.tenantId,
      String(form.get("purchaseNeedId")),
    );
    return {
      message: result.purchaseOrderId
        ? "Purchase order draft created for this need."
        : "Purchase need was not open.",
    };
  }

  if (intent === "assignSupplierForNeed") {
    await assignSupplierToPurchaseNeed(
      context.pool,
      context.ctx.tenantId,
      String(form.get("purchaseNeedId")),
      String(form.get("supplierId") || ""),
    );
    return { message: "Supplier assigned to purchase need." };
  }

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

function purchaseNeedStatus(need: any) {
  if (!need.supplier_id) return "needs supplier";
  return "ready for PO";
}

function purchaseNeedStatusTone(need: any): BadgeTone {
  return need.supplier_id ? "info" : "warning";
}

function formatDate(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

export default function Procurement() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("needs" in data)) {
    return (
      <SetupBanner
        message={data.setupError ?? "Database setup is incomplete."}
      />
    );
  }

  const proposalRows = (data.needs ?? [])
    .filter((need: any) => !need.purchase_order_id)
    .map((need: any) => [
      <strong>New proposal</strong>,
      need.supplier_name ?? "Missing supplier",
      <MoneylessBadge tone={purchaseNeedStatusTone(need)}>
        {purchaseNeedStatus(need)}
      </MoneylessBadge>,
      <strong>
        {need.sku} {need.title}
      </strong>,
      `${Number(need.quantity).toLocaleString()} ${need.unit}`,
      "0 EUR",
      "",
      <s-stack direction="inline" gap="small">
        <Form method="post">
          <input type="hidden" name="intent" value="assignSupplierForNeed" />
          <input type="hidden" name="purchaseNeedId" value={need.id} />
          <s-stack direction="inline" gap="small">
            <s-select
              label="Supplier"
              name="supplierId"
              value={need.supplier_id ?? need.preferred_supplier_id ?? ""}
            >
              {(data.suppliers ?? []).map((supplier: any) => (
                <s-option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </s-option>
              ))}
            </s-select>
            <s-button type="submit">Assign</s-button>
          </s-stack>
        </Form>
        <Form method="post">
          <input type="hidden" name="intent" value="createPoForNeed" />
          <input type="hidden" name="purchaseNeedId" value={need.id} />
          <s-button variant="primary" type="submit">
            Create PO
          </s-button>
        </Form>
      </s-stack>,
    ]);

  const purchaseOrderRows = (data.purchaseOrders ?? []).map((po: any) => {
    const businessStatus = purchaseOrderBusinessStatus(po);
    return [
      <Link to={`/app/procurement/${po.id}`}>
        <strong>{po.display_number}</strong>
      </Link>,
      po.supplier_name,
      <MoneylessBadge tone={purchaseOrderStatusTone(businessStatus)}>
        {businessStatus}
      </MoneylessBadge>,
      `${po.line_count} line${po.line_count === 1 ? "" : "s"}`,
      "",
      `${Number(po.net_amount ?? 0).toLocaleString()} ${po.currency_code ?? "EUR"}`,
      formatDate(po.next_expected_delivery_date),
      <s-stack direction="inline" gap="small">
        {po.status === "draft" ? (
          <Form method="post">
            <input type="hidden" name="intent" value="poStatus" />
            <input type="hidden" name="purchaseOrderId" value={po.id} />
            <input type="hidden" name="status" value="pending_approval" />
            <s-button type="submit">Submit</s-button>
          </Form>
        ) : null}
        {po.status === "pending_approval" ? (
          <Form method="post">
            <input type="hidden" name="intent" value="poStatus" />
            <input type="hidden" name="purchaseOrderId" value={po.id} />
            <input type="hidden" name="status" value="approved" />
            <s-button variant="primary" type="submit">
              Approve
            </s-button>
          </Form>
        ) : null}
        {po.status === "approved" ? (
          <Form method="post">
            <input type="hidden" name="intent" value="poStatus" />
            <input type="hidden" name="purchaseOrderId" value={po.id} />
            <input type="hidden" name="status" value="sent" />
            <s-button variant="primary" type="submit">
              Send
            </s-button>
          </Form>
        ) : null}
        {po.status === "sent" ? (
          <Form method="post">
            <input type="hidden" name="intent" value="poStatus" />
            <input type="hidden" name="purchaseOrderId" value={po.id} />
            <input type="hidden" name="status" value="acknowledged" />
            <s-button variant="primary" type="submit">
              Acknowledge
            </s-button>
          </Form>
        ) : null}
        {po.status === "acknowledged" ? (
          <s-text>Awaiting receipt</s-text>
        ) : null}
      </s-stack>,
    ];
  });

  return (
    <s-page heading="Procurement">
      <s-section>
        <div className="kit-toolbar">
          <div>
            <s-heading>Trading-goods purchasing</s-heading>
            <div className="kit-list-summary">
              Purchase orders are created from open customer order shortages,
              stock, reservations, incoming purchase orders and minimum stock.
            </div>
          </div>
          <div className="kit-toolbar-actions">
            <Form method="post">
              <input type="hidden" name="intent" value="planPurchaseNeeds" />
              <s-button variant="primary" type="submit">
                Plan purchasing needs
              </s-button>
            </Form>
          </div>
        </div>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section heading="Purchase orders">
        <DataTable
          headings={[
            "PO",
            "Supplier",
            "Status",
            "Item / lines",
            "Quantity",
            "Net value",
            "Expected delivery",
            "Action",
          ]}
          rows={[...proposalRows, ...purchaseOrderRows]}
        />
      </s-section>
    </s-page>
  );
}

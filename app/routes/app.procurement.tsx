import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  assignSupplierToPurchaseNeed,
  commitMrpRun,
  createPurchaseOrderFromNeed,
  loadPurchaseNeeds,
  loadPurchaseNeedSupplierAssignment,
  loadPurchaseOrders,
  loadPurchaseOrderTenantDiagnostics,
  loadPurchasePayments,
  loadSuppliers,
  runOperationsMrp,
  transitionPurchaseOrder,
} from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  const planningRun = await runOperationsMrp(context.pool, context.ctx.tenantId);
  const autoPlanResult = await commitMrpRun(
    context.pool,
    context.ctx.tenantId,
    planningRun.mrpRunId,
  );

  return {
    configured: true,
    shopDomain: context.shopDomain,
    tenantId: context.ctx.tenantId,
    autoPlanResult,
    needs: await loadPurchaseNeeds(context.pool, context.ctx.tenantId),
    purchaseOrders: await loadPurchaseOrders(
      context.pool,
      context.ctx.tenantId,
    ),
    purchaseOrderDiagnostics: await loadPurchaseOrderTenantDiagnostics(
      context.pool,
      context.ctx.tenantId,
    ),
    showDevelopmentDiagnostics: process.env.NODE_ENV !== "production",
    payables: await loadPurchasePayments(context.pool, context.ctx.tenantId),
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
    const purchaseNeedId = String(form.get("purchaseNeedId"));
    const assignment = await loadPurchaseNeedSupplierAssignment(
      context.pool,
      context.ctx.tenantId,
      purchaseNeedId,
    );
    if (!assignment || assignment.status === "converted_to_po") {
      return { message: "Purchase need was not open." };
    }
    if (!assignment.supplier_id) {
      return {
        message: "Assign a supplier before creating a Purchase Order.",
      };
    }

    const result = await createPurchaseOrderFromNeed(
      context.pool,
      context.ctx.tenantId,
      purchaseNeedId,
    );
    return {
      message: result.purchaseOrderId
        ? "Purchase order draft created for this need."
        : "Purchase need was not open.",
    };
  }

  if (intent === "assignSupplierForNeed") {
    const supplierId = String(form.get("supplierId") || "");
    if (!supplierId) {
      return { message: "Select a supplier before assigning this need." };
    }

    await assignSupplierToPurchaseNeed(
      context.pool,
      context.ctx.tenantId,
      String(form.get("purchaseNeedId")),
      supplierId,
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
  if (po.payment_status && po.payment_status !== "paid") return "Payment open";
  if (po.receipt_status === "closed") return "Received / put away";
  if (po.receipt_status === "putaway_pending") return "Putaway pending";
  if (po.receipt_status === "qc_required" || po.receipt_status === "posted")
    return "Receiving / QC";
  if (po.status === "acknowledged") return "Awaiting receipt";
  if (po.status === "sent") return "Sent / ordered";
  if (po.status === "approved") return "PO created";
  return "PO created";
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
  if (status === "Received / put away") return "success";
  if (
    status === "Sent / ordered" ||
    status === "Awaiting receipt" ||
    status === "Receiving / QC" ||
    status === "Putaway pending" ||
    status === "Payment open"
  )
    return "info";
  if (status === "cancelled") return "critical";
  return "warning";
}

function purchaseNeedStatus(need: any) {
  if (!need.supplier_id) return "Need supplier";
  return "Ready for PO";
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

function formatMoney(amount: unknown, currencyCode: unknown) {
  return `${Number(amount ?? 0).toLocaleString()} ${String(currencyCode || "EUR")}`;
}

function roleSummary(row: any) {
  return [
    row.is_sellable ? "sellable" : null,
    row.is_purchasable ? "purchasable" : null,
    row.is_producible ? "producible" : null,
  ]
    .filter(Boolean)
    .join(" / ") || "not classified";
}

function policySummary(row: any) {
  return (
    <s-stack direction="block" gap="small">
      <s-text>Roles: {roleSummary(row)}</s-text>
      <s-text>
        Lead time: {Number(row.supplier_lead_time_days ?? row.max_lead_time_days ?? 7).toLocaleString()} days
      </s-text>
      <s-text>
        Order qty: {Number(row.default_order_quantity ?? row.max_default_order_quantity ?? 1).toLocaleString()}
      </s-text>
      <s-text>
        Min stock: {Number(row.min_inventory_quantity ?? row.max_min_inventory_quantity ?? 0).toLocaleString()}
      </s-text>
    </s-stack>
  );
}

function nextPurchaseOrderAction(po: any) {
  if (po.status === "draft" || po.status === "pending_approval") {
    return "Open Purchase Order";
  }
  if (po.status === "approved") return "Send to supplier";
  if (po.status === "sent") return "Acknowledge supplier";
  if (po.status === "acknowledged" && !po.receipt_status) {
    return "Create Goods Receipt";
  }
  if (po.receipt_status === "posted" || po.receipt_status === "qc_required") {
    return "Complete QC";
  }
  if (po.receipt_status === "putaway_pending") return "Put away";
  if (po.receipt_status === "closed") return "View inventory";
  return "Open Purchase Order";
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

  const suppliers = (data.suppliers ?? []) as any[];
  const paymentByPurchaseOrder = new Map(
    (data.payables ?? []).map((payment: any) => [
      payment.purchase_order_id,
      payment,
    ]),
  );
  const proposalRows = (data.needs ?? [])
    .filter((need: any) => !need.purchase_order_id)
    .map((need: any) => {
      const assignedSupplier = Boolean(need.supplier_id);
      const preferredSupplier = Boolean(need.preferred_supplier_id);
      const selectedSupplierId =
        need.supplier_id ?? need.preferred_supplier_id ?? suppliers[0]?.id;

      const supplierCell = (
        <s-stack direction="block" gap="small">
          <strong>{need.supplier_name ?? "No assigned supplier"}</strong>
          {need.preferred_supplier_name ? (
            <s-text>Preferred supplier: {need.preferred_supplier_name}</s-text>
          ) : (
            <s-text>No preferred supplier set</s-text>
          )}
        </s-stack>
      );

      const itemCell = (
        <s-stack direction="block" gap="small">
          <strong>
            {need.sku} {need.title}
          </strong>
          <s-link href={`/app/items/${need.item_id}`}>Open product</s-link>
        </s-stack>
      );

      let actionCell;
      if (assignedSupplier) {
        actionCell = (
          <Form method="post">
            <input type="hidden" name="intent" value="createPoForNeed" />
            <input type="hidden" name="purchaseNeedId" value={need.id} />
            <s-button variant="primary" type="submit">
              Create PO
            </s-button>
          </Form>
        );
      } else if (suppliers.length === 0 && !preferredSupplier) {
        actionCell = (
          <s-stack direction="block" gap="small">
            <s-text>
              Create a supplier first, then assign it to this purchase need.
            </s-text>
            <s-link href="/app/suppliers/new">Create supplier</s-link>
          </s-stack>
        );
      } else {
        actionCell = (
          <s-stack direction="block" gap="small">
            {preferredSupplier ? (
              <Form method="post">
                <input
                  type="hidden"
                  name="intent"
                  value="assignSupplierForNeed"
                />
                <input type="hidden" name="purchaseNeedId" value={need.id} />
                <input
                  type="hidden"
                  name="supplierId"
                  value={need.preferred_supplier_id}
                />
                <s-button type="submit">Assign preferred supplier</s-button>
              </Form>
            ) : null}
            {suppliers.length > 0 ? (
              <Form method="post">
                <input
                  type="hidden"
                  name="intent"
                  value="assignSupplierForNeed"
                />
                <input type="hidden" name="purchaseNeedId" value={need.id} />
                <s-stack direction="block" gap="small">
                  <s-select
                    label="Supplier"
                    name="supplierId"
                    value={selectedSupplierId}
                  >
                    {suppliers.map((supplier: any) => (
                      <s-option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </s-option>
                    ))}
                  </s-select>
                  <s-button type="submit">Assign supplier</s-button>
                </s-stack>
              </Form>
            ) : null}
          </s-stack>
        );
      }

      return [
        <strong>Purchase proposal</strong>,
        <MoneylessBadge tone={purchaseNeedStatusTone(need)}>
          {purchaseNeedStatus(need)}
        </MoneylessBadge>,
        itemCell,
        policySummary(need),
        supplierCell,
        `${Number(need.quantity).toLocaleString()} ${need.unit}`,
        `${Number(need.preferred_unit_price ?? 0).toLocaleString()} ${need.preferred_currency_code ?? "EUR"}`,
        `${(Number(need.quantity ?? 0) * Number(need.preferred_unit_price ?? 0)).toLocaleString()} ${need.preferred_currency_code ?? "EUR"}`,
        actionCell,
      ];
    });

  const purchaseOrderRows = (data.purchaseOrders ?? []).map((po: any) => {
    const payment = paymentByPurchaseOrder.get(po.id) as any;
    const row = { ...po, payment_status: payment?.status };
    const businessStatus = purchaseOrderBusinessStatus(row);
    const nextActionHref =
      po.latest_receipt_id &&
      ["posted", "qc_required", "putaway_pending", "closed"].includes(
        String(po.receipt_status),
      )
        ? `/app/receiving/${po.latest_receipt_id}`
        : `/app/procurement/${po.id}`;
    return [
      <Link to={`/app/procurement/${po.id}`}>
        <strong>{po.display_number}</strong>
      </Link>,
      <MoneylessBadge tone={purchaseOrderStatusTone(businessStatus)}>
        {businessStatus}
      </MoneylessBadge>,
      <s-stack direction="block" gap="small">
        <strong>{po.item_summary ?? `${po.line_count} line${po.line_count === 1 ? "" : "s"}`}</strong>
      </s-stack>,
      policySummary(row),
      <s-stack direction="block" gap="small">
        <strong>{po.supplier_name}</strong>
        {po.preferred_supplier_names ? (
          <s-text>Preferred: {po.preferred_supplier_names}</s-text>
        ) : null}
      </s-stack>,
      `${Number(po.total_quantity ?? 0).toLocaleString()} ${po.unit ?? "pcs"}`,
      `${Number(po.unit_price ?? 0).toLocaleString()} ${po.currency_code ?? "EUR"}`,
      `${Number(po.net_amount ?? 0).toLocaleString()} ${po.currency_code ?? "EUR"}`,
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
        <s-link href={nextActionHref}>
          {nextPurchaseOrderAction(po)}
        </s-link>
      </s-stack>,
    ];
  });

  const payableRows = (data.payables ?? []).map((payment: any) => [
    <strong>{payment.payment_number}</strong>,
    payment.supplier_name ?? "No supplier",
    <Link to={`/app/procurement/${payment.purchase_order_id}`}>
      {payment.purchase_order_number}
    </Link>,
    <MoneylessBadge>{payment.status}</MoneylessBadge>,
    formatMoney(payment.gross_amount ?? payment.net_amount, payment.currency_code),
    formatDate(payment.due_date) || "No due date",
    formatDate(payment.created_at),
    "Review in accounting",
  ]);
  const purchaseOrderSectionRows = [...proposalRows, ...purchaseOrderRows];

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
                Refresh purchasing needs
              </s-button>
            </Form>
          </div>
        </div>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : data.autoPlanResult ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>
              Purchasing needs were refreshed from open order shortages.
            </s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section heading="Procurement process">
        <div className="kit-process-guide">
          {[
            "Purchase proposal",
            "Supplier assigned",
            "Purchase Order",
            "Supplier acknowledgement",
            "Goods Receipt",
            "QC",
            "Putaway",
            "Inventory",
          ].map((step) => (
            <span key={step}>{step}</span>
          ))}
        </div>
      </s-section>

      <s-section heading="Purchase orders">
        <DataTable
          headings={[
            "Reference",
            "Status",
            "Item",
            "Product context",
            "Supplier",
            "Quantity",
            "Unit price",
            "Line value",
            "Action",
          ]}
          rows={purchaseOrderSectionRows}
        />
        {purchaseOrderSectionRows.length === 0 &&
        data.showDevelopmentDiagnostics ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-heading>Development diagnostics</s-heading>
              <s-paragraph>Current tenant: {data.tenantId}</s-paragraph>
              <s-paragraph>Shop: {data.shopDomain}</s-paragraph>
              <s-paragraph>
                Purchase Orders for current tenant:{" "}
                {
                  data.purchaseOrderDiagnostics
                    .current_tenant_purchase_orders
                }
              </s-paragraph>
              <s-paragraph>
                Purchase Orders across all tenants:{" "}
                {data.purchaseOrderDiagnostics.total_purchase_orders}
              </s-paragraph>
              <s-paragraph>
                If total Purchase Orders exist but current-tenant Purchase
                Orders are zero, the visible database rows belong to another
                tenant, usually a DB-backed test tenant.
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : null}
      </s-section>

      <s-section heading="Payment / Payables">
        {payableRows.length > 0 ? (
          <DataTable
            headings={[
              "Payment",
              "Supplier",
              "Purchase Order",
              "Status",
              "Amount",
              "Due date",
              "Created",
              "Next action",
            ]}
            rows={payableRows}
          />
        ) : (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>
              Payment entries are created after received goods are put away.
            </s-paragraph>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}

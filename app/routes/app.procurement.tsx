import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";

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
  loadSuppliers,
  runOperationsMrp,
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
  const url = new URL(request.url);
  const filters = {
    tab: url.searchParams.get("tab") ?? "active",
    q: url.searchParams.get("q")?.trim() ?? "",
    supplierId: url.searchParams.get("supplierId") ?? "all",
    sourceOrder: url.searchParams.get("sourceOrder")?.trim() ?? "",
    expectedBefore: url.searchParams.get("expectedBefore") ?? "",
  };

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
    suppliers: await loadSuppliers(context.pool, context.ctx.tenantId),
    filters,
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
    if (result.purchaseOrderId) {
      return redirect("/app/procurement");
    }
    return {
      message: "Purchase need was not open.",
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

  return { message: "No action was performed." };
};

function purchaseOrderBusinessStatus(po: any) {
  if (po.status === "cancelled") return "cancelled";
  if (po.receipt_status === "closed") return "Received / put away";
  if (po.receipt_status === "putaway_pending") return "Putaway pending";
  if (po.receipt_status === "qc_required" || po.receipt_status === "posted")
    return "Receiving / QC";
  if (po.status === "acknowledged") return "Awaiting receipt";
  if (po.status === "sent") return "Sent / ordered";
  if (po.status === "approved") return "PO approved";
  return "PO created";
}

function isCompletedProcurement(po: any) {
  return po.status === "cancelled" || po.receipt_status === "closed";
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
  if (need.purchase_order_id) return "PO created";
  if (!need.supplier_id) return "Need supplier";
  if (need.purchase_need_status === "ready_for_po") return "Ready for PO";
  return "Supplier assigned";
}

function purchaseNeedStatusTone(need: any): BadgeTone {
  if (need.purchase_order_id) return "success";
  return need.supplier_id ? "info" : "warning";
}

function formatDate(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function sortTime(value: unknown) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function nextPurchaseOrderAction(po: any) {
  if (
    po.latest_receipt_id &&
    ["posted", "qc_required", "putaway_pending", "closed"].includes(
      String(po.receipt_status),
    )
  ) {
    return "Open Receipt";
  }
  if (po.status === "draft" || po.status === "pending_approval") {
    return "Open Purchase Order";
  }
  if (po.status === "approved") return "Sent to supplier";
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

function purchaseOrderActionHref(po: any) {
  if (
    po.latest_receipt_id &&
    ["posted", "qc_required", "putaway_pending", "closed"].includes(
      String(po.receipt_status),
    )
  ) {
    return `/app/receiving/${po.latest_receipt_id}`;
  }
  return `/app/procurement/${po.id}`;
}

function sourceSummary(need: any) {
  if (need.demand_link_scope === "order_line") {
    return `${need.source_order_name ?? "Order"} line ${need.source_line_sku ?? need.sku}`;
  }
  if (need.source_order_name) return need.source_order_name;
  return "Min stock / item planning";
}

function compactText(value: unknown, maxLength = 120) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function sourceCell(need: any) {
  return (
    <s-stack direction="block" gap="small">
      <strong>{sourceSummary(need)}</strong>
      <s-text>
        {compactText(need.need_explanation ?? "Need created by planning.")}
      </s-text>
      {need.source_order_line_id ? (
        <s-link href={`/app/order-lines/${need.source_order_line_id}`}>
          Open source line
        </s-link>
      ) : null}
    </s-stack>
  );
}

function needQuantityReason(need: any) {
  const demand = Number(need.demand_quantity ?? 0);
  const available = Number(need.available_quantity ?? 0);
  const shortage = Number(need.shortage_quantity ?? need.quantity ?? 0);
  return [
    demand > 0 ? `Demand ${demand.toLocaleString()}` : null,
    `available ${available.toLocaleString()}`,
    `short ${shortage.toLocaleString()}`,
  ]
    .filter(Boolean)
    .join(" / ");
}

function supplierStatusCell(need: any) {
  if (need.supplier_id) {
    return (
      <s-stack direction="block" gap="small">
        <MoneylessBadge tone="info">Supplier assigned</MoneylessBadge>
        <strong>{need.supplier_name}</strong>
        {need.preferred_supplier_name &&
        need.preferred_supplier_name !== need.supplier_name ? (
          <s-text>Preferred: {need.preferred_supplier_name}</s-text>
        ) : null}
      </s-stack>
    );
  }

  return (
    <s-stack direction="block" gap="small">
      <MoneylessBadge tone="warning">Supplier missing</MoneylessBadge>
      {need.preferred_supplier_name ? (
        <s-text>Preferred: {need.preferred_supplier_name}</s-text>
      ) : (
        <s-text>No preferred supplier set</s-text>
      )}
    </s-stack>
  );
}

function purchaseNeedPoCell(need: any) {
  if (!need.purchase_order_id) return "No PO yet";
  return (
    <s-stack direction="block" gap="small">
      <s-link href={`/app/procurement/${need.purchase_order_id}`}>
        {need.purchase_order_number ?? "Open Purchase Order"}
      </s-link>
      <MoneylessBadge>{need.purchase_order_status ?? "open"}</MoneylessBadge>
    </s-stack>
  );
}

function leadTimeDays(row: any) {
  return Number(row.supplier_lead_time_days ?? row.max_lead_time_days ?? 7);
}

function needExpectedLabel(need: any) {
  return `Lead time ${leadTimeDays(need).toLocaleString()} days`;
}

function expectedDateForNeed(need: any) {
  const date = new Date();
  date.setDate(date.getDate() + leadTimeDays(need));
  return date;
}

function matchesSearch(row: any, query: string, fields: string[]) {
  if (!query) return true;
  const searchable = fields
    .map((field) => row[field])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return searchable.includes(query.toLowerCase());
}

function expectedBeforeMatches(dateValue: unknown, expectedBefore: string) {
  if (!expectedBefore) return true;
  const value = dateValue instanceof Date ? dateValue : new Date(String(dateValue));
  const threshold = new Date(expectedBefore);
  if (Number.isNaN(value.getTime()) || Number.isNaN(threshold.getTime())) {
    return true;
  }
  return value <= threshold;
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
  const filters = (data.filters ?? {
    tab: "active",
    q: "",
    supplierId: "all",
    sourceOrder: "",
    expectedBefore: "",
  }) as any;
  const activeTab = [
    "active",
    "needs",
    "need_supplier",
    "ready_for_po",
    "orders",
    "po_created",
    "po_approved",
    "sent_ordered",
    "awaiting_receipt",
    "receipts",
    "receiving_qc",
    "putaway_pending",
    "completed",
  ].includes(
    filters.tab,
  )
    ? filters.tab
    : "active";
  const filteredNeeds = (data.needs ?? []).filter((need: any) => {
    if (
      filters.supplierId !== "all" &&
      String(need.supplier_id ?? need.preferred_supplier_id ?? "") !==
        filters.supplierId
    ) {
      return false;
    }
    if (
      filters.sourceOrder &&
      !String(need.source_order_name ?? "")
        .toLowerCase()
        .includes(String(filters.sourceOrder).toLowerCase())
    ) {
      return false;
    }
    if (!expectedBeforeMatches(expectedDateForNeed(need), filters.expectedBefore)) {
      return false;
    }
    return matchesSearch(need, filters.q, [
      "sku",
      "title",
      "source_order_name",
      "source_line_sku",
      "supplier_name",
      "preferred_supplier_name",
      "purchase_order_number",
    ]);
  });
  const filteredPurchaseOrders = (data.purchaseOrders ?? []).filter((po: any) => {
    if (filters.supplierId !== "all" && String(po.supplier_id ?? "") !== filters.supplierId) {
      return false;
    }
    if (
      filters.sourceOrder &&
      !String(po.source_order_names ?? "")
        .toLowerCase()
        .includes(String(filters.sourceOrder).toLowerCase())
    ) {
      return false;
    }
    if (!expectedBeforeMatches(po.next_expected_delivery_date, filters.expectedBefore)) {
      return false;
    }
    return matchesSearch(po, filters.q, [
      "display_number",
      "supplier_name",
      "item_summary",
      "preferred_supplier_names",
    ]);
  });

  function proposalRow(need: any) {
    const assignedSupplier = Boolean(need.supplier_id);
    const preferredSupplier = Boolean(need.preferred_supplier_id);
    const selectedSupplierId =
      need.supplier_id ?? need.preferred_supplier_id ?? suppliers[0]?.id;

    const itemCell = (
      <s-stack direction="block" gap="small">
        <strong>
          {need.sku} {need.title}
        </strong>
        <s-text>{needQuantityReason(need)}</s-text>
        <s-link href={`/app/items/${need.item_id}`}>Open product</s-link>
      </s-stack>
    );

    let actionCell;
    if (need.purchase_order_id) {
      actionCell = (
        <s-link href={`/app/procurement/${need.purchase_order_id}`}>
          Open Purchase Order
        </s-link>
      );
    } else if (assignedSupplier) {
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

    return {
      id: `need-${need.id}`,
      href: need.purchase_order_id
        ? `/app/procurement/${need.purchase_order_id}`
        : `/app/items/${need.item_id}`,
      cells: [
        <strong>Purchase Need</strong>,
        <MoneylessBadge tone={purchaseNeedStatusTone(need)}>
          {purchaseNeedStatus(need)}
        </MoneylessBadge>,
        sourceCell(need),
        itemCell,
        `${Number(need.quantity).toLocaleString()} ${need.unit}`,
        <s-stack direction="block" gap="small">
          {supplierStatusCell(need)}
          <s-text>
            {Number(need.preferred_unit_price ?? 0).toLocaleString()}{" "}
            {need.preferred_currency_code ?? "EUR"} · line{" "}
            {(
              Number(need.quantity ?? 0) *
              Number(need.preferred_unit_price ?? 0)
            ).toLocaleString()}{" "}
            {need.preferred_currency_code ?? "EUR"}
          </s-text>
        </s-stack>,
        purchaseNeedPoCell(need),
        needExpectedLabel(need),
        actionCell,
      ],
    };
  }

  function purchaseOrderRow(po: any) {
    const businessStatus = purchaseOrderBusinessStatus(po);
    return {
      id: `po-${po.id}`,
      href: `/app/procurement/${po.id}`,
      cells: [
        <strong>{po.display_number}</strong>,
        <MoneylessBadge tone={purchaseOrderStatusTone(businessStatus)}>
          {businessStatus}
        </MoneylessBadge>,
        po.source_order_names ?? "Purchase Order",
        <strong>{po.item_summary ?? `${po.line_count} line${po.line_count === 1 ? "" : "s"}`}</strong>,
        `${Number(po.total_quantity ?? 0).toLocaleString()} ${po.unit ?? "pcs"}`,
        <s-stack direction="block" gap="small">
          <strong>{po.supplier_name}</strong>
          <s-text>
            {Number(po.unit_price ?? 0) > 0
              ? `${Number(po.unit_price).toLocaleString()} ${po.currency_code ?? "EUR"}`
              : "No price"}{" "}
            · line {Number(po.net_amount ?? 0).toLocaleString()}{" "}
            {po.currency_code ?? "EUR"}
          </s-text>
        </s-stack>,
        <s-link href={`/app/procurement/${po.id}`}>
          {po.display_number}
        </s-link>,
        formatDate(po.next_expected_delivery_date) || "Not set",
        <s-link href={purchaseOrderActionHref(po)}>
          {nextPurchaseOrderAction(po)}
        </s-link>,
      ],
    };
  }

  const activePurchaseOrders = filteredPurchaseOrders.filter(
    (po: any) => !isCompletedProcurement(po),
  );
  const completedPurchaseOrders = filteredPurchaseOrders.filter(
    (po: any) => isCompletedProcurement(po),
  );
  const needRows = filteredNeeds.filter((need: any) => {
    if (activeTab === "needs") return true;
    if (activeTab === "need_supplier") return !need.purchase_order_id && !need.supplier_id;
    if (activeTab === "ready_for_po") return !need.purchase_order_id && Boolean(need.supplier_id);
    return activeTab === "active" && !need.purchase_order_id;
  });
  const visiblePurchaseOrders = activePurchaseOrders.filter((po: any) => {
    const businessStatus = purchaseOrderBusinessStatus(po);
    if (activeTab === "orders") return true;
    if (activeTab === "po_created") return businessStatus === "PO created";
    if (activeTab === "po_approved") return businessStatus === "PO approved";
    if (activeTab === "sent_ordered") return businessStatus === "Sent / ordered";
    if (activeTab === "awaiting_receipt") {
      return businessStatus === "Awaiting receipt";
    }
    if (activeTab === "receipts") return Boolean(po.latest_receipt_id);
    if (activeTab === "receiving_qc") return businessStatus === "Receiving / QC";
    if (activeTab === "putaway_pending") return businessStatus === "Putaway pending";
    return activeTab === "active";
  });
  const workQueueRows = [
    ...needRows.map(proposalRow),
    ...visiblePurchaseOrders.map(purchaseOrderRow),
  ];
  const activeQueueRows =
    activeTab === "completed" ? [] : workQueueRows;
  const hasActiveFilters = Boolean(
    filters.q ||
      filters.supplierId !== "all" ||
      filters.sourceOrder ||
      filters.expectedBefore,
  );

  const completedPurchaseOrderRows = completedPurchaseOrders
    .sort(
      (left: any, right: any) =>
        sortTime(right.updated_at ?? right.created_at) -
        sortTime(left.updated_at ?? left.created_at),
    )
    .map((po: any) => {
      return [
        <s-link href={`/app/procurement/${po.id}`}>{po.display_number}</s-link>,
        po.supplier_name,
        po.item_summary ?? `${po.line_count} line${po.line_count === 1 ? "" : "s"}`,
        <MoneylessBadge>{purchaseOrderBusinessStatus(po)}</MoneylessBadge>,
        `${Number(po.net_amount ?? 0).toLocaleString()} ${po.currency_code ?? "EUR"}`,
        po.latest_receipt_id ? (
          <s-link href={`/app/receiving/${po.latest_receipt_id}`}>
            Open Receipt
          </s-link>
        ) : (
          <s-link href={`/app/procurement/${po.id}`}>Open Purchase Order</s-link>
        ),
      ];
    });

  return (
    <s-page heading="Procurement">
      <s-section>
        <details className="kit-compact-disclosure">
          <summary>
            <span className="kit-toolbar">
              <span>Procurement process</span>
              <span className="kit-toolbar-actions">
                <Form method="post">
                  <input type="hidden" name="intent" value="planPurchaseNeeds" />
                  <s-button variant="primary" type="submit">
                    Refresh
                  </s-button>
                </Form>
              </span>
            </span>
          </summary>
          <div className="kit-process-guide kit-process-guide-compact">
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
        </details>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section>
        <Form method="get">
          <div className="kit-filterbar kit-procurement-scopebar">
            <s-select label="Work queue" name="tab" value={activeTab}>
              <s-option value="active">Active work</s-option>
              <s-option value="needs">Purchase Needs</s-option>
              <s-option value="need_supplier">Need supplier</s-option>
              <s-option value="ready_for_po">Ready for PO</s-option>
              <s-option value="orders">Purchase Orders</s-option>
              <s-option value="po_created">PO created</s-option>
              <s-option value="po_approved">PO approved</s-option>
              <s-option value="sent_ordered">Sent / ordered</s-option>
              <s-option value="awaiting_receipt">Awaiting receipt</s-option>
              <s-option value="receipts">Receipts</s-option>
              <s-option value="receiving_qc">Receiving / QC</s-option>
              <s-option value="putaway_pending">Putaway pending</s-option>
              <s-option value="completed">Completed</s-option>
            </s-select>
            <s-button type="submit">Apply</s-button>
          </div>
          <details className="kit-compact-disclosure" open={hasActiveFilters}>
            <summary>Filters</summary>
            <div className="kit-filterbar kit-procurement-filterbar">
              <s-text-field
                label="Product / reference"
                name="q"
                value={filters.q}
                placeholder="SKU, product, PO, supplier"
              ></s-text-field>
              <s-select label="Supplier" name="supplierId" value={filters.supplierId}>
                <s-option value="all">All suppliers</s-option>
                {suppliers.map((supplier: any) => (
                  <s-option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </s-option>
                ))}
              </s-select>
              <s-text-field
                label="Source order"
                name="sourceOrder"
                value={filters.sourceOrder}
                placeholder="#1005"
              ></s-text-field>
              <s-text-field
                label="Expected before"
                name="expectedBefore"
                value={filters.expectedBefore}
                placeholder="YYYY-MM-DD"
              ></s-text-field>
              <s-button type="submit">Apply filters</s-button>
              <Link to="/app/procurement">Clear filters</Link>
            </div>
          </details>
        </Form>

        {activeTab !== "completed" ? (
          <DataTable
            headings={[
              "Reference",
              "Status",
              "Source / reason",
              "Item",
            "Qty",
              "Supplier",
              "PO",
              "Expected",
              "Next action",
            ]}
            rows={activeQueueRows}
          />
        ) : null}
        {activeTab === "orders" &&
        activeQueueRows.length === 0 &&
        data.showDevelopmentDiagnostics ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-heading>Development diagnostics</s-heading>
              <s-paragraph>Current tenant: {data.tenantId}</s-paragraph>
              <s-paragraph>Shop: {data.shopDomain}</s-paragraph>
              <s-paragraph>
                Purchase Orders for current tenant:{" "}
                {data.purchaseOrderDiagnostics.current_tenant_purchase_orders}
              </s-paragraph>
              <s-paragraph>
                Purchase Orders across all tenants:{" "}
                {data.purchaseOrderDiagnostics.total_purchase_orders}
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : null}

        {activeTab === "completed" ? (
          <DataTable
            headings={[
              "Purchase Order",
              "Supplier",
              "Products",
              "Status",
              "Value",
              "Open",
            ]}
            rows={completedPurchaseOrderRows}
          />
        ) : null}
      </s-section>
    </s-page>
  );
}

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  createGoodsReceiptForPurchaseOrder,
  loadReceivablePurchaseOrders,
  loadReceipts,
  loadSuppliers,
} from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  const url = new URL(request.url);
  const filters = {
    queue: url.searchParams.get("queue") ?? "active",
    q: url.searchParams.get("q")?.trim() ?? "",
    supplierId: url.searchParams.get("supplierId") ?? "all",
    expectedBefore: url.searchParams.get("expectedBefore") ?? "",
  };

  return {
    configured: true,
    receivablePurchaseOrders: await loadReceivablePurchaseOrders(
      context.pool,
      context.ctx.tenantId,
    ),
    receiving: await loadReceipts(context.pool, context.ctx.tenantId),
    suppliers: await loadSuppliers(context.pool, context.ctx.tenantId),
    filters,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent"));

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

  return { message: "No action was performed." };
};

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

function receiptStatus(receipt: any, lines: any[]) {
  if (receipt.status === "closed") return "Completed";
  if (receipt.status === "cancelled") return "Cancelled";
  if (receipt.status === "putaway_pending") return "Putaway pending";
  if (
    lines.some(
      (line) =>
        line.qc_status === "open" ||
        line.qc_status === "in_progress" ||
        line.status === "qc_hold",
    ) ||
    receipt.status === "qc_required" ||
    receipt.status === "posted"
  ) {
    return "Receiving / QC";
  }
  if (lines.some((line) => line.status === "accepted")) {
    return "Putaway pending";
  }
  return "Review";
}

function nextReceiptAction(status: string) {
  if (status === "Completed") return "Open receipt";
  if (status === "Receiving / QC") return "Complete QC";
  if (status === "Putaway pending") return "Put away to inventory";
  return "Open receipt";
}

function toneForStatus(status: string) {
  if (status === "Completed") return "success";
  if (status === "Cancelled") return "critical";
  if (status === "Receiving / QC" || status === "Putaway pending") return "info";
  return "warning";
}

function matchesSearch(row: any, query: string, fields: string[]) {
  if (!query) return true;
  const haystack = fields
    .map((field) => row[field])
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function expectedBeforeMatches(value: unknown, expectedBefore: string) {
  if (!expectedBefore || !value) return true;
  const date = value instanceof Date ? value : new Date(String(value));
  const threshold = new Date(expectedBefore);
  if (Number.isNaN(date.getTime()) || Number.isNaN(threshold.getTime())) {
    return true;
  }
  return date <= threshold;
}

function priceSummary(row: any) {
  if (Number(row.missing_price_count ?? 0) > 0) {
    return <MoneylessBadge tone="critical">Missing price</MoneylessBadge>;
  }

  return `${Number(row.net_amount ?? 0).toLocaleString()} ${row.currency_code ?? "EUR"}`;
}

export default function Receiving() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("receiving" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  const receiving = data.receiving ?? { receipts: [], lines: [] };
  const suppliers = (data.suppliers ?? []) as any[];
  const filters = (data.filters ?? {
    queue: "active",
    q: "",
    supplierId: "all",
    expectedBefore: "",
  }) as any;
  const activeQueue = [
    "active",
    "awaiting_receipt",
    "receiving_qc",
    "putaway_pending",
    "completed",
  ].includes(filters.queue)
    ? filters.queue
    : "active";

  const linesByReceipt = new Map<string, any[]>();
  for (const line of (receiving.lines ?? []) as any[]) {
    const receiptLines = linesByReceipt.get(line.goods_receipt_id) ?? [];
    receiptLines.push(line);
    linesByReceipt.set(line.goods_receipt_id, receiptLines);
  }

  const readyPurchaseOrders = (data.receivablePurchaseOrders ?? []).filter(
    (po: any) => {
      if (!["active", "awaiting_receipt"].includes(activeQueue)) return false;
      if (filters.supplierId !== "all" && String(po.supplier_id ?? "") !== filters.supplierId) {
        return false;
      }
      if (!expectedBeforeMatches(po.next_expected_delivery_date, filters.expectedBefore)) {
        return false;
      }
      return matchesSearch(po, filters.q, [
        "display_number",
        "supplier_name",
        "item_summary",
      ]);
    },
  );

  const receiptRows = (receiving.receipts ?? [])
    .map((receipt: any) => {
      const lines = linesByReceipt.get(receipt.id) ?? [];
      const status = receiptStatus(receipt, lines);
      return { ...receipt, lines, business_status: status };
    })
    .filter((receipt: any) => {
      if (activeQueue === "active" && receipt.business_status === "Completed") {
        return false;
      }
      if (activeQueue === "completed" && receipt.business_status !== "Completed") {
        return false;
      }
      if (
        activeQueue === "receiving_qc" &&
        receipt.business_status !== "Receiving / QC"
      ) {
        return false;
      }
      if (
        activeQueue === "putaway_pending" &&
        receipt.business_status !== "Putaway pending"
      ) {
        return false;
      }
      if (activeQueue === "awaiting_receipt") return false;
      if (filters.supplierId !== "all" && String(receipt.supplier_id ?? "") !== filters.supplierId) {
        return false;
      }
      if (!expectedBeforeMatches(receipt.received_at ?? receipt.created_at, filters.expectedBefore)) {
        return false;
      }
      return matchesSearch(receipt, filters.q, [
        "receipt_number",
        "purchase_order_number",
        "supplier_name",
        "item_summary",
      ]);
    })
    .sort((left: any, right: any) => {
      if (activeQueue === "completed") {
        return (
          sortTime(right.updated_at ?? right.received_at ?? right.created_at) -
          sortTime(left.updated_at ?? left.received_at ?? left.created_at)
        );
      }
      return (
        sortTime(right.received_at ?? right.created_at) -
        sortTime(left.received_at ?? left.created_at)
      );
    });

  const workRows = [
    ...readyPurchaseOrders.map((po: any) => ({
      id: `po-${po.id}`,
      href: `/app/procurement/${po.id}`,
      cells: [
        <strong>{po.display_number}</strong>,
        <MoneylessBadge>Awaiting receipt</MoneylessBadge>,
        po.supplier_name,
        po.item_summary ?? `${po.line_count} line${po.line_count === 1 ? "" : "s"}`,
        `${Number(po.total_quantity ?? 0).toLocaleString()} ${po.unit ?? "pcs"}`,
        priceSummary(po),
        "No receipt yet",
        formatDate(po.next_expected_delivery_date) || "Not set",
        Number(po.missing_price_count ?? 0) > 0 ? (
          <Link to={`/app/procurement/${po.id}`}>Open Purchase Order</Link>
        ) : (
          <Form method="post">
          <input type="hidden" name="intent" value="createGoodsReceipt" />
          <input type="hidden" name="purchaseOrderId" value={po.id} />
          <s-button type="submit">Create Goods Receipt</s-button>
          </Form>
        ),
      ],
    })),
    ...receiptRows.map((receipt: any) => ({
      id: `receipt-${receipt.id}`,
      href: `/app/receiving/${receipt.id}`,
      cells: [
        <strong>{receipt.receipt_number}</strong>,
        <MoneylessBadge tone={toneForStatus(receipt.business_status) as any}>
          {receipt.business_status}
        </MoneylessBadge>,
        receipt.supplier_name,
        receipt.item_summary ?? `${receipt.line_count} line${receipt.line_count === 1 ? "" : "s"}`,
        `${Number(receipt.received_quantity ?? 0).toLocaleString()} ${receipt.unit ?? "pcs"}`,
        "",
        receipt.purchase_order_number,
        formatDate(receipt.received_at ?? receipt.created_at),
        <Link to={`/app/receiving/${receipt.id}`}>
          {nextReceiptAction(receipt.business_status)}
        </Link>,
      ],
    })),
  ];

  const hasActiveFilters = Boolean(
    filters.q || filters.supplierId !== "all" || filters.expectedBefore,
  );

  return (
    <s-page heading="Receiving">
      <s-section>
        <details className="kit-compact-disclosure">
          <summary>
            <span className="kit-toolbar">
              <span>Receiving</span>
              <span className="kit-toolbar-actions">
                <s-link href="/app/receiving">
                  <s-button>Refresh</s-button>
                </s-link>
              </span>
            </span>
          </summary>
          <div className="kit-process-guide kit-process-guide-compact">
            {[
              "Purchase Order acknowledged",
              "Goods Receipt",
              "Receive goods",
              "QC",
              "Putaway / Einlagerung",
              "Inventory booked",
            ].map((step) => (
              <span key={step}>{step}</span>
            ))}
          </div>
        </details>
      </s-section>

      <s-section>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
        <form method="get">
          <div className="kit-filterbar kit-procurement-scopebar">
            <s-select label="Work queue" name="queue" value={activeQueue}>
              <s-option value="active">Active work</s-option>
              <s-option value="awaiting_receipt">Awaiting receipt</s-option>
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
                label="Receipt / PO / product"
                name="q"
                value={filters.q}
                placeholder="GR, PO, SKU, supplier"
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
                label="Expected / received before"
                name="expectedBefore"
                value={filters.expectedBefore}
                placeholder="YYYY-MM-DD"
              ></s-text-field>
              <s-button type="submit">Apply filters</s-button>
              <Link to="/app/receiving">Clear filters</Link>
            </div>
          </details>
        </form>

        <DataTable
          headings={[
            "Reference",
            "Status",
            "Supplier",
            "Products",
            "Quantity",
            "Value",
            "PO / Receipt",
            "Date",
            "Next action",
          ]}
          rows={workRows}
        />
      </s-section>
    </s-page>
  );
}

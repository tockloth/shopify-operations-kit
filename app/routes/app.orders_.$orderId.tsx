import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  loadOperationsOrderDetail,
  loadOperationsOrdersList,
  runOperationsMrp,
} from "../lib/operations-kit.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    shopDomain: context.shopDomain,
    detail: await loadOperationsOrderDetail(
      context.pool,
      context.ctx.tenantId,
      params.orderId!,
    ),
    orderSummary: (await loadOperationsOrdersList(
      context.pool,
      context.ctx.tenantId,
    )).find((order: any) => order.id === params.orderId),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  if (String(form.get("intent")) === "refreshPlanning") {
    const result = await runOperationsMrp(context.pool, context.ctx.tenantId);
    return {
      message: `Planning refreshed for ${result.orderLines} open order line(s).`,
    };
  }

  return { message: "No action was performed." };
};

function quantity(value: unknown) {
  return Number(value ?? 0).toLocaleString();
}

function formatDate(value?: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function formatAddress(address?: any) {
  if (!address) return "No shipping address";
  return [
    address.name,
    address.address1,
    address.address2,
    address.zip,
    address.city,
    address.provinceCode,
    address.countryCodeV2,
  ]
    .filter(Boolean)
    .join(", ");
}

function hasUsableShippingAddress(address?: any) {
  return Boolean(address?.address1 && address.city && address.countryCodeV2);
}

function shopifyOrderUrl(shopDomain: string, legacyId?: string | null) {
  if (!legacyId) return null;
  const shop = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${shop}/orders/${legacyId}`;
}

function scopeLabel(scope?: string | null) {
  if (scope === "order_line") return "Exact: this order line";
  if (scope === "order") return "This order";
  if (scope === "item_fallback") return "Item-level fallback";
  return null;
}

function shippingBlockReason(order: any, shippingAddress?: any) {
  const missing = [
    order.customer_name ? null : "customer name",
    order.customer_email ? null : "customer email",
    hasUsableShippingAddress(shippingAddress) ? null : "shipping address",
  ].filter(Boolean);

  return missing.length > 0
    ? `Missing ${missing.join(", ")}. Logistics shipment creation will be blocked.`
    : null;
}

type Decision = {
  label:
    | "Ready from stock"
    | "Needs procurement"
    | "Needs production"
    | "Review master data"
    | "Already in progress";
  reason: string;
  tone: "success" | "info" | "warning" | "critical";
  blocked: boolean;
  hasProcurement: boolean;
  hasProduction: boolean;
  hasLogistics: boolean;
};

function lineDecision(
  line: any,
  procurementRows: any[],
  receiptRows: any[],
  productionRows: any[],
  logisticsRows: any[],
): Decision {
  const itemId = line.item_id;
  const hasProcurement =
    procurementRows.some((row) => row.item_id === itemId) ||
    receiptRows.some((row) => row.item_id === itemId);
  const hasItemFallbackProcurement =
    procurementRows.some(
      (row) =>
        row.item_id === itemId && row.demand_link_scope === "item_fallback",
    ) ||
    receiptRows.some(
      (row) =>
        row.item_id === itemId && row.demand_link_scope === "item_fallback",
    );
  const hasProduction = productionRows.some((row) => row.item_id === itemId);
  const hasLogistics = logisticsRows.some(
    (row) => row.operations_order_line_id === line.id,
  );
  const masterDataMissing =
    !line.is_sellable && !line.is_purchasable && !line.is_producible;
  const orderedQuantity = Number(line.quantity ?? 0);
  const availableQuantity = Number(
    line.allocated_available_quantity ?? line.available_quantity ?? 0,
  );

  if (masterDataMissing) {
    return {
      label: "Review master data",
      reason: "Item has no operational make/buy role yet.",
      tone: "critical",
      blocked: true,
      hasProcurement,
      hasProduction,
      hasLogistics,
    };
  }

  if (hasProcurement || hasProduction || hasLogistics) {
    return {
      label: "Already in progress",
      reason: hasItemFallbackProcurement
        ? "Operational work is item-level because no direct order-line link is available."
        : "Operational work already exists for this order.",
      tone: "info",
      blocked: false,
      hasProcurement,
      hasProduction,
      hasLogistics,
    };
  }

  if (line.supply_status === "reserved" || availableQuantity >= orderedQuantity) {
    return {
      label: "Ready from stock",
      reason: "Available stock covers the ordered quantity.",
      tone: "success",
      blocked: false,
      hasProcurement,
      hasProduction,
      hasLogistics,
    };
  }

  if (line.is_purchasable) {
    return {
      label: "Needs procurement",
      reason: "Stock does not cover the line and the item is purchasable.",
      tone: "warning",
      blocked: false,
      hasProcurement: true,
      hasProduction,
      hasLogistics,
    };
  }

  if (line.is_producible) {
    return {
      label: "Needs production",
      reason: "Stock does not cover the line and the item is producible.",
      tone: "warning",
      blocked: false,
      hasProcurement,
      hasProduction: true,
      hasLogistics,
    };
  }

  return {
    label: "Review master data",
    reason: "Operations Kit cannot choose stock, procurement or production.",
    tone: "critical",
    blocked: true,
    hasProcurement,
    hasProduction,
    hasLogistics,
  };
}

export default function OrderDetail() {
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
    order: null,
    lines: [],
    procurement: [],
    receipts: [],
    production: [],
    logistics: [],
  };
  const order = detail.order as any;
  const orderSummary = (data as any).orderSummary as any;
  const lines = (detail.lines ?? []) as any[];
  const procurementRows = (detail.procurement ?? []) as any[];
  const receiptRows = (detail.receipts ?? []) as any[];
  const productionRows = (detail.production ?? []) as any[];
  const logisticsRows = (detail.logistics ?? []) as any[];
  const shippingAddress = order?.shipping_address;

  if (!order) {
    return (
      <s-page heading="Order not found">
        <s-section>
          <s-link href="/app/orders">Back to orders</s-link>
        </s-section>
      </s-page>
    );
  }
  const shippingReason = shippingBlockReason(order, shippingAddress);
  const shopifyHref = shopifyOrderUrl(
    (data as any).shopDomain ?? "",
    order.shopify_order_legacy_id,
  );

  const lineStates = lines.map((line) => ({
    line,
    decision: lineDecision(
      line,
      procurementRows,
      receiptRows,
      productionRows,
      logisticsRows,
    ),
  }));

  const operationsStatus = orderSummary?.operational_status ?? "In progress";
  const operationsStatusTone = orderSummary?.operational_status_tone ?? "info";
  const nextActionLabel = orderSummary?.next_action_label ?? "Open order";
  const nextActionHref = orderSummary?.next_action_href ?? `/app/orders/${order.id}`;
  const nextReason = orderSummary?.next_reason ?? "Review order lines.";
  const currentOrderHref = `/app/orders/${order.id}`;

  const relatedRows = [
    ...procurementRows.map((row) => ({
      type: "Procurement",
      reference: row.purchase_order_number ?? "Purchase need",
      status: row.purchase_order_status ?? row.purchase_need_status,
      demand_link_scope: row.demand_link_scope,
      href: row.purchase_order_id
        ? `/app/procurement/${row.purchase_order_id}`
        : "/app/procurement",
    })),
    ...receiptRows.map((row) => ({
      type: "Receipt",
      reference: row.receipt_number,
      status: row.receipt_status,
      demand_link_scope: row.demand_link_scope,
      href: `/app/receiving/${row.receipt_id}`,
    })),
    ...productionRows.map((row) => ({
      type: "Production",
      reference: row.production_order_number ?? "Production need",
      status: row.production_order_status ?? row.production_need_status,
      href: "/app/production",
    })),
    ...logisticsRows.map((row) => ({
      type: "Logistics",
      reference: row.shipment_number,
      status: row.status ?? row.shipping_order_status,
      href: "/app/logistics",
    })),
  ].slice(0, 12);

  return (
    <s-page heading={`Operations order ${order.order_name}`}>
      <s-section>
        <div className="kit-toolbar">
          <div>
            <s-link href="/app/orders">Back to Orders</s-link>
          </div>
          <div className="kit-toolbar-actions">
            {shopifyHref ? (
              <a href={shopifyHref} target="_blank" rel="noreferrer">
                Open in Shopify
              </a>
            ) : null}
            <Form method="post">
              <input type="hidden" name="intent" value="refreshPlanning" />
              <s-button type="submit">Refresh planning</s-button>
            </Form>
          </div>
        </div>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section heading="Summary">
        <DataTable
          headings={[
            "Order",
            "Order date",
            "Customer",
            "Email",
            "Payment",
            "Fulfillment",
            "Shipping address",
            "Address",
            "Operations status",
            "Next action",
          ]}
          rows={[
            [
              <strong>{order.order_name}</strong>,
              formatDate(order.processed_at ?? order.created_at),
              order.customer_name ?? "No customer",
              order.customer_email ?? "No email",
              <MoneylessBadge>{order.financial_status ?? "unknown"}</MoneylessBadge>,
              <MoneylessBadge>
                {order.fulfillment_status ?? "unfulfilled"}
              </MoneylessBadge>,
              shippingAddress ? formatAddress(shippingAddress) : "No shipping address",
              shippingReason ? (
                <MoneylessBadge tone="warning">Blocked</MoneylessBadge>
              ) : (
                <MoneylessBadge tone="success">Ready</MoneylessBadge>
              ),
              <MoneylessBadge tone={operationsStatusTone as any}>
                {operationsStatus}
              </MoneylessBadge>,
              nextActionHref === currentOrderHref ? (
                nextActionLabel
              ) : (
                <s-link href={nextActionHref}>{nextActionLabel}</s-link>
              ),
            ],
          ]}
        />
        {shippingReason ? <s-paragraph>{shippingReason}</s-paragraph> : null}
        <s-paragraph>{nextReason}</s-paragraph>
      </s-section>

      <s-section heading="Lines">
        <DataTable
          headings={[
            "Line item",
            "SKU / title",
            "Customer quantity",
            "Available stock",
            "Shortage",
            "Decision",
            "Linked need / PO / receipt / shipment",
            "Open line",
          ]}
          rows={lineStates.map(({ line, decision }, index) => {
            const itemId = line.item_id;
            const procurement = procurementRows.find(
              (row) => row.item_id === itemId,
            );
            const receipt = receiptRows.find((row) => row.item_id === itemId);
            const production = productionRows.find(
              (row) => row.item_id === itemId,
            );
            const logistics = logisticsRows.find(
              (row) => row.operations_order_line_id === line.id,
            );
            const allocatedAvailable = Number(
              line.allocated_available_quantity ?? line.available_quantity ?? 0,
            );
            const shortage = Math.max(Number(line.quantity ?? 0) - allocatedAvailable, 0);
            const demandScope = scopeLabel(
              procurement?.demand_link_scope ?? receipt?.demand_link_scope,
            );

            return {
              id: line.id,
                href: `/app/order-lines/${line.id}`,
                cells: [
                  `Line ${index + 1}`,
                  `${line.sku ?? line.item_sku} / ${line.title ?? line.item_title}`,
                  `${quantity(line.quantity)} ${line.unit}`,
                  `${quantity(allocatedAvailable)} available`,
                shortage > 0 ? `${quantity(shortage)} short` : "Covered",
                <MoneylessBadge tone={decision.tone}>
                  {decision.label}
                </MoneylessBadge>,
                <s-stack direction="block" gap="small">
                  <s-text>
                    {[
                      procurement?.purchase_order_number ??
                        procurement?.purchase_need_status,
                      receipt?.receipt_number,
                      production?.production_order_number ??
                        production?.production_need_status,
                      logistics?.shipment_number,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No linked work"}
                  </s-text>
                  {demandScope ? <s-text>{demandScope}</s-text> : null}
                </s-stack>,
                <s-link href={`/app/order-lines/${line.id}`}>
                  Open line
                </s-link>,
              ],
            };
          })}
        />
      </s-section>

      <s-section heading="Related work">
        {relatedRows.length > 0 ? (
          <DataTable
            headings={["Work", "Reference", "Status", "Demand scope", "Open"]}
            rows={relatedRows.map((row) => [
              row.type,
              row.reference ?? "No reference",
              <MoneylessBadge>{row.status ?? "open"}</MoneylessBadge>,
              scopeLabel((row as any).demand_link_scope) ?? "Linked context",
              row.href === nextActionHref ? (
                "Shown as next action"
              ) : (
                <s-link href={row.href}>Open {row.type}</s-link>
              ),
            ])}
          />
        ) : (
          <s-paragraph>
            No linked procurement, receiving, production or logistics work yet.
          </s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

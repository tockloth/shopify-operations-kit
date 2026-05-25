import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  loadOperationsOrderDetail,
  loadOperationsOrdersList,
  loadShopifyFulfillmentTargetForOrder,
  runOperationsMrp,
  updateOperationsOrderFulfillmentStatus,
} from "../lib/operations-kit.server";
import { fulfillShopifyOrderForShipment } from "../lib/shopify-fulfillment.server";
import { authenticate } from "../shopify.server";

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
  if (String(form.get("intent")) === "syncShopifyFulfillment") {
    const orderId = String(form.get("orderId") || "");
    const target = await loadShopifyFulfillmentTargetForOrder(
      context.pool,
      context.ctx.tenantId,
      orderId,
    );
    if (!target) return { message: "Order not found.", tone: "critical" };
    if (!target.shopify_order_gid) {
      return {
        message: "No Shopify order id is stored for this order.",
        tone: "critical",
      };
    }
    if (Number(target.shipped_shipment_count ?? 0) <= 0) {
      return {
        message:
          "Shopify fulfillment can only be updated after the local shipment is marked shipped.",
        tone: "critical",
      };
    }

    try {
      const { admin } = await authenticate.admin(request);
      const result = await fulfillShopifyOrderForShipment(
        admin,
        target.shopify_order_gid,
      );
      if (result.shopifyFulfillmentStatus) {
        await updateOperationsOrderFulfillmentStatus(
          context.pool,
          context.ctx.tenantId,
          target.id,
          result.shopifyFulfillmentStatus,
        );
      }
      return {
        message: `${target.order_name}: ${result.message}`,
        tone:
          result.shopifyFulfillmentStatus === "FULFILLED"
            ? "success"
            : "warning",
      };
    } catch (error) {
      return {
        message:
          error instanceof Error
            ? `${target.order_name}: ${error.message}`
            : `${target.order_name}: Shopify fulfillment failed.`,
        tone: "critical",
      };
    }
  }

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

function formatDateTime(value?: string | null) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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

function operationsStatusContent(status: string, tone: string, shipmentNumbers?: string | null) {
  const label =
    status === "Product classification required"
      ? "Classification required"
      : status;

  if (status === "Complete") {
    return (
      <s-stack direction="block" gap="small">
        <MoneylessBadge tone="success">Complete</MoneylessBadge>
        {shipmentNumbers ? <s-text>{shipmentNumbers}</s-text> : null}
      </s-stack>
    );
  }

  return (
    <MoneylessBadge tone={tone as any}>
      {label}
    </MoneylessBadge>
  );
}

function shopifyFulfillmentContent(order: any, operationsStatus: string) {
  return (
    <s-stack direction="block" gap="small">
      <MoneylessBadge
        tone={order.fulfillment_status === "FULFILLED" ? "success" : "warning"}
      >
        {order.fulfillment_status ?? "unfulfilled"}
      </MoneylessBadge>
      {operationsStatus === "Complete" &&
      order.fulfillment_status !== "FULFILLED" ? (
        <s-text>Shopify not updated</s-text>
      ) : null}
    </s-stack>
  );
}

function canUpdateShopifyFulfillment(order: any, orderSummary: any) {
  return (
    operationsComplete(orderSummary) &&
    order.fulfillment_status !== "FULFILLED" &&
    Number(orderSummary?.shipment_shipped_count ?? 0) > 0 &&
    Boolean(order.shopify_order_gid)
  );
}

function operationsComplete(orderSummary: any) {
  return (
    orderSummary?.operational_status === "Complete" ||
    Number(orderSummary?.shipment_shipped_count ?? 0) > 0
  );
}

function compactNextActionLabel(label?: string | null) {
  if (label === "Classify order line products") return "Classify products";
  if (label === "Review order lines") return "Review lines";
  return label ?? "Review lines";
}

function syncSummary(orderSummary: any, order: any) {
  const failed =
    String(orderSummary?.last_order_webhook_status ?? "").toLowerCase() ===
      "failed" ||
    Boolean(orderSummary?.last_order_webhook_error_message);
  const syncedAt = orderSummary?.shopify_order_synced_at ?? order.updated_at;
  return {
    label: failed ? "Failed" : "Synced",
    tone: failed ? ("critical" as const) : ("success" as const),
    time: formatTime(syncedAt),
  };
}

function lineProductLabel(line: any) {
  return `${line.sku ?? line.item_sku ?? "No SKU"} / ${line.title ?? line.item_title ?? "No title"}`;
}

type Decision = {
  label:
    | "Ready from stock"
    | "Needs procurement"
    | "Needs production"
    | "Product classification required"
    | "BOM required"
    | "Review order line"
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
      label: "Product classification required",
      reason: "Item has no operational sell/buy/make role yet.",
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
    if (Number(line.active_bom_count ?? 0) === 0) {
      return {
        label: "BOM required",
        reason: "Stock does not cover the line, the item is producible, and no active BOM exists.",
        tone: "critical",
        blocked: true,
        hasProcurement,
        hasProduction: true,
        hasLogistics,
      };
    }
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
    label: "Review order line",
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
  const compactNextAction = compactNextActionLabel(nextActionLabel);
  const nextActionHref = orderSummary?.next_action_href ?? `/app/orders/${order.id}`;
  const nextReason = orderSummary?.next_reason ?? "Review order lines.";
  const currentOrderHref = `/app/orders/${order.id}`;
  const orderSyncSummary = syncSummary(orderSummary, order);

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
      href: row.shipping_order_id
        ? `/app/logistics/${row.shipping_order_id}`
        : "/app/logistics",
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
            "Shopify fulfillment",
            "Address",
            "Operations",
            "Sync",
            "Next action",
          ]}
          rows={[
            [
              <strong>{order.order_name}</strong>,
              formatDate(order.processed_at ?? order.created_at),
              order.customer_name ?? "No customer",
              order.customer_email ?? "No email",
              <MoneylessBadge>{order.financial_status ?? "unknown"}</MoneylessBadge>,
              shopifyFulfillmentContent(order, operationsStatus),
              shippingReason ? (
                <MoneylessBadge tone="warning">Blocked</MoneylessBadge>
              ) : (
                <MoneylessBadge tone="success">Ready</MoneylessBadge>
              ),
              operationsStatusContent(
                operationsStatus,
                operationsStatusTone,
                orderSummary?.shipment_numbers,
              ),
              <s-stack direction="block" gap="small">
                <MoneylessBadge tone={orderSyncSummary.tone}>
                  {orderSyncSummary.label}
                </MoneylessBadge>
                {orderSyncSummary.time ? <s-text>{orderSyncSummary.time}</s-text> : null}
              </s-stack>,
              <s-stack direction="block" gap="small">
                {canUpdateShopifyFulfillment(order, orderSummary) ? (
                  <Form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="syncShopifyFulfillment"
                    />
                    <input type="hidden" name="orderId" value={order.id} />
                    <s-button type="submit">
                      Update Shopify fulfillment
                    </s-button>
                  </Form>
                ) : null}
                {nextActionHref === currentOrderHref ? (
                  <s-text>{compactNextAction}</s-text>
                ) : (
                  <s-link href={nextActionHref}>{compactNextAction}</s-link>
                )}
              </s-stack>,
            ],
          ]}
        />
      </s-section>

      <s-section>
        <details className="kit-compact-disclosure">
          <summary>Customer and shipping details</summary>
          <DataTable
            headings={["Customer", "Email", "Shipping address", "Address status"]}
            rows={[
              [
                order.customer_name ?? "No customer",
                order.customer_email ?? "No email",
                shippingAddress ? formatAddress(shippingAddress) : "No shipping address",
                shippingReason ?? "Ready",
              ],
            ]}
          />
        </details>
      </s-section>

      <s-section>
        <details className="kit-compact-disclosure">
          <summary>Sync details</summary>
          <DataTable
            headings={["Last synced", "Source", "Webhook topic", "Webhook status", "Error", "Log"]}
            rows={[
              [
                formatDateTime(orderSummary?.shopify_order_synced_at ?? order.updated_at),
                orderSummary?.last_order_sync_source ?? "unknown",
                orderSummary?.last_order_webhook_topic ?? "none",
                <MoneylessBadge tone={orderSyncSummary.tone}>
                  {orderSummary?.last_order_webhook_status ?? orderSyncSummary.label}
                </MoneylessBadge>,
                orderSummary?.last_order_webhook_error_message ?? "No error",
                <s-link href="/app/settings?section=audit">View sync log</s-link>,
              ],
            ]}
          />
        </details>
      </s-section>

      <s-section heading="Why this action is needed">
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

            return [
              `Line ${index + 1}`,
              line.item_id ? (
                <s-link href={`/app/items/${line.item_id}`}>
                  {lineProductLabel(line)}
                </s-link>
              ) : (
                lineProductLabel(line)
              ),
              `${quantity(line.quantity)} ${line.unit}`,
              `${quantity(allocatedAvailable)} available`,
                shortage > 0 ? `${quantity(shortage)} short` : "Covered",
                <s-stack direction="block" gap="small">
                  <MoneylessBadge tone={decision.tone}>
                    {decision.label}
                  </MoneylessBadge>
                  <s-text>{decision.reason}</s-text>
                  {decision.label === "Product classification required" &&
                  line.item_id ? (
                    <s-link href={`/app/items/${line.item_id}`}>
                      Classify product
                    </s-link>
                  ) : null}
                </s-stack>,
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
              ];
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

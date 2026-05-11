import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { loadOperationsOrderDetail } from "../lib/operations-kit.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    detail: await loadOperationsOrderDetail(
      context.pool,
      context.ctx.tenantId,
      params.orderId!,
    ),
  };
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
  const hasProduction = productionRows.some((row) => row.item_id === itemId);
  const hasLogistics = logisticsRows.some(
    (row) => row.operations_order_line_id === line.id,
  );
  const masterDataMissing =
    !line.is_sellable && !line.is_purchasable && !line.is_producible;
  const orderedQuantity = Number(line.quantity ?? 0);
  const availableQuantity = Number(line.available_quantity ?? 0);

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
      reason: "Operational work already exists for this line or item.",
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

  const hasReview = lineStates.some(
    (row) => row.decision.label === "Review master data",
  );
  const hasProcurement = lineStates.some(
    (row) =>
      row.decision.label === "Needs procurement" ||
      row.decision.hasProcurement,
  );
  const hasProduction = lineStates.some(
    (row) =>
      row.decision.label === "Needs production" || row.decision.hasProduction,
  );
  const reviewLine = lineStates.find(
    (row) => row.decision.label === "Review master data",
  )?.line;
  const allReady =
    lineStates.length > 0 &&
    lineStates.every(
      (row) =>
        row.decision.label === "Ready from stock" ||
        row.line.supply_status === "reserved",
    );

  const orderStatus = hasReview
    ? {
        label: "Review required",
        tone: "critical" as const,
        reason:
          "At least one order line is missing operational product data.",
        nextLabel: "Review order lines",
        nextHref: reviewLine
          ? `/app/order-lines/${reviewLine.id}`
          : `/app/orders/${order.id}`,
      }
    : hasProcurement
      ? {
          label: "Procurement in progress",
          tone: "warning" as const,
          reason:
            "At least one line needs procurement or has procurement/receiving work.",
          nextLabel: "Open Procurement",
          nextHref: "/app/procurement",
        }
      : hasProduction
        ? {
            label: "Production in progress",
            tone: "warning" as const,
            reason:
              "At least one line needs production or has production work.",
            nextLabel: "Open Production",
            nextHref: "/app/production",
          }
        : allReady
          ? {
              label: "Ready for logistics",
              tone: "success" as const,
              reason:
                "All lines are ready from stock or already reserved.",
              nextLabel: "Open Logistics",
              nextHref: "/app/logistics",
            }
          : {
              label: "In progress",
              tone: "info" as const,
              reason:
                "Operations Kit has partial context for this order. Review line decisions.",
              nextLabel: "Review order lines",
              nextHref: `/app/orders/${order.id}`,
            };

  const relatedRows = [
    ...procurementRows.map((row) => ({
      type: "Procurement",
      reference: row.purchase_order_number ?? "Purchase need",
      status: row.purchase_order_status ?? row.purchase_need_status,
      href: row.purchase_order_id
        ? `/app/procurement/${row.purchase_order_id}`
        : "/app/procurement",
    })),
    ...receiptRows.map((row) => ({
      type: "Receipt",
      reference: row.receipt_number,
      status: row.receipt_status,
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
        <s-link href="/app/orders">Back to orders</s-link>
      </s-section>

      <s-section heading="Order summary">
        <DataTable
          headings={[
            "Order",
            "Customer",
            "Payment",
            "Fulfillment",
            "Created / processed",
            "Operations",
          ]}
          rows={[
            [
              <strong>{order.order_name}</strong>,
              order.customer_name ?? "No customer",
              <MoneylessBadge>{order.financial_status ?? "unknown"}</MoneylessBadge>,
              <MoneylessBadge>
                {order.fulfillment_status ?? "unfulfilled"}
              </MoneylessBadge>,
              formatDate(order.processed_at ?? order.created_at),
              <MoneylessBadge>{order.status}</MoneylessBadge>,
            ],
          ]}
        />
        {shippingAddress ? (
          <s-paragraph>
            Ship to:{" "}
            {[
              shippingAddress.name ?? order.customer_name,
              shippingAddress.address1,
              shippingAddress.zip,
              shippingAddress.city,
              shippingAddress.countryCodeV2,
            ]
              .filter(Boolean)
              .join(", ")}
          </s-paragraph>
        ) : null}
      </s-section>

      <s-section heading="Operational status">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="small">
              <s-text>Status</s-text>
              <MoneylessBadge tone={orderStatus.tone}>
                {orderStatus.label}
              </MoneylessBadge>
            </s-stack>
            <s-paragraph>{orderStatus.reason}</s-paragraph>
            <s-link href={orderStatus.nextHref}>{orderStatus.nextLabel}</s-link>
          </s-stack>
        </s-box>
      </s-section>

      <s-section heading="Order lines work table">
        <DataTable
          headings={[
            "Line item",
            "Quantity",
            "Policy",
            "Inventory",
            "Decision",
            "Blocked",
            "Work context",
            "Detail",
          ]}
          rows={lineStates.map(({ line, decision }) => {
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

            return {
              id: line.id,
              href: `/app/order-lines/${line.id}`,
              cells: [
                <strong>
                  {line.sku ?? line.item_sku} {line.title ?? line.item_title}
                </strong>,
                `${quantity(line.quantity)} ${line.unit}`,
                [
                  line.item_type,
                  line.is_purchasable ? "buy" : null,
                  line.is_producible ? "make" : null,
                  line.is_sellable ? "sell" : null,
                ]
                  .filter(Boolean)
                  .join(" / ") || "not classified",
                [
                  `${quantity(line.available_quantity)} available`,
                  `${quantity(line.reserved_quantity)} reserved`,
                  `${quantity(line.ordered_quantity)} ordered`,
                  `${quantity(line.qc_hold_quantity)} QC hold`,
                ].join(" · "),
                <MoneylessBadge tone={decision.tone}>
                  {decision.label}
                </MoneylessBadge>,
                decision.blocked ? "Blocked" : "Clear",
                [
                  procurement?.purchase_order_number ??
                    procurement?.purchase_need_status,
                  receipt?.receipt_number,
                  production?.production_order_number ??
                    production?.production_need_status,
                  logistics?.shipment_number,
                ]
                  .filter(Boolean)
                  .join(" · ") || "No linked work",
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
            headings={["Work", "Reference", "Status", "Open"]}
            rows={relatedRows.map((row) => [
              row.type,
              row.reference ?? "No reference",
              <MoneylessBadge>{row.status ?? "open"}</MoneylessBadge>,
              <s-link href={row.href}>Open</s-link>,
            ])}
          />
        ) : (
          <s-paragraph>
            No linked procurement, receiving, production or logistics work yet.
          </s-paragraph>
        )}
      </s-section>

      <s-section heading="Next action">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            <s-heading>{orderStatus.nextLabel}</s-heading>
            <s-paragraph>{orderStatus.reason}</s-paragraph>
            <s-link href={orderStatus.nextHref}>{orderStatus.nextLabel}</s-link>
          </s-stack>
        </s-box>
      </s-section>
    </s-page>
  );
}

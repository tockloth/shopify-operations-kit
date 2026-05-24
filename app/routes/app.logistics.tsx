import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  createShippingOrdersFromOpenOperationsOrders,
  loadOperationsOrdersList,
  loadShippableOperationsOrders,
  loadShippingOrders,
} from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) {
    return { configured: false, setupError: context.setupError };
  }

  const url = new URL(request.url);
  return {
    configured: true,
    shippableOrders: await loadShippableOperationsOrders(
      context.pool,
      context.ctx.tenantId,
    ),
    orderSummaries: await loadOperationsOrdersList(
      context.pool,
      context.ctx.tenantId,
    ),
    shipping: await loadShippingOrders(context.pool, context.ctx.tenantId),
    filters: {
      queue: url.searchParams.get("queue") ?? "active",
      q: url.searchParams.get("q")?.trim() ?? "",
      address: url.searchParams.get("address") ?? "all",
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "createShipping") {
    const result = await createShippingOrdersFromOpenOperationsOrders(
      context.pool,
      context.ctx.tenantId,
      String(form.get("operationsOrderId") || "") || undefined,
    );
    if (result.shippingOrderIds[0]) {
      return redirect(`/app/logistics/${result.shippingOrderIds[0]}`);
    }
    return {
      message: result.blockedOrders.length
        ? `${result.blockedOrders.length} order(s) are blocked. Resolve address or inventory readiness first.`
        : "No shipment was created.",
    };
  }

  return { message: "No action was performed." };
};

function hasUsableShippingAddress(address?: any) {
  return Boolean(address?.address1 && address.city && address.countryCodeV2);
}

function formatAddress(address?: any) {
  return address
    ? [
        address.name,
        address.address1,
        address.address2,
        address.city,
        address.zip,
        address.provinceCode,
        address.countryCodeV2,
      ]
        .filter(Boolean)
        .join(", ")
    : "No shipping address";
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

function shipmentStatusLabel(status: string) {
  if (status === "packed") return "Packed";
  if (status === "shipped") return "Shipped";
  if (status === "cancelled") return "Cancelled";
  return "Shipment created";
}

function shipmentStatusTone(status: string) {
  if (status === "shipped") return "success";
  if (status === "packed") return "info";
  if (status === "cancelled") return "critical";
  return "warning";
}

function shipmentNextAction(status: string) {
  if (status === "open" || status === "picking") return "Open shipment";
  if (status === "packed") return "Open shipment";
  if (status === "shipped") return "Open shipment";
  return "Open shipment";
}

export default function Logistics() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("shipping" in data)) {
    return (
      <SetupBanner
        message={data.setupError ?? "Database setup is incomplete."}
      />
    );
  }

  const shipping = data.shipping ?? { orders: [], lines: [] };
  const filters = (data.filters ?? {
    queue: "active",
    q: "",
    address: "all",
  }) as any;
  const activeQueue = [
    "active",
    "ready",
    "blocked",
    "shipments",
    "completed",
  ].includes(filters.queue)
    ? filters.queue
    : "active";
  const summaryByOrderId = new Map(
    ((data as any).orderSummaries ?? []).map((order: any) => [order.id, order]),
  );
  const linesByShipment = new Map<string, any[]>();
  for (const line of (shipping.lines ?? []) as any[]) {
    const lines = linesByShipment.get(line.shipping_order_id) ?? [];
    lines.push(line);
    linesByShipment.set(line.shipping_order_id, lines);
  }

  const blocker = (order: any) => {
    const summary = summaryByOrderId.get(order.id) as any;
    const missing = [
      order.customer_name ? null : "Missing customer name",
      order.customer_email ? null : "Missing customer email",
      hasUsableShippingAddress(order.shipping_address)
        ? null
        : "Missing shipping address",
    ].filter(Boolean);
    if (missing.length > 0) return missing.join(" · ");
    if (summary?.operational_status !== "Ready for logistics") {
      return `Inventory not ready: ${summary?.operational_status ?? "Needs planning"}`;
    }
    return "";
  };

  const orderRows = (data.shippableOrders ?? [])
    .map((order: any) => {
      const block = blocker(order);
      return { ...order, blocker: block, logistics_status: block ? "Blocked" : "Ready" };
    })
    .filter((order: any) => {
      if (activeQueue === "shipments" || activeQueue === "completed") return false;
      if (activeQueue === "ready" && order.blocker) return false;
      if (activeQueue === "blocked" && !order.blocker) return false;
      if (filters.address === "ready" && !hasUsableShippingAddress(order.shipping_address)) {
        return false;
      }
      if (filters.address === "missing" && hasUsableShippingAddress(order.shipping_address)) {
        return false;
      }
      return matchesSearch(order, filters.q, [
        "order_name",
        "customer_name",
        "customer_email",
        "skus",
        "product_summary",
      ]);
    });

  const shipmentRows = (shipping.orders ?? [])
    .filter((shipment: any) => {
      const completed = shipment.status === "shipped" || shipment.status === "cancelled";
      if (activeQueue === "completed") return completed;
      if (activeQueue === "shipments") return true;
      if (activeQueue === "active") return !completed;
      return false;
    })
    .filter((shipment: any) =>
      matchesSearch(shipment, filters.q, [
        "shipment_number",
        "order_name",
        "customer_name",
        "customer_email",
      ]),
    );

  const workRows = [
    ...orderRows.map((order: any) => {
      const createShipmentActionId = `create-shipment-${order.id}`;
      return {
        id: `order-${order.id}`,
        href: order.blocker ? `/app/orders/${order.id}` : undefined,
        clickDelegateId: order.blocker ? undefined : createShipmentActionId,
        cells: [
          <strong>{order.order_name}</strong>,
          <MoneylessBadge tone={order.blocker ? "warning" : "success"}>
            {order.logistics_status}
          </MoneylessBadge>,
          <div>
            <strong>{order.customer_name ?? "No customer"}</strong>
            <div className="kit-muted">{order.customer_email ?? "No email"}</div>
            <div className="kit-muted">{formatAddress(order.shipping_address)}</div>
          </div>,
          order.product_summary ?? order.skus ?? "",
          order.blocker || "Inventory and address ready",
          order.blocker ? (
            <Link to={`/app/orders/${order.id}`}>Open order</Link>
          ) : (
            <Form method="post">
              <input type="hidden" name="intent" value="createShipping" />
              <input type="hidden" name="operationsOrderId" value={order.id} />
              <s-button id={createShipmentActionId} variant="primary" type="submit">
                Create and open shipment
              </s-button>
            </Form>
          ),
        ],
      };
    }),
    ...shipmentRows.map((shipment: any) => {
      const lines = linesByShipment.get(shipment.id) ?? [];
      const products = lines
        .slice(0, 2)
        .map(
          (line: any) =>
            `${Number(line.ordered_quantity).toLocaleString()} × ${line.sku} ${line.title}`,
        )
        .join("; ");
      return {
        id: `shipment-${shipment.id}`,
        href: `/app/logistics/${shipment.id}`,
        cells: [
          <strong>{shipment.shipment_number}</strong>,
          <MoneylessBadge tone={shipmentStatusTone(shipment.status) as any}>
            {shipmentStatusLabel(shipment.status)}
          </MoneylessBadge>,
          <div>
            <strong>{shipment.customer_name ?? "No customer"}</strong>
            <div className="kit-muted">
              {shipment.customer_email ?? "No email"}
            </div>
            <div className="kit-muted">
              {formatAddress(shipment.shipping_address)}
            </div>
          </div>,
          lines.length > 2
            ? `${products}; +${lines.length - 2} more`
            : products,
          shipment.order_name,
          <Link to={`/app/logistics/${shipment.id}`}>
            {shipmentNextAction(shipment.status)}
          </Link>,
        ],
      };
    }),
  ];

  const hasActiveFilters = Boolean(filters.q || filters.address !== "all");

  return (
    <s-page heading="Logistics">
      <s-section>
        <div className="kit-toolbar">
          <s-heading>Logistics</s-heading>
          <div className="kit-toolbar-actions">
            <s-link href="/app/logistics">
              <s-button>Refresh</s-button>
            </s-link>
          </div>
        </div>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
        <Form method="get">
          <div className="kit-filterbar kit-procurement-scopebar">
            <s-select label="Work queue" name="queue" value={activeQueue}>
              <s-option value="active">Active work</s-option>
              <s-option value="ready">Ready</s-option>
              <s-option value="blocked">Blocked</s-option>
              <s-option value="shipments">Shipments</s-option>
              <s-option value="completed">Completed</s-option>
            </s-select>
            <s-button type="submit">Apply</s-button>
          </div>
          <details className="kit-compact-disclosure" open={hasActiveFilters}>
            <summary>Filters</summary>
            <div className="kit-filterbar kit-procurement-filterbar">
              <s-text-field
                label="Order / customer / product"
                name="q"
                value={filters.q}
                placeholder="#1005, customer, SKU"
              ></s-text-field>
              <s-select label="Address" name="address" value={filters.address}>
                <s-option value="all">All address states</s-option>
                <s-option value="ready">Ready</s-option>
                <s-option value="missing">Missing</s-option>
              </s-select>
              <s-button type="submit">Apply filters</s-button>
              <Link to="/app/logistics">Clear filters</Link>
            </div>
          </details>
        </Form>
        <DataTable
          headings={[
            "Reference",
            "Status",
            "Customer / address",
            "Products / quantities",
            "Reason",
            "Next action",
          ]}
          rows={workRows}
        />
      </s-section>
    </s-page>
  );
}

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  backfillTestShippingAddressForOpenOrders,
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

  if (intent === "backfillTestShippingAddress") {
    const result = await backfillTestShippingAddressForOpenOrders(
      context.pool,
      context.ctx.tenantId,
    );
    return {
      message: `${result.updated} open order(s) backfilled with a local test shipping address.`,
    };
  }

  return { message: "No action was performed." };
};

function hasUsableShippingAddress(address?: any) {
  return Boolean(address?.address1 && address.city && address.countryCodeV2);
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
    ...orderRows.map((order: any) => ({
      id: `order-${order.id}`,
      href: order.blocker ? `/app/orders/${order.id}` : undefined,
      cells: [
        <strong>{order.order_name}</strong>,
        <MoneylessBadge tone={order.blocker ? "warning" : "success"}>
          {order.logistics_status}
        </MoneylessBadge>,
        order.customer_name ?? "No customer",
        order.skus ?? "",
        hasUsableShippingAddress(order.shipping_address) ? "Ready" : "Missing",
        order.blocker || "Inventory and address ready",
        order.blocker ? (
          <Link to={`/app/orders/${order.id}`}>Open order</Link>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="createShipping" />
            <input type="hidden" name="operationsOrderId" value={order.id} />
            <s-button variant="primary" type="submit">
              Create shipment
            </s-button>
          </Form>
        ),
      ],
    })),
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
          shipment.customer_name ?? "No customer",
          lines.length > 2
            ? `${products}; +${lines.length - 2} more`
            : products,
          hasUsableShippingAddress(shipment.shipping_address)
            ? "Ready"
            : "Missing",
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
        {process.env.NODE_ENV !== "production" ? (
          <details className="kit-compact-disclosure">
            <summary>Development tools</summary>
            <Form method="post">
              <input
                type="hidden"
                name="intent"
                value="backfillTestShippingAddress"
              />
              <s-button type="submit">
                Backfill test shipping address for open local test orders
              </s-button>
            </Form>
          </details>
        ) : null}

        <DataTable
          headings={[
            "Reference",
            "Status",
            "Customer",
            "Products / quantities",
            "Address",
            "Reason",
            "Next action",
          ]}
          rows={workRows}
        />
      </s-section>
    </s-page>
  );
}

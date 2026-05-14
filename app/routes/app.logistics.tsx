import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  backfillTestShippingAddressForOpenOrders,
  createShippingOrdersFromOpenOperationsOrders,
  loadShippableOperationsOrders,
  loadShippingOrders,
  transitionShippingOrder,
} from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    shippableOrders: await loadShippableOperationsOrders(
      context.pool,
      context.ctx.tenantId,
    ),
    shipping: await loadShippingOrders(context.pool, context.ctx.tenantId),
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
    return {
      message: `${result.shippingOrderIds.length} shipping order(s) created or refreshed.${
        result.blockedOrders.length
          ? ` ${result.blockedOrders.length} order(s) were blocked because customer name, email or shipping address is missing.`
          : ""
      }`,
    };
  }

  if (intent === "transitionShipping") {
    await transitionShippingOrder(
      context.pool,
      context.ctx.tenantId,
      String(form.get("shippingOrderId")),
      String(form.get("status")) === "shipped" ? "shipped" : "packed",
    );
    return { message: "Shipping order updated." };
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

export default function Logistics() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("shipping" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }
  const shipping = data.shipping ?? { orders: [], lines: [] };
  const formatAddress = (address?: any) =>
    address
      ? [
          address.address1,
          address.city,
          address.zip,
          address.countryCodeV2,
        ].filter(Boolean).join(", ")
      : "No address";
  const blockingReason = (order: any) =>
    [
      order.customer_name ? null : "Missing customer name",
      order.customer_email ? null : "Missing customer email",
      order.shipping_address ? null : "Missing shipping address",
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <s-page heading="Logistics">
      <s-section>
        <s-paragraph>
          Logistics turns ready customer demand into shipping orders, pack work
          and shipment evidence. A Shopify order can be shipped partially or
          fully; complete shipments close the Operations order.
        </s-paragraph>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
        {process.env.NODE_ENV !== "production" ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-text>
                Development only: backfill a local test shipping address for
                open orders that are missing customer or shipping data.
              </s-text>
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
            </s-stack>
          </s-box>
        ) : null}
      </s-section>

      <s-section heading="Ready for logistics">
        <DataTable
          headings={["Order", "Customer", "Ship to", "Products", "Lines", "Readiness", "Action"]}
          rows={(data.shippableOrders ?? []).map((order: any) => {
            const blocked = blockingReason(order);

            return [
              <strong>{order.order_name}</strong>,
              order.customer_name ?? "No customer",
              formatAddress(order.shipping_address),
              order.skus ?? "",
              order.line_count,
              blocked ? (
                <s-stack direction="block" gap="small">
                  <MoneylessBadge tone="warning">Blocked</MoneylessBadge>
                  <s-text>{blocked}</s-text>
                </s-stack>
              ) : (
                <MoneylessBadge tone="success">Ready</MoneylessBadge>
              ),
              blocked ? (
                "Resolve customer / shipping data"
              ) : (
                <Form method="post">
                  <input type="hidden" name="intent" value="createShipping" />
                  <input
                    type="hidden"
                    name="operationsOrderId"
                    value={order.id}
                  />
                  <s-button variant="primary" type="submit">
                    Create shipment
                  </s-button>
                </Form>
              ),
            ];
          })}
        />
      </s-section>

      <s-section heading="Shipping orders">
        <DataTable
          headings={["Shipment", "Order", "Customer", "Ship to", "Status", "Lines", "Actions"]}
          rows={(shipping.orders ?? []).map((order: any) => [
            <strong>{order.shipment_number}</strong>,
            order.order_name,
            order.customer_name ?? "No customer",
            formatAddress(order.shipping_address),
            <MoneylessBadge
              tone={order.status === "shipped" ? "success" : order.status === "packed" ? "info" : "warning"}
            >
              {order.status}
            </MoneylessBadge>,
            order.line_count,
            <s-stack direction="inline" gap="small">
              <Form method="post">
                <input type="hidden" name="intent" value="transitionShipping" />
                <input type="hidden" name="shippingOrderId" value={order.id} />
                <input type="hidden" name="status" value="packed" />
                <s-button type="submit">Mark packed</s-button>
              </Form>
              <Form method="post">
                <input type="hidden" name="intent" value="transitionShipping" />
                <input type="hidden" name="shippingOrderId" value={order.id} />
                <input type="hidden" name="status" value="shipped" />
                <s-button variant="primary" type="submit">Mark shipped</s-button>
              </Form>
            </s-stack>,
          ])}
        />
      </s-section>

      <s-section heading="Shipment lines">
        <DataTable
          headings={["Shipment", "Item", "Ordered", "Packed", "Shipped", "Status"]}
          rows={(shipping.lines ?? []).map((line: any) => [
            line.shipment_number,
            <strong>{line.sku} {line.title}</strong>,
            `${Number(line.ordered_quantity).toLocaleString()} ${line.unit}`,
            Number(line.packed_quantity).toLocaleString(),
            Number(line.shipped_quantity).toLocaleString(),
            <MoneylessBadge>{line.status}</MoneylessBadge>,
          ])}
        />
      </s-section>
    </s-page>
  );
}

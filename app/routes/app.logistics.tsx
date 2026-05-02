import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
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
      message: `${result.shippingOrderIds.length} shipping order(s) created or refreshed.`,
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

  return { message: "No action was performed." };
};

export default function Logistics() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("shipping" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }
  const shipping = data.shipping ?? { orders: [], lines: [] };

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
      </s-section>

      <s-section heading="Ready for logistics">
        <DataTable
          headings={["Order", "Customer", "Products", "Lines", "Status", "Action"]}
          rows={(data.shippableOrders ?? []).map((order: any) => [
            <strong>{order.order_name}</strong>,
            order.customer_name ?? "No customer",
            order.skus ?? "",
            order.line_count,
            <MoneylessBadge>{order.status}</MoneylessBadge>,
            <Form method="post">
              <input type="hidden" name="intent" value="createShipping" />
              <input type="hidden" name="operationsOrderId" value={order.id} />
              <s-button variant="primary" type="submit">Create shipment</s-button>
            </Form>,
          ])}
        />
      </s-section>

      <s-section heading="Shipping orders">
        <DataTable
          headings={["Shipment", "Order", "Customer", "Status", "Lines", "Actions"]}
          rows={(shipping.orders ?? []).map((order: any) => [
            <strong>{order.shipment_number}</strong>,
            order.order_name,
            order.customer_name ?? "No customer",
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

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  consolidateOpenOrdersByCustomer,
  createShippingOrdersFromOpenOperationsOrders,
  loadOperationsOrdersList,
  redactOperationsOrderCustomerData,
  runOperationsMrp,
} from "../lib/operations-kit.server";
import { syncShopifyOrders } from "../lib/shopify-sync.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    shopDomain: context.shopDomain,
    orders: await loadOperationsOrdersList(context.pool, context.ctx.tenantId),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent") || "sync");

  if (intent === "consolidate") {
    const result = await consolidateOpenOrdersByCustomer(
      context.pool,
      context.ctx.tenantId,
    );
    return {
      message: `${result.merged} customer order group(s) consolidated for operations planning.`,
    };
  }

  if (intent === "runOperationsMrp") {
    const result = await runOperationsMrp(context.pool, context.ctx.tenantId);
    return {
      message: `Planning run created for ${result.orderLines} open order line(s). Open Procurement to review and create purchase orders for trading goods.`,
    };
  }

  if (intent === "createLogisticsWork") {
    const result = await createShippingOrdersFromOpenOperationsOrders(
      context.pool,
      context.ctx.tenantId,
    );
    return {
      message: `${result.shippingOrderIds.length} logistics order(s) created from open operations orders.${
        result.blockedOrders.length
          ? ` ${result.blockedOrders.length} order(s) were blocked because customer name, email or shipping address is missing for shipping.`
          : ""
      }`,
    };
  }

  if (intent === "redactCustomerData") {
    await redactOperationsOrderCustomerData(
      context.pool,
      context.ctx.tenantId,
      String(form.get("orderId")),
    );
    return { message: "Customer data redacted for this order." };
  }

  try {
    const result = await syncShopifyOrders(context.pool, context.ctx.tenantId, admin);
    const protectedDataMessage = !result.customerDataAvailable
      ? " Customer name, email and shipping address were skipped because the current Shopify app installation does not include the required protected customer data access."
      : !result.shippingAddressAvailable
        ? " Customer name and email were synced. Shipping address was skipped because Address is not approved in Protected Customer Data."
        : "";

    return {
      message: `${result.orders} Shopify order(s) and ${result.lines} line item(s) synced into Operations Kit.${protectedDataMessage}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("not approved to access the Order object") ||
      message.toLowerCase().includes("protected customer data") ||
      message.toLowerCase().includes("not approved for protected customer data")
    ) {
      return {
        message:
          "Order sync is blocked by Shopify Protected Customer Data. This is an app access setting, not an Operations Kit process error. Enable Protected customer data access for Orders in the Partner Dashboard, restart the dev preview, then re-approve the app scopes.",
      };
    }

    throw error;
  }
};

function shopifyOrderUrl(shopDomain: string, legacyId?: string | null) {
  if (!legacyId) return null;
  const shop = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${shop}/orders/${legacyId}`;
}

function statusTone(status?: string | null) {
  if (status === "Review required") return "critical";
  if (status === "Ready for logistics") return "success";
  if (status === "Procurement in progress" || status === "Production in progress") {
    return "warning";
  }
  return "info";
}

function compactSkus(value?: string | null) {
  if (!value) return "No products";
  const skus = value.split(", ").filter(Boolean);
  if (skus.length <= 3) return value;
  return `${skus.slice(0, 3).join(", ")} +${skus.length - 3} more`;
}

export default function Orders() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("orders" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  const orders = data.orders ?? [];
  const statusCounts = {
    review: orders.filter((order: any) => order.operational_status === "Review required").length,
    procurement: orders.filter((order: any) => order.operational_status === "Procurement in progress").length,
    production: orders.filter((order: any) => order.operational_status === "Production in progress").length,
    ready: orders.filter((order: any) => order.operational_status === "Ready for logistics").length,
    inProgress: orders.filter((order: any) => order.operational_status === "In progress").length,
  };

  return (
    <s-page heading="Orders">
      <s-section>
        <div className="kit-toolbar">
          <div>
            <s-heading>Orders</s-heading>
            <div className="kit-list-summary">
              Review Shopify orders and see what operational work is needed.
            </div>
          </div>
          <div className="kit-toolbar-actions">
            <s-link href="/app/orders/new">Create manual order</s-link>
            <Form method="post">
              <input type="hidden" name="intent" value="sync" />
              <s-button variant="primary" type="submit">Sync Shopify orders</s-button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="runOperationsMrp" />
              <s-button type="submit">Plan open orders</s-button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="createLogisticsWork" />
              <s-button type="submit">Create logistics work</s-button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="consolidate" />
              <s-button type="submit">Consolidate</s-button>
            </Form>
          </div>
        </div>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section heading="Operational status">
        <DataTable
          headings={[
            "Review required",
            "Procurement in progress",
            "Production in progress",
            "Ready for logistics",
            "In progress",
          ]}
          rows={[
            [
              statusCounts.review.toLocaleString(),
              statusCounts.procurement.toLocaleString(),
              statusCounts.production.toLocaleString(),
              statusCounts.ready.toLocaleString(),
              statusCounts.inProgress.toLocaleString(),
            ],
          ]}
        />
      </s-section>

      <s-section heading="Orders work queue">
        {orders.length === 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>Sync Shopify orders to create operational demand.</s-paragraph>
          </s-box>
        ) : (
          <DataTable
            headings={[
              "Order",
              "Customer",
              "Shopify status",
              "Lines / products",
              "Operational work",
              "Next",
            ]}
            rows={orders.map((order: any) => {
              const lineCount = Number(order.line_count ?? 0);

              return {
                id: order.id,
                href: `/app/orders/${order.id}`,
                cells: [
                  <strong>{order.order_name}</strong>,
                  order.customer_name ?? "No customer",
                  <s-stack direction="block" gap="small">
                    <MoneylessBadge tone={order.financial_status === "PAID" ? "success" : "neutral"}>
                      {order.financial_status ?? "unknown"}
                    </MoneylessBadge>
                    <MoneylessBadge tone={order.fulfillment_status === "FULFILLED" ? "success" : "warning"}>
                      {order.fulfillment_status ?? "unfulfilled"}
                    </MoneylessBadge>
                  </s-stack>,
                  <s-stack direction="block" gap="small">
                    <s-text>
                      {lineCount.toLocaleString()} {lineCount === 1 ? "line" : "lines"}
                    </s-text>
                    <s-text>{compactSkus(order.skus)}</s-text>
                  </s-stack>,
                  <s-stack direction="block" gap="small">
                    <MoneylessBadge tone={statusTone(order.operational_status)}>
                      {order.operational_status ?? "In progress"}
                    </MoneylessBadge>
                    <s-text>{order.next_reason ?? "Review line decisions."}</s-text>
                  </s-stack>,
                  <s-stack direction="block" gap="small">
                    <s-link href={order.next_action_href ?? `/app/orders/${order.id}`}>
                      {order.next_action_label ?? "Open order"}
                    </s-link>
                    {shopifyOrderUrl(data.shopDomain ?? "", order.shopify_order_legacy_id) ? (
                      <a
                        href={shopifyOrderUrl(data.shopDomain ?? "", order.shopify_order_legacy_id)!}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Shopify
                      </a>
                    ) : null}
                  </s-stack>,
                ],
              };
            })}
          />
        )}
      </s-section>
    </s-page>
  );
}

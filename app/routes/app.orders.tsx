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
  const url = new URL(request.url);
  const filters = {
    query: url.searchParams.get("q")?.trim() ?? "",
    fulfillment: url.searchParams.get("fulfillment") ?? "all",
    payment: url.searchParams.get("payment") ?? "all",
    addressMissing: url.searchParams.get("addressMissing") ?? "all",
  };
  const orders = await loadOperationsOrdersList(context.pool, context.ctx.tenantId);
  const filteredOrders = filterOrders(orders, filters);

  return {
    configured: true,
    shopDomain: context.shopDomain,
    filters,
    orders,
    filteredOrders,
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
    const protectedDataMessage = result.protectedCustomerDataUnavailable
      ? result.customerDataAvailable
        ? result.customerDefaultAddressesStored > 0
          ? " Shopify did not return order shipping addresses; customer default addresses were stored where available. Check Protected Customer Data access if checkout shipping addresses should be available."
          : " Shopify did not return shipping addresses. Check Protected Customer Data access and app scopes."
        : " Shopify did not return customer name, email, or shipping addresses. Check Protected Customer Data access and app scopes."
      : result.shippingAddressesMissing > 0
        ? ` ${result.shippingAddressesMissing} order(s) did not include a usable Shopify shipping address.`
        : "";

    return {
      message: `${result.orders} Shopify order(s) and ${result.lines} line item(s) synced into Operations Kit. ${result.shippingAddressesStored} shipping address(es) stored.${protectedDataMessage}`,
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

function compactProducts(value?: string | null) {
  if (!value) return "No products";
  const products = value.split(" || ").filter(Boolean);
  if (products.length <= 2) return products.join(" · ");
  return `${products.slice(0, 2).join(" · ")} · +${products.length - 2} more`;
}

function formatOrderDate(value?: string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(value));
}

function filterOrders(orders: any[], filters: any) {
  const query = String(filters.query ?? "").toLowerCase();
  return orders.filter((order) => {
    const searchable = [
      order.order_name,
      order.customer_name,
      order.customer_email,
      order.product_summary,
      order.skus,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (
      filters.fulfillment !== "all" &&
      String(order.fulfillment_status ?? "unfulfilled") !== filters.fulfillment
    ) {
      return false;
    }
    if (
      filters.payment !== "all" &&
      String(order.financial_status ?? "unknown") !== filters.payment
    ) {
      return false;
    }
    const missingAddress = Boolean(shippingBlockReason(order));
    if (filters.addressMissing === "yes" && !missingAddress) return false;
    if (filters.addressMissing === "no" && missingAddress) return false;
    return true;
  });
}

function uniqueValues(orders: any[], field: string, fallback: string) {
  return Array.from(
    new Set(
      orders.map((order) => String(order[field] ?? fallback)).filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function shippingBlockReason(order: any) {
  const missing = [
    order.customer_name ? null : "missing customer name",
    order.customer_email ? null : "missing customer email",
    order.shipping_address?.address1 &&
    order.shipping_address?.city &&
    order.shipping_address?.countryCodeV2
      ? null
      : "missing shipping address",
  ].filter(Boolean);

  return missing.length > 0 ? missing.join(", ") : null;
}

export default function Orders() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("orders" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  const orders = data.orders ?? [];
  const filteredOrders = data.filteredOrders ?? orders;
  const filters = data.filters ?? {
    query: "",
    fulfillment: "all",
    payment: "all",
    addressMissing: "all",
  };
  const hasActiveFilters =
    filters.query ||
    filters.fulfillment !== "all" ||
    filters.payment !== "all" ||
    filters.addressMissing !== "all";
  const paymentStatuses = uniqueValues(orders as any[], "financial_status", "unknown");
  const fulfillmentStatuses = uniqueValues(
    orders as any[],
    "fulfillment_status",
    "unfulfilled",
  );
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
            <Form method="post">
              <input type="hidden" name="intent" value="sync" />
              <s-button variant="primary" type="submit">Sync Shopify orders</s-button>
            </Form>
          </div>
        </div>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section>
        <details open={Boolean(hasActiveFilters)}>
          <summary>Filters</summary>
          <Form method="get">
            <div className="kit-filterbar">
              <s-text-field
                label="Search order, customer or product"
                name="q"
                value={filters.query}
              />
              <s-select label="Fulfillment" name="fulfillment" value={filters.fulfillment}>
                <s-option value="all">All fulfillment statuses</s-option>
                {fulfillmentStatuses.map((status) => (
                  <s-option key={status} value={status}>
                    {status}
                  </s-option>
                ))}
              </s-select>
              <s-select label="Payment" name="payment" value={filters.payment}>
                <s-option value="all">All payment statuses</s-option>
                {paymentStatuses.map((status) => (
                  <s-option key={status} value={status}>
                    {status}
                  </s-option>
                ))}
              </s-select>
              <s-select
                label="Address missing"
                name="addressMissing"
                value={filters.addressMissing}
              >
                <s-option value="all">All orders</s-option>
                <s-option value="yes">Address/name/email missing</s-option>
                <s-option value="no">Shipping data ready</s-option>
              </s-select>
            </div>
            <s-stack direction="inline" gap="small">
              <s-button type="submit">Apply filters</s-button>
              <s-link href="/app/orders">Clear filters</s-link>
            </s-stack>
          </Form>
        </details>
        <s-paragraph>
          Showing {filteredOrders.length.toLocaleString()} of{" "}
          {orders.length.toLocaleString()} order(s).
        </s-paragraph>
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
              "Order date",
              "Customer",
              "Products / quantities",
              "Payment",
              "Fulfillment",
              "Address",
              "Next action",
            ]}
            rows={filteredOrders.map((order: any) => {
              const lineCount = Number(order.line_count ?? 0);
              const blockReason = shippingBlockReason(order);

              return {
                id: order.id,
                href: `/app/orders/${order.id}`,
                cells: [
                  <strong>{order.order_name}</strong>,
                  formatOrderDate(order.processed_at ?? order.created_at),
                  order.customer_name ?? "No customer",
                  <s-stack direction="block" gap="small">
                    <s-text>
                      {lineCount.toLocaleString()} {lineCount === 1 ? "line" : "lines"}
                    </s-text>
                    <s-text>{compactProducts(order.product_summary ?? order.skus)}</s-text>
                  </s-stack>,
                  <MoneylessBadge tone={order.financial_status === "PAID" ? "success" : "neutral"}>
                    {order.financial_status ?? "unknown"}
                  </MoneylessBadge>,
                  <MoneylessBadge tone={order.fulfillment_status === "FULFILLED" ? "success" : "warning"}>
                    {order.fulfillment_status ?? "unfulfilled"}
                  </MoneylessBadge>,
                  blockReason ? (
                    <s-stack direction="block" gap="small">
                      <MoneylessBadge tone="warning">Missing</MoneylessBadge>
                      <s-text>{blockReason}</s-text>
                    </s-stack>
                  ) : (
                    <MoneylessBadge tone="success">Ready</MoneylessBadge>
                  ),
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

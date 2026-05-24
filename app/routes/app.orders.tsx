import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  loadShopifyFulfillmentTargetForOrder,
  loadOperationsOrdersList,
  updateOperationsOrderFulfillmentStatus,
} from "../lib/operations-kit.server";
import { fulfillShopifyOrderForShipment } from "../lib/shopify-fulfillment.server";
import { syncShopifyOrders } from "../lib/shopify-sync.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };
  const url = new URL(request.url);
  const filters = {
    queue: url.searchParams.get("queue") ?? "active",
    query: url.searchParams.get("q")?.trim() ?? "",
    fulfillment: url.searchParams.get("fulfillment") ?? "all",
    payment: url.searchParams.get("payment") ?? "all",
    addressMissing: url.searchParams.get("addressMissing") ?? "all",
  };
  const notice = url.searchParams.get("notice");
  const noticeTone = url.searchParams.get("tone") ?? "info";
  const orders = await loadOperationsOrdersList(context.pool, context.ctx.tenantId);
  const filteredOrders = filterOrders(orders, filters);

  return {
    configured: true,
    shopDomain: context.shopDomain,
    filters,
    notice: notice ? { message: notice, tone: noticeTone } : null,
    orders,
    filteredOrders,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return ordersRedirect(context.setupError, "critical");

  const form = await request.formData();
  const intent = String(form.get("intent") || "sync");

  if (intent === "syncShopifyFulfillment") {
    const orderId = String(form.get("orderId") || "");
    const target = await loadShopifyFulfillmentTargetForOrder(
      context.pool,
      context.ctx.tenantId,
      orderId,
    );
    if (!target) return ordersRedirect("Order not found.", "critical");
    if (!target.shopify_order_gid) {
      return ordersRedirect("No Shopify order id is stored for this order.", "critical");
    }
    if (Number(target.shipped_shipment_count ?? 0) <= 0) {
      return ordersRedirect(
        "Shopify fulfillment can only be updated after the local shipment is marked shipped.",
        "critical",
      );
    }

    try {
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
      return ordersRedirect(
        `${target.order_name}: ${result.message}`,
        result.shopifyFulfillmentStatus === "FULFILLED"
          ? "success"
          : "warning",
      );
    } catch (error) {
      return ordersRedirect(
        error instanceof Error
          ? `${target.order_name}: ${error.message}`
          : `${target.order_name}: Shopify fulfillment failed.`,
        "critical",
      );
    }
  }

  if (intent !== "sync") return ordersRedirect("No action was performed.", "info");

  try {
    const result = await syncShopifyOrders(context.pool, context.ctx.tenantId, admin);
    const protectedDataMessage = result.protectedCustomerDataUnavailable
      ? result.protectedCustomerDataDeniedAt === "customer_fallback_query"
        ? " Shopify GraphQL denied protected customer fields for the current app installation/session, so Operations Kit used an orders-only fallback. Re-authorize or reinstall the app after confirming Protected Customer Data access for name, email, and address."
        : result.customerDataAvailable
          ? result.customerDefaultAddressesStored > 0
            ? " Shopify GraphQL denied the full order customer/address query; customer default addresses were stored where available. Re-authorize or reinstall the app if checkout shipping addresses should be available."
            : " Shopify GraphQL denied shipping-address fields. Check Protected Customer Data access for address fields, then re-authorize or reinstall the app."
          : " Shopify GraphQL denied protected customer fields for the current app installation/session. Check Protected Customer Data access and re-authorize or reinstall the app."
      : result.shippingAddressesMissing > 0
        ? ` ${result.shippingAddressesMissing} order(s) did not include a usable Shopify shipping address.`
        : "";

    return ordersRedirect(
      `${result.orders} Shopify order(s) and ${result.lines} line item(s) synced into Operations Kit. ${result.shippingAddressesStored} shipping address(es) stored.${protectedDataMessage}`,
      "success",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("not approved to access the Order object") ||
      message.toLowerCase().includes("protected customer data") ||
      message.toLowerCase().includes("not approved for protected customer data")
    ) {
      return ordersRedirect(
        "Order sync is blocked by Shopify Protected Customer Data. This is an app access setting, not an Operations Kit process error. Enable Protected customer data access for Orders in the Partner Dashboard, restart the dev preview, then re-approve the app scopes.",
        "critical",
      );
    }

    throw error;
  }
};

function ordersRedirect(message: string, tone: string) {
  const params = new URLSearchParams({ notice: message, tone });
  return redirect(`/app/orders?${params.toString()}`);
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
  const queue = ["active", "completed", "all"].includes(filters.queue)
    ? filters.queue
    : "active";
  return orders.filter((order) => {
    const completed = isCompletedOrder(order);
    if (queue === "active" && completed) return false;
    if (queue === "completed" && !completed) return false;
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
  }).sort((left, right) => {
    if (queue === "completed") {
      return (
        orderSortTime(right.latest_shipped_at ?? right.updated_at ?? right.created_at) -
        orderSortTime(left.latest_shipped_at ?? left.updated_at ?? left.created_at)
      );
    }
    return (
      orderSortTime(right.latest_shipped_at ?? right.processed_at ?? right.created_at) -
      orderSortTime(left.latest_shipped_at ?? left.processed_at ?? left.created_at)
    );
  });
}

function normalizedQueueStatus(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function isCompletedOrder(order: any) {
  const fulfillmentStatus = normalizedQueueStatus(order.fulfillment_status);
  const operationalStatus = normalizedQueueStatus(order.operational_status);
  return (
    fulfillmentStatus === "fulfilled" ||
    fulfillmentStatus === "closed" ||
    operationalStatus === "complete" ||
    operationalStatus === "fulfilled_done"
  );
}

function orderSortTime(value: unknown) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
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

function operationsStatusContent(order: any) {
  if (order.operational_status === "Complete") {
    return (
      <s-stack direction="block" gap="small">
        <MoneylessBadge tone="success">Complete</MoneylessBadge>
        {order.shipment_numbers ? (
          <s-text>{order.shipment_numbers}</s-text>
        ) : null}
      </s-stack>
    );
  }

  return (
    <MoneylessBadge tone={order.operational_status_tone ?? "info"}>
      {order.operational_status ?? "Needs planning"}
    </MoneylessBadge>
  );
}

function shopifyFulfillmentContent(order: any) {
  return (
    <s-stack direction="block" gap="small">
      <MoneylessBadge
        tone={order.fulfillment_status === "FULFILLED" ? "success" : "warning"}
      >
        {order.fulfillment_status ?? "unfulfilled"}
      </MoneylessBadge>
      {order.operational_status === "Complete" &&
      order.fulfillment_status !== "FULFILLED" ? (
        <s-text>Shopify not updated</s-text>
      ) : null}
    </s-stack>
  );
}

function canUpdateShopifyFulfillment(order: any) {
  return (
    order.operational_status === "Complete" &&
    order.fulfillment_status !== "FULFILLED" &&
    Number(order.shipment_shipped_count ?? 0) > 0 &&
    Boolean(order.shopify_order_gid)
  );
}

function nextActionContent(order: any) {
  if (canUpdateShopifyFulfillment(order)) {
    return (
      <Form method="post">
        <input type="hidden" name="intent" value="syncShopifyFulfillment" />
        <input type="hidden" name="orderId" value={order.id} />
        <s-button type="submit">Update Shopify fulfillment</s-button>
      </Form>
    );
  }

  return "Open order";
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
    queue: "active",
    query: "",
    fulfillment: "all",
    payment: "all",
    addressMissing: "all",
  };
  const hasActiveFilters =
    filters.query ||
    filters.queue !== "active" ||
    filters.fulfillment !== "all" ||
    filters.payment !== "all" ||
    filters.addressMissing !== "all";
  const paymentStatuses = uniqueValues(orders as any[], "financial_status", "unknown");
  const fulfillmentStatuses = uniqueValues(
    orders as any[],
    "fulfillment_status",
    "unfulfilled",
  );
  const actionNotice = actionData as { message?: string } | undefined;
  const notice = actionNotice?.message ? actionNotice : data.notice;
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
        {notice?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{notice.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section>
        <details open={Boolean(hasActiveFilters)}>
          <summary>Filters</summary>
          <Form method="get">
            <div className="kit-filterbar">
              <s-select label="Work queue" name="queue" value={filters.queue}>
                <s-option value="all">All orders</s-option>
                <s-option value="active">Active work</s-option>
                <s-option value="completed">Completed</s-option>
              </s-select>
              <s-text-field
                label="Search order, customer or product"
                name="q"
                value={filters.query}
              />
              <s-select label="Shopify fulfillment" name="fulfillment" value={filters.fulfillment}>
                <s-option value="all">All Shopify fulfillment statuses</s-option>
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

      <s-section heading="Orders">
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
              "Operations",
              "Payment",
              "Shopify fulfillment",
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
                  operationsStatusContent(order),
                  <MoneylessBadge tone={order.financial_status === "PAID" ? "success" : "neutral"}>
                    {order.financial_status ?? "unknown"}
                  </MoneylessBadge>,
                  shopifyFulfillmentContent(order),
                  blockReason ? (
                    <s-stack direction="block" gap="small">
                      <MoneylessBadge tone="warning">Missing</MoneylessBadge>
                      <s-text>{blockReason}</s-text>
                    </s-stack>
                  ) : (
                    <MoneylessBadge tone="success">Ready</MoneylessBadge>
                  ),
                  nextActionContent(order),
                ],
              };
            })}
          />
        )}
      </s-section>
    </s-page>
  );
}

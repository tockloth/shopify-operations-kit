import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  consolidateOpenOrdersByCustomer,
  createOperationsOrderEntry,
  createShippingOrdersFromOpenOperationsOrders,
  loadOperationsOrderLinesList,
  loadOperationsOrdersList,
  loadSellableItemsForOrderEntry,
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
    sellableItems: await loadSellableItemsForOrderEntry(
      context.pool,
      context.ctx.tenantId,
    ),
    orders: await loadOperationsOrdersList(context.pool, context.ctx.tenantId),
    orderLines: await loadOperationsOrderLinesList(context.pool, context.ctx.tenantId),
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

  if (intent === "createOperationsOrder") {
    const result = await createOperationsOrderEntry(
      context.pool,
      context.ctx.tenantId,
      {
        orderName: String(form.get("orderName") || ""),
        customerName: String(form.get("customerName") || ""),
        customerEmail: String(form.get("customerEmail") || ""),
        itemId: String(form.get("itemId") || ""),
        quantity: Number(form.get("quantity") || 1),
      },
    );
    return {
      message: `${result.orderName} entered. It can now be planned through BOM / MRP.`,
    };
  }

  if (intent === "runOperationsMrp") {
    const result = await runOperationsMrp(context.pool, context.ctx.tenantId);
    return {
      message: `Planning run created for ${result.orderLines} open order line(s). Open BOM / MRP to review and commit production and procurement needs.`,
    };
  }

  if (intent === "createLogisticsWork") {
    const result = await createShippingOrdersFromOpenOperationsOrders(
      context.pool,
      context.ctx.tenantId,
    );
    return {
      message: `${result.shippingOrderIds.length} logistics order(s) created from open operations orders.`,
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
    return {
      message: `${result.orders} Shopify order(s) and ${result.lines} line item(s) synced into Operations Kit.${
        result.customerDataAvailable
          ? ""
          : " Customer name and email were skipped because the current Shopify dev session does not include read_customers."
      }`,
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

function formatDate(value?: string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function Orders() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("orders" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  return (
    <s-page heading="Orders">
      <s-section>
        <div className="kit-toolbar">
          <div>
            <s-heading>Operations orders</s-heading>
            <div className="kit-list-summary">
              Shopify orders enriched for MRP, procurement, production, QC,
              inventory and logistics.
            </div>
          </div>
          <div className="kit-toolbar-actions">
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
        <DataTable
          headings={[
            "Order",
            "Date",
            "Customer",
            "Payment status",
            "Fulfillment",
            "Items",
            "Products",
            "Operations",
            "Shopify",
            "Privacy",
          ]}
          rows={(data.orders ?? []).map((order: any) => ({
            id: order.id,
            href: `/app/orders/${order.id}`,
            cells: [
              <strong>{order.order_name}</strong>,
              formatDate(order.processed_at ?? order.created_at),
              order.customer_name ?? "No customer",
              <MoneylessBadge tone={order.financial_status === "PAID" ? "success" : "neutral"}>
                {order.financial_status ?? "unknown"}
              </MoneylessBadge>,
              <MoneylessBadge tone={order.fulfillment_status === "FULFILLED" ? "success" : "warning"}>
                {order.fulfillment_status ?? "unfulfilled"}
              </MoneylessBadge>,
              `${Number(order.line_count ?? 0).toLocaleString()} ${Number(order.line_count ?? 0) === 1 ? "item" : "items"}`,
              order.skus ?? "No lines",
              <MoneylessBadge>{order.status}</MoneylessBadge>,
              shopifyOrderUrl(data.shopDomain ?? "", order.shopify_order_legacy_id) ? (
                <a
                  href={shopifyOrderUrl(data.shopDomain ?? "", order.shopify_order_legacy_id)!}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Shopify
                </a>
              ) : (
                "Not synced"
              ),
              order.customer_data_redacted_at ? (
                "Redacted"
              ) : (
                <Form method="post" onClick={(event) => event.stopPropagation()}>
                  <input type="hidden" name="intent" value="redactCustomerData" />
                  <input type="hidden" name="orderId" value={order.id} />
                  <s-button type="submit">Delete customer data</s-button>
                </Form>
              ),
            ],
          }))}
        />
      </s-section>

      <s-section heading="Order lines">
        <DataTable
          headings={["Line item", "Order", "Quantity", "Item role", "Make / buy", "Supply status"]}
          rows={(data.orderLines ?? []).map((line: any) => ({
            id: line.id,
            href: `/app/order-lines/${line.id}`,
            cells: [
              <strong>{line.sku ?? line.item_sku ?? "No SKU"} · {line.title ?? line.item_title ?? "No title"}</strong>,
              line.order_name,
              `${Number(line.quantity).toLocaleString()} ${line.unit}`,
              <MoneylessBadge>{line.item_type}</MoneylessBadge>,
              [
                line.is_producible ? `produce ${Number(line.default_production_quantity ?? 1).toLocaleString()}` : null,
                line.is_purchasable ? `order ${Number(line.default_order_quantity ?? 1).toLocaleString()}` : null,
                line.is_sellable ? "sellable" : null,
              ].filter(Boolean).join(", ") || "not classified",
              <MoneylessBadge>{line.supply_status}</MoneylessBadge>,
            ],
          }))}
        />
      </s-section>

      <s-section heading="Manual operations order entry">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <Form method="post">
            <input type="hidden" name="intent" value="createOperationsOrder" />
            <s-stack direction="block" gap="base">
              <s-text-field
                label="Order number"
                name="orderName"
                placeholder="INTAKE-1001"
              ></s-text-field>
              <s-text-field
                label="Customer"
                name="customerName"
                placeholder="Customer name"
              ></s-text-field>
              <s-email-field
                label="Email"
                name="customerEmail"
                placeholder="customer@example.com"
              ></s-email-field>
              <s-select label="Product" name="itemId" required>
                <s-option value="">Select sellable item</s-option>
                {(data.sellableItems ?? []).map((item: any) => (
                  <s-option key={item.id} value={item.id}>
                    {item.sku} · {item.title}
                  </s-option>
                ))}
              </s-select>
              <s-number-field
                label="Quantity"
                name="quantity"
                min={1}
                step={1}
                value="1"
              ></s-number-field>
            </s-stack>
            <s-button variant="primary" type="submit">Create operations order</s-button>
          </Form>
        </s-box>
      </s-section>

    </s-page>
  );
}

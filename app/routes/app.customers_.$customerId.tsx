import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { loadOperationsCustomerDetail } from "../lib/operations-kit.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    detail: await loadOperationsCustomerDetail(
      context.pool,
      context.ctx.tenantId,
      params.customerId!,
    ),
  };
};

function formatDate(value?: string | null) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function formatMoney(amount?: string | number | null, currency?: string | null) {
  if (amount == null) return "No spend";
  return `${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency ?? ""}`.trim();
}

function compactProducts(value?: string | null) {
  if (!value) return "No products";
  const products = value.split(" || ").filter(Boolean);
  if (products.length <= 2) return products.join(" · ");
  return `${products.slice(0, 2).join(" · ")} · +${products.length - 2} more`;
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

export default function CustomerDetail() {
  const data = useLoaderData<typeof loader>();
  if (!data.configured || !("detail" in data)) {
    return (
      <SetupBanner
        message={data.setupError ?? "Database setup is incomplete."}
      />
    );
  }

  const customer = data.detail?.customer as any;
  const orders = (data.detail?.orders ?? []) as any[];

  if (!customer) {
    return (
      <s-page heading="Customer not found">
        <s-section>
          <s-link href="/app/customers">Back to customers</s-link>
        </s-section>
      </s-page>
    );
  }

  const displayName =
    customer.display_name ??
    `Shopify customer ${customer.shopify_customer_legacy_id ?? customer.shopify_customer_gid}`;

  return (
    <s-page heading={displayName}>
      <s-section>
        <s-link href="/app/customers">Back to customers</s-link>
      </s-section>

      <s-section heading="Customer summary">
        <DataTable
          headings={[
            "Customer",
            "Email",
            "Shopify customer",
            "Orders",
            "Amount spent",
            "Privacy",
          ]}
          rows={[
            [
              <strong>{displayName}</strong>,
              customer.email ?? "No email",
              customer.shopify_customer_legacy_id ??
                customer.shopify_customer_gid ??
                "Not synced",
              Number(customer.number_of_orders ?? 0).toLocaleString(),
              formatMoney(
                customer.amount_spent,
                customer.amount_spent_currency,
              ),
              customer.customer_data_redacted_at ? (
                <MoneylessBadge tone="neutral">Redacted</MoneylessBadge>
              ) : !customer.display_name && !customer.email ? (
                <MoneylessBadge tone="neutral">No PCD</MoneylessBadge>
              ) : (
                <MoneylessBadge tone="success">Encrypted</MoneylessBadge>
              ),
            ],
          ]}
        />
      </s-section>

      <s-section heading="Address / shipping readiness">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            <s-paragraph>
              No customer address is stored. Shipping address is usually taken
              from the Shopify order.
            </s-paragraph>
            <s-paragraph>
              Recent linked orders with shipping address:{" "}
              {
                orders.filter((order) => Boolean(order.shipping_address))
                  .length
              }{" "}
              of {orders.length}
            </s-paragraph>
          </s-stack>
        </s-box>
      </s-section>

      <s-section heading="Related orders">
        {orders.length > 0 ? (
          <DataTable
            headings={[
              "Order",
              "Status",
              "Payment",
              "Fulfillment",
              "Products",
              "Shipping address",
              "Processed",
            ]}
            rows={orders.map((order: any) => ({
              id: order.id,
              href: `/app/orders/${order.id}`,
              cells: [
                <strong>{order.order_name}</strong>,
                <MoneylessBadge>{order.status}</MoneylessBadge>,
                order.financial_status ?? "unknown",
                order.fulfillment_status ?? "unfulfilled",
                compactProducts(order.product_summary),
                order.shipping_address ? (
                  formatAddress(order.shipping_address)
                ) : (
                  <MoneylessBadge tone="warning">Missing</MoneylessBadge>
                ),
                formatDate(order.processed_at ?? order.created_at),
              ],
            }))}
          />
        ) : (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>
              Order linkage is based on synced Shopify order customer data and
              may be unavailable for historic redacted records.
            </s-paragraph>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}

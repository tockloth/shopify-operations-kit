import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { loadOperationsCustomersList } from "../lib/operations-kit.server";
import { syncShopifyCustomers } from "../lib/shopify-sync.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    customers: await loadOperationsCustomersList(context.pool, context.ctx.tenantId),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  try {
    const result = await syncShopifyCustomers(context.pool, context.ctx.tenantId, admin);
    return {
      message: `${result.customers} Shopify customer(s) synced into Operations Kit.${
        result.customerDataAvailable
          ? ""
          : " Personal customer fields were skipped because this app is not approved for Protected Customer Data."
      }`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("read_customers") ||
      message.toLowerCase().includes("customer field") ||
      message.toLowerCase().includes("customers field")
    ) {
      return {
        message:
          "Customer sync needs the read_customers scope, but the current Shopify app installation does not have it. Run npm run deploy to upload the updated shopify.app.toml scopes, then restart with npm run dev:ledger:reset and approve the updated scopes. The terminal must list read_customers under Access scopes auto-granted.",
      };
    }

    throw error;
  }
};

function formatDate(value?: string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMoney(amount?: string | number | null, currency?: string | null) {
  if (amount == null) return "No spend";
  return `${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency ?? ""}`.trim();
}

export default function Customers() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("customers" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  return (
    <s-page heading="Customers">
      <s-section>
        <div className="kit-toolbar">
          <div>
            <s-heading>Customer master data</s-heading>
            <div className="kit-list-summary">
              Shopify customers synced for operations context. Personal data is
              stored encrypted and can be redacted from orders.
            </div>
          </div>
          <div className="kit-toolbar-actions">
            <Form method="post">
              <s-button variant="primary" type="submit">Sync Shopify customers</s-button>
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
            "Customer",
            "Email",
            "Orders",
            "Amount spent",
            "Shopify updated",
            "Privacy",
          ]}
          rows={(data.customers ?? []).map((customer: any) => ({
            id: customer.id,
            cells: [
              <strong>
                {customer.display_name ??
                  `Shopify customer ${customer.shopify_customer_legacy_id ?? customer.shopify_customer_gid}`}
              </strong>,
              customer.email ?? "No email",
              Number(customer.number_of_orders ?? 0).toLocaleString(),
              formatMoney(customer.amount_spent, customer.amount_spent_currency),
              formatDate(customer.shopify_updated_at ?? customer.synced_at),
              customer.customer_data_redacted_at ? (
                <MoneylessBadge tone="neutral">Redacted</MoneylessBadge>
              ) : !customer.display_name && !customer.email ? (
                <MoneylessBadge tone="neutral">No PCD</MoneylessBadge>
              ) : (
                <MoneylessBadge tone="success">Encrypted</MoneylessBadge>
              ),
            ],
          }))}
        />
      </s-section>
    </s-page>
  );
}

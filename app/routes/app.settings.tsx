import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  loadPrivacySettings,
  redactExpiredCustomerData,
  updatePrivacySettings,
} from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) {
    return {
      configured: false,
      setupError: context.setupError,
      shopDomain: context.shopDomain,
    };
  }

  return {
    configured: true,
    shopDomain: context.shopDomain,
    tenantId: context.ctx.tenantId,
    privacy: await loadPrivacySettings(context.pool, context.ctx.tenantId),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "savePrivacy") {
    await updatePrivacySettings(context.pool, context.ctx.tenantId, {
      customerDataRetentionDays: Number(form.get("customerDataRetentionDays") || 365),
    });
    return { message: "Privacy settings saved." };
  }

  if (intent === "redactExpired") {
    const result = await redactExpiredCustomerData(context.pool, context.ctx.tenantId);
    return { message: `${result.redacted} expired order record(s) redacted.` };
  }

  return { message: "No action was performed." };
};

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("tenantId" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  return (
    <s-page heading="Settings">
      <s-section heading="Connection">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            <s-paragraph>Shop: {data.shopDomain}</s-paragraph>
            <s-paragraph>Tenant: {data.tenantId}</s-paragraph>
            <s-paragraph>Database: connected</s-paragraph>
          </s-stack>
        </s-box>
      </s-section>
      {actionData?.message ? (
        <s-section>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        </s-section>
      ) : null}
      <s-section heading="Customer data protection">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <Form method="post">
            <input type="hidden" name="intent" value="savePrivacy" />
            <s-stack direction="block" gap="base">
              <s-number-field
                label="Retention after order"
                name="customerDataRetentionDays"
                min={1}
                step={1}
                value={String(data.privacy?.customer_data_retention_days ?? 365)}
              ></s-number-field>
              <s-box padding="small" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-heading>Storage</s-heading>
                  <s-paragraph>
                    Customer name and email are encrypted before database storage.
                  </s-paragraph>
                </s-stack>
              </s-box>
            </s-stack>
            <s-button variant="primary" type="submit">Save privacy settings</s-button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="redactExpired" />
            <s-button type="submit">Redact expired customer data now</s-button>
          </Form>
        </s-box>
      </s-section>
      <s-section heading="Access settings">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
            <s-stack direction="block" gap="small">
              <s-heading>Users, groups and roles</s-heading>
              <s-paragraph>
                Manage employees, fixed operating groups and the first read,
                write and execute permissions for the trading-goods workflow.
              </s-paragraph>
            </s-stack>
            <s-link href="/app/settings/users">Open users</s-link>
          </s-stack>
        </s-box>
      </s-section>
      <s-section heading="Current product scope">
        <s-paragraph>
          Implemented: Shopify app shell, tenant bootstrap, product sync,
          order intake, encrypted customer storage, customer-data redaction,
          retention settings, product classification, supplier master data,
          purchasing terms, order availability, inventory ledger, purchase
          needs and draft purchase orders for trading goods.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

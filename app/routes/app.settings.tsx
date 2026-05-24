import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  loadPrivacySettings,
  redactExpiredCustomerData,
  seedSampleOperatingScenario,
  updatePrivacySettings,
} from "../lib/operations-kit.server";
import { diagnoseShopifyCustomerDataAccess } from "../lib/shopify-sync.server";
import { authenticate } from "../shopify.server";

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

  if (intent === "seedSampleScenario") {
    const result = await seedSampleOperatingScenario(
      context.pool,
      context.ctx.tenantId,
    );
    return {
      message: `Sample operating scenario ready: ${result.itemCount} products, ${result.supplierCount} suppliers, ${result.purchaseOrderNumber} ${
        result.purchaseOrderCreated ? "created" : "reused"
      } and acknowledged. Next: open Procurement, open ${result.purchaseOrderNumber}, create the Goods Receipt, then complete QC and Putaway.`,
      tenantId: context.ctx.tenantId,
      shopDomain: context.shopDomain,
      purchaseOrderId: result.purchaseOrderId,
      purchaseOrderNumber: result.purchaseOrderNumber,
      purchaseOrderStatus: "acknowledged",
      receiptId: result.receiptId,
    };
  }

  if (intent === "diagnoseShopifyAccess") {
    const { admin } = await authenticate.admin(request);
    return {
      message: "Shopify access diagnostics completed.",
      diagnostics: await diagnoseShopifyCustomerDataAccess(
        context.pool,
        context.ctx.tenantId,
        admin,
      ),
    };
  }

  return { message: "No action was performed." };
};

function yesNo(value: boolean) {
  return value ? "yes" : "no";
}

function diagnosticErrors(
  errors: Array<{
    message: string;
    path: string | null;
    code: string | null;
    extensionKeys?: string[];
  }>,
) {
  if (!errors.length) return "none";
  return errors
    .map((error) => {
      const details = [
        error.path ? `path: ${error.path}` : null,
        error.code ? `code: ${error.code}` : null,
        error.extensionKeys?.length
          ? `extensions: ${error.extensionKeys.join(",")}`
          : null,
      ].filter(Boolean);
      return details.length
        ? `${error.message} (${details.join(", ")})`
        : error.message;
    })
    .join(" | ");
}

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("tenantId" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }
  const diagnostics =
    actionData && "diagnostics" in actionData ? actionData.diagnostics : null;

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
            <s-stack direction="block" gap="small">
              <s-paragraph>{actionData.message}</s-paragraph>
              {"tenantId" in actionData && actionData.tenantId ? (
                <s-paragraph>Current tenant: {actionData.tenantId}</s-paragraph>
              ) : null}
              {"shopDomain" in actionData && actionData.shopDomain ? (
                <s-paragraph>Shop: {actionData.shopDomain}</s-paragraph>
              ) : null}
              {"purchaseOrderNumber" in actionData &&
              actionData.purchaseOrderNumber ? (
                <s-paragraph>
                  Purchase Order: {actionData.purchaseOrderNumber} ·{" "}
                  {"purchaseOrderStatus" in actionData
                    ? actionData.purchaseOrderStatus
                    : "acknowledged"}
                </s-paragraph>
              ) : null}
              {"purchaseOrderId" in actionData && actionData.purchaseOrderId ? (
                <s-paragraph>Purchase Order ID: {actionData.purchaseOrderId}</s-paragraph>
              ) : null}
              {"purchaseOrderId" in actionData && actionData.purchaseOrderId ? (
                <s-link href={`/app/procurement/${actionData.purchaseOrderId}`}>
                  Open sample Purchase Order
                </s-link>
              ) : null}
              {"receiptId" in actionData && actionData.receiptId ? (
                <s-link href={`/app/receiving/${actionData.receiptId}`}>
                  Open sample Goods Receipt
                </s-link>
              ) : null}
            </s-stack>
          </s-box>
        </s-section>
      ) : null}
      <s-section heading="Development sample data">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small">
              <s-heading>Seed sample operating scenario</s-heading>
              <s-paragraph>
                Recreate products, suppliers and one acknowledged Purchase Order
                for local Procurement, Receiving, QC, Putaway and Payables
                testing after a database reset.
              </s-paragraph>
            </s-stack>
            <Form method="post">
              <input type="hidden" name="intent" value="seedSampleScenario" />
              <s-button variant="primary" type="submit">
                Seed sample operating scenario
              </s-button>
            </Form>
          </s-stack>
        </s-box>
      </s-section>
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
      <s-section heading="Shopify access diagnostics">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small">
              <s-heading>Current app token probe</s-heading>
              <s-paragraph>
                Development/staging diagnostic for the currently installed Shopify
                Admin API token. It shows scopes, access booleans and GraphQL
                errors only; customer names, emails, addresses and tokens are not
                displayed.
              </s-paragraph>
            </s-stack>
            <Form method="post">
              <input type="hidden" name="intent" value="diagnoseShopifyAccess" />
              <s-button type="submit">Run Shopify access diagnostics</s-button>
            </Form>
            {diagnostics ? (
              <s-box padding="small" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-heading>Granted scopes</s-heading>
                  <s-paragraph>
                    Query OK: {yesNo(diagnostics.accessScopes.queryOk)}
                  </s-paragraph>
                  <s-paragraph>
                    read_orders: {yesNo(diagnostics.accessScopes.hasReadOrders)}
                  </s-paragraph>
                  <s-paragraph>
                    read_customers: {yesNo(diagnostics.accessScopes.hasReadCustomers)}
                  </s-paragraph>
                  <s-paragraph>
                    Handles: {diagnostics.accessScopes.grantedScopes.join(", ") || "none"}
                  </s-paragraph>
                  <s-paragraph>
                    Scope errors: {diagnosticErrors(diagnostics.accessScopes.errors)}
                  </s-paragraph>

                  <s-heading>Order probe</s-heading>
                  <s-paragraph>
                    Orders query OK: {yesNo(diagnostics.orderProbe.queryOk)}
                  </s-paragraph>
                  <s-paragraph>
                    Sample order returned: {yesNo(diagnostics.orderProbe.orderReturned)}
                  </s-paragraph>
                  <s-paragraph>
                    Order errors: {diagnosticErrors(diagnostics.orderProbe.errors)}
                  </s-paragraph>

                  <s-heading>Protected customer data probe</s-heading>
                  <s-paragraph>
                    Customer field accessible:{" "}
                    {yesNo(diagnostics.protectedCustomerData.customerFieldAccessible)}
                  </s-paragraph>
                  <s-paragraph>
                    Customer object returned:{" "}
                    {yesNo(diagnostics.protectedCustomerData.customerObjectReturned)}
                  </s-paragraph>
                  <s-paragraph>
                    Customer name/email returned:{" "}
                    {yesNo(diagnostics.protectedCustomerData.customerNameOrEmailReturned)}
                  </s-paragraph>
                  <s-paragraph>
                    Shipping address accessible:{" "}
                    {yesNo(diagnostics.protectedCustomerData.shippingAddressAccessible)}
                  </s-paragraph>
                  <s-paragraph>
                    Shipping address returned:{" "}
                    {yesNo(diagnostics.protectedCustomerData.shippingAddressReturned)}
                  </s-paragraph>
                  <s-paragraph>
                    Customer default address accessible:{" "}
                    {yesNo(diagnostics.protectedCustomerData.defaultAddressAccessible)}
                  </s-paragraph>
                  <s-paragraph>
                    Customer default address returned:{" "}
                    {yesNo(diagnostics.protectedCustomerData.defaultAddressReturned)}
                  </s-paragraph>
                  <s-paragraph>
                    Customer field errors:{" "}
                    {diagnosticErrors(diagnostics.protectedCustomerData.errors.customer)}
                  </s-paragraph>
                  <s-paragraph>
                    Shipping address errors:{" "}
                    {diagnosticErrors(
                      diagnostics.protectedCustomerData.errors.shippingAddress,
                    )}
                  </s-paragraph>
                  <s-paragraph>
                    Default address errors:{" "}
                    {diagnosticErrors(
                      diagnostics.protectedCustomerData.errors.defaultAddress,
                    )}
                  </s-paragraph>

                  <s-heading>Stored Operations Kit data</s-heading>
                  {diagnostics.protectedCustomerData.customerNameOrEmailReturned &&
                  diagnostics.protectedCustomerData.shippingAddressReturned &&
                  diagnostics.storageProbe.ordersWithCustomerName === 0 &&
                  diagnostics.storageProbe.ordersWithCustomerEmail === 0 &&
                  diagnostics.storageProbe.ordersWithShippingAddress === 0 ? (
                    <s-paragraph>
                      Shopify returned customer data, but Operations Kit has no
                      encrypted customer fields stored yet. Run Orders sync and
                      re-run this diagnostic.
                    </s-paragraph>
                  ) : null}
                  <s-paragraph>
                    Orders stored: {diagnostics.storageProbe.totalOrders}
                  </s-paragraph>
                  <s-paragraph>
                    Orders with encrypted customer name:{" "}
                    {diagnostics.storageProbe.ordersWithCustomerName}
                  </s-paragraph>
                  <s-paragraph>
                    Orders with encrypted customer email:{" "}
                    {diagnostics.storageProbe.ordersWithCustomerEmail}
                  </s-paragraph>
                  <s-paragraph>
                    Orders with encrypted shipping address:{" "}
                    {diagnostics.storageProbe.ordersWithShippingAddress}
                  </s-paragraph>
                </s-stack>
              </s-box>
            ) : null}
          </s-stack>
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

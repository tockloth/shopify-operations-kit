import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  loadPrivacySettings,
  loadSyncLog,
  loadSyncOverview,
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
  const url = new URL(request.url);
  const syncFilters = {
    status: url.searchParams.get("syncStatus") ?? "all",
    topic: url.searchParams.get("syncTopic") ?? "all",
    entityType: url.searchParams.get("entityType") ?? "all",
    failedOnly: url.searchParams.get("failedOnly") === "yes",
  };

  return {
    configured: true,
    shopDomain: context.shopDomain,
    tenantId: context.ctx.tenantId,
    privacy: await loadPrivacySettings(context.pool, context.ctx.tenantId),
    syncFilters,
    syncOverview: await loadSyncOverview(context.pool, context.ctx.tenantId),
    syncLog: await loadSyncLog(context.pool, context.ctx.tenantId, syncFilters),
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

function formatDateTime(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function syncStatusTone(status?: string | null) {
  if (status === "processed") return "success" as const;
  if (status === "failed") return "critical" as const;
  if (status === "ignored_duplicate") return "neutral" as const;
  return "warning" as const;
}

export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("tenantId" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }
  const diagnostics =
    actionData && "diagnostics" in actionData ? actionData.diagnostics : null;
  const syncOverview = "syncOverview" in data ? (data.syncOverview as any) : null;
  const syncFilters = "syncFilters" in data ? (data.syncFilters as any) : {};
  const syncLog = "syncLog" in data ? ((data.syncLog ?? []) as any[]) : [];

  return (
    <s-page heading="Settings">
      <s-section heading="Tenant & Shopify">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            <s-heading>Shop installation</s-heading>
            <s-paragraph>Shop: {data.shopDomain}</s-paragraph>
            <s-paragraph>Tenant: {data.tenantId}</s-paragraph>
            <s-paragraph>Database: connected</s-paragraph>
            <s-heading>Sync status</s-heading>
            <s-paragraph>
              Last Product sync: {formatDateTime(syncOverview?.last_product_synced_at)} ·{" "}
              {syncOverview?.last_product_sync_source ?? "unknown"} ·{" "}
              {syncOverview?.last_product_webhook_topic ?? "no webhook"}
            </s-paragraph>
            <s-paragraph>
              Last Order sync: {formatDateTime(syncOverview?.last_order_synced_at)} ·{" "}
              {syncOverview?.last_order_sync_source ?? "unknown"} ·{" "}
              {syncOverview?.last_order_webhook_topic ?? "no webhook"}
            </s-paragraph>
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
      <s-section heading="Operations">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small">
              <s-heading>Product classification and sample data</s-heading>
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
      <s-section heading="Audit & Health">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-heading>Sync log</s-heading>
            <s-paragraph>
              Webhook and sync delivery history for the current tenant. Unknown-shop
              events are recorded in webhook events before a tenant can be assigned.
            </s-paragraph>
            <Form method="get">
              <input type="hidden" name="section" value="audit" />
              <div className="kit-filterbar">
                <s-select label="Status" name="syncStatus" value={syncFilters.status ?? "all"}>
                  <s-option value="all">All statuses</s-option>
                  <s-option value="received">Received</s-option>
                  <s-option value="processed">Processed</s-option>
                  <s-option value="failed">Failed</s-option>
                  <s-option value="ignored_duplicate">Ignored duplicate</s-option>
                </s-select>
                <s-select label="Topic" name="syncTopic" value={syncFilters.topic ?? "all"}>
                  <s-option value="all">All topics</s-option>
                  <s-option value="ORDERS_CREATE">Orders create</s-option>
                  <s-option value="ORDERS_UPDATED">Orders updated</s-option>
                  <s-option value="PRODUCTS_CREATE">Products create</s-option>
                  <s-option value="PRODUCTS_UPDATE">Products update</s-option>
                  <s-option value="PRODUCTS_DELETE">Products delete</s-option>
                </s-select>
                <s-select label="Entity type" name="entityType" value={syncFilters.entityType ?? "all"}>
                  <s-option value="all">All entities</s-option>
                  <s-option value="order">Orders</s-option>
                  <s-option value="product">Products</s-option>
                  <s-option value="other">Other</s-option>
                </s-select>
                <s-select
                  label="Failed only"
                  name="failedOnly"
                  value={syncFilters.failedOnly ? "yes" : "no"}
                >
                  <s-option value="no">No</s-option>
                  <s-option value="yes">Yes</s-option>
                </s-select>
              </div>
              <s-stack direction="inline" gap="small">
                <s-button type="submit">Apply filters</s-button>
                <s-link href="/app/settings?section=audit">Clear filters</s-link>
              </s-stack>
            </Form>
            <div className="kit-resource-table">
              <s-table variant="auto">
                <s-table-header-row>
                  <s-table-header>Topic</s-table-header>
                  <s-table-header>Status</s-table-header>
                  <s-table-header>Received</s-table-header>
                  <s-table-header>Processed</s-table-header>
                  <s-table-header>Shop</s-table-header>
                  <s-table-header>Resource</s-table-header>
                  <s-table-header>Error</s-table-header>
                  <s-table-header>Open</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {syncLog.length === 0 ? (
                    <s-table-row>
                      <s-table-cell>No sync events yet.</s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                      <s-table-cell></s-table-cell>
                    </s-table-row>
                  ) : null}
                  {syncLog.map((event) => (
                    <s-table-row key={event.id}>
                      <s-table-cell>{event.topic}</s-table-cell>
                      <s-table-cell>
                        <s-badge tone={syncStatusTone(event.status)}>
                          {event.status}
                        </s-badge>
                      </s-table-cell>
                      <s-table-cell>{formatDateTime(event.received_at)}</s-table-cell>
                      <s-table-cell>{formatDateTime(event.processed_at)}</s-table-cell>
                      <s-table-cell>{event.shop_domain}</s-table-cell>
                      <s-table-cell>
                        {event.entity_label ?? event.resource_gid ?? "No resource"}
                      </s-table-cell>
                      <s-table-cell>{event.error_message ?? "none"}</s-table-cell>
                      <s-table-cell>
                        {event.entity_href ? (
                          <s-link href={event.entity_href}>
                            Open {event.entity_type}
                          </s-link>
                        ) : (
                          "No entity link"
                        )}
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            </div>
          </s-stack>
        </s-box>
      </s-section>
      <s-section heading="Tenant & Shopify">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-heading>Customer data protection</s-heading>
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
          </s-stack>
        </s-box>
      </s-section>
      <s-section heading="Tenant & Shopify">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small">
              <s-heading>Shopify access diagnostics</s-heading>
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

                  <s-heading>Storage preflight</s-heading>
                  <s-paragraph>
                    Encryption configured:{" "}
                    {yesNo(diagnostics.storagePreflight.encryptionConfigured)}
                  </s-paragraph>
                  <s-paragraph>
                    Encryption source: {diagnostics.storagePreflight.encryptionSource}
                  </s-paragraph>
                  <s-paragraph>
                    Development encryption fallback:{" "}
                    {yesNo(
                      diagnostics.storagePreflight.usingDevelopmentEncryptionFallback,
                    )}
                  </s-paragraph>
                  <s-paragraph>
                    Encryption can encrypt/decrypt test value:{" "}
                    {yesNo(diagnostics.storagePreflight.encryptionRoundTripOk)}
                  </s-paragraph>
                  <s-paragraph>
                    Database write path available:{" "}
                    {yesNo(diagnostics.storagePreflight.databaseWritePathAvailable)}
                  </s-paragraph>
                  <s-paragraph>
                    Database write error:{" "}
                    {diagnostics.storagePreflight.databaseWriteError ?? "none"}
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

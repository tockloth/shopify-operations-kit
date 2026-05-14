import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { loadItems } from "../lib/operations-kit.server";
import { syncShopifyProducts } from "../lib/shopify-sync.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const source = url.searchParams.get("source") ?? "all";

  return {
    configured: true,
    shopDomain: context.shopDomain,
    filters: { query, source },
    items: await loadItems(context.pool, context.ctx.tenantId, { query, source }),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const result = await syncShopifyProducts(context.pool, context.ctx.tenantId, admin);
  return {
    message: `${result.products} Shopify product(s) and ${result.variants} variant(s) synced into Operations Kit. ${result.markedMissing} stale product record(s) marked missing.`,
  };
};

function shopifyProductUrl(shopDomain: string, legacyId?: string | null) {
  if (!legacyId) return null;
  const shop = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${shop}/products/${legacyId}`;
}

function shopVisibility(item: any) {
  if (item.product_source !== "shopify") {
    return { label: "Not in Shopify", tone: "neutral" as const };
  }
  if (!item.is_active || item.product_status === "MISSING") {
    return { label: "Stale / missing", tone: "critical" as const };
  }
  if (item.product_status === "DRAFT") {
    return { label: "Draft", tone: "warning" as const };
  }
  if (item.product_status === "ARCHIVED") {
    return { label: "Archived", tone: "neutral" as const };
  }
  if (item.shop_product_flag === "shop") {
    return { label: "On shop", tone: "success" as const };
  }
  if (
    item.product_status === "ACTIVE" &&
    !item.shopify_published_at &&
    !item.shopify_online_store_url
  ) {
    return { label: "Not published", tone: "warning" as const };
  }
  return { label: "Shopify synced", tone: "info" as const };
}

export default function Items() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("items" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }
  const filters = "filters" in data && data.filters ? data.filters : { query: "", source: "all" };

  return (
    <s-page heading="Products">
      <s-section>
        <div className="kit-toolbar">
          <div>
            <s-heading>Product master data</s-heading>
            <div className="kit-list-summary">
              Products are the operational master records. Shopify products and
              variants sync into this table. Order lines are separate demand
              positions that reference these products.
            </div>
          </div>
          <div className="kit-toolbar-actions">
            <s-link href="/app/items/new">Create operational component</s-link>
            <Form method="post">
              <input type="hidden" name="intent" value="syncShopifyProducts" />
              <s-button variant="primary" type="submit">Sync Shopify products</s-button>
            </Form>
          </div>
        </div>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
        <Form method="get">
          <div className="kit-filterbar">
            <s-text-field
              label="Search products"
              name="q"
              value={filters.query}
              placeholder="Name or SKU"
            ></s-text-field>
            <s-select label="Filter" name="source" value={filters.source}>
              <s-option value="all">All products</s-option>
              <s-option value="shop">Products on shop</s-option>
              <s-option value="operations">Operational only</s-option>
              <s-option value="components">Operational components</s-option>
            </s-select>
            <s-button type="submit">Apply filters</s-button>
            <s-link href="/app/items">Clear</s-link>
          </div>
        </Form>
        <DataTable
          headings={[
            "Product / variant",
            "Source",
            "Shop",
            "Status",
            "Inventory",
            "Operations role",
            "Make / buy",
            "Lead time",
            "QC",
            "Shopify",
          ]}
          rows={(data.items ?? []).map((item) => ({
            id: item.id,
            href: `/app/items/${item.id}`,
            cells: [
              <strong>{item.sku} · {item.title}</strong>,
              <MoneylessBadge tone={item.product_source === "shopify" ? "success" : "info"}>
                {item.product_source === "shopify" ? "Shopify" : "Operations"}
              </MoneylessBadge>,
              <MoneylessBadge tone={shopVisibility(item).tone}>
                {shopVisibility(item).label}
              </MoneylessBadge>,
              <MoneylessBadge tone={item.product_status === "ACTIVE" ? "success" : "neutral"}>
                {item.product_status ?? "operational"}
              </MoneylessBadge>,
              [
                `${Number(item.available_quantity ?? 0).toLocaleString()} available`,
                `${Number(item.reserved_quantity ?? 0).toLocaleString()} reserved`,
                `min ${Number(item.min_inventory_quantity ?? 0).toLocaleString()}`,
                item.shopify_inventory_available != null
                  ? `Shopify ${Number(item.shopify_inventory_available).toLocaleString()}`
                  : null,
              ].filter(Boolean).join(" · "),
              <MoneylessBadge>{item.item_type}</MoneylessBadge>,
              [
                item.is_sellable ? "sellable" : null,
                item.is_producible ? `produce ${Number(item.default_production_quantity ?? 1).toLocaleString()}` : null,
                item.is_purchasable ? `order ${Number(item.default_order_quantity ?? 1).toLocaleString()}` : null,
              ].filter(Boolean).join(", ") || "not classified",
              `${Number(item.supplier_lead_time_days ?? 0).toLocaleString()} days`,
              [
                item.qc_required_after_purchase ? "receipt QC" : null,
                item.qc_required_after_production ? "production QC" : null,
              ].filter(Boolean).join(", ") || "no QC",
              shopifyProductUrl(data.shopDomain ?? "", item.shopify_product_legacy_id) ? (
                <a
                  href={shopifyProductUrl(data.shopDomain ?? "", item.shopify_product_legacy_id)!}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Shopify
                </a>
              ) : (
                "Not synced"
              ),
            ],
          }))}
        />
      </s-section>
    </s-page>
  );
}

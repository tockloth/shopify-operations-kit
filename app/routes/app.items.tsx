import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { loadItems, loadSuppliers } from "../lib/operations-kit.server";
import { syncShopifyProducts } from "../lib/shopify-sync.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };
  const url = new URL(request.url);
  const filters = {
    query: url.searchParams.get("q") ?? "",
    source: url.searchParams.get("source") ?? "all",
    shopifyStatus: url.searchParams.get("shopifyStatus") ?? "all",
    role: url.searchParams.get("role") ?? "all",
    supplierId: url.searchParams.get("supplierId") ?? "all",
  };

  return {
    configured: true,
    shopDomain: context.shopDomain,
    filters,
    items: await loadItems(context.pool, context.ctx.tenantId, filters),
    suppliers: await loadSuppliers(context.pool, context.ctx.tenantId),
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

function roles(item: any) {
  return [
    item.is_sellable ? "sellable" : null,
    item.is_purchasable ? "purchasable" : null,
    item.is_producible ? "producible" : null,
  ].filter(Boolean).join(" / ") || "not classified";
}

function bomStatus(item: any) {
  if (!item.is_producible) return "Not required";
  if (Number(item.active_bom_count ?? 0) === 0) return "Missing BOM";
  if (Number(item.active_bom_component_count ?? 0) === 0) return "BOM empty";
  return `${Number(item.active_bom_component_count ?? 0).toLocaleString()} component(s)`;
}

function dataQuality(item: any) {
  if (!item.is_active || item.product_status === "MISSING") {
    return { label: "Stale Shopify product", tone: "warning" as const };
  }
  if (!item.is_sellable && !item.is_purchasable && !item.is_producible) {
    return { label: "Review classification", tone: "critical" as const };
  }
  if (item.is_purchasable && !item.preferred_supplier_id) {
    return { label: "Supplier missing", tone: "warning" as const };
  }
  if (item.is_producible && Number(item.active_bom_count ?? 0) === 0) {
    return { label: "BOM missing", tone: "warning" as const };
  }
  if (
    item.is_producible &&
    Number(item.active_bom_count ?? 0) > 0 &&
    Number(item.active_bom_component_count ?? 0) === 0
  ) {
    return { label: "BOM empty", tone: "warning" as const };
  }
  return { label: "Ready", tone: "success" as const };
}

function nextAction(item: any) {
  if (item.is_producible && Number(item.active_bom_count ?? 0) === 0) {
    return { label: "Open BOM", href: `/app/boms?parentItemId=${item.id}` };
  }
  if (
    item.is_producible &&
    Number(item.active_bom_count ?? 0) > 0 &&
    Number(item.active_bom_component_count ?? 0) === 0
  ) {
    return { label: "Add components", href: `/app/boms?parentItemId=${item.id}` };
  }
  return { label: "Open product", href: `/app/items/${item.id}` };
}

export default function Items() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("items" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }
  const filters = "filters" in data && data.filters
    ? data.filters
    : {
        query: "",
        source: "all",
        shopifyStatus: "all",
        role: "all",
        supplierId: "all",
      };
  const suppliers = "suppliers" in data ? (data.suppliers ?? []) : [];

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
          <div className="kit-filterbar kit-products-filterbar">
            <s-text-field
              label="Search products"
              name="q"
              value={filters.query}
              placeholder="Name or SKU"
            ></s-text-field>
            <s-select label="Source / shop" name="source" value={filters.source}>
              <s-option value="all">All products</s-option>
              <s-option value="shop">Products on shop</s-option>
              <s-option value="operations">Operational only</s-option>
              <s-option value="components">Operational components</s-option>
            </s-select>
            <s-select label="Shopify status" name="shopifyStatus" value={filters.shopifyStatus}>
              <s-option value="all">All statuses</s-option>
              <s-option value="active">Active</s-option>
              <s-option value="draft">Draft</s-option>
              <s-option value="archived">Archived</s-option>
              <s-option value="not_published">Active, not published</s-option>
              <s-option value="missing">Stale / missing</s-option>
              <s-option value="operational">Operations item</s-option>
            </s-select>
            <s-select label="Role" name="role" value={filters.role}>
              <s-option value="all">All roles</s-option>
              <s-option value="sellable">Sellable</s-option>
              <s-option value="purchasable">Purchasable</s-option>
              <s-option value="producible">Producible</s-option>
              <s-option value="component">Component / material</s-option>
              <s-option value="review">Needs classification</s-option>
            </s-select>
            <s-select label="Supplier" name="supplierId" value={filters.supplierId}>
              <s-option value="all">All suppliers</s-option>
              <s-option value="missing">Supplier missing</s-option>
              {suppliers.map((supplier: any) => (
                <s-option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </s-option>
              ))}
            </s-select>
            <s-button type="submit">Apply filters</s-button>
            <s-link href="/app/items">Clear</s-link>
          </div>
        </Form>
        <DataTable
          headings={[
            "Product",
            "Shopify status",
            "Type",
            "Roles",
            "Supplier",
            "Stock",
            "BOM",
            "Data quality",
            "Next",
          ]}
          rows={(data.items ?? []).map((item) => ({
            id: item.id,
            href: `/app/items/${item.id}`,
            cells: [
              <strong>{item.sku} · {item.title}</strong>,
              <MoneylessBadge tone={shopVisibility(item).tone}>
                {shopVisibility(item).label}
              </MoneylessBadge>,
              <MoneylessBadge>{item.item_type}</MoneylessBadge>,
              roles(item),
              item.preferred_supplier_name ?? (
                item.is_purchasable ? "No supplier" : "Not required"
              ),
              [
                `${Number(item.available_quantity ?? 0).toLocaleString()} available`,
                `${Number(item.reserved_quantity ?? 0).toLocaleString()} reserved`,
                `min ${Number(item.min_inventory_quantity ?? 0).toLocaleString()}`,
                item.shopify_inventory_available != null
                  ? `Shopify ${Number(item.shopify_inventory_available).toLocaleString()}`
                  : null,
              ].filter(Boolean).join(" · "),
              bomStatus(item),
              <MoneylessBadge tone={dataQuality(item).tone}>
                {dataQuality(item).label}
              </MoneylessBadge>,
              <s-link href={nextAction(item).href}>{nextAction(item).label}</s-link>,
            ],
          }))}
        />
      </s-section>
    </s-page>
  );
}

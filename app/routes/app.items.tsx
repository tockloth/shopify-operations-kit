import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { createOperationsItem, loadItems } from "../lib/operations-kit.server";
import { syncShopifyProducts } from "../lib/shopify-sync.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    shopDomain: context.shopDomain,
    items: await loadItems(context.pool, context.ctx.tenantId),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent") || "syncShopifyProducts");

  if (intent === "createOperationsItem") {
    const result = await createOperationsItem(context.pool, context.ctx.tenantId, {
      sku: String(form.get("sku") || ""),
      title: String(form.get("title") || ""),
      itemType: String(form.get("itemType") || "component"),
      replenishmentPolicy: String(form.get("replenishmentPolicy") || "buy"),
      minInventoryQuantity: Number(form.get("minInventoryQuantity") || 0),
      defaultProductionQuantity: Number(form.get("defaultProductionQuantity") || 1),
      defaultOrderQuantity: Number(form.get("defaultOrderQuantity") || 1),
      supplierLeadTimeDays: Number(form.get("supplierLeadTimeDays") || 7),
    });
    return {
      message: `${result.sku} · ${result.title} created in the operations product master.`,
    };
  }

  const result = await syncShopifyProducts(context.pool, context.ctx.tenantId, admin);
  return {
    message: `${result.products} Shopify product(s) and ${result.variants} variant(s) synced into Operations Kit.`,
  };
};

function shopifyProductUrl(shopDomain: string, legacyId?: string | null) {
  if (!legacyId) return null;
  const shop = shopDomain.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${shop}/products/${legacyId}`;
}

export default function Items() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("items" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

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
        <DataTable
          headings={[
            "Product / variant",
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

      <s-section heading="Create operational component">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <Form method="post">
            <input type="hidden" name="intent" value="createOperationsItem" />
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                <s-text-field
                  label="SKU"
                  name="sku"
                  placeholder="COMP-001"
                  required
                ></s-text-field>
                <s-text-field
                  label="Product name"
                  name="title"
                  placeholder="Assembly component"
                  required
                ></s-text-field>
              </s-stack>
              <s-stack direction="inline" gap="base">
                <s-select label="Product type" name="itemType" value="component">
                  <s-option value="component">Non-sellable component</s-option>
                  <s-option value="raw_material">Raw material</s-option>
                  <s-option value="product">Sellable product</s-option>
                  <s-option value="assembly">Produced sales product / assembly</s-option>
                </s-select>
                <s-select label="Replenishment" name="replenishmentPolicy" value="buy">
                  <s-option value="buy">Purchased</s-option>
                  <s-option value="make">Produced</s-option>
                  <s-option value="stocked">Stocked only</s-option>
                </s-select>
              </s-stack>
              <s-stack direction="inline" gap="base">
                <s-number-field label="Minimum inventory" name="minInventoryQuantity" min={0} step={1} value="0"></s-number-field>
                <s-number-field label="Default order quantity" name="defaultOrderQuantity" min={1} step={1} value="1"></s-number-field>
                <s-number-field label="Default production quantity" name="defaultProductionQuantity" min={1} step={1} value="1"></s-number-field>
                <s-number-field label="Supplier lead time days" name="supplierLeadTimeDays" min={0} step={1} value="7"></s-number-field>
              </s-stack>
              <s-button variant="primary" type="submit">Create product</s-button>
            </s-stack>
          </Form>
        </s-box>
      </s-section>
    </s-page>
  );
}

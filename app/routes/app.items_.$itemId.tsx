import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  loadItemDetail,
  saveSupplierForItem,
  updateItemOperationsProperties,
} from "../lib/operations-kit.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    detail: await loadItemDetail(
      context.pool,
      context.ctx.tenantId,
      params.itemId!,
    ),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "saveProductMasterData" || intent === "savePurchasingSettings") {
    await updateItemOperationsProperties(context.pool, context.ctx.tenantId, {
      itemId: params.itemId!,
      itemType: String(form.get("itemType")),
      isSellable: form.get("isSellable") === "on",
      isPurchasable: form.get("isPurchasable") === "on",
      isProducible: form.get("isProducible") === "on",
      minInventoryQuantity: Number(form.get("minInventoryQuantity") || 0),
      defaultProductionQuantity: Number(
        form.get("defaultProductionQuantity") || 1,
      ),
      defaultOrderQuantity: Number(form.get("defaultOrderQuantity") || 1),
      supplierLeadTimeDays: Number(form.get("supplierLeadTimeDays") || 7),
      qcRequiredAfterPurchase: form.get("qcRequiredAfterPurchase") === "on",
      qcRequiredAfterProduction: form.get("qcRequiredAfterProduction") === "on",
    });

    const supplierId = String(form.get("supplierId") || "");
    if (supplierId) {
      await saveSupplierForItem(context.pool, context.ctx.tenantId, {
        itemId: params.itemId!,
        supplierId,
        isPreferred: form.get("isPreferred") === "on",
        supplierSku: String(form.get("supplierSku") || ""),
        unitPrice: Number(form.get("unitPrice") || 0),
        currencyCode: String(form.get("currencyCode") || "EUR"),
        leadTimeDays: Number(
          form.get("supplierItemLeadTimeDays") ||
            form.get("supplierLeadTimeDays") ||
            0,
        ),
        minimumOrderQuantity: Number(form.get("minimumOrderQuantity") || 0),
      });
    }

    return { message: "Product master data saved." };
  }

  if (intent === "saveProperties") {
    await updateItemOperationsProperties(context.pool, context.ctx.tenantId, {
      itemId: params.itemId!,
      itemType: String(form.get("itemType")),
      isSellable: form.get("isSellable") === "on",
      isPurchasable: form.get("isPurchasable") === "on",
      isProducible: form.get("isProducible") === "on",
      minInventoryQuantity: Number(form.get("minInventoryQuantity") || 0),
      defaultProductionQuantity: Number(
        form.get("defaultProductionQuantity") || 1,
      ),
      defaultOrderQuantity: Number(form.get("defaultOrderQuantity") || 1),
      supplierLeadTimeDays: Number(form.get("supplierLeadTimeDays") || 7),
      qcRequiredAfterPurchase: form.get("qcRequiredAfterPurchase") === "on",
      qcRequiredAfterProduction: form.get("qcRequiredAfterProduction") === "on",
    });
    return { message: "Operations properties saved." };
  }

  if (intent === "saveSupplier") {
    await saveSupplierForItem(context.pool, context.ctx.tenantId, {
      itemId: params.itemId!,
      supplierId: String(form.get("supplierId") || ""),
      isPreferred: form.get("isPreferred") === "on",
      supplierSku: String(form.get("supplierSku") || ""),
      unitPrice: Number(form.get("unitPrice") || 0),
      currencyCode: String(form.get("currencyCode") || "EUR"),
      leadTimeDays: Number(form.get("supplierItemLeadTimeDays") || 0),
      minimumOrderQuantity: Number(form.get("minimumOrderQuantity") || 0),
    });
    return { message: "Supplier purchasing terms saved." };
  }

  return { message: "No action was performed." };
};

function quantity(value: unknown) {
  return Number(value ?? 0).toLocaleString();
}

function itemTypeLabel(value?: string | null) {
  const labels: Record<string, string> = {
    product: "Product",
    component: "Component",
    raw_material: "Material",
    assembly: "Assembly",
  };
  return labels[String(value || "")] ?? "Product";
}

function planningPolicy(item: any) {
  if (item.is_purchasable && item.is_producible) return "Make or Buy";
  if (item.is_purchasable) return "Buy";
  if (item.is_producible) return "Make";
  if (item.is_sellable) return "Sell only";
  return "Review master data";
}

function reviewState(item: any, preferredSupplier: any, activeBomCount: number) {
  if (!item.is_sellable && !item.is_purchasable && !item.is_producible) {
    return {
      label: "Review master data",
      tone: "critical" as const,
      reason: "Classify the item as sellable, purchasable, producible, or a valid combination.",
    };
  }
  if (item.is_purchasable && !preferredSupplier) {
    return {
      label: "Supplier review",
      tone: "warning" as const,
      reason: "Purchased items need a preferred supplier before procurement can run cleanly.",
    };
  }
  if (item.is_producible && activeBomCount === 0) {
    return {
      label: "BOM review",
      tone: "warning" as const,
      reason: "Producible items need an active BOM before production planning can run cleanly.",
    };
  }
  return {
    label: "Ready for planning",
    tone: "success" as const,
    reason: "Required operational planning data is present.",
  };
}

function shopifyStatus(item: any) {
  if (!item.shopify_product_gid) {
    return { label: "Operations item", tone: "neutral" as const };
  }
  if (!item.is_active || item.product_status === "MISSING") {
    return { label: "Missing from latest sync", tone: "critical" as const };
  }
  if (item.product_status === "DRAFT") {
    return { label: "Draft", tone: "warning" as const };
  }
  if (item.product_status === "ARCHIVED") {
    return { label: "Archived", tone: "neutral" as const };
  }
  if (
    item.product_status === "ACTIVE" &&
    (item.shopify_published_at || item.shopify_online_store_url)
  ) {
    return { label: "On shop", tone: "success" as const };
  }
  if (item.product_status === "ACTIVE") {
    return { label: "Active, not published", tone: "warning" as const };
  }
  return {
    label: item.product_status ?? "Shopify synced",
    tone: "info" as const,
  };
}

export default function ProductDetail() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("detail" in data)) {
    return (
      <SetupBanner
        message={data.setupError ?? "Database setup is incomplete."}
      />
    );
  }

  const detail = data.detail ?? {
    item: null,
    bomLines: [],
    suppliers: [],
    allSuppliers: [],
    availableComponents: [],
    orderLines: [],
    purchaseWork: [],
    productionWork: [],
  };
  const item = detail.item as any;
  if (!item) {
    return (
      <s-page heading="Product not found">
        <s-section>
          <s-link href="/app/items">Back to products</s-link>
        </s-section>
      </s-page>
    );
  }
  const preferredSupplier = (detail.suppliers ?? []).find(
    (supplier: any) => supplier.is_preferred,
  ) as any;
  const initialSupplier = (preferredSupplier ??
    (detail.suppliers ?? [])[0] ??
    (detail.allSuppliers ?? [])[0] ??
    null) as any;
  const supplierFormValues = (preferredSupplier ?? initialSupplier ?? {}) as any;
  const activeBomIds = new Set(
    (detail.bomLines ?? [])
      .filter((line: any) => line.is_active)
      .map((line: any) => line.id),
  );
  const activeBomCount = activeBomIds.size;
  const activeBomComponentCount = (detail.bomLines ?? []).filter(
    (line: any) => line.is_active && line.component_id,
  ).length;
  const activeBomLines = (detail.bomLines ?? []).filter(
    (line: any) => line.is_active && line.component_id,
  );
  const state = reviewState(item, preferredSupplier, activeBomCount);
  const shopifyState = shopifyStatus(item);

  return (
    <s-page heading={`${item.sku} · ${item.title}`}>
      <Form method="post" className="kit-master-form">
        <input type="hidden" name="intent" value="saveProductMasterData" />

        <s-section>
          <div className="kit-product-action-row">
            <s-link href="/app/items">Back to products</s-link>
            <div className="kit-product-action-buttons">
              <s-button variant="primary" type="submit">
                Save
              </s-button>
              <s-link href={`/app/items/${item.id}`}>Cancel</s-link>
            </div>
          </div>
          {actionData?.message ? (
            <s-banner tone="success">{actionData.message}</s-banner>
          ) : null}
        </s-section>

        <s-section heading="Product master data">
          <s-stack direction="block" gap="base">
            <DataTable
              headings={[
                "Product",
                "Shopify context",
                "Shopify status",
                "Type",
                "Operational roles",
                "Review state",
              ]}
              rows={[
                [
                  <strong>
                    {item.sku} · {item.title}
                  </strong>,
                  item.product_handle || item.variant_title
                    ? [item.product_handle, item.variant_title]
                        .filter(Boolean)
                        .join(" / ")
                    : item.shopify_variant_gid
                      ? "Shopify variant linked"
                      : "Operations item",
                  <MoneylessBadge tone={shopifyState.tone}>
                    {shopifyState.label}
                  </MoneylessBadge>,
                  <MoneylessBadge>{itemTypeLabel(item.item_type)}</MoneylessBadge>,
                  <div className="kit-inline-badges">
                    {item.is_sellable ? (
                      <MoneylessBadge tone="success">sellable</MoneylessBadge>
                    ) : null}
                    {item.is_purchasable ? (
                      <MoneylessBadge tone="info">purchasable</MoneylessBadge>
                    ) : null}
                    {item.is_producible ? (
                      <MoneylessBadge tone="info">producible</MoneylessBadge>
                    ) : null}
                    {!item.is_sellable &&
                    !item.is_purchasable &&
                    !item.is_producible ? (
                      <MoneylessBadge tone="critical">not classified</MoneylessBadge>
                    ) : null}
                  </div>,
                  <MoneylessBadge tone={state.tone}>{state.label}</MoneylessBadge>,
                ],
              ]}
            />
            <DataTable
              headings={[
                "Policy",
                "Lead time",
                "Standard order quantity",
                "Standard production quantity",
                "Minimum stock",
              ]}
              rows={[
                [
                  <MoneylessBadge
                    tone={
                      planningPolicy(item) === "Review master data"
                        ? "critical"
                        : planningPolicy(item) === "Sell only"
                          ? "warning"
                          : "success"
                    }
                  >
                    {planningPolicy(item)}
                  </MoneylessBadge>,
                  `${quantity(item.supplier_lead_time_days)} days`,
                  quantity(item.default_order_quantity ?? 1),
                  quantity(item.default_production_quantity ?? 1),
                  quantity(item.min_inventory_quantity ?? 0),
                ],
              ]}
            />
          </s-stack>
        </s-section>

        <s-section heading="Operational classification">
          <div className="kit-edit-panel">
            <div className="kit-classification-grid">
              <s-select
                label="Item type"
                name="itemType"
                value={item.item_type}
              >
                <s-option value="product">Product</s-option>
                <s-option value="assembly">Assembly</s-option>
                <s-option value="component">Component</s-option>
                <s-option value="raw_material">Material</s-option>
              </s-select>
              <div className="kit-checkbox-row">
                <s-checkbox
                  label="Sellable"
                  name="isSellable"
                  checked={Boolean(item.is_sellable)}
                ></s-checkbox>
                <s-checkbox
                  label="Purchasable"
                  name="isPurchasable"
                  checked={Boolean(item.is_purchasable)}
                ></s-checkbox>
                <s-checkbox
                  label="Producible"
                  name="isProducible"
                  checked={Boolean(item.is_producible)}
                ></s-checkbox>
              </div>
            </div>
          </div>
        </s-section>

        <s-section heading="Purchasing settings">
          <div className="kit-edit-panel">
            {item.is_purchasable && (detail.allSuppliers ?? []).length > 0 ? (
              <div className="kit-compact-grid kit-grid-5">
                <s-select
                  label="Preferred supplier"
                  name="supplierId"
                  value={initialSupplier?.id ?? ""}
                >
                  {(detail.allSuppliers ?? []).map((supplier: any) => (
                    <s-option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </s-option>
                  ))}
                </s-select>
                <s-text-field
                  label="Supplier SKU"
                  name="supplierSku"
                  value={supplierFormValues.supplier_sku ?? item.sku}
                ></s-text-field>
                <s-checkbox
                  label="Preferred"
                  name="isPreferred"
                  checked={supplierFormValues.is_preferred ?? true}
                ></s-checkbox>
                <s-number-field
                  label="Lead time"
                  name="supplierLeadTimeDays"
                  min={0}
                  step={1}
                  value={String(item.supplier_lead_time_days ?? 7)}
                ></s-number-field>
                <s-number-field
                  label="Standard order qty"
                  name="defaultOrderQuantity"
                  min={1}
                  step={1}
                  value={String(item.default_order_quantity ?? 1)}
                ></s-number-field>
                <s-number-field
                  label="Standard production qty"
                  name="defaultProductionQuantity"
                  min={1}
                  step={1}
                  value={String(item.default_production_quantity ?? 1)}
                ></s-number-field>
                <s-number-field
                  label="Minimum stock"
                  name="minInventoryQuantity"
                  min={0}
                  step={1}
                  value={String(item.min_inventory_quantity ?? 0)}
                ></s-number-field>
                <s-number-field
                  label="Supplier MOQ"
                  name="minimumOrderQuantity"
                  min={0}
                  step={1}
                  value={String(supplierFormValues.minimum_order_quantity ?? "")}
                ></s-number-field>
                <s-number-field
                  label="Supplier price"
                  name="unitPrice"
                  min={0}
                  step={0.01}
                  value={String(supplierFormValues.unit_price ?? "")}
                ></s-number-field>
                <s-select
                  label="Currency"
                  name="currencyCode"
                  value={supplierFormValues.currency_code ?? "EUR"}
                >
                  <s-option value="EUR">EUR</s-option>
                  <s-option value="USD">USD</s-option>
                  <s-option value="GBP">GBP</s-option>
                </s-select>
              </div>
            ) : (
              <>
                {item.is_purchasable ? (
                  <div className="kit-compact-warning">
                    <s-banner tone="warning">
                      Create a supplier before assigning purchasing settings.
                    </s-banner>
                    <s-link href="/app/suppliers">Open suppliers</s-link>
                  </div>
                ) : null}
                <div className="kit-compact-grid kit-grid-4">
                  <s-number-field
                    label="Lead time"
                    name="supplierLeadTimeDays"
                    min={0}
                    step={1}
                    value={String(item.supplier_lead_time_days ?? 7)}
                  ></s-number-field>
                  <s-number-field
                    label="Standard order qty"
                    name="defaultOrderQuantity"
                    min={1}
                    step={1}
                    value={String(item.default_order_quantity ?? 1)}
                  ></s-number-field>
                  <s-number-field
                    label="Standard production qty"
                    name="defaultProductionQuantity"
                    min={1}
                    step={1}
                    value={String(item.default_production_quantity ?? 1)}
                  ></s-number-field>
                  <s-number-field
                    label="Minimum stock"
                    name="minInventoryQuantity"
                    min={0}
                    step={1}
                    value={String(item.min_inventory_quantity ?? 0)}
                  ></s-number-field>
                </div>
              </>
            )}
          </div>
        </s-section>

        <s-section heading="QC">
          <div className="kit-edit-panel">
            <div className="kit-compact-grid kit-grid-2">
              <s-checkbox
                label="QC required on receiving"
                name="qcRequiredAfterPurchase"
                checked={Boolean(item.qc_required_after_purchase)}
              ></s-checkbox>
              <s-checkbox
                label="QC required after production"
                name="qcRequiredAfterProduction"
                checked={Boolean(item.qc_required_after_production)}
              ></s-checkbox>
            </div>
          </div>
        </s-section>

        <s-section heading="BOM">
          <div className="kit-edit-panel">
            {item.is_producible ? (
              <s-stack direction="block" gap="base">
                <DataTable
                  headings={["Active BOM", "Components", "Editor"]}
                  rows={[
                    [
                      activeBomCount > 0 ? (
                        <MoneylessBadge tone="success">Yes</MoneylessBadge>
                      ) : (
                        <MoneylessBadge tone="warning">No</MoneylessBadge>
                      ),
                      activeBomComponentCount,
                      <s-link href={`/app/boms?parentItemId=${item.id}`}>
                        Open BOM editor
                      </s-link>,
                    ],
                  ]}
                />
                {activeBomLines.length > 0 ? (
                  <DataTable
                    headings={["Component", "Type", "Policy", "Quantity", "Unit", "Available stock"]}
                    rows={activeBomLines.map((line: any) => [
                      <strong>
                        {line.component_sku} {line.component_title}
                      </strong>,
                      itemTypeLabel(line.item_type),
                      [
                        line.is_purchasable ? "buy" : null,
                        line.is_producible ? "make" : null,
                      ]
                        .filter(Boolean)
                        .join(" / ") || "review",
                      quantity(line.quantity),
                      line.unit ?? "pcs",
                      quantity(line.component_available_quantity ?? 0),
                    ])}
                  />
                ) : activeBomCount > 0 ? (
                  <s-banner tone="warning">
                    This item has an active BOM with no components.
                  </s-banner>
                ) : (
                  <s-banner tone="warning">
                    This producible item has no active BOM.
                  </s-banner>
                )}
              </s-stack>
            ) : (
              <s-paragraph>BOM is only required for producible items.</s-paragraph>
            )}
          </div>
        </s-section>
      </Form>
    </s-page>
  );
}

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, SetupBanner } from "../components/KitUi";
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

  return (
    <s-page heading={`${item.sku} · ${item.title}`}>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-link href="/app/items">Back to products</s-link>
          <s-paragraph>
            Maintain the master data before running the Handelsware process: the
            product must be sellable, purchased, and connected to at least one
            supplier with purchasing terms.
          </s-paragraph>
          {actionData?.message ? (
            <s-banner tone="success">{actionData.message}</s-banner>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Classification and planning policy">
        <s-box padding="base" border="base" border-radius="base">
          <Form method="post">
            <input type="hidden" name="intent" value="saveProperties" />
            <s-stack direction="block" gap="base">
              <s-grid grid-template-columns="1fr 1fr 1fr" gap="base">
                <s-select
                  label="Product type"
                  name="itemType"
                  value={item.item_type}
                >
                  <s-option value="product">Sales product</s-option>
                  <s-option value="assembly">
                    Produced sales product / assembly
                  </s-option>
                  <s-option value="component">Component</s-option>
                  <s-option value="raw_material">Raw material</s-option>
                </s-select>
                <s-number-field
                  label="Minimum inventory"
                  name="minInventoryQuantity"
                  min={0}
                  step={1}
                  value={String(item.min_inventory_quantity ?? 0)}
                ></s-number-field>
                <s-number-field
                  label="Supplier lead time days"
                  name="supplierLeadTimeDays"
                  min={0}
                  step={1}
                  value={String(item.supplier_lead_time_days ?? 7)}
                ></s-number-field>
              </s-grid>
              <s-grid grid-template-columns="1fr 1fr" gap="base">
                <s-number-field
                  label="Default order quantity"
                  name="defaultOrderQuantity"
                  min={1}
                  step={1}
                  value={String(item.default_order_quantity ?? 1)}
                ></s-number-field>
                <s-number-field
                  label="Default production quantity"
                  name="defaultProductionQuantity"
                  min={1}
                  step={1}
                  value={String(item.default_production_quantity ?? 1)}
                ></s-number-field>
              </s-grid>
              <s-grid grid-template-columns="1fr 1fr 1fr" gap="base">
                <s-checkbox
                  label="Sellable in Shopify"
                  name="isSellable"
                  checked={Boolean(item.is_sellable)}
                ></s-checkbox>
                <s-checkbox
                  label="Purchased"
                  name="isPurchasable"
                  checked={Boolean(item.is_purchasable)}
                ></s-checkbox>
                <s-checkbox
                  label="Produced"
                  name="isProducible"
                  checked={Boolean(item.is_producible)}
                ></s-checkbox>
              </s-grid>
              <s-grid grid-template-columns="1fr 1fr" gap="base">
                <s-box padding="small" border="base" border-radius="base">
                  <s-stack direction="block" gap="small">
                    <s-checkbox
                      label="QC after receipt"
                      name="qcRequiredAfterPurchase"
                      checked={Boolean(item.qc_required_after_purchase)}
                    ></s-checkbox>
                    <s-paragraph tone="neutral" color="subdued">
                      Purchased goods go to receiving QC first. Accepted
                      quantity is put away; rejected quantity stays in
                      quarantine.
                    </s-paragraph>
                  </s-stack>
                </s-box>
                <s-box padding="small" border="base" border-radius="base">
                  <s-stack direction="block" gap="small">
                    <s-checkbox
                      label="QC after production"
                      name="qcRequiredAfterProduction"
                      checked={Boolean(item.qc_required_after_production)}
                    ></s-checkbox>
                    <s-paragraph tone="neutral" color="subdued">
                      Produced quantity must pass production QC before it can be
                      stored or released to logistics.
                    </s-paragraph>
                  </s-stack>
                </s-box>
              </s-grid>
              <s-button variant="primary" type="submit">
                Save operations properties
              </s-button>
            </s-stack>
          </Form>
        </s-box>
      </s-section>

      <s-section heading="Supplier purchasing terms">
        <s-box padding="base" border="base" border-radius="base">
          <s-stack direction="block" gap="base">
            <DataTable
              headings={[
                "Supplier",
                "Preferred",
                "Supplier SKU",
                "Price",
                "Lead time",
                "MOQ",
                "Status",
              ]}
              rows={(detail.suppliers ?? []).map((supplier: any) => [
                <strong>{supplier.name}</strong>,
                supplier.is_preferred ? "Yes" : "No",
                supplier.supplier_sku ?? "Not set",
                supplier.unit_price
                  ? `${Number(supplier.unit_price).toLocaleString()} ${supplier.currency_code ?? "EUR"}`
                  : "No price",
                supplier.lead_time_days != null
                  ? `${Number(supplier.lead_time_days).toLocaleString()} days`
                  : `${Number(item.supplier_lead_time_days ?? 7).toLocaleString()} days`,
                supplier.minimum_order_quantity != null
                  ? Number(supplier.minimum_order_quantity).toLocaleString()
                  : "No MOQ",
                supplier.supplier_item_is_active ? "Active" : "Inactive",
              ])}
            />
            {(detail.allSuppliers ?? []).length === 0 ? (
              <s-banner tone="warning">
                Create supplier master data before assigning purchasing terms.
              </s-banner>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="saveSupplier" />
                <s-stack direction="block" gap="base">
                  <s-grid grid-template-columns="1fr 1fr" gap="base">
                    <s-select
                      label="Supplier"
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
                      value={preferredSupplier?.supplier_sku ?? item.sku}
                    ></s-text-field>
                  </s-grid>
                  <s-grid grid-template-columns="1fr 1fr 1fr" gap="base">
                    <s-number-field
                      label="Supplier price"
                      name="unitPrice"
                      min={0}
                      step={0.01}
                      value={String(preferredSupplier?.unit_price ?? "")}
                    ></s-number-field>
                    <s-select
                      label="Currency"
                      name="currencyCode"
                      value={preferredSupplier?.currency_code ?? "EUR"}
                    >
                      <s-option value="EUR">EUR</s-option>
                      <s-option value="USD">USD</s-option>
                      <s-option value="GBP">GBP</s-option>
                    </s-select>
                    <s-number-field
                      label="Minimum order quantity"
                      name="minimumOrderQuantity"
                      min={0}
                      step={1}
                      value={String(
                        preferredSupplier?.minimum_order_quantity ?? "",
                      )}
                    ></s-number-field>
                  </s-grid>
                  <s-grid grid-template-columns="1fr 1fr" gap="base">
                    <s-number-field
                      label="Supplier-specific lead time days"
                      name="supplierItemLeadTimeDays"
                      min={0}
                      step={1}
                      value={String(
                        preferredSupplier?.lead_time_days ??
                          item.supplier_lead_time_days ??
                          7,
                      )}
                    ></s-number-field>
                    <s-checkbox
                      label="Preferred supplier for this product"
                      name="isPreferred"
                      checked
                    ></s-checkbox>
                  </s-grid>
                  <s-button-group gap="base">
                    <s-button variant="primary" type="submit">
                      Save purchasing terms
                    </s-button>
                    <s-link href="/app/suppliers">Open suppliers</s-link>
                  </s-button-group>
                </s-stack>
              </Form>
            )}
          </s-stack>
        </s-box>
      </s-section>

    </s-page>
  );
}

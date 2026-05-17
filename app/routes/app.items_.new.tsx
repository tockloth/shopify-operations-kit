import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";

import { SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { createOperationsItem } from "../lib/operations-kit.server";

function safeReturnTo(value: string | null) {
  return value?.startsWith("/app/") ? value : "/app/items";
}

function safeItemType(value: string | null) {
  return ["product", "assembly", "component", "raw_material"].includes(
    String(value),
  )
    ? String(value)
    : "component";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };
  const url = new URL(request.url);
  return {
    configured: true,
    itemType: safeItemType(url.searchParams.get("itemType")),
    returnTo: safeReturnTo(url.searchParams.get("returnTo")),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  await createOperationsItem(context.pool, context.ctx.tenantId, {
    sku: String(form.get("sku") || ""),
    title: String(form.get("title") || ""),
    itemType: safeItemType(String(form.get("itemType") || "component")),
    replenishmentPolicy: String(form.get("replenishmentPolicy") || "buy"),
    isSellable: form.get("isSellable") === "on",
    isPurchasable: form.get("isPurchasable") === "on",
    isProducible: form.get("isProducible") === "on",
    qcRequiredAfterPurchase: form.get("qcRequiredAfterPurchase") === "on",
    qcRequiredAfterProduction: form.get("qcRequiredAfterProduction") === "on",
    minInventoryQuantity: Number(form.get("minInventoryQuantity") || 0),
    defaultProductionQuantity: Number(form.get("defaultProductionQuantity") || 1),
    defaultOrderQuantity: Number(form.get("defaultOrderQuantity") || 1),
    supplierLeadTimeDays: Number(form.get("supplierLeadTimeDays") || 7),
  });

  return redirect(safeReturnTo(String(form.get("returnTo") || "")));
};

export default function NewOperationalComponent() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }
  const defaultItemType = data.itemType ?? "component";
  const defaultSellable = defaultItemType === "product" || defaultItemType === "assembly";
  const defaultPurchasable = defaultItemType === "component" || defaultItemType === "raw_material";
  const defaultProducible = defaultItemType === "assembly";

  return (
    <s-page heading="Create operational component">
      <s-section>
        <s-link href={data.returnTo ?? "/app/items"}>Back to products</s-link>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section>
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <Form method="post">
            <input type="hidden" name="returnTo" value={data.returnTo ?? "/app/items"} />
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
                <s-select label="Product type" name="itemType" value={data.itemType ?? "component"}>
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
                <s-checkbox
                  label="Sellable"
                  name="isSellable"
                  checked={defaultSellable}
                ></s-checkbox>
                <s-checkbox
                  label="Purchasable"
                  name="isPurchasable"
                  checked={defaultPurchasable}
                ></s-checkbox>
                <s-checkbox
                  label="Producible"
                  name="isProducible"
                  checked={defaultProducible}
                ></s-checkbox>
              </s-stack>
              <s-stack direction="inline" gap="base">
                <s-number-field label="Minimum inventory" name="minInventoryQuantity" min={0} step={1} value="0"></s-number-field>
                <s-number-field label="Default order quantity" name="defaultOrderQuantity" min={1} step={1} value="1"></s-number-field>
                <s-number-field label="Default production quantity" name="defaultProductionQuantity" min={1} step={1} value="1"></s-number-field>
                <s-number-field label="Supplier lead time days" name="supplierLeadTimeDays" min={0} step={1} value="7"></s-number-field>
              </s-stack>
              <s-stack direction="inline" gap="base">
                <s-checkbox
                  label="QC required on receiving"
                  name="qcRequiredAfterPurchase"
                  checked={defaultPurchasable}
                ></s-checkbox>
                <s-checkbox
                  label="QC required after production"
                  name="qcRequiredAfterProduction"
                  checked={defaultProducible}
                ></s-checkbox>
              </s-stack>
              <s-stack direction="inline" gap="small">
                <s-button variant="primary" type="submit">Create product</s-button>
                <s-link href={data.returnTo ?? "/app/items"}>Cancel</s-link>
              </s-stack>
            </s-stack>
          </Form>
        </s-box>
      </s-section>
    </s-page>
  );
}

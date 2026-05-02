import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  addBomLineToItem,
  loadItemDetail,
  savePreferredSupplierForItem,
  updateItemOperationsProperties,
} from "../lib/operations-kit.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    detail: await loadItemDetail(context.pool, context.ctx.tenantId, params.itemId!),
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
      defaultProductionQuantity: Number(form.get("defaultProductionQuantity") || 1),
      defaultOrderQuantity: Number(form.get("defaultOrderQuantity") || 1),
      supplierLeadTimeDays: Number(form.get("supplierLeadTimeDays") || 7),
      qcRequiredAfterPurchase: form.get("qcRequiredAfterPurchase") === "on",
      qcRequiredAfterProduction: form.get("qcRequiredAfterProduction") === "on",
    });
    return { message: "Operations properties saved." };
  }

  if (intent === "addBomLine") {
    await addBomLineToItem(context.pool, context.ctx.tenantId, {
      parentItemId: params.itemId!,
      componentItemId: String(form.get("componentItemId")),
      quantity: Number(form.get("quantity") || 1),
    });
    return { message: "BOM line saved." };
  }

  if (intent === "saveSupplier") {
    await savePreferredSupplierForItem(context.pool, context.ctx.tenantId, {
      itemId: params.itemId!,
      supplierName: String(form.get("supplierName")),
      supplierEmail: String(form.get("supplierEmail") || ""),
    });
    return { message: "Preferred supplier saved." };
  }

  return { message: "No action was performed." };
};

export default function ProductDetail() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("detail" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  const detail = data.detail ?? {
    item: null,
    bomLines: [],
    suppliers: [],
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

  return (
    <s-page heading={`${item.sku} · ${item.title}`}>
      <s-section>
        <s-link href="/app/items">Back to products</s-link>
        <s-paragraph>
          This product can be a Shopify sales product, an internal component or
          a raw material. Maintain make/buy policy, supplier, BOM, inventory
          minimums and QC rules here.
        </s-paragraph>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section heading="Classification and planning policy">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <Form method="post">
            <input type="hidden" name="intent" value="saveProperties" />
            <div className="kit-grid">
              <label>
                Item type
                <select name="itemType" defaultValue={item.item_type}>
                  <option value="product">Sales product</option>
                  <option value="assembly">Produced sales product / assembly</option>
                  <option value="component">Component</option>
                  <option value="raw_material">Raw material</option>
                </select>
              </label>
              <label>
                Minimum inventory
                <input name="minInventoryQuantity" type="number" min="0" step="1" defaultValue={item.min_inventory_quantity ?? 0} />
              </label>
              <label>
                Default production quantity
                <input name="defaultProductionQuantity" type="number" min="1" step="1" defaultValue={item.default_production_quantity ?? 1} />
              </label>
              <label>
                Default order quantity
                <input name="defaultOrderQuantity" type="number" min="1" step="1" defaultValue={item.default_order_quantity ?? 1} />
              </label>
              <label>
                Supplier lead time days
                <input name="supplierLeadTimeDays" type="number" min="0" step="1" defaultValue={item.supplier_lead_time_days ?? 7} />
              </label>
            </div>
            <s-stack direction="inline" gap="small">
              <label><input name="isSellable" type="checkbox" defaultChecked={item.is_sellable} /> Sellable in Shopify</label>
              <label><input name="isPurchasable" type="checkbox" defaultChecked={item.is_purchasable} /> Purchased</label>
              <label><input name="isProducible" type="checkbox" defaultChecked={item.is_producible} /> Produced</label>
              <label><input name="qcRequiredAfterPurchase" type="checkbox" defaultChecked={item.qc_required_after_purchase} /> QC after receipt</label>
              <label><input name="qcRequiredAfterProduction" type="checkbox" defaultChecked={item.qc_required_after_production} /> QC after production</label>
            </s-stack>
            <s-button variant="primary" type="submit">Save operations properties</s-button>
          </Form>
        </s-box>
      </s-section>

      <s-section heading="Make or buy detail">
        <div className="kit-two-column">
          <div className="kit-object-panel">
            <s-heading>Supplier context</s-heading>
            <DataTable
              headings={["Supplier", "Preferred", "Status"]}
            rows={(detail.suppliers ?? []).map((supplier: any) => [
                <strong>{supplier.name}</strong>,
                supplier.is_preferred ? "Yes" : "No",
                supplier.is_active ? "Active" : "Inactive",
              ])}
            />
            <Form method="post">
              <input type="hidden" name="intent" value="saveSupplier" />
              <s-stack direction="inline" gap="small">
                <input
                  aria-label="Supplier name"
                  name="supplierName"
                  placeholder="Supplier name"
                  required
                />
                <input
                  aria-label="Supplier email"
                  name="supplierEmail"
                  placeholder="orders@supplier.example"
                  type="email"
                />
                <s-button type="submit">Save preferred supplier</s-button>
              </s-stack>
            </Form>
          </div>
          <div className="kit-object-panel">
            <s-heading>BOM</s-heading>
            <DataTable
              headings={["Component", "Quantity", "Unit"]}
              rows={(detail.bomLines ?? [])
                .filter((line: any) => line.component_id)
                .map((line: any) => [
                  <strong>{line.component_sku} {line.component_title}</strong>,
                  Number(line.quantity).toLocaleString(),
                  line.unit,
                ])}
            />
            <Form method="post">
              <input type="hidden" name="intent" value="addBomLine" />
              <s-stack direction="inline" gap="small">
                <select name="componentItemId">
                  {(detail.availableComponents ?? []).map((component: any) => (
                    <option key={component.id} value={component.id}>
                      {component.sku} · {component.title}
                    </option>
                  ))}
                </select>
                <input name="quantity" type="number" min="0.0001" step="1" defaultValue="1" />
                <s-button type="submit">Add / update BOM line</s-button>
              </s-stack>
            </Form>
          </div>
        </div>
      </s-section>
    </s-page>
  );
}

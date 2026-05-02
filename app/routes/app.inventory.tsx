import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { loadInventoryLedger, loadItems, postInventoryMovement } from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    inventory: await loadInventoryLedger(context.pool, context.ctx.tenantId),
    items: await loadItems(context.pool, context.ctx.tenantId),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "postInventoryMovement") {
    await postInventoryMovement(context.pool, context.ctx.tenantId, {
      itemId: String(form.get("itemId") || ""),
      movementType: String(form.get("movementType") || "stock_adjustment"),
      quantity: Number(form.get("quantity") || 0),
      locationCode: String(form.get("locationCode") || "MAIN"),
      reference: String(form.get("reference") || ""),
    });
    return { message: "Inventory movement posted." };
  }

  return { message: "No inventory action was performed." };
};

export default function Inventory() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("inventory" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }
  const inventory = data.inventory ?? { balances: [], movements: [] };

  return (
    <s-page heading="Inventory ledger">
      <s-section>
        <s-paragraph>
          Shopify remains the inventory system of record. Operations Kit keeps an
          operational subledger for planning, QC hold, putaway, consumption and
          finished output evidence.
        </s-paragraph>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section heading="Post inventory movement">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <Form method="post">
            <input type="hidden" name="intent" value="postInventoryMovement" />
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base">
                <s-select label="Product" name="itemId" required>
                  <s-option value="">Select product</s-option>
                  {(data.items ?? []).map((item: any) => (
                    <s-option key={item.id} value={item.id}>
                      {item.sku} · {item.title}
                    </s-option>
                  ))}
                </s-select>
                <s-select label="Movement" name="movementType" value="stock_adjustment">
                  <s-option value="stock_adjustment">Inventory adjustment</s-option>
                  <s-option value="purchase_receipt">Receipt from procurement</s-option>
                  <s-option value="produce">Receipt from production</s-option>
                  <s-option value="putaway">Putaway after QC</s-option>
                  <s-option value="count_adjustment">Inventory count</s-option>
                </s-select>
              </s-stack>
              <s-stack direction="inline" gap="base">
                <s-number-field label="Quantity" name="quantity" min={0.0001} step={1} value="1"></s-number-field>
                <s-select label="Location" name="locationCode" value="MAIN">
                  <s-option value="MAIN">MAIN</s-option>
                  <s-option value="QC-HOLD">QC-HOLD</s-option>
                  <s-option value="QUARANTINE">QUARANTINE</s-option>
                  <s-option value="LOGISTICS-STAGE">LOGISTICS-STAGE</s-option>
                </s-select>
                <s-text-field
                  label="Reference"
                  name="reference"
                  placeholder="GRN-1001, PROD-1001 or cycle count"
                ></s-text-field>
              </s-stack>
              <s-button variant="primary" type="submit">Post movement</s-button>
            </s-stack>
          </Form>
        </s-box>
      </s-section>

      <s-section heading="Operational balances">
        <DataTable
          headings={["Item", "Physical", "Reserved", "Available"]}
          rows={(inventory.balances ?? []).map((row: any) => [
            <strong>{row.sku} {row.title}</strong>,
            Number(row.physical_quantity).toLocaleString(),
            Number(row.reserved_quantity).toLocaleString(),
            Number(row.available_quantity).toLocaleString(),
          ])}
        />
      </s-section>

      <s-section heading="Hold and staging balances">
        <DataTable
          headings={["Item", "QC hold", "Quarantine", "Logistics stage"]}
          rows={(inventory.balances ?? []).map((row: any) => [
            <strong>{row.sku} {row.title}</strong>,
            Number(row.qc_hold_quantity ?? 0).toLocaleString(),
            Number(row.quarantine_quantity ?? 0).toLocaleString(),
            Number(row.logistics_stage_quantity ?? 0).toLocaleString(),
          ])}
        />
      </s-section>

      <s-section heading="Ledger movements">
        <DataTable
          headings={["Item", "Movement", "Quantity delta", "Location", "Source"]}
          rows={(inventory.movements ?? []).map((movement: any) => [
            <strong>{movement.sku} {movement.title}</strong>,
            <MoneylessBadge>{movement.movement_type}</MoneylessBadge>,
            Number(movement.quantity_delta).toLocaleString(),
            movement.location_code ?? "",
            `${movement.source_type}`,
          ])}
        />
      </s-section>
    </s-page>
  );
}

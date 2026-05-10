import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  loadInventoryItemDetail,
  postInventoryMovement,
} from "../lib/operations-kit.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    detail: await loadInventoryItemDetail(
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
  const intent = String(form.get("intent") || "");

  if (intent === "postInventoryMovement") {
    await postInventoryMovement(context.pool, context.ctx.tenantId, {
      itemId: params.itemId!,
      movementType: String(form.get("movementType") || "stock_adjustment"),
      quantity: Number(form.get("quantity") || 0),
      locationCode: String(form.get("locationCode") || "MAIN"),
      reference: String(form.get("reference") || ""),
    });
    return { message: "Inventory movement posted." };
  }

  return { message: "No inventory action was performed." };
};

function quantity(value: unknown) {
  return Number(value ?? 0).toLocaleString();
}

export default function InventoryItemDetail() {
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
    balance: null,
    demand: [],
    incoming: [],
    movements: [],
  };
  const item = detail.item as any;
  const balance = (detail.balance ?? {}) as any;

  if (!item) {
    return (
      <s-page heading="Inventory item not found">
        <s-section>
          <s-link href="/app/inventory">Back to inventory</s-link>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading={`${item.sku} · ${item.title}`}>
      <s-section>
        <s-stack direction="block" gap="base">
          <Link to="/app/inventory">
            <s-button>Back to inventory</s-button>
          </Link>
          <s-paragraph>
            This detail view shows the operational stock position for one
            product. Customer orders reserve stock; purchase orders increase
            ordered and planned stock until receipt and QC.
          </s-paragraph>
          {actionData?.message ? (
            <s-banner tone="success">{actionData.message}</s-banner>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Stock position">
        <s-grid grid-template-columns="1fr 1fr 1fr 1fr 1fr" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-heading>{quantity(balance.physical_quantity)}</s-heading>
              <s-text>Physical</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-heading>{quantity(balance.reserved_quantity)}</s-heading>
              <s-text>Reserved</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-heading>{quantity(balance.available_quantity)}</s-heading>
              <s-text>Available</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-heading>{quantity(balance.ordered_quantity)}</s-heading>
              <s-text>Ordered</s-text>
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-heading>{quantity(balance.planned_quantity)}</s-heading>
              <s-text>Planned</s-text>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      <s-section heading="Post inventory movement">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <Form method="post">
            <input type="hidden" name="intent" value="postInventoryMovement" />
            <s-stack direction="block" gap="base">
              <s-grid grid-template-columns="1fr 1fr 1fr" gap="base">
                <s-select
                  label="Movement"
                  name="movementType"
                  value="stock_adjustment"
                >
                  <s-option value="stock_adjustment">
                    Inventory adjustment
                  </s-option>
                  <s-option value="purchase_receipt">
                    Receipt from procurement
                  </s-option>
                  <s-option value="putaway">Putaway after QC</s-option>
                  <s-option value="produce">Receipt from production</s-option>
                  <s-option value="count_adjustment">Inventory count</s-option>
                </s-select>
                <s-number-field
                  label="Quantity"
                  name="quantity"
                  min={0.0001}
                  step={1}
                  value="1"
                ></s-number-field>
                <s-select label="Location" name="locationCode" value="MAIN">
                  <s-option value="MAIN">MAIN</s-option>
                  <s-option value="QC-HOLD">QC-HOLD</s-option>
                  <s-option value="QUARANTINE">QUARANTINE</s-option>
                  <s-option value="LOGISTICS-STAGE">LOGISTICS-STAGE</s-option>
                </s-select>
              </s-grid>
              <s-text-field
                label="Reference"
                name="reference"
                placeholder="GRN-1001, PO-1001 or cycle count"
              ></s-text-field>
              <s-button variant="primary" type="submit">
                Post movement
              </s-button>
            </s-stack>
          </Form>
        </s-box>
      </s-section>

      <s-section heading="Customer reservations">
        <DataTable
          headings={["Order", "Customer", "Quantity", "Status"]}
          rows={(detail.demand ?? []).map((line: any) => ({
            id: `demand-${line.order_id}`,
            href: `/app/orders/${line.order_id}`,
            cells: [
              <strong>{line.order_name}</strong>,
              line.customer_display_name ?? "No customer",
              `${quantity(line.quantity)} ${line.unit}`,
              <MoneylessBadge>{line.status}</MoneylessBadge>,
            ],
          }))}
        />
      </s-section>

      <s-section heading="Incoming purchase orders">
        <DataTable
          headings={[
            "PO",
            "Supplier",
            "Quantity",
            "Expected delivery",
            "Status",
          ]}
          rows={(detail.incoming ?? []).map((line: any) => ({
            id: `incoming-${line.purchase_order_id}`,
            href: `/app/procurement?purchaseOrderId=${line.purchase_order_id}`,
            cells: [
              <strong>{line.display_number}</strong>,
              line.supplier_name,
              `${quantity(line.quantity)} ${line.unit}`,
              line.expected_delivery_date ?? "",
              <MoneylessBadge>{line.purchase_order_status}</MoneylessBadge>,
            ],
          }))}
        />
      </s-section>

      <s-section heading="Ledger movements">
        <DataTable
          headings={["Date", "Movement", "Quantity", "Location", "Source"]}
          rows={(detail.movements ?? []).map((movement: any) => [
            new Date(movement.occurred_at).toLocaleString(),
            <MoneylessBadge>{movement.movement_type}</MoneylessBadge>,
            quantity(movement.quantity_delta),
            movement.location_code ?? "",
            movement.source_type,
          ])}
        />
      </s-section>
    </s-page>
  );
}

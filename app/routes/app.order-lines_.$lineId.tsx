import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  createPurchaseNeedForOrderLine,
  loadOperationsOrderLineDetail,
} from "../lib/operations-kit.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    detail: await loadOperationsOrderLineDetail(
      context.pool,
      context.ctx.tenantId,
      params.lineId!,
    ),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "createPurchaseNeed") {
    const result = await createPurchaseNeedForOrderLine(
      context.pool,
      context.ctx.tenantId,
      params.lineId!,
      Number(form.get("quantity")),
    );
    return {
      message: `Purchase need created for ${result.quantity.toLocaleString()} pcs.${
        result.supplierAssigned
          ? " Preferred supplier was assigned."
          : " Assign a supplier in Procurement."
      }`,
    };
  }

  return { message: "No action was performed." };
};

export default function OrderLineDetail() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("detail" in data)) {
    return (
      <SetupBanner
        message={data.setupError ?? "Database setup is incomplete."}
      />
    );
  }

  const detail = data.detail ?? { line: null };
  const line = detail.line as any;
  if (!line) {
    return (
      <s-page heading="Order line not found">
        <s-section>
          <s-link href="/app/orders">Back to orders</s-link>
        </s-section>
      </s-page>
    );
  }

  const sku = line.sku ?? line.item_sku;
  const title = line.title ?? line.item_title;
  const shortage = Math.max(
    Number(line.quantity ?? 0) +
      Number(line.min_inventory_quantity ?? 0) -
      Number(line.available_quantity ?? 0),
    0,
  );
  const suggestedPurchaseQuantity = Math.max(
    shortage,
    Number(line.default_order_quantity ?? 1),
    1,
  );

  return (
    <s-page heading={`${line.order_name} · ${sku}`}>
      <s-section>
        <s-stack direction="inline" gap="small">
          <s-link href="/app/orders">Back to orders</s-link>
          <s-link href={`/app/orders/${line.operations_order_id}`}>
            Open order
          </s-link>
          <s-link href={`/app/items/${line.item_id}`}>Open product</s-link>
        </s-stack>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section heading="Demand line">
        <DataTable
          headings={[
            "Line item",
            "Order",
            "Quantity",
            "Supply status",
            "Fulfillment",
          ]}
          rows={[
            [
              <strong>
                {sku} · {title}
              </strong>,
              line.order_name,
              `${Number(line.quantity).toLocaleString()} ${line.unit}`,
              <MoneylessBadge>{line.supply_status}</MoneylessBadge>,
              <MoneylessBadge>
                {line.fulfillment_status ?? "unfulfilled"}
              </MoneylessBadge>,
            ],
          ]}
        />
      </s-section>

      <s-section heading="Planning decision inputs">
        <DataTable
          headings={[
            "Product role",
            "Make / buy",
            "Inventory",
            "Open demand",
            "Planning quantities",
            "QC",
          ]}
          rows={[
            [
              <MoneylessBadge>{line.item_type}</MoneylessBadge>,
              [
                line.is_sellable ? "sellable" : null,
                line.is_producible ? "produced" : null,
                line.is_purchasable ? "purchased" : null,
              ]
                .filter(Boolean)
                .join(", ") || "not classified",
              [
                `${Number(line.available_quantity ?? 0).toLocaleString()} available`,
                `${Number(line.reserved_quantity ?? 0).toLocaleString()} reserved`,
                `${Number(line.qc_hold_quantity ?? 0).toLocaleString()} QC hold`,
                `${Number(line.quarantine_quantity ?? 0).toLocaleString()} quarantine`,
              ].join(" · "),
              `${Number(line.open_order_quantity ?? 0).toLocaleString()} pcs ordered by open operations orders`,
              [
                `shortage ${shortage.toLocaleString()}`,
                `min ${Number(line.min_inventory_quantity ?? 0).toLocaleString()}`,
                `order ${Number(line.default_order_quantity ?? 1).toLocaleString()}`,
                `produce ${Number(line.default_production_quantity ?? 1).toLocaleString()}`,
                `${Number(line.supplier_lead_time_days ?? 0).toLocaleString()} days lead time`,
              ].join(" · "),
              [
                line.qc_required_after_purchase ? "receipt QC" : null,
                line.qc_required_after_production ? "production QC" : null,
              ]
                .filter(Boolean)
                .join(", ") || "no QC",
            ],
          ]}
        />
      </s-section>

      <s-section heading="Procurement proposal">
        <s-grid grid-template-columns="1fr 1fr" gap="base">
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-stack direction="block" gap="small">
              <s-heading>Suggestion</s-heading>
              <s-paragraph>
                Operations Kit proposes the larger value from shortage plus
                minimum inventory and the product default order quantity.
              </s-paragraph>
              <DataTable
                headings={["Supplier", "Suggested quantity", "Lead time"]}
                rows={[
                  [
                    line.preferred_supplier_name ?? "No preferred supplier",
                    `${suggestedPurchaseQuantity.toLocaleString()} ${line.unit}`,
                    `${Number(line.supplier_lead_time_days ?? 0).toLocaleString()} days`,
                  ],
                ]}
              />
            </s-stack>
          </s-box>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <Form method="post">
              <input type="hidden" name="intent" value="createPurchaseNeed" />
              <s-stack direction="block" gap="base">
                <s-number-field
                  label="Purchase quantity"
                  name="quantity"
                  value={String(suggestedPurchaseQuantity)}
                  min={1}
                  step={1}
                ></s-number-field>
                <s-button
                  variant="primary"
                  type="submit"
                  disabled={!line.is_purchasable}
                >
                  Create purchase need
                </s-button>
                {!line.is_purchasable ? (
                  <s-paragraph tone="critical">
                    Open the product and classify it as purchased first.
                  </s-paragraph>
                ) : null}
              </s-stack>
            </Form>
          </s-box>
        </s-grid>
      </s-section>
    </s-page>
  );
}

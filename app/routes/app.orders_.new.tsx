import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";

import { SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  createOperationsOrderEntry,
  loadSellableItemsForOrderEntry,
} from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    sellableItems: await loadSellableItemsForOrderEntry(
      context.pool,
      context.ctx.tenantId,
    ),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  await createOperationsOrderEntry(
    context.pool,
    context.ctx.tenantId,
    {
      orderName: String(form.get("orderName") || ""),
      customerName: String(form.get("customerName") || ""),
      customerEmail: String(form.get("customerEmail") || ""),
      itemId: String(form.get("itemId") || ""),
      quantity: Number(form.get("quantity") || 1),
    },
  );

  return redirect("/app/orders");
};

export default function NewOperationsOrder() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("sellableItems" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  return (
    <s-page heading="Create manual operations order">
      <s-section>
        <s-link href="/app/orders">Back to orders</s-link>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section>
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <Form method="post">
            <s-stack direction="block" gap="base">
              <s-text-field
                label="Order number"
                name="orderName"
                placeholder="INTAKE-1001"
              ></s-text-field>
              <s-text-field
                label="Customer"
                name="customerName"
                placeholder="Customer name"
              ></s-text-field>
              <s-email-field
                label="Email"
                name="customerEmail"
                placeholder="customer@example.com"
              ></s-email-field>
              <s-select label="Product" name="itemId" required>
                <s-option value="">Select sellable product</s-option>
                {(data.sellableItems ?? []).map((item: any) => (
                  <s-option key={item.id} value={item.id}>
                    {item.sku} · {item.title}
                  </s-option>
                ))}
              </s-select>
              <s-number-field
                label="Quantity"
                name="quantity"
                min={1}
                step={1}
                value="1"
              ></s-number-field>
              <s-stack direction="inline" gap="small">
                <s-button variant="primary" type="submit">Create operations order</s-button>
                <s-link href="/app/orders">Cancel</s-link>
              </s-stack>
            </s-stack>
          </Form>
        </s-box>
      </s-section>
    </s-page>
  );
}

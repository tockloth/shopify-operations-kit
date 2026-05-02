import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  completeProductionQc,
  completeProductionOrder,
  createProductionWorkForLatestNeed,
  loadProductionNeeds,
  loadProductionOrders,
} from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    productionNeeds: await loadProductionNeeds(context.pool, context.ctx.tenantId),
    productionOrders: await loadProductionOrders(context.pool, context.ctx.tenantId),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "complete") {
    const result = await completeProductionOrder(
      context.pool,
      context.ctx.tenantId,
      String(form.get("productionOrderId") || "") || undefined,
    );
    return {
      message: result.productionOrderId
        ? `Production completed. ${result.componentsConsumed} component line(s) consumed and finished output posted.`
        : "No ready production order found. Commit an MRP production need first.",
    };
  }

  if (intent === "completeQc") {
    const result = await completeProductionQc(context.pool, context.ctx.tenantId, {
      productionOrderId: String(form.get("productionOrderId")),
      acceptedQuantity: Number(form.get("acceptedQuantity") || 0),
      rejectedQuantity: Number(form.get("rejectedQuantity") || 0),
      releaseDestination:
        String(form.get("releaseDestination")) === "logistics" ? "logistics" : "inventory",
    });
    return {
      message: result.productionOrderId
        ? `Production QC completed. ${result.accepted} accepted, ${result.rejected} quarantined.`
        : "Production order not found.",
    };
  }

  const result = await createProductionWorkForLatestNeed(
    context.pool,
    context.ctx.tenantId,
    String(form.get("productionNeedId") || "") || undefined,
  );

  return {
    message: result.productionOrderId
      ? `Production order is ready with ${result.warehouseTasks} component pick task(s).`
      : "No open production need found. Run and commit MRP first.",
  };
};

export default function Production() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("productionOrders" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  return (
    <s-page heading="Production">
      <s-section>
        <s-paragraph>
          Production converts producible sellable items into internal work
          orders. Production creates component pick work, consumes components,
          and sends finished output through production QC before it reaches
          inventory or logistics.
        </s-paragraph>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>
      <s-section heading="Production needs">
        <DataTable
          headings={["Item", "Quantity", "Status", "Production order", "Action"]}
          rows={(data.productionNeeds ?? []).map((need: any) => [
            <strong>{need.sku} {need.title}</strong>,
            `${Number(need.quantity).toLocaleString()} ${need.unit}`,
            <MoneylessBadge>{need.status}</MoneylessBadge>,
            need.production_order_number ?? "Not converted",
            need.production_order_id ? (
              "Converted"
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="create" />
                <input type="hidden" name="productionNeedId" value={need.id} />
                <s-button variant="primary" type="submit">Create MO</s-button>
              </Form>
            ),
          ])}
        />
      </s-section>
      <s-section heading="Production orders">
        <DataTable
          headings={["Order", "Assembly", "Quantity", "Status", "QC", "Components", "Action"]}
          rows={(data.productionOrders ?? []).map((order: any) => [
            <strong>{order.display_number}</strong>,
            `${order.sku} ${order.title}`,
            `${Number(order.quantity).toLocaleString()} ${order.unit}`,
            <MoneylessBadge tone={order.status === "ready" ? "success" : "info"}>
              {order.status}
            </MoneylessBadge>,
            `${order.qc_status ?? "not_required"} · accepted ${Number(order.accepted_quantity ?? 0).toLocaleString()} / rejected ${Number(order.rejected_quantity ?? 0).toLocaleString()}`,
            order.component_count,
            order.status === "qc_hold" ? (
              <Form method="post">
                <input type="hidden" name="intent" value="completeQc" />
                <input type="hidden" name="productionOrderId" value={order.id} />
                <s-stack direction="inline" gap="small">
                  <input
                    aria-label="Accepted quantity"
                    name="acceptedQuantity"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={order.quantity}
                  />
                  <input
                    aria-label="Rejected quantity"
                    name="rejectedQuantity"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue="0"
                  />
                  <select name="releaseDestination" defaultValue="inventory">
                    <option value="inventory">Inventory</option>
                    <option value="logistics">Logistics</option>
                  </select>
                  <s-button type="submit">Complete QC</s-button>
                </s-stack>
              </Form>
            ) : (
              order.status === "ready" || order.status === "approved" || order.status === "in_progress" ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="complete" />
                  <input type="hidden" name="productionOrderId" value={order.id} />
                  <s-button variant="primary" type="submit">Complete production</s-button>
                </Form>
              ) : (
                "Monitor"
              )
            ),
          ])}
        />
      </s-section>
    </s-page>
  );
}

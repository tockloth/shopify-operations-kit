import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { loadOperationsOrderDetail } from "../lib/operations-kit.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    detail: await loadOperationsOrderDetail(
      context.pool,
      context.ctx.tenantId,
      params.orderId!,
    ),
  };
};

export default function OrderDetail() {
  const data = useLoaderData<typeof loader>();
  if (!data.configured || !("detail" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  const detail = data.detail ?? { order: null, lines: [] };
  const order = detail.order as any;
  if (!order) {
    return (
      <s-page heading="Order not found">
        <s-section>
          <s-link href="/app/orders">Back to orders</s-link>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading={`Operations order ${order.order_name}`}>
      <s-section>
        <s-link href="/app/orders">Back to orders</s-link>
        <s-paragraph>
          This view extends the Shopify order with operational planning context:
          item classification, fulfillment status, make/buy meaning and later
          MRP/procurement/production actions.
        </s-paragraph>
      </s-section>

      <s-section heading="Order context">
        <div className="kit-grid">
          <div className="kit-object-panel">
            <strong>Customer</strong>
            <div>{order.customer_name ?? "No customer"}</div>
            <div className="kit-muted">{order.customer_email ?? ""}</div>
          </div>
          <div className="kit-object-panel">
            <strong>Shopify status</strong>
            <div>{order.financial_status ?? "unknown"} / {order.fulfillment_status ?? "unfulfilled"}</div>
          </div>
          <div className="kit-object-panel">
            <strong>Operations status</strong>
            <div><MoneylessBadge>{order.status}</MoneylessBadge></div>
          </div>
        </div>
      </s-section>

      <s-section heading="Order lines with operations properties">
        <DataTable
          headings={[
            "Line item",
            "Quantity",
            "Item role",
            "Make / buy",
            "Policy",
          ]}
          rows={(detail.lines ?? []).map((line: any) => [
            <s-link href={`/app/items/${line.item_id}`}>
              <strong>{line.sku ?? line.item_sku} {line.title ?? line.item_title}</strong>
            </s-link>,
            `${Number(line.quantity).toLocaleString()} ${line.unit}`,
            <MoneylessBadge>{line.item_type}</MoneylessBadge>,
            [
              line.is_sellable ? "sellable" : null,
              line.is_producible ? `produce ${Number(line.default_production_quantity).toLocaleString()}` : null,
              line.is_purchasable ? `order ${Number(line.default_order_quantity).toLocaleString()}` : null,
            ].filter(Boolean).join(", ") || "not classified",
            `Min inventory ${Number(line.min_inventory_quantity).toLocaleString()}`,
          ])}
        />
      </s-section>
    </s-page>
  );
}

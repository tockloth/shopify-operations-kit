import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  loadShippingOrderDetail,
  transitionShippingOrder,
  updateShippingOrderLineQuantity,
} from "../lib/operations-kit.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) {
    return { configured: false, setupError: context.setupError };
  }

  return {
    configured: true,
    detail: await loadShippingOrderDetail(
      context.pool,
      context.ctx.tenantId,
      params.shipmentId!,
    ),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "updateLineQuantity") {
    return updateShippingOrderLineQuantity(
      context.pool,
      context.ctx.tenantId,
      String(form.get("shippingOrderLineId") || ""),
      Number(form.get("quantity")),
    );
  }

  const status = String(form.get("status")) === "shipped" ? "shipped" : "packed";
  await transitionShippingOrder(
    context.pool,
    context.ctx.tenantId,
    params.shipmentId!,
    status,
  );
  return { message: "Shipment updated." };
};

function formatDate(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatAddress(address?: any) {
  return address
    ? [
        address.name,
        address.address1,
        address.address2,
        address.city,
        address.zip,
        address.provinceCode,
        address.countryCodeV2,
      ]
        .filter(Boolean)
        .join(", ")
    : "No address";
}

function statusTone(status: string) {
  if (status === "shipped") return "success";
  if (status === "packed") return "info";
  if (status === "cancelled") return "critical";
  return "warning";
}

function canCorrectShipmentLine(shipmentStatus: string, lineStatus: string) {
  return (
    (shipmentStatus === "open" || shipmentStatus === "picking") &&
    (lineStatus === "open" || lineStatus === "picked")
  );
}

export default function ShipmentDetail() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("detail" in data)) {
    return (
      <SetupBanner
        message={data.setupError ?? "Database setup is incomplete."}
      />
    );
  }

  const detail = data.detail ?? { order: null, lines: [] };
  const shipment = detail.order as any;
  if (!shipment) {
    return (
      <s-page heading="Shipment not found">
        <s-section>
          <Link to="/app/logistics">Back to Logistics</Link>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading={`Shipment ${shipment.shipment_number}`}>
      <s-section>
        <div className="kit-toolbar">
          <Link to="/app/logistics">
            <s-button>Back to Logistics</s-button>
          </Link>
          <div className="kit-toolbar-actions">
            {shipment.status !== "packed" && shipment.status !== "shipped" ? (
              <Form method="post">
                <input type="hidden" name="intent" value="transition" />
                <input type="hidden" name="status" value="packed" />
                <s-button type="submit">Mark packed</s-button>
              </Form>
            ) : null}
            {shipment.status !== "shipped" ? (
              <Form method="post">
                <input type="hidden" name="intent" value="transition" />
                <input type="hidden" name="status" value="shipped" />
                <s-button variant="primary" type="submit">
                  Mark shipped
                </s-button>
              </Form>
            ) : null}
          </div>
        </div>
        {actionData?.message ? (
          <s-banner tone="success">{actionData.message}</s-banner>
        ) : null}
      </s-section>

      <s-section heading="Shipment">
        <DataTable
          headings={["Shipment", "Order", "Customer", "Status", "Created"]}
          rows={[
            [
              <strong>{shipment.shipment_number}</strong>,
              <Link to={`/app/orders/${shipment.operations_order_id}`}>
                {shipment.order_name}
              </Link>,
              shipment.customer_name ?? "No customer",
              <MoneylessBadge tone={statusTone(shipment.status) as any}>
                {shipment.status}
              </MoneylessBadge>,
              formatDate(shipment.created_at),
            ],
          ]}
        />
      </s-section>

      <s-section heading="Quantity correction">
        {(detail.lines ?? []).length === 0 ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>No shipment lines exist for this shipment.</s-paragraph>
          </s-box>
        ) : (
          <div className="kit-shipment-correction-list">
            {(detail.lines ?? []).map((line: any) => {
              const correctable = canCorrectShipmentLine(
                shipment.status,
                line.status,
              );
              return (
                <s-box
                  key={line.id}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                >
                  <div className="kit-shipment-correction-row">
                    <div>
                      <strong>
                        {line.sku} {line.title}
                      </strong>
                      <div className="kit-muted">
                        Current shipment quantity:{" "}
                        <strong>
                          {Number(line.ordered_quantity).toLocaleString()}{" "}
                          {line.unit}
                        </strong>
                      </div>
                    </div>
                    {correctable ? (
                      <Form method="post" className="kit-shipment-line-form">
                        <input
                          type="hidden"
                          name="intent"
                          value="updateLineQuantity"
                        />
                        <input
                          type="hidden"
                          name="shippingOrderLineId"
                          value={line.id}
                        />
                        <label className="kit-field-label">
                          Correct quantity
                          <input
                            type="number"
                            name="quantity"
                            min="0.0001"
                            step="0.0001"
                            defaultValue={Number(line.ordered_quantity)}
                          />
                        </label>
                        <s-button type="submit">Update quantity</s-button>
                      </Form>
                    ) : (
                      <MoneylessBadge tone="neutral">
                        Quantity locked after pack / ship
                      </MoneylessBadge>
                    )}
                  </div>
                </s-box>
              );
            })}
          </div>
        )}
      </s-section>

      <s-section heading="Lines">
        <DataTable
          headings={[
            "Product",
            "Quantity",
            "Picked",
            "Packed",
            "Shipped",
            "Status",
          ]}
          rows={(detail.lines ?? []).map((line: any) => [
            <strong>
              {line.sku} {line.title}
            </strong>,
            `${Number(line.ordered_quantity).toLocaleString()} ${line.unit}`,
            Number(line.picked_quantity ?? 0).toLocaleString(),
            Number(line.packed_quantity ?? 0).toLocaleString(),
            Number(line.shipped_quantity ?? 0).toLocaleString(),
            <MoneylessBadge>{line.status}</MoneylessBadge>,
          ])}
        />
      </s-section>

      <s-section heading="Address">
        <DataTable
          headings={["Name", "Address"]}
          rows={[
            [
              shipment.shipping_address?.name ?? shipment.customer_name ?? "No name",
              formatAddress(shipment.shipping_address),
            ],
          ]}
        />
      </s-section>
    </s-page>
  );
}

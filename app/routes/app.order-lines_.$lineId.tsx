import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

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

function quantity(value: unknown) {
  return Number(value ?? 0).toLocaleString();
}

function scopeLabel(value: unknown) {
  const scope = String(value || "");
  if (scope === "order_line") return "This order line";
  if (scope === "order") return "This order";
  if (scope === "item_fallback") return "Item-level fallback";
  return "Linked context";
}

function hasShippingAddress(address: any) {
  return Boolean(
      address &&
      (address.address1 || address.street) &&
      address.city &&
      (address.countryCodeV2 || address.country || address.countryCode),
  );
}

function shippingBlockers(line: any) {
  const blockers: string[] = [];
  if (!line.customer_name) blockers.push("Missing customer name");
  if (!line.customer_email) blockers.push("Missing customer email");
  if (!hasShippingAddress(line.shipping_address)) {
    blockers.push("Missing shipping address");
  }
  return blockers;
}

function putawayLabel(row: any) {
  if (row.receipt_line_status === "putaway_completed") {
    return "Inventory booked";
  }
  if (Number(row.accepted_quantity ?? 0) > 0) {
    return "Putaway pending";
  }
  return "Not ready";
}

type Decision = {
  label: string;
  reason: string;
  tone: "success" | "info" | "warning" | "critical";
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

  const detail = data.detail ?? {
    line: null,
    procurement: [],
    receipts: [],
    inventoryMovements: [],
    production: [],
    logistics: [],
  };
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
  const orderedQuantity = Number(line.quantity ?? 0);
  const allocatedAvailableQuantity = Number(
    line.allocated_available_quantity ?? line.available_quantity ?? 0,
  );
  const shortageQuantity = Math.max(
    orderedQuantity - allocatedAvailableQuantity,
    0,
  );
  const masterDataMissing =
    !line.is_sellable && !line.is_purchasable && !line.is_producible;
  const procurementRows = (detail.procurement ?? []) as any[];
  const hasItemFallbackProcurement = procurementRows.some(
    (row) => row.demand_link_scope === "item_fallback",
  );
  const receiptRows = (detail.receipts ?? []) as any[];
  const productionRows = (detail.production ?? []) as any[];
  const logisticsRows = (detail.logistics ?? []) as any[];
  const purchaseOrder = procurementRows.find((row) => row.purchase_order_id);
  const receipt = receiptRows[0] ?? procurementRows.find((row) => row.receipt_id);
  const blockers = shippingBlockers(line);

  let decision: Decision;
  if (masterDataMissing) {
    decision = {
      label: "Review master data",
      reason:
        "The item is not classified as sellable, purchasable or producible yet.",
      tone: "critical",
    };
  } else if (
    procurementRows.length > 0 ||
    receiptRows.length > 0 ||
    productionRows.length > 0 ||
    logisticsRows.length > 0
  ) {
    decision = {
      label: "Already in progress",
      reason: hasItemFallbackProcurement
        ? "Existing procurement work is item-level because no direct order-line link is available."
        : "Existing operational work is linked to this order.",
      tone: "info",
    };
  } else if (
    line.supply_status === "reserved" ||
    allocatedAvailableQuantity >= orderedQuantity
  ) {
    decision = {
      label: "Ready from stock",
      reason: "Available stock covers the ordered quantity.",
      tone: "success",
    };
  } else if (line.is_purchasable) {
    decision = {
      label: "Needs procurement",
      reason:
        "Available stock does not cover the order line and the item is purchasable.",
      tone: "warning",
    };
  } else if (line.is_producible) {
    decision = {
      label: "Needs production",
      reason:
        "Available stock does not cover the order line and the item is producible.",
      tone: "warning",
    };
  } else {
    decision = {
      label: "Review master data",
      reason:
        "Operations Kit cannot choose stock, procurement or production from the current item setup.",
      tone: "critical",
    };
  }

  const nextAction = masterDataMissing
    ? {
        label: "Complete product detail",
        href: `/app/items/${line.item_id}`,
        reason:
          "Set the operational role and make/buy properties before planning.",
      }
    : receipt?.receipt_id
      ? {
          label: "Open receipt",
          href: `/app/receiving/${receipt.receipt_id}`,
          reason: "Receiving work exists for this item.",
        }
      : purchaseOrder?.purchase_order_id
        ? {
            label: "Open Purchase Order",
            href: `/app/procurement/${purchaseOrder.purchase_order_id}`,
            reason: "Procurement work is already linked to this item.",
          }
        : procurementRows.length > 0 || decision.label === "Needs procurement"
          ? {
              label: "Open Procurement",
              href: "/app/procurement",
              reason: "Review purchase proposals and purchase orders.",
            }
          : decision.label === "Needs production"
            ? {
                label: "Open Production",
                href: "/app/production",
                reason: "Production planning comes from the Production page.",
              }
            : decision.label === "Ready from stock"
              ? {
                  label: "Open Logistics",
                  href: "/app/logistics",
                reason:
                  "Stock is available; logistics work is handled separately.",
                }
              : {
                  label: "Open product",
                  href: `/app/items/${line.item_id}`,
                  reason: "Review operational product setup.",
                };

  const toolbarAction = nextAction.href.startsWith("/app/procurement")
    ? { label: "Open Procurement", href: "/app/procurement" }
    : nextAction.href.startsWith("/app/logistics")
      ? { label: "Open Logistics", href: "/app/logistics" }
      : nextAction.href.startsWith("/app/receiving")
        ? { label: "Open Receiving", href: nextAction.href }
        : nextAction.href.startsWith("/app/production")
          ? { label: "Open Production", href: nextAction.href }
          : { label: nextAction.label, href: nextAction.href };

  return (
    <s-page heading={`${line.order_name} · ${sku}`}>
      <s-section>
        <s-stack direction="inline" gap="small">
          <s-link href={`/app/orders/${line.operations_order_id}`}>
            Back to Order
          </s-link>
          <s-link href={`/app/items/${line.item_id}`}>Open product</s-link>
          <s-link href={toolbarAction.href}>{toolbarAction.label}</s-link>
        </s-stack>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section heading="Order line summary">
        <DataTable
          headings={[
            "Order",
            "Line item",
            "Quantity",
            "Customer",
            "Shopify line reference",
            "Payment",
            "Fulfillment",
            "Operations",
          ]}
          rows={[
            [
              line.order_name,
              <strong>
                {sku} {title}
              </strong>,
              `${quantity(line.quantity)} ${line.unit}`,
              line.customer_name ?? "No customer",
              line.shopify_line_item_gid
                ? "Shopify line linked"
                : "No Shopify line reference",
              <MoneylessBadge>
                {line.financial_status ?? "unknown"}
              </MoneylessBadge>,
              <MoneylessBadge>
                {line.fulfillment_status ?? "unfulfilled"}
              </MoneylessBadge>,
              <MoneylessBadge>{line.supply_status}</MoneylessBadge>,
            ],
          ]}
        />
      </s-section>

      <s-section heading="Operational decision">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            <s-stack direction="inline" gap="small">
              <s-text>Decision</s-text>
              <MoneylessBadge tone={decision.tone}>
                {decision.label}
              </MoneylessBadge>
            </s-stack>
            <s-paragraph>{decision.reason}</s-paragraph>
            {blockers.length > 0 ? (
              <s-paragraph tone="critical">
                Blocking data: {blockers.join(", ")}
              </s-paragraph>
            ) : null}
            <s-link href={nextAction.href}>Target page: {nextAction.label}</s-link>
          </s-stack>
        </s-box>
      </s-section>

      <s-section heading="Product / item master data">
        <DataTable
          headings={[
            "Item",
            "Shopify link",
            "Type",
            "Policy",
            "Preferred supplier",
            "BOM",
            "Product detail",
          ]}
          rows={[
            [
              <strong>
                {line.item_sku} {line.item_title}
              </strong>,
              line.product_handle || line.variant_title
                ? [line.product_handle, line.variant_title]
                    .filter(Boolean)
                    .join(" / ")
                : line.shopify_variant_gid
                  ? "Shopify variant linked"
                  : "Operations item",
              <MoneylessBadge>{line.item_type}</MoneylessBadge>,
              [
                line.is_sellable ? "sellable" : null,
                line.is_purchasable ? "purchasable" : null,
                line.is_producible ? "producible" : null,
              ]
                .filter(Boolean)
                .join(", ") || "not classified",
              line.preferred_supplier_name ?? "No preferred supplier",
              Number(line.active_bom_count ?? 0) > 0
                ? `${quantity(line.active_bom_count)} active BOM`
                : "No active BOM",
              <s-link href={`/app/items/${line.item_id}`}>Open product</s-link>,
            ],
          ]}
        />
        {masterDataMissing ? (
          <s-paragraph tone="critical">
            Operational product data is missing. Complete the product detail
            before planning.
          </s-paragraph>
        ) : null}
      </s-section>

      <s-section heading="Inventory availability">
        <DataTable
          headings={[
            "On hand",
            "Reserved",
            "Available",
            "Allocated available",
            "Shortage",
            "QC hold",
            "Quarantine",
          ]}
          rows={[
            [
              quantity(line.physical_quantity),
              quantity(line.reserved_quantity),
              quantity(line.available_quantity),
              quantity(allocatedAvailableQuantity),
              quantity(shortageQuantity),
              quantity(line.qc_hold_quantity),
              quantity(line.quarantine_quantity),
            ],
          ]}
        />
      </s-section>

      <s-section heading="Procurement context">
        {procurementRows.length > 0 ? (
          <DataTable
            headings={[
              "Purchase need",
              "Scope",
              "Supplier",
              "Purchase Order",
              "Receipt",
              "Quantity",
            ]}
            rows={procurementRows.map((row: any) => [
              <MoneylessBadge>{row.purchase_need_status}</MoneylessBadge>,
              scopeLabel(row.demand_link_scope),
              row.supplier_name ?? "No supplier",
              row.purchase_order_id ? (
                <s-link href={`/app/procurement/${row.purchase_order_id}`}>
                  {row.purchase_order_number}
                </s-link>
              ) : (
                "No Purchase Order"
              ),
              row.receipt_id ? (
                <s-link href={`/app/receiving/${row.receipt_id}`}>
                  {row.receipt_number} · {row.receipt_status}
                </s-link>
              ) : (
                "No receipt"
              ),
              `${quantity(row.quantity)} ${row.unit}`,
            ])}
          />
        ) : (
          <s-paragraph>
            No procurement work is linked to this order line yet.
          </s-paragraph>
        )}
      </s-section>

      <s-section heading="Receiving context">
        {receiptRows.length > 0 ? (
          <DataTable
            headings={[
              "Receipt",
              "Scope",
              "Status",
              "QC",
              "Putaway",
              "Quantity",
              "Open receipt",
            ]}
            rows={receiptRows.map((row: any) => [
              row.receipt_number ?? "No receipt number",
              scopeLabel(row.demand_link_scope),
              <MoneylessBadge>{row.receipt_status ?? "open"}</MoneylessBadge>,
              <MoneylessBadge>{row.receipt_line_status ?? "pending"}</MoneylessBadge>,
              putawayLabel(row),
              `${quantity(row.accepted_quantity)} accepted / ${quantity(
                row.rejected_quantity,
              )} rejected`,
              <s-link href={`/app/receiving/${row.receipt_id}`}>
                Open receipt
              </s-link>,
            ])}
          />
        ) : (
          <s-paragraph>No receiving work is linked to this order line yet.</s-paragraph>
        )}
      </s-section>

      <s-section heading="Logistics context">
        <DataTable
          headings={["Customer", "Address readiness", "Shipment", "Status", "Open"]}
          rows={[
            [
              line.customer_name ?? "No customer",
              blockers.length > 0 ? (
                <s-paragraph tone="critical">{blockers.join(", ")}</s-paragraph>
              ) : (
                <MoneylessBadge tone="success">Ready</MoneylessBadge>
              ),
              logisticsRows[0]?.shipment_number ?? "No shipment",
              logisticsRows[0] ? (
                <MoneylessBadge>
                  {logisticsRows[0].status ?? logisticsRows[0].shipping_order_status}
                </MoneylessBadge>
              ) : (
                "Not created"
              ),
              logisticsRows[0]?.shipping_order_id ? (
                <s-link href={`/app/logistics/${logisticsRows[0].shipping_order_id}`}>
                  Open shipment
                </s-link>
              ) : (
                <s-link href="/app/logistics">Open Logistics</s-link>
              ),
            ],
          ]}
        />
      </s-section>

      <s-section heading="Next action">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            <s-heading>{nextAction.label}</s-heading>
            <s-paragraph>{nextAction.reason}</s-paragraph>
            <s-link href={nextAction.href}>{nextAction.label}</s-link>
          </s-stack>
        </s-box>
      </s-section>
    </s-page>
  );
}

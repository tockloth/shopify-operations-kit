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

function movementLabel(value: unknown) {
  const movement = String(value || "");
  const labels: Record<string, string> = {
    stock_adjustment: "Inventory adjustment",
    reservation: "Reservation",
    reservation_release: "Reservation release",
    purchase_receipt: "Purchase receipt",
    qc_hold: "QC hold",
    putaway: "Putaway",
    quarantine: "Quarantine",
    pick: "Pick",
    pack: "Pack",
    ship: "Ship",
    consume: "Consume",
    produce: "Produce",
    count_adjustment: "Count adjustment",
  };
  return labels[movement] ?? movement.replaceAll("_", " ");
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
  const availableQuantity = Number(line.available_quantity ?? 0);
  const masterDataMissing =
    !line.is_sellable && !line.is_purchasable && !line.is_producible;
  const procurementRows = (detail.procurement ?? []) as any[];
  const receiptRows = (detail.receipts ?? []) as any[];
  const inventoryMovementRows = (detail.inventoryMovements ?? []) as any[];
  const productionRows = (detail.production ?? []) as any[];
  const logisticsRows = (detail.logistics ?? []) as any[];
  const purchaseOrder = procurementRows.find((row) => row.purchase_order_id);
  const receipt = receiptRows[0] ?? procurementRows.find((row) => row.receipt_id);

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
      reason: "Existing operational work is linked to this item or order line.",
      tone: "info",
    };
  } else if (
    line.supply_status === "reserved" ||
    availableQuantity >= orderedQuantity
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

  const relatedWorkRows = [
    ...receiptRows.map((row: any) => ({
      type: "Receipt",
      reference: row.receipt_number,
      status: row.receipt_status,
      quantity: `${quantity(row.accepted_quantity)} accepted / ${quantity(
        row.rejected_quantity,
      )} rejected`,
      href: `/app/receiving/${row.receipt_id}`,
    })),
    ...inventoryMovementRows.map((row: any) => ({
      type: "Inventory",
      reference: movementLabel(row.movement_type),
      status: row.location_code ?? "Unassigned",
      quantity: quantity(row.quantity_delta),
      href: "/app/inventory",
    })),
    ...productionRows.map((row: any) => ({
      type: "Production",
      reference: row.production_order_number ?? "Production need",
      status: row.production_order_status ?? row.production_need_status,
      quantity: `${quantity(row.quantity)} ${row.unit}`,
      href: "/app/production",
    })),
    ...logisticsRows.map((row: any) => ({
      type: "Logistics",
      reference: row.shipment_number,
      status: row.status ?? row.shipping_order_status,
      quantity: `${quantity(row.ordered_quantity)} ${row.unit}`,
      href: "/app/logistics",
    })),
  ].slice(0, 8);

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

      <s-section heading="Order line summary">
        <DataTable
          headings={[
            "Order",
            "Line item",
            "Quantity",
            "Customer",
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
            "Physical",
            "Reserved",
            "Available",
            "Ordered",
            "Planned",
            "QC hold",
            "Quarantine",
          ]}
          rows={[
            [
              quantity(line.physical_quantity),
              quantity(line.reserved_quantity),
              quantity(line.available_quantity),
              quantity(line.ordered_quantity),
              quantity(line.planned_quantity),
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
              "Supplier",
              "Purchase Order",
              "Receiving",
              "Quantity",
            ]}
            rows={procurementRows.map((row: any) => [
              <MoneylessBadge>{row.purchase_need_status}</MoneylessBadge>,
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

      <s-section heading="Related work">
        {relatedWorkRows.length > 0 ? (
          <DataTable
            headings={["Work", "Reference", "Status", "Quantity", "Open"]}
            rows={relatedWorkRows.map((row) => [
              row.type,
              row.reference ?? "No reference",
              <MoneylessBadge>{row.status ?? "open"}</MoneylessBadge>,
              row.quantity,
              <s-link href={row.href}>Open</s-link>,
            ])}
          />
        ) : (
          <s-paragraph>
            No receiving, inventory, production or logistics work is linked yet.
          </s-paragraph>
        )}
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

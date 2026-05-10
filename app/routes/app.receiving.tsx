import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  loadReceivablePurchaseOrders,
  loadReceipts,
  postGoodsReceiptForAcknowledgedPurchaseOrders,
} from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    receivablePurchaseOrders: await loadReceivablePurchaseOrders(
      context.pool,
      context.ctx.tenantId,
    ),
    receiving: await loadReceipts(context.pool, context.ctx.tenantId),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "receive") {
    const result = await postGoodsReceiptForAcknowledgedPurchaseOrders(
      context.pool,
      context.ctx.tenantId,
      String(form.get("purchaseOrderId") || "") || undefined,
    );
    return {
      message: `${result.receipts} receipt(s) posted. ${result.qcChecks} line(s) are now on QC hold.`,
    };
  }

  return { message: "No action was performed." };
};

function formatDate(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function nextReceiptAction(receipt: any, lines: any[]) {
  if (receipt.status === "closed") return "Complete";
  if (
    lines.some(
      (line) =>
        line.qc_status === "open" ||
        line.qc_status === "in_progress" ||
        line.status === "qc_hold",
    )
  ) {
    return "QC";
  }
  if (lines.some((line) => line.status === "accepted")) return "Putaway";
  if (receipt.status === "cancelled") return "Cancelled";
  return "Review";
}

export default function Receiving() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("receiving" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }
  const receiving = data.receiving ?? { receipts: [], lines: [] };
  const linesByReceipt = new Map<string, any[]>();
  for (const line of (receiving.lines ?? []) as any[]) {
    const receiptLines = linesByReceipt.get(line.goods_receipt_id) ?? [];
    receiptLines.push(line);
    linesByReceipt.set(line.goods_receipt_id, receiptLines);
  }
  const readyPurchaseOrders = data.receivablePurchaseOrders ?? [];
  const firstReadyPurchaseOrder = readyPurchaseOrders[0] as any;

  return (
    <s-page heading="Receiving">
      <s-section>
        <s-paragraph>
          Track posted receipts and open each receipt to complete QC and
          putaway work.
        </s-paragraph>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section heading="Ready to receive">
        {readyPurchaseOrders.length > 0 ? (
          <s-stack direction="block" gap="base">
            <DataTable
              headings={["Purchase Order", "Supplier", "Lines", "Status"]}
              rows={readyPurchaseOrders.map((po: any) => ({
                id: po.id,
                href: `/app/procurement/${po.id}`,
                cells: [
                  <strong>{po.display_number}</strong>,
                  po.supplier_name,
                  po.line_count,
                  <MoneylessBadge>{po.status}</MoneylessBadge>,
                ],
              }))}
            />
            <Form method="post">
              <input type="hidden" name="intent" value="receive" />
              <s-stack direction="inline" gap="small">
                <s-select
                  label="Purchase Order"
                  name="purchaseOrderId"
                  value={firstReadyPurchaseOrder?.id ?? ""}
                >
                  {readyPurchaseOrders.map((po: any) => (
                    <s-option key={po.id} value={po.id}>
                      {po.display_number} · {po.supplier_name}
                    </s-option>
                  ))}
                </s-select>
                <s-button variant="primary" type="submit">
                  Post receipt
                </s-button>
              </s-stack>
            </Form>
          </s-stack>
        ) : (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>No purchase orders are ready to receive.</s-paragraph>
          </s-box>
        )}
      </s-section>

      <s-section heading="Goods receipts">
        <DataTable
          headings={[
            "Receipt",
            "Purchase Order",
            "Supplier",
            "Status",
            "Received",
            "Lines",
            "Next action",
            "Detail",
          ]}
          rows={(receiving.receipts ?? []).map((receipt: any) => [
            <strong>{receipt.receipt_number}</strong>,
            <s-link href={`/app/procurement/${receipt.purchase_order_id}`}>
              {receipt.purchase_order_number}
            </s-link>,
            receipt.supplier_name,
            <MoneylessBadge>{receipt.status}</MoneylessBadge>,
            formatDate(receipt.received_at ?? receipt.created_at),
            receipt.line_count,
            nextReceiptAction(
              receipt,
              linesByReceipt.get(receipt.id) ?? [],
            ),
            <s-link href={`/app/receiving/${receipt.id}`}>
              Open receipt
            </s-link>,
          ])}
        />
      </s-section>
    </s-page>
  );
}

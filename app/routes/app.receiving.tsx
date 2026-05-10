import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  completeReceiptLineQc,
  loadReceivablePurchaseOrders,
  loadReceipts,
  postGoodsReceiptForAcknowledgedPurchaseOrders,
  putawayReceiptLine,
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

  if (intent === "completeLineQc") {
    const result = await completeReceiptLineQc(context.pool, context.ctx.tenantId, {
      goodsReceiptLineId: String(form.get("goodsReceiptLineId")),
      acceptedQuantity: Number(form.get("acceptedQuantity") || 0),
      rejectedQuantity: Number(form.get("rejectedQuantity") || 0),
      notes: String(form.get("notes") || ""),
    });
    return {
      message: `QC completed: ${result.accepted} accepted, ${result.rejected} quarantined.`,
    };
  }

  if (intent === "putawayReceiptLine") {
    const result = await putawayReceiptLine(
      context.pool,
      context.ctx.tenantId,
      String(form.get("goodsReceiptLineId")),
    );
    return {
      message: `${result.putaway} unit(s) put away into MAIN inventory.`,
    };
  }

  return { message: "No action was performed." };
};

export default function Receiving() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("receiving" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }
  const receiving = data.receiving ?? { receipts: [], lines: [] };

  return (
    <s-page heading="Receiving and QC">
      <s-section>
        <s-paragraph>
          Receiving turns acknowledged purchase orders into goods receipts. QC
          keeps material on hold until accepted. Accepted quantity creates a
          putaway task; rejected quantity is moved to quarantine.
        </s-paragraph>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section heading="Ready to receive">
        <DataTable
          headings={["PO", "Supplier", "Lines", "Status", "Action"]}
          rows={(data.receivablePurchaseOrders ?? []).map((po: any) => [
            <strong>{po.display_number}</strong>,
            po.supplier_name,
            po.line_count,
            <MoneylessBadge>{po.status}</MoneylessBadge>,
            <Form method="post">
              <input type="hidden" name="intent" value="receive" />
              <input type="hidden" name="purchaseOrderId" value={po.id} />
              <s-button variant="primary" type="submit">Post receipt</s-button>
            </Form>,
          ])}
        />
      </s-section>

      <s-section heading="Goods receipts">
        <DataTable
          headings={["Receipt", "Purchase order", "Supplier", "Status", "Lines"]}
          rows={(receiving.receipts ?? []).map((receipt: any) => [
            <strong>{receipt.receipt_number}</strong>,
            receipt.purchase_order_number,
            receipt.supplier_name,
            <MoneylessBadge>{receipt.status}</MoneylessBadge>,
            receipt.line_count,
          ])}
        />
      </s-section>

      <s-section heading="Receipt lines and QC">
        <DataTable
          headings={["Item", "Received", "Accepted / rejected", "Line status", "QC", "Action"]}
          rows={(receiving.lines ?? []).map((line: any) => [
            <strong>{line.sku} {line.title}</strong>,
            `${Number(line.received_quantity).toLocaleString()} ${line.unit}`,
            `${Number(line.accepted_quantity).toLocaleString()} / ${Number(line.rejected_quantity).toLocaleString()}`,
            <MoneylessBadge>{line.status}</MoneylessBadge>,
            `${line.qc_status ?? "not required"} · ${line.qc_result ?? "pending"}`,
            line.qc_status === "open" || line.qc_status === "in_progress" ? (
              <Form method="post">
                <input type="hidden" name="intent" value="completeLineQc" />
                <input type="hidden" name="goodsReceiptLineId" value={line.id} />
                <s-stack direction="inline" gap="small">
                  <input
                    aria-label="Accepted quantity"
                    name="acceptedQuantity"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={line.received_quantity}
                  />
                  <input
                    aria-label="Rejected quantity"
                    name="rejectedQuantity"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue="0"
                  />
                  <s-button type="submit">Complete QC</s-button>
                </s-stack>
              </Form>
            ) : line.status === "accepted" ? (
              <Form method="post">
                <input type="hidden" name="intent" value="putawayReceiptLine" />
                <input type="hidden" name="goodsReceiptLineId" value={line.id} />
                <s-button variant="primary" type="submit">Put away</s-button>
              </Form>
            ) : (
              "Completed"
            ),
          ])}
        />
      </s-section>
    </s-page>
  );
}

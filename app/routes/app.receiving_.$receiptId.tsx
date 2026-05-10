import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  completeReceiptLineQc,
  loadReceiptDetail,
  putawayReceiptLine,
} from "../lib/operations-kit.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    detail: await loadReceiptDetail(
      context.pool,
      context.ctx.tenantId,
      params.receiptId!,
    ),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent"));

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

function formatDate(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function qcLabel(line: any) {
  if (!line.qc_status) return "Not required";
  if (line.qc_result) return `${line.qc_status} · ${line.qc_result}`;
  return `${line.qc_status} · pending`;
}

function putawayLabel(line: any) {
  if (line.status === "putaway_done") return "Done";
  if (line.status === "accepted") {
    return line.putaway_task_status
      ? `${line.putaway_task_status} task`
      : "Ready";
  }
  if (line.status === "rejected") return "Not required";
  return "Waiting for QC";
}

function lineActionLabel(line: any) {
  if (line.qc_status === "open" || line.qc_status === "in_progress")
    return "QC";
  if (line.status === "accepted") return "Putaway";
  return "No action";
}

export default function ReceiptDetail() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("detail" in data)) {
    return (
      <SetupBanner
        message={data.setupError ?? "Database setup is incomplete."}
      />
    );
  }

  const detail = data.detail ?? { receipt: null, lines: [] };
  const receipt = detail.receipt as any;
  if (!receipt) {
    return (
      <s-page heading="Receipt not found">
        <s-section>
          <s-link href="/app/receiving">Back to Receiving</s-link>
        </s-section>
      </s-page>
    );
  }

  const qcLines = (detail.lines ?? []).filter(
    (line: any) =>
      line.qc_status === "open" || line.qc_status === "in_progress",
  );
  const putawayLines = (detail.lines ?? []).filter(
    (line: any) => line.status === "accepted",
  );

  return (
    <s-page heading={`Receipt ${receipt.receipt_number}`}>
      <s-section>
        <s-stack direction="block" gap="small">
          <s-link href="/app/receiving">Back to Receiving</s-link>
          {actionData?.message ? (
            <s-box padding="base" borderWidth="base" borderRadius="base">
              <s-paragraph>{actionData.message}</s-paragraph>
            </s-box>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading="Receipt header">
        <DataTable
          headings={[
            "Receipt",
            "Purchase Order",
            "Supplier",
            "Status",
            "Received",
          ]}
          rows={[
            [
              <strong>{receipt.receipt_number}</strong>,
              <s-link href={`/app/procurement/${receipt.purchase_order_id}`}>
                {receipt.purchase_order_number}
              </s-link>,
              receipt.supplier_name,
              <MoneylessBadge>{receipt.status}</MoneylessBadge>,
              formatDate(receipt.received_at ?? receipt.created_at),
            ],
          ]}
        />
      </s-section>

      <s-section heading="Receipt lines">
        <DataTable
          headings={[
            "Item",
            "Received",
            "Accepted / rejected",
            "QC",
            "Putaway",
            "Status",
            "Next action",
          ]}
          rows={(detail.lines ?? []).map((line: any) => [
            <strong>
              {line.sku} {line.title}
            </strong>,
            `${Number(line.received_quantity).toLocaleString()} ${line.unit}`,
            `${Number(line.accepted_quantity).toLocaleString()} / ${Number(line.rejected_quantity).toLocaleString()}`,
            qcLabel(line),
            putawayLabel(line),
            <MoneylessBadge>{line.status}</MoneylessBadge>,
            lineActionLabel(line),
          ])}
        />
      </s-section>

      {qcLines.length > 0 ? (
        <s-section heading="QC actions">
          <s-stack direction="block" gap="base">
            {qcLines.map((line: any) => (
              <s-box
                key={line.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <Form method="post">
                  <input type="hidden" name="intent" value="completeLineQc" />
                  <input
                    type="hidden"
                    name="goodsReceiptLineId"
                    value={line.id}
                  />
                  <s-stack direction="block" gap="base">
                    <s-heading>
                      QC · {line.sku} {line.title}
                    </s-heading>
                    <s-grid grid-template-columns="1fr 1fr" gap="base">
                      <s-number-field
                        label="Accepted quantity"
                        name="acceptedQuantity"
                        min={0}
                        step={1}
                        value={String(line.received_quantity)}
                      ></s-number-field>
                      <s-number-field
                        label="Rejected quantity"
                        name="rejectedQuantity"
                        min={0}
                        step={1}
                        value="0"
                      ></s-number-field>
                    </s-grid>
                    <s-text-field label="Notes" name="notes"></s-text-field>
                    <s-button type="submit">Complete QC</s-button>
                  </s-stack>
                </Form>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      ) : null}

      {putawayLines.length > 0 ? (
        <s-section heading="Putaway actions">
          <s-stack direction="block" gap="base">
            {putawayLines.map((line: any) => (
              <s-box
                key={line.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
              >
                <Form method="post">
                  <input
                    type="hidden"
                    name="intent"
                    value="putawayReceiptLine"
                  />
                  <input
                    type="hidden"
                    name="goodsReceiptLineId"
                    value={line.id}
                  />
                  <s-stack direction="block" gap="small">
                    <s-heading>
                      Putaway · {line.sku} {line.title}
                    </s-heading>
                    <s-paragraph>
                      {Number(line.accepted_quantity).toLocaleString()}{" "}
                      {line.unit} ready for MAIN inventory.
                    </s-paragraph>
                    <s-button variant="primary" type="submit">
                      Put away
                    </s-button>
                  </s-stack>
                </Form>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}

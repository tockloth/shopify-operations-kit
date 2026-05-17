import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  exportPaymentEntries,
  loadPaymentEntries,
} from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) {
    return { configured: false, setupError: context.setupError };
  }

  const url = new URL(request.url);
  return {
    configured: true,
    payments: await loadPaymentEntries(context.pool, context.ctx.tenantId),
    select: url.searchParams.get("select") ?? "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "exportSelected") {
    const ids = form.getAll("paymentId").map(String);
    const result = await exportPaymentEntries(
      context.pool,
      context.ctx.tenantId,
      ids,
    );
    return {
      message: `${result.exported} payment entr${result.exported === 1 ? "y" : "ies"} exported.`,
    };
  }

  return { message: "No payment action was performed." };
};

function formatDate(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatMoney(amount: unknown, currencyCode: unknown) {
  return `${Number(amount ?? 0).toLocaleString()} ${String(currencyCode || "EUR")}`;
}

export default function Payments() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("payments" in data)) {
    return (
      <SetupBanner
        message={data.setupError ?? "Database setup is incomplete."}
      />
    );
  }

  const payments = data.payments ?? [];
  const selectUnexported = data.select === "unexported";

  return (
    <s-page heading="Payments">
      <s-section>
        <Form method="post">
          <input type="hidden" name="intent" value="exportSelected" />
          <div className="kit-toolbar">
            <div />
            <div className="kit-toolbar-actions">
              <Link to="/app/payments?select=unexported">
                <s-button>Mark all not exported</s-button>
              </Link>
              <Link to="/app/payments">
                <s-button>Clear selection</s-button>
              </Link>
              <s-button variant="primary" type="submit">
                Export selected
              </s-button>
            </div>
          </div>
          {actionData?.message ? (
            <s-banner tone="success">{actionData.message}</s-banner>
          ) : null}
          <DataTable
            headings={[
              "Select",
              "Payment",
              "Supplier",
              "Purchase Order",
              "Status",
              "Amount",
              "Due date",
              "Last exported",
            ]}
            rows={payments.map((payment: any) => {
              const exported = Boolean(payment.exported_at);
              return [
                exported ? (
                  ""
                ) : (
                  <input
                    aria-label={`Select ${payment.payment_number}`}
                    type="checkbox"
                    name="paymentId"
                    value={payment.id}
                    defaultChecked={selectUnexported}
                  />
                ),
                <strong>{payment.payment_number}</strong>,
                payment.supplier_name ?? "No supplier",
                <Link to={`/app/procurement/${payment.purchase_order_id}`}>
                  {payment.purchase_order_number}
                </Link>,
                <MoneylessBadge tone={exported ? "success" : "info"}>
                  {exported ? "Exported" : payment.status}
                </MoneylessBadge>,
                formatMoney(
                  payment.gross_amount ?? payment.net_amount,
                  payment.currency_code,
                ),
                formatDate(payment.due_date) || "No due date",
                exported ? formatDate(payment.exported_at) : "Not exported",
              ];
            })}
          />
        </Form>
      </s-section>
    </s-page>
  );
}

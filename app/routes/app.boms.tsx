import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  commitMrpRun,
  loadBoms,
  loadMrpRunDetail,
  loadMrpRuns,
  runOperationsMrp,
} from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  const url = new URL(request.url);
  const mrpRunId = url.searchParams.get("mrpRunId");

  return {
    configured: true,
    boms: await loadBoms(context.pool, context.ctx.tenantId),
    mrpRuns: await loadMrpRuns(context.pool, context.ctx.tenantId),
    mrpDetail: mrpRunId
      ? await loadMrpRunDetail(context.pool, context.ctx.tenantId, mrpRunId)
      : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "runOperationsMrp") {
    const result = await runOperationsMrp(context.pool, context.ctx.tenantId);
    return {
      message: `MRP preview created for ${result.orderLines} open order line(s). Open run ${result.mrpRunId.slice(0, 8)} to review recommendations.`,
    };
  }

  if (intent === "commit") {
    const mrpRunId = String(form.get("mrpRunId"));
    const result = await commitMrpRun(context.pool, context.ctx.tenantId, mrpRunId);
    return {
      message: `Needs committed: ${result.productionNeeds} production need(s), ${result.purchaseNeeds} purchase need(s).`,
    };
  }

  return { message: "No action was performed." };
};

export default function BomMrp() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("boms" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  return (
    <s-page heading="BOM and MRP">
      <s-section>
        <s-paragraph>
          Maintain the manufacturing relationship between sellable assemblies
          and their required materials, then run planning previews.
        </s-paragraph>
        {actionData?.message ? (
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        ) : null}
      </s-section>

      <s-section heading="Active BOMs">
        <DataTable
          headings={["Parent item", "Status", "Components", "Validation"]}
          rows={(data.boms ?? []).map((bom: any) => [
            <strong>
              {bom.parent_sku} {bom.parent_title}
            </strong>,
            <MoneylessBadge tone={bom.is_active ? "success" : "warning"}>
              {bom.is_active ? "active" : "inactive"}
            </MoneylessBadge>,
            bom.line_count,
            bom.is_producible
              ? "Valid for production MRP"
              : "Parent must be producible before active MRP",
          ])}
        />
      </s-section>

      <s-section heading="Run MRP">
        <Form method="post">
          <input type="hidden" name="intent" value="runOperationsMrp" />
          <s-button variant="primary" type="submit">
            Plan open Shopify orders
          </s-button>
        </Form>
      </s-section>

      <s-section heading="MRP runs">
        <DataTable
          headings={["Run", "Scenario", "Status", "Lines", "Next action"]}
          rows={(data.mrpRuns ?? []).map((run: any) => [
            <Link to={`/app/boms?mrpRunId=${run.id}`}>
              <strong>{String(run.id).slice(0, 8)}</strong>
            </Link>,
            run.scenario_mode,
            <MoneylessBadge tone={run.status === "committed" ? "success" : "info"}>
              {run.status}
            </MoneylessBadge>,
            run.line_count,
            run.status === "committed" ? (
              <s-link href="/app/procurement">Open needs</s-link>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="commit" />
                <input type="hidden" name="mrpRunId" value={run.id} />
                <s-button type="submit">Commit needs</s-button>
              </Form>
            ),
          ])}
        />
      </s-section>

      {data.mrpDetail?.run ? (
        <s-section heading="Selected MRP run detail">
          <DataTable
            headings={["Item", "Demand", "Available", "Shortage", "Recommended action", "Explanation"]}
            rows={data.mrpDetail.lines.map((line: any) => [
              <strong>
                {line.sku} {line.title}
              </strong>,
              Number(line.demand_quantity).toLocaleString(),
              Number(line.available_quantity).toLocaleString(),
              Number(line.shortage_quantity).toLocaleString(),
              <MoneylessBadge
                tone={
                  line.recommended_action === "buy"
                    ? "warning"
                    : line.recommended_action === "make"
                      ? "info"
                      : "success"
                }
              >
                {line.recommended_action}
              </MoneylessBadge>,
              line.explanation,
            ])}
          />
        </s-section>
      ) : null}
    </s-page>
  );
}

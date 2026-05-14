import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  addBomLineToItem,
  commitMrpRun,
  createActiveBomForItem,
  deleteBomLine,
  loadBomProductContext,
  loadBoms,
  loadMrpRunDetail,
  loadMrpRuns,
  runOperationsMrp,
  updateBomLineQuantity,
} from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  const url = new URL(request.url);
  const mrpRunId = url.searchParams.get("mrpRunId");
  const parentItemId = url.searchParams.get("parentItemId");

  return {
    configured: true,
    parentItemId,
    boms: await loadBoms(context.pool, context.ctx.tenantId),
    bomContext: await loadBomProductContext(
      context.pool,
      context.ctx.tenantId,
      parentItemId,
    ),
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
  const parentItemId = String(form.get("parentItemId") || "");

  if (intent === "createActiveBom") {
    try {
      await createActiveBomForItem(
        context.pool,
        context.ctx.tenantId,
        parentItemId,
      );
      return { message: "Active BOM created. Add components next." };
    } catch (error) {
      return { message: error instanceof Error ? error.message : String(error) };
    }
  }

  if (intent === "addBomLine") {
    const quantity = Number(form.get("quantity") || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { message: "Quantity must be greater than zero." };
    }

    try {
      await addBomLineToItem(context.pool, context.ctx.tenantId, {
        parentItemId,
        componentItemId: String(form.get("componentItemId") || ""),
        quantity,
      });
      return { message: "BOM component saved." };
    } catch (error) {
      return { message: error instanceof Error ? error.message : String(error) };
    }
  }

  if (intent === "updateBomLineQuantity") {
    const quantity = Number(form.get("quantity") || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { message: "Quantity must be greater than zero." };
    }

    try {
      await updateBomLineQuantity(context.pool, context.ctx.tenantId, {
        bomLineId: String(form.get("bomLineId") || ""),
        quantity,
        unit: String(form.get("unit") || "pcs"),
      });
      return { message: "Component quantity updated." };
    } catch (error) {
      return { message: error instanceof Error ? error.message : String(error) };
    }
  }

  if (intent === "deleteBomLine") {
    try {
      await deleteBomLine(
        context.pool,
        context.ctx.tenantId,
        String(form.get("bomLineId") || ""),
      );
      return { message: "Component removed from BOM." };
    } catch (error) {
      return { message: error instanceof Error ? error.message : String(error) };
    }
  }

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
  const bomContext = data.bomContext as any;
  const parent = bomContext?.parent as any;
  const activeBom = bomContext?.activeBom as any;
  const availableComponents = (bomContext?.availableComponents ?? []) as any[];

  return (
    <s-page heading="BOM and MRP">
      <s-section>
        <s-stack direction="block" gap="small">
          {parent ? (
            <s-link href={`/app/items/${parent.id}`}>Back to product</s-link>
          ) : (
            <s-link href="/app/items">Back to products</s-link>
          )}
        </s-stack>
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

      {parent ? (
        <s-section heading={`BOM for ${parent.sku} / ${parent.title}`}>
          <s-stack direction="block" gap="base">
            <DataTable
              headings={["Parent product", "Status", "Active BOM", "Components", "Open"]}
              rows={[
                [
                  <strong>
                    {parent.sku} {parent.title}
                  </strong>,
                  parent.is_producible ? (
                    <MoneylessBadge tone="success">Producible</MoneylessBadge>
                  ) : (
                    <MoneylessBadge tone="warning">Not producible</MoneylessBadge>
                  ),
                  activeBom ? (
                    <MoneylessBadge tone="success">Active</MoneylessBadge>
                  ) : (
                    <MoneylessBadge tone="warning">Missing</MoneylessBadge>
                  ),
                  Number(activeBom?.line_count ?? 0).toLocaleString(),
                  <s-link href={`/app/items/${parent.id}`}>Open product</s-link>,
                ],
              ]}
            />

            {!parent.is_producible ? (
              <s-banner tone="warning">
                Mark this item as producible on Product Detail before creating a BOM.
              </s-banner>
            ) : !activeBom ? (
              <Form method="post">
                <input type="hidden" name="intent" value="createActiveBom" />
                <input type="hidden" name="parentItemId" value={parent.id} />
                <s-button variant="primary" type="submit">
                  Create active BOM
                </s-button>
              </Form>
            ) : null}

            {activeBom ? (
              <>
                {(bomContext.bomLines ?? []).length > 0 ? (
                  <DataTable
                    headings={[
                      "Component",
                      "Type",
                      "Policy",
                      "Quantity",
                      "Update quantity",
                      "Remove component",
                    ]}
                    rows={(bomContext.bomLines ?? []).map((line: any) => [
                      <strong>
                        {line.component_sku} {line.component_title}
                      </strong>,
                      line.item_type,
                      [
                        line.is_purchasable ? "buy" : null,
                        line.is_producible ? "make" : null,
                      ]
                        .filter(Boolean)
                        .join(" / ") || "component",
                      `${Number(line.quantity ?? 0).toLocaleString()} ${line.unit}`,
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="updateBomLineQuantity"
                        />
                        <input
                          type="hidden"
                          name="parentItemId"
                          value={parent.id}
                        />
                        <input
                          type="hidden"
                          name="bomLineId"
                          value={line.id}
                        />
                        <s-stack direction="inline" gap="small">
                          <s-number-field
                            label="Quantity"
                            name="quantity"
                            min={0.0001}
                            step={1}
                            value={String(line.quantity ?? 1)}
                          ></s-number-field>
                          <s-text-field
                            label="Unit"
                            name="unit"
                            value={line.unit ?? "pcs"}
                          ></s-text-field>
                          <s-button type="submit">Update quantity</s-button>
                        </s-stack>
                      </Form>,
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="deleteBomLine"
                        />
                        <input
                          type="hidden"
                          name="parentItemId"
                          value={parent.id}
                        />
                        <input
                          type="hidden"
                          name="bomLineId"
                          value={line.id}
                        />
                        <s-button type="submit">Remove component</s-button>
                      </Form>,
                    ])}
                  />
                ) : (
                  <s-box padding="base" borderWidth="base" borderRadius="base">
                    <s-paragraph>
                      Add components to define what is required to produce this item.
                    </s-paragraph>
                  </s-box>
                )}

                {availableComponents.length > 0 ? (
                  <s-box padding="base" borderWidth="base" borderRadius="base">
                    <Form method="post">
                      <input type="hidden" name="intent" value="addBomLine" />
                      <input type="hidden" name="parentItemId" value={parent.id} />
                      <s-stack direction="block" gap="base">
                        <s-grid grid-template-columns="minmax(0, 2fr) minmax(140px, 1fr)" gap="base">
                          <s-select label="Component" name="componentItemId">
                            {availableComponents.map((component: any) => (
                              <s-option key={component.id} value={component.id}>
                                {component.sku} / {component.title}
                              </s-option>
                            ))}
                          </s-select>
                          <s-number-field
                            label="Quantity"
                            name="quantity"
                            min={1}
                            step={1}
                            value="1"
                          ></s-number-field>
                        </s-grid>
                        <s-button variant="primary" type="submit">
                          Add component
                        </s-button>
                      </s-stack>
                    </Form>
                  </s-box>
                ) : (
                  <s-banner tone="warning">
                    Create component or material products before adding BOM lines.
                  </s-banner>
                )}
              </>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading="Active BOMs">
        <DataTable
          headings={["Parent product", "Active BOM", "Components", "Product", "Next action"]}
          rows={(data.boms ?? []).map((bom: any) => ({
            id: bom.id,
            href: `/app/boms?parentItemId=${bom.parent_item_id}`,
            cells: [
              <strong>
                {bom.parent_sku} {bom.parent_title}
              </strong>,
              <MoneylessBadge tone={bom.is_active ? "success" : "warning"}>
                {bom.is_active ? "active" : "inactive"}
              </MoneylessBadge>,
              bom.line_count,
              <s-link href={`/app/items/${bom.parent_item_id}`}>
                Open product
              </s-link>,
              !bom.is_producible ? (
                "Review product classification"
              ) : Number(bom.line_count ?? 0) === 0 ? (
                <s-link href={`/app/boms?parentItemId=${bom.parent_item_id}`}>
                  Add components
                </s-link>
              ) : (
                <s-link href={`/app/boms?parentItemId=${bom.parent_item_id}`}>
                  Review BOM
                </s-link>
              ),
            ],
          }))}
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

import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { KpiCard, NextAction, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { loadDashboard } from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    summary: await loadDashboard(context.pool, context.ctx.tenantId),
  };
};

export default function Dashboard() {
  const data = useLoaderData<typeof loader>();

  if (!data.configured || !("summary" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  const summary = data.summary ?? {
    items: 0,
    activeBoms: 0,
    purchaseNeedsOpen: 0,
    productionNeedsOpen: 0,
    draftPurchaseOrders: 0,
    sentPurchaseOrders: 0,
    acknowledgedPurchaseOrders: 0,
    openReceipts: 0,
    openQcChecks: 0,
    openWarehouseTasks: 0,
    openCases: 0,
    latestMrpRun: null,
  };

  return (
    <s-page heading="Operations Kit">
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Shopify bleibt fuehrend fuer Produkte, Varianten, Orders und Inventory.
            Operations Kit plant daraus interne Arbeit: BOM, MRP, Einkauf,
            Produktion, Warehouse-Aufgaben und operative Nachweise.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Operational summary">
        <div className="kit-grid">
          <KpiCard label="Items" value={summary.items} href="/app/items" />
          <KpiCard label="Active BOMs" value={summary.activeBoms} href="/app/boms" />
          <KpiCard
            label="Latest MRP"
            value={summary.latestMrpRun?.status ?? "not run"}
            href="/app/boms"
          />
          <KpiCard
            label="Open purchase needs"
            value={summary.purchaseNeedsOpen}
            href="/app/procurement"
          />
          <KpiCard
            label="Open production needs"
            value={summary.productionNeedsOpen}
            href="/app/production"
          />
          <KpiCard
            label="Draft POs"
            value={summary.draftPurchaseOrders}
            href="/app/procurement"
          />
          <KpiCard
            label="Open pick tasks"
            value={summary.openWarehouseTasks}
            href="/app/warehouse"
          />
          <KpiCard
            label="Receipts / QC"
            value={`${summary.openReceipts}/${summary.openQcChecks}`}
            href="/app/receiving"
          />
          <KpiCard label="Open cases" value={summary.openCases} href="/app/cases" />
        </div>
      </s-section>

      <s-section heading="Operating workflow">
        <div className="kit-two-column">
          <NextAction title="1. Sync Shopify">
            <s-paragraph>
              Bring Shopify products, variants, inventory references and orders
              into Operations Kit before planning work.
            </s-paragraph>
            <s-link href="/app/items">Sync products</s-link>
            <s-link href="/app/orders">Sync orders</s-link>
          </NextAction>

          <NextAction title="2. Classify items">
            <s-paragraph>
              Mark variants as sellable products, produced assemblies or
              purchased components. Maintain BOM, supplier, minimum stock,
              default quantities and QC policy.
            </s-paragraph>
            <s-link href="/app/items">Open products</s-link>
          </NextAction>

          <NextAction title="3. Plan and approve">
            <s-paragraph>
              Run MRP for open Shopify orders, commit needs, create purchase
              orders with Procurement Manager approval, or production work with
              production QC.
            </s-paragraph>
            <s-link href="/app/boms">Run MRP</s-link>
            <s-link href="/app/procurement">Open procurement</s-link>
          </NextAction>

          <NextAction title="4. Receive, produce, ship">
            <s-paragraph>
              Complete receiving QC, put away accepted stock, quarantine
              rejected stock, execute production, and pack customer shipments.
            </s-paragraph>
            <s-link href="/app/receiving">Open receiving</s-link>
            <s-link href="/app/logistics">Open logistics</s-link>
          </NextAction>
        </div>
      </s-section>

      <s-section heading="Planning-to-work flow">
        <div className="kit-flow">
          {[
            ["Items/BOM", "/app/items"],
            ["Operations order", "/app/orders"],
            ["MRP preview", "/app/boms"],
            ["Needs", "/app/procurement"],
            ["Purchase order", "/app/procurement"],
            ["Receiving/QC", "/app/receiving"],
            ["Production order", "/app/production"],
            ["Pick tasks", "/app/warehouse"],
            ["Shipping", "/app/logistics"],
            ["Inventory ledger", "/app/inventory"],
            ["Case evidence", "/app/cases"],
          ].map(([label, href]) => (
            <Link key={label} to={href}>
              <s-box padding="small" borderWidth="base" borderRadius="base">
                <s-text>{label}</s-text>
              </s-box>
            </Link>
          ))}
        </div>
      </s-section>

      <s-section heading="Next work">
        <div className="kit-two-column">
          <NextAction title="Procurement control">
            <s-paragraph>
              Procurement prepares POs; Procurement Manager approves before
              supplier sending and receiving.
            </s-paragraph>
            <s-link href="/app/procurement">Open Procurement</s-link>
          </NextAction>
          <NextAction title="Production and logistics">
            <s-paragraph>
              Production completes work and QC, then releases accepted quantity
              either to inventory or directly toward logistics.
            </s-paragraph>
            <s-link href="/app/production">Open Production</s-link>
          </NextAction>
        </div>
      </s-section>
    </s-page>
  );
}

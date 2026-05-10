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
            Operations Kit konzentriert sich jetzt auf Handelsware: Stammdaten,
            Kundenauftraege, Bestand, Beschaffung und Versandvorbereitung.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Operational summary">
        <div className="kit-grid">
          <KpiCard label="Items" value={summary.items} href="/app/items" />
          <KpiCard
            label="Latest planning run"
            value={summary.latestMrpRun?.status ?? "not run"}
            href="/app/procurement"
          />
          <KpiCard
            label="Open purchase needs"
            value={summary.purchaseNeedsOpen}
            href="/app/procurement"
          />
          <KpiCard
            label="Draft POs"
            value={summary.draftPurchaseOrders}
            href="/app/procurement"
          />
        </div>
      </s-section>

      <s-section heading="Operating workflow">
        <div className="kit-two-column">
          <NextAction title="1. Sync Shopify">
            <s-paragraph>
              Bring Shopify products, variants, inventory references and orders
              into Operations Kit before planning work.
            </s-paragraph>
            <s-link href="/app/items">Products</s-link>
            <s-link href="/app/orders">Orders</s-link>
          </NextAction>

          <NextAction title="2. Classify items">
            <s-paragraph>
              Mark variants as sellable and purchased. Maintain supplier,
              minimum stock, lot size, lead time and receipt QC policy.
            </s-paragraph>
            <s-link href="/app/items">Open products</s-link>
          </NextAction>

          <NextAction title="3. Plan and approve">
            <s-paragraph>
              Plan purchasing needs for open Shopify orders and minimum stock,
              assign suppliers, create purchase orders and approve them.
            </s-paragraph>
            <s-link href="/app/procurement">Open procurement</s-link>
          </NextAction>

          <NextAction title="4. Receive and ship">
            <s-paragraph>
              Receive ordered goods, approve receipt QC later, keep inventory
              visible and prepare customer shipments.
            </s-paragraph>
            <s-link href="/app/inventory">Open inventory</s-link>
            <s-link href="/app/logistics">Open logistics</s-link>
          </NextAction>
        </div>
      </s-section>

      <s-section heading="Planning-to-work flow">
        <div className="kit-flow">
          {[
            ["Products", "/app/items"],
            ["Customer orders", "/app/orders"],
            ["Inventory", "/app/inventory"],
            ["Purchase needs", "/app/procurement"],
            ["Purchase order", "/app/procurement"],
            ["Shipping", "/app/logistics"],
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
          <NextAction title="Inventory and logistics">
            <s-paragraph>
              Inventory receives and reserves stock. Logistics prepares full or
              partial deliveries for customer orders.
            </s-paragraph>
            <s-link href="/app/inventory">Open Inventory</s-link>
          </NextAction>
        </div>
      </s-section>
    </s-page>
  );
}

import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { KpiCard, NextAction, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  loadDashboard,
  loadDashboardOrderLineCards,
  loadOperationsOrdersList,
} from "../lib/operations-kit.server";

type DashboardOrder = Awaited<ReturnType<typeof loadOperationsOrdersList>>[number];
type DashboardOrderLineCard = Awaited<ReturnType<typeof loadDashboardOrderLineCards>>[number];

const orderStatusColumns = [
  { key: "needs_planning", label: "Needs planning", href: "/app/orders" },
  { key: "procurement", label: "Procurement", href: "/app/procurement" },
  { key: "receiving", label: "Receiving / QC", href: "/app/receiving" },
  { key: "ready_for_logistics", label: "Ready for logistics", href: "/app/logistics" },
  { key: "shipment", label: "Shipment", href: "/app/logistics" },
  { key: "fulfilled_done", label: "Fulfilled / Done", href: "/app/orders" },
  { key: "blocked_review", label: "Blocked / Review", href: "/app/orders" },
] as const;

type OrderStatusColumnKey = (typeof orderStatusColumns)[number]["key"];

const orderLineStatusColumns = [
  { key: "needs_planning", label: "Needs planning", href: "/app/orders" },
  { key: "procurement", label: "Procurement", href: "/app/procurement" },
  { key: "receiving", label: "Receiving / QC", href: "/app/receiving" },
  { key: "putaway_pending", label: "Putaway", href: "/app/receiving" },
  { key: "ready_for_logistics", label: "Ready for logistics", href: "/app/logistics" },
  { key: "shipment", label: "Shipment", href: "/app/logistics" },
  { key: "fulfilled_done", label: "Fulfilled / Done", href: "/app/orders" },
  { key: "blocked_review", label: "Blocked / Review", href: "/app/orders" },
] as const;

function mapOrderStatusToColumn(status?: string | null): OrderStatusColumnKey {
  switch (status) {
    case "Purchase proposal ready":
    case "Purchase Order created":
    case "Sent to supplier":
      return "procurement";
    case "Awaiting receipt":
    case "Receiving / QC":
    case "Putaway pending":
      return "receiving";
    case "Ready for logistics":
      return "ready_for_logistics";
    case "Shipment created":
      return "shipment";
    case "Complete":
      return "fulfilled_done";
    case "Logistics blocked":
    case "Shipment complete, address missing in Operations Kit":
    case "Review required":
    case "Production in progress":
      return "blocked_review";
    case "Needs planning":
    default:
      return "needs_planning";
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  const [summary, orders, orderLineCards] = await Promise.all([
    loadDashboard(context.pool, context.ctx.tenantId),
    loadOperationsOrdersList(context.pool, context.ctx.tenantId),
    loadDashboardOrderLineCards(context.pool, context.ctx.tenantId),
  ]);

  return {
    configured: true,
    summary,
    orders,
    orderLineCards,
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
  const orders = data.orders ?? [];
  const ordersByColumn = orderStatusColumns.map((column) => ({
    ...column,
    orders: orders.filter(
      (order: DashboardOrder) => mapOrderStatusToColumn(order.operational_status) === column.key,
    ),
  }));
  const orderLineCards = data.orderLineCards ?? [];
  const orderLineCardsByColumn = orderLineStatusColumns.map((column) => ({
    ...column,
    cards: orderLineCards.filter(
      (card: DashboardOrderLineCard) => card.statusKey === column.key,
    ),
  }));

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

      <s-section heading="Order Status Board">
        <div className="kit-board-toolbar">
          <s-paragraph>
            Aggregate customer-order status derived from the existing Operations
            order list.
          </s-paragraph>
          <Link className="kit-board-refresh" to="/app">
            Refresh
          </Link>
        </div>
        <div className="kit-status-board">
          {ordersByColumn.map((column) => (
            <div className="kit-status-column" key={column.key}>
              <Link className="kit-status-column-header" to={column.href}>
                <span>{column.label}</span>
                <span className="kit-status-count">{column.orders.length}</span>
              </Link>
              <div className="kit-status-card-stack">
                {column.orders.length === 0 ? (
                  <div className="kit-status-empty">No orders</div>
                ) : (
                  column.orders.map((order: DashboardOrder) => {
                    const statusKey = mapOrderStatusToColumn(order.operational_status);
                    return (
                      <Link
                        className={`kit-status-card${
                          statusKey === "blocked_review" ? " kit-status-card-blocked" : ""
                        }`}
                        key={order.id}
                        to={`/app/orders/${order.id}`}
                      >
                        <strong>{order.order_name}</strong>
                        <span className="kit-muted">{order.customer_name ?? "No customer"}</span>
                        <span>{order.product_summary ?? "No products"}</span>
                        <span className="kit-status-card-status">
                          {order.operational_status ?? "Needs planning"}
                        </span>
                        <span className="kit-status-card-next">
                          {order.next_action_label ?? "Open order"}
                        </span>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      </s-section>

      <s-section heading="Order Line Status Board">
        <s-paragraph>
          Tracks each ordered product separately. One customer order can have
          multiple order-line cards in different statuses.
        </s-paragraph>
        <div className="kit-status-board kit-status-board-wide">
          {orderLineCardsByColumn.map((column) => (
            <div className="kit-status-column" key={column.key}>
              <Link className="kit-status-column-header" to={column.href}>
                <span>{column.label}</span>
                <span className="kit-status-count">{column.cards.length}</span>
              </Link>
              <div className="kit-status-card-stack">
                {column.cards.length === 0 ? (
                  <div className="kit-status-empty">No order lines</div>
                ) : (
                  column.cards.map((card: DashboardOrderLineCard) => (
                    <div
                      className={`kit-status-card${
                        card.statusKey === "blocked_review" ? " kit-status-card-blocked" : ""
                      }`}
                      key={card.id}
                    >
                      <Link className="kit-status-card-title" to={card.detailHref}>
                        {card.orderName}
                      </Link>
                      <span>
                        {card.sku ? `${card.sku} · ${card.title}` : card.title}
                      </span>
                      <span className="kit-muted">
                        {card.quantity} {card.unit}
                        {card.shortage > 0 ? ` · Short ${card.shortage}` : ""}
                      </span>
                      <span className="kit-muted">{card.customerName ?? "No customer"}</span>
                      <span className="kit-status-card-status">{card.statusLabel}</span>
                      {card.blockerReason ? (
                        <span className="kit-status-card-blocker">
                          {card.blockerReason}
                        </span>
                      ) : null}
                      <Link className="kit-status-card-next" to={card.areaHref}>
                        {card.nextActionLabel}
                      </Link>
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
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

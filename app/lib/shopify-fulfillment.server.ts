type ShopifyAdmin = {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<Response>;
};

type ShopifyFulfillmentOrderLine = {
  id: string;
  remainingQuantity: number;
};

type ShopifyFulfillmentOrder = {
  id: string;
  status: string;
  requestStatus: string | null;
  lineItems: {
    nodes: ShopifyFulfillmentOrderLine[];
  };
};

type FulfillmentOrdersData = {
  order: {
    id: string;
    displayFulfillmentStatus: string | null;
    fulfillmentOrders: {
      nodes: ShopifyFulfillmentOrder[];
    };
  } | null;
};

type FulfillmentCreateData = {
  fulfillmentCreate: {
    fulfillment: {
      id: string;
      status: string;
    } | null;
    userErrors: Array<{
      field: string[] | null;
      message: string;
    }>;
  };
};

const FULFILLMENT_ORDER_QUERY = `#graphql
  query OperationsKitFulfillmentOrders($orderId: ID!) {
    order(id: $orderId) {
      id
      displayFulfillmentStatus
      fulfillmentOrders(first: 20) {
        nodes {
          id
          status
          requestStatus
          lineItems(first: 100) {
            nodes {
              id
              remainingQuantity
              lineItem {
                id
                sku
                title
                quantity
              }
            }
          }
        }
      }
    }
  }
`;

const FULFILLMENT_CREATE_MUTATION = `#graphql
  mutation OperationsKitFulfillmentCreate($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function graphqlJson<T>(
  admin: ShopifyAdmin,
  query: string,
  variables: Record<string, unknown>,
) {
  const response = await admin.graphql(query, { variables });
  const payload = (await response.json()) as { data?: T; errors?: unknown };
  if (payload.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(payload.errors)}`);
  }
  if (!payload.data) throw new Error("Shopify GraphQL returned no data.");
  return payload.data;
}

function hasRemainingFulfillableQuantity(order: ShopifyFulfillmentOrder) {
  return order.lineItems.nodes.some(
    (line) => Number(line.remainingQuantity) > 0,
  );
}

function canCreateFulfillment(order: ShopifyFulfillmentOrder) {
  const terminalStatuses = new Set(["CANCELLED", "CLOSED", "INCOMPLETE"]);
  return (
    !terminalStatuses.has(String(order.status).toUpperCase()) &&
    hasRemainingFulfillableQuantity(order)
  );
}

function summarizeFulfillmentOrders(orders: ShopifyFulfillmentOrder[]) {
  if (orders.length === 0) return "no fulfillment orders returned";
  return orders
    .map((order) => {
      const remaining = order.lineItems.nodes.reduce(
        (sum, line) => sum + Number(line.remainingQuantity ?? 0),
        0,
      );
      return `${order.status}/${order.requestStatus ?? "no request"} remaining ${remaining}`;
    })
    .join("; ");
}

export async function fulfillShopifyOrderForShipment(
  admin: ShopifyAdmin,
  shopifyOrderGid: string,
) {
  const fulfillmentOrders = await graphqlJson<FulfillmentOrdersData>(
    admin,
    FULFILLMENT_ORDER_QUERY,
    { orderId: shopifyOrderGid },
  );

  if (!fulfillmentOrders.order) {
    throw new Error("Shopify order was not found for fulfillment writeback.");
  }

  const shopifyFulfillmentStatus =
    fulfillmentOrders.order.displayFulfillmentStatus ?? null;
  const lineItemsByFulfillmentOrder =
    fulfillmentOrders.order.fulfillmentOrders.nodes
      .filter(canCreateFulfillment)
      .map((fulfillmentOrder) => ({
        fulfillmentOrderId: fulfillmentOrder.id,
      }));

  if (lineItemsByFulfillmentOrder.length === 0) {
    const alreadyFulfilled = shopifyFulfillmentStatus === "FULFILLED";
    return {
      fulfilled: false,
      alreadyFulfilled,
      shopifyFulfillmentStatus,
      message: alreadyFulfilled
        ? "Shopify already reports this order as fulfilled."
        : `Shopify has no remaining fulfillment quantity for this order, but the order status is ${shopifyFulfillmentStatus ?? "unknown"}. Fulfillment orders: ${summarizeFulfillmentOrders(
            fulfillmentOrders.order.fulfillmentOrders.nodes,
          )}.`,
    };
  }

  const created = await graphqlJson<FulfillmentCreateData>(
    admin,
    FULFILLMENT_CREATE_MUTATION,
    {
      fulfillment: {
        lineItemsByFulfillmentOrder,
        notifyCustomer: false,
      },
    },
  );

  const userErrors = created.fulfillmentCreate.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(
      `Shopify fulfillment failed: ${userErrors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }

  return {
    fulfilled: true,
    alreadyFulfilled: false,
    fulfillmentId: created.fulfillmentCreate.fulfillment?.id ?? null,
    status: created.fulfillmentCreate.fulfillment?.status ?? null,
    shopifyFulfillmentStatus: "FULFILLED",
    message: "Shopify fulfillment created.",
  };
}

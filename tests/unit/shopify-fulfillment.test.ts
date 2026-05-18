import { describe, expect, it, vi } from "vitest";

import { fulfillShopifyOrderForShipment } from "../../app/lib/shopify-fulfillment.server";

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
}

describe("Shopify fulfillment writeback", () => {
  it("creates a Shopify fulfillment for remaining fulfillment orders", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            order: {
              id: "gid://shopify/Order/1",
              fulfillmentOrders: {
                nodes: [
                  {
                    id: "gid://shopify/FulfillmentOrder/10",
                    status: "OPEN",
                    requestStatus: "UNSUBMITTED",
                    lineItems: {
                      nodes: [
                        {
                          id: "gid://shopify/FulfillmentOrderLineItem/11",
                          remainingQuantity: 2,
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            fulfillmentCreate: {
              fulfillment: {
                id: "gid://shopify/Fulfillment/20",
                status: "SUCCESS",
              },
              userErrors: [],
            },
          },
        }),
      );

    const result = await fulfillShopifyOrderForShipment(
      { graphql },
      "gid://shopify/Order/1",
    );

    expect(result.fulfilled).toBe(true);
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(graphql.mock.calls[1][1]).toEqual({
      variables: {
        fulfillment: {
          lineItemsByFulfillmentOrder: [
            { fulfillmentOrderId: "gid://shopify/FulfillmentOrder/10" },
          ],
          notifyCustomer: false,
        },
      },
    });
  });

  it("does not call fulfillmentCreate when Shopify has no remaining quantity", async () => {
    const graphql = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: {
          order: {
            id: "gid://shopify/Order/1",
            displayFulfillmentStatus: "FULFILLED",
            fulfillmentOrders: {
              nodes: [
                {
                  id: "gid://shopify/FulfillmentOrder/10",
                  status: "CLOSED",
                  requestStatus: "UNSUBMITTED",
                  lineItems: { nodes: [] },
                },
              ],
            },
          },
        },
      }),
    );

    const result = await fulfillShopifyOrderForShipment(
      { graphql },
      "gid://shopify/Order/1",
    );

    expect(result.fulfilled).toBe(false);
    expect(result.alreadyFulfilled).toBe(true);
    expect(result.shopifyFulfillmentStatus).toBe("FULFILLED");
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("reports no remaining quantity without pretending an unfulfilled order is fulfilled", async () => {
    const graphql = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        data: {
          order: {
            id: "gid://shopify/Order/1",
            displayFulfillmentStatus: "UNFULFILLED",
            fulfillmentOrders: {
              nodes: [
                {
                  id: "gid://shopify/FulfillmentOrder/10",
                  status: "CLOSED",
                  requestStatus: "UNSUBMITTED",
                  lineItems: { nodes: [] },
                },
              ],
            },
          },
        },
      }),
    );

    const result = await fulfillShopifyOrderForShipment(
      { graphql },
      "gid://shopify/Order/1",
    );

    expect(result.fulfilled).toBe(false);
    expect(result.alreadyFulfilled).toBe(false);
    expect(result.shopifyFulfillmentStatus).toBe("UNFULFILLED");
    expect(result.message).toContain("Fulfillment orders: CLOSED/UNSUBMITTED");
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it("surfaces Shopify fulfillment user errors", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            order: {
              id: "gid://shopify/Order/1",
              fulfillmentOrders: {
                nodes: [
                  {
                    id: "gid://shopify/FulfillmentOrder/10",
                    status: "OPEN",
                    requestStatus: "UNSUBMITTED",
                    lineItems: {
                      nodes: [
                        {
                          id: "gid://shopify/FulfillmentOrderLineItem/11",
                          remainingQuantity: 1,
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            fulfillmentCreate: {
              fulfillment: null,
              userErrors: [
                {
                  field: ["fulfillment"],
                  message: "Access denied",
                },
              ],
            },
          },
        }),
      );

    await expect(
      fulfillShopifyOrderForShipment({ graphql }, "gid://shopify/Order/1"),
    ).rejects.toThrow("Shopify fulfillment failed: Access denied");
  });
});

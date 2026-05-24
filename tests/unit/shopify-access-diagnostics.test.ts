import { describe, expect, it, vi } from "vitest";

import { diagnoseShopifyCustomerDataAccess } from "../../app/lib/shopify-sync.server";

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
}

describe("Shopify customer data access diagnostics", () => {
  it("reports granted scopes, protected data errors and stored data counters", async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            currentAppInstallation: {
              accessScopes: [
                { handle: "read_orders" },
                { handle: "read_customers" },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            orders: {
              nodes: [{ id: "gid://shopify/Order/1" }],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          errors: [
            {
              message: "Access denied for customer field.",
              path: ["orders", "nodes", 0, "customer"],
              extensions: { code: "ACCESS_DENIED" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            orders: {
              nodes: [
                {
                  id: "gid://shopify/Order/1",
                  shippingAddress: null,
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          errors: [
            {
              message: "Access denied for defaultAddress field.",
              path: ["orders", "nodes", 0, "customer", "defaultAddress"],
              extensions: { code: "ACCESS_DENIED" },
            },
          ],
        }),
      );
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            total_orders: "5",
            orders_with_customer_name: "0",
            orders_with_customer_email: "0",
            orders_with_shipping_address: "0",
          },
        ],
      }),
    };

    const result = await diagnoseShopifyCustomerDataAccess(
      db as any,
      "tenant-1",
      { graphql },
    );

    expect(result.accessScopes.hasReadOrders).toBe(true);
    expect(result.accessScopes.hasReadCustomers).toBe(true);
    expect(result.orderProbe.orderReturned).toBe(true);
    expect(result.protectedCustomerData.customerFieldAccessible).toBe(false);
    expect(result.protectedCustomerData.shippingAddressAccessible).toBe(true);
    expect(result.protectedCustomerData.defaultAddressAccessible).toBe(false);
    expect(result.protectedCustomerData.errors.customer[0]?.code).toBe("ACCESS_DENIED");
    expect(result.storagePreflight.encryptionRoundTripOk).toBe(true);
    expect(result.storagePreflight.databaseWritePathAvailable).toBe(true);
    expect(result.storageProbe.totalOrders).toBe(5);
    expect(result.storageProbe.ordersWithShippingAddress).toBe(0);
  });
});

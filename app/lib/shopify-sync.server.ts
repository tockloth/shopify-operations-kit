import type { QueryExecutor } from "./kit-db.server";
import { withKitTransaction } from "./kit-db.server";
import {
  customerDataEncryptionStatus,
  encryptCustomerData,
  hashCustomerLookup,
} from "./customer-privacy.server";

export type ShopifyAdmin = {
  graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response>;
};

const PRODUCT_SYNC_QUERY = `#graphql
  query OperationsKitProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        legacyResourceId
        title
        handle
        vendor
        productType
        status
        tags
        publishedAt
        onlineStoreUrl
        variants(first: 100) {
          nodes {
            id
            legacyResourceId
            title
            sku
            barcode
            price
            inventoryQuantity
            inventoryItem {
              id
              legacyResourceId
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_BY_ID_SYNC_QUERY = `#graphql
  query OperationsKitProductById($id: ID!) {
    node(id: $id) {
      ... on Product {
        id
        legacyResourceId
        title
        handle
        vendor
        productType
        status
        tags
        publishedAt
        onlineStoreUrl
        variants(first: 100) {
          nodes {
            id
            legacyResourceId
            title
            sku
            barcode
            price
            inventoryQuantity
            inventoryItem {
              id
              legacyResourceId
            }
          }
        }
      }
    }
  }
`;

const ORDER_SYNC_QUERY = `#graphql
  query OperationsKitOrders($first: Int!) {
    orders(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        legacyResourceId
        name
        processedAt
        displayFinancialStatus
        displayFulfillmentStatus
        customer {
          displayName
          defaultEmailAddress {
            emailAddress
          }
          defaultAddress {
            name
            address1
            address2
            city
            provinceCode
            zip
            countryCodeV2
          }
        }
        shippingAddress {
          name
          address1
          address2
          city
          provinceCode
          zip
          countryCodeV2
        }
        lineItems(first: 100) {
          nodes {
            id
            title
            sku
            quantity
            variant {
              id
              legacyResourceId
              title
              sku
              inventoryItem {
                id
                legacyResourceId
              }
              product {
                id
                legacyResourceId
                title
                handle
                status
              }
            }
          }
        }
      }
    }
  }
`;

const ORDER_SYNC_WITH_CUSTOMER_QUERY = `#graphql
  query OperationsKitOrdersWithCustomer($first: Int!) {
    orders(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        legacyResourceId
        name
        processedAt
        displayFinancialStatus
        displayFulfillmentStatus
        customer {
          displayName
          defaultEmailAddress {
            emailAddress
          }
          defaultAddress {
            name
            address1
            address2
            city
            provinceCode
            zip
            countryCodeV2
          }
        }
        lineItems(first: 100) {
          nodes {
            id
            title
            sku
            quantity
            variant {
              id
              legacyResourceId
              title
              sku
              inventoryItem {
                id
                legacyResourceId
              }
              product {
                id
                legacyResourceId
                title
                handle
                status
              }
            }
          }
        }
      }
    }
  }
`;

const ORDER_SYNC_WITHOUT_CUSTOMER_QUERY = `#graphql
  query OperationsKitOrdersWithoutCustomer($first: Int!) {
    orders(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        legacyResourceId
        name
        processedAt
        displayFinancialStatus
        displayFulfillmentStatus
        lineItems(first: 100) {
          nodes {
            id
            title
            sku
            quantity
            variant {
              id
              legacyResourceId
              title
              sku
              inventoryItem {
                id
                legacyResourceId
              }
              product {
                id
                legacyResourceId
                title
                handle
                status
              }
            }
          }
        }
      }
    }
  }
`;

const ORDER_BY_ID_SYNC_QUERY = `#graphql
  query OperationsKitOrderById($id: ID!) {
    node(id: $id) {
      ... on Order {
        id
        legacyResourceId
        name
        processedAt
        displayFinancialStatus
        displayFulfillmentStatus
        customer {
          displayName
          defaultEmailAddress {
            emailAddress
          }
          defaultAddress {
            name
            address1
            address2
            city
            provinceCode
            zip
            countryCodeV2
          }
        }
        shippingAddress {
          name
          address1
          address2
          city
          provinceCode
          zip
          countryCodeV2
        }
        lineItems(first: 100) {
          nodes {
            id
            title
            sku
            quantity
            variant {
              id
              legacyResourceId
              title
              sku
              inventoryItem {
                id
                legacyResourceId
              }
              product {
                id
                legacyResourceId
                title
                handle
                status
              }
            }
          }
        }
      }
    }
  }
`;

const ORDER_BY_ID_WITH_CUSTOMER_QUERY = `#graphql
  query OperationsKitOrderByIdWithCustomer($id: ID!) {
    node(id: $id) {
      ... on Order {
        id
        legacyResourceId
        name
        processedAt
        displayFinancialStatus
        displayFulfillmentStatus
        customer {
          displayName
          defaultEmailAddress {
            emailAddress
          }
          defaultAddress {
            name
            address1
            address2
            city
            provinceCode
            zip
            countryCodeV2
          }
        }
        lineItems(first: 100) {
          nodes {
            id
            title
            sku
            quantity
            variant {
              id
              legacyResourceId
              title
              sku
              inventoryItem {
                id
                legacyResourceId
              }
              product {
                id
                legacyResourceId
                title
                handle
                status
              }
            }
          }
        }
      }
    }
  }
`;

const ORDER_BY_ID_WITHOUT_CUSTOMER_QUERY = `#graphql
  query OperationsKitOrderByIdWithoutCustomer($id: ID!) {
    node(id: $id) {
      ... on Order {
        id
        legacyResourceId
        name
        processedAt
        displayFinancialStatus
        displayFulfillmentStatus
        lineItems(first: 100) {
          nodes {
            id
            title
            sku
            quantity
            variant {
              id
              legacyResourceId
              title
              sku
              inventoryItem {
                id
                legacyResourceId
              }
              product {
                id
                legacyResourceId
                title
                handle
                status
              }
            }
          }
        }
      }
    }
  }
`;

const CURRENT_APP_INSTALLATION_ACCESS_SCOPES_QUERY = `#graphql
  query OperationsKitCurrentAppInstallationAccessScopes {
    currentAppInstallation {
      accessScopes {
        handle
      }
    }
  }
`;

const ORDER_CUSTOMER_DATA_BASE_PROBE_QUERY = `#graphql
  query OperationsKitOrderBaseProbe($first: Int!) {
    orders(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
      }
    }
  }
`;

const ORDER_CUSTOMER_PROBE_QUERY = `#graphql
  query OperationsKitOrderCustomerProbe($first: Int!) {
    orders(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        customer {
          displayName
          defaultEmailAddress {
            emailAddress
          }
        }
      }
    }
  }
`;

const ORDER_SHIPPING_ADDRESS_PROBE_QUERY = `#graphql
  query OperationsKitOrderShippingAddressProbe($first: Int!) {
    orders(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        shippingAddress {
          address1
          city
          countryCodeV2
        }
      }
    }
  }
`;

const ORDER_DEFAULT_ADDRESS_PROBE_QUERY = `#graphql
  query OperationsKitOrderDefaultAddressProbe($first: Int!) {
    orders(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        customer {
          defaultAddress {
            address1
            city
            countryCodeV2
          }
        }
      }
    }
  }
`;

type ShopifyShippingAddress = {
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  provinceCode: string | null;
  zip: string | null;
  countryCodeV2: string | null;
  phone?: string | null;
} | null;

type ShopifyOrderNode = {
  id: string;
  legacyResourceId: string | null;
  name: string;
  processedAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  customer?: {
    displayName: string | null;
    defaultEmailAddress: {
      emailAddress: string | null;
    } | null;
    defaultAddress: ShopifyShippingAddress;
  } | null;
  shippingAddress?: ShopifyShippingAddress;
  lineItems: {
    nodes: Array<{
      id: string;
      title: string;
      sku: string | null;
      quantity: number;
      variant: {
        id: string;
        legacyResourceId: string | null;
        title: string | null;
        sku: string | null;
        inventoryItem: {
          id: string;
          legacyResourceId: string | null;
        } | null;
        product: {
          id: string;
          legacyResourceId: string | null;
          title: string;
          handle: string | null;
          status: string | null;
        } | null;
      } | null;
    }>;
  };
};

type OrderSyncAvailability = {
  customerDataAvailable: boolean;
  shippingAddressAvailable: boolean;
  customerDefaultAddressAvailable: boolean;
};

type SingleOrderUpsertResult = {
  lines: number;
  customerDataReturnedCount: number;
  customerDataEncryptedCount: number;
  customerDataStoredCount: number;
  customerNameStoredCount: number;
  customerEmailStoredCount: number;
  shippingAddressEncryptedCount: number;
  shippingAddressStoredCount: number;
  shippingAddressesStored: number;
  orderShippingAddressesStored: number;
  customerDefaultAddressesStored: number;
  shippingAddressesMissing: number;
  ordersMissingShippingAddress: string[];
};

type ShopifyProductVariantNode = {
  id: string;
  legacyResourceId: string | null;
  title: string | null;
  sku: string | null;
  barcode?: string | null;
  price?: string | null;
  inventoryQuantity: number | null;
  inventoryItem: {
    id: string;
    legacyResourceId: string | null;
  } | null;
};

type ShopifyProductNode = {
  id: string;
  legacyResourceId: string | null;
  title: string;
  handle: string | null;
  vendor?: string | null;
  productType?: string | null;
  status: string | null;
  tags?: string[] | null;
  publishedAt: string | null;
  onlineStoreUrl: string | null;
  variants: {
    nodes: ShopifyProductVariantNode[];
  };
};

type ShopifyInstallationSnapshot = {
  shop_installation_id: string | null;
  shop_domain: string;
};

type ProductUpsertResult = {
  productsFetched: number;
  productsUpserted: number;
  variantsFetched: number;
  variantsUpserted: number;
  itemsCreatedOrLinked: number;
  errors: string[];
};

function hasUsableShopifyShippingAddress(address: ShopifyShippingAddress) {
  return Boolean(address?.address1 && address.city && address.countryCodeV2);
}

function selectShopifyOrderAddress(order: {
  shippingAddress?: ShopifyShippingAddress;
  customer?: { defaultAddress?: ShopifyShippingAddress } | null;
}) {
  if (hasUsableShopifyShippingAddress(order.shippingAddress ?? null)) {
    return { address: order.shippingAddress, source: "order_shipping" };
  }
  if (hasUsableShopifyShippingAddress(order.customer?.defaultAddress ?? null)) {
    return {
      address: order.customer?.defaultAddress ?? null,
      source: "customer_default",
    };
  }
  return { address: null, source: null };
}

const CUSTOMER_SYNC_QUERY = `#graphql
  query OperationsKitCustomers($first: Int!) {
    customers(first: $first, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        legacyResourceId
        displayName
        firstName
        lastName
        defaultEmailAddress {
          emailAddress
        }
        numberOfOrders
        amountSpent {
          amount
          currencyCode
        }
        createdAt
        updatedAt
      }
    }
  }
`;

const CUSTOMER_SYNC_WITHOUT_PROTECTED_DATA_QUERY = `#graphql
  query OperationsKitCustomersWithoutProtectedData($first: Int!) {
    customers(first: $first, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        legacyResourceId
        createdAt
        updatedAt
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

type ShopifyGraphqlErrorSummary = {
  message: string;
  path: string | null;
  code: string | null;
  extensionKeys: string[];
};

async function graphqlDiagnosticProbe<T>(
  admin: ShopifyAdmin,
  query: string,
  variables: Record<string, unknown>,
) {
  try {
    const response = await admin.graphql(query, { variables });
    const payload = (await response.json()) as {
      data?: T;
      errors?: Array<{
        message?: string;
        path?: Array<string | number>;
        extensions?: Record<string, unknown>;
      }>;
    };
    return {
      ok: !payload.errors?.length && Boolean(payload.data),
      data: payload.data ?? null,
      errors: summarizeGraphqlErrors(payload.errors),
    };
  } catch (error) {
    return {
      ok: false,
      data: null,
      errors: [
        {
          message: error instanceof Error ? error.message : String(error),
          path: null,
          code: null,
          extensionKeys: [],
        },
      ],
    };
  }
}

function summarizeGraphqlErrors(
  errors?: Array<{
    message?: string;
    path?: Array<string | number>;
    extensions?: Record<string, unknown>;
  }>,
): ShopifyGraphqlErrorSummary[] {
  return (errors ?? []).map((error) => ({
    message: error.message ?? "Unknown Shopify GraphQL error.",
    path: error.path?.join(".") ?? null,
    code:
      typeof error.extensions?.code === "string"
        ? error.extensions.code
        : null,
    extensionKeys: Object.keys(error.extensions ?? {}).sort(),
  }));
}

function encryptCustomerDataForSync(value: string | null | undefined, label: string) {
  try {
    return encryptCustomerData(value);
  } catch (error) {
    throw new Error(
      `Customer data encryption failed while encrypting ${label}. Set OPERATIONS_KIT_CUSTOMER_DATA_KEY to a stable secret and redeploy. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function isProtectedCustomerDataError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("protected-customer-data") ||
    message.includes("protected customer data") ||
    message.includes("not approved to use") ||
    message.includes("not approved to access") ||
    message.includes("access denied for customer field") ||
    message.includes("access denied for customers field") ||
    message.includes("read_customers")
  );
}

export async function diagnoseShopifyCustomerDataAccess(
  db: QueryExecutor,
  tenantId: string,
  admin: ShopifyAdmin,
) {
  type ScopesData = {
    currentAppInstallation: {
      accessScopes: Array<{ handle: string }>;
    } | null;
  };
  type OrderBaseData = { orders: { nodes: Array<{ id: string }> } };
  type CustomerProbeData = {
    orders: {
      nodes: Array<{
        id: string;
        customer: {
          displayName: string | null;
          defaultEmailAddress: { emailAddress: string | null } | null;
        } | null;
      }>;
    };
  };
  type ShippingProbeData = {
    orders: {
      nodes: Array<{
        id: string;
        shippingAddress: {
          address1: string | null;
          city: string | null;
          countryCodeV2: string | null;
        } | null;
      }>;
    };
  };
  type DefaultAddressProbeData = {
    orders: {
      nodes: Array<{
        id: string;
        customer: {
          defaultAddress: {
            address1: string | null;
            city: string | null;
            countryCodeV2: string | null;
          } | null;
        } | null;
      }>;
    };
  };

  const [scopesProbe, baseProbe, customerProbe, shippingProbe, defaultAddressProbe] =
    await Promise.all([
      graphqlDiagnosticProbe<ScopesData>(
        admin,
        CURRENT_APP_INSTALLATION_ACCESS_SCOPES_QUERY,
        {},
      ),
      graphqlDiagnosticProbe<OrderBaseData>(
        admin,
        ORDER_CUSTOMER_DATA_BASE_PROBE_QUERY,
        { first: 1 },
      ),
      graphqlDiagnosticProbe<CustomerProbeData>(
        admin,
        ORDER_CUSTOMER_PROBE_QUERY,
        { first: 1 },
      ),
      graphqlDiagnosticProbe<ShippingProbeData>(
        admin,
        ORDER_SHIPPING_ADDRESS_PROBE_QUERY,
        { first: 1 },
      ),
      graphqlDiagnosticProbe<DefaultAddressProbeData>(
        admin,
        ORDER_DEFAULT_ADDRESS_PROBE_QUERY,
        { first: 1 },
      ),
    ]);

  const grantedScopes =
    scopesProbe.data?.currentAppInstallation?.accessScopes
      ?.map((scope) => scope.handle)
      .sort((left, right) => left.localeCompare(right)) ?? [];
  const baseOrder = baseProbe.data?.orders.nodes[0] ?? null;
  const customerOrder = customerProbe.data?.orders.nodes[0] ?? null;
  const shippingOrder = shippingProbe.data?.orders.nodes[0] ?? null;
  const defaultAddressOrder = defaultAddressProbe.data?.orders.nodes[0] ?? null;

  const dbState = await db.query<{
    total_orders: string | number;
    orders_with_customer_name: string | number;
    orders_with_customer_email: string | number;
    orders_with_shipping_address: string | number;
  }>(
    `
      select
        count(*) as total_orders,
        count(*) filter (where customer_name_encrypted is not null) as orders_with_customer_name,
        count(*) filter (where customer_email_encrypted is not null) as orders_with_customer_email,
        count(*) filter (where shipping_address_encrypted is not null) as orders_with_shipping_address
      from operations_orders
      where tenant_id = $1
    `,
    [tenantId],
  );
  const row = dbState.rows[0];
  const storageWrite = await graphqlIndependentStorageWriteProbe(db, tenantId);
  const encryption = customerDataEncryptionStatus();

  return {
    accessScopes: {
      queryOk: scopesProbe.ok,
      grantedScopes,
      hasReadOrders: grantedScopes.includes("read_orders"),
      hasReadCustomers: grantedScopes.includes("read_customers"),
      errors: scopesProbe.errors,
    },
    orderProbe: {
      queryOk: baseProbe.ok,
      orderReturned: Boolean(baseOrder),
      errors: baseProbe.errors,
    },
    protectedCustomerData: {
      customerFieldAccessible: customerProbe.ok,
      customerObjectReturned: Boolean(customerOrder?.customer),
      customerNameOrEmailReturned: Boolean(
        customerOrder?.customer?.displayName ||
          customerOrder?.customer?.defaultEmailAddress?.emailAddress,
      ),
      shippingAddressAccessible: shippingProbe.ok,
      shippingAddressReturned: Boolean(shippingOrder?.shippingAddress),
      defaultAddressAccessible: defaultAddressProbe.ok,
      defaultAddressReturned: Boolean(defaultAddressOrder?.customer?.defaultAddress),
      errors: {
        customer: customerProbe.errors,
        shippingAddress: shippingProbe.errors,
        defaultAddress: defaultAddressProbe.errors,
      },
    },
    storagePreflight: {
      encryptionConfigured: encryption.configured,
      encryptionSource: encryption.source,
      usingDevelopmentEncryptionFallback: encryption.usingDevelopmentFallback,
      encryptionRoundTripOk: encryption.canRoundTrip,
      databaseWritePathAvailable: storageWrite.ok,
      databaseWriteError: storageWrite.error,
    },
    storageProbe: {
      totalOrders: Number(row?.total_orders ?? 0),
      ordersWithCustomerName: Number(row?.orders_with_customer_name ?? 0),
      ordersWithCustomerEmail: Number(row?.orders_with_customer_email ?? 0),
      ordersWithShippingAddress: Number(row?.orders_with_shipping_address ?? 0),
    },
  };
}

async function graphqlIndependentStorageWriteProbe(
  db: QueryExecutor,
  tenantId: string,
) {
  try {
    await db.query(
      `
        insert into privacy_settings (tenant_id)
        values ($1)
        on conflict (tenant_id)
        do update set tenant_id = excluded.tenant_id
      `,
      [tenantId],
    );
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function upsertShopifyVariantItem(
  db: QueryExecutor,
  tenantId: string,
  input: {
    productGid: string | null;
    productLegacyId: string | null;
    productTitle: string;
    productHandle: string | null;
    productStatus: string | null;
    productPublishedAt: string | null;
    onlineStoreUrl: string | null;
    variantGid: string;
    variantLegacyId: string | null;
    variantTitle: string | null;
    sku: string | null;
    inventoryItemGid: string | null;
    inventoryItemLegacyId: string | null;
    inventoryQuantity: number | null;
    syncSeenAt: string;
  },
) {
  const sku =
    input.sku?.trim() ||
    input.variantLegacyId ||
    input.variantGid.split("/").at(-1) ||
    "UNSKUED";
  const title =
    input.variantTitle && input.variantTitle !== "Default Title"
      ? `${input.productTitle} / ${input.variantTitle}`
      : input.productTitle;
  const isCurrentlyOnShop =
    input.productStatus === "ACTIVE" &&
    Boolean(input.productPublishedAt || input.onlineStoreUrl);

  const result = await db.query<{ id: string }>(
    `
      insert into items (
        tenant_id, shopify_product_gid, shopify_product_legacy_id,
        shopify_variant_gid, shopify_variant_legacy_id,
        shopify_inventory_item_gid, product_handle, product_status,
        shopify_published_at, shopify_online_store_url, shopify_last_seen_at,
        variant_title, sku, title, item_type, unit, is_sellable,
        is_purchasable, is_producible, is_active, shopify_inventory_available
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, 'product', 'pcs', $15,
        false, false, true, $16
      )
      on conflict (tenant_id, shopify_variant_gid)
      do update set
        shopify_product_gid = excluded.shopify_product_gid,
        shopify_product_legacy_id = excluded.shopify_product_legacy_id,
        shopify_variant_legacy_id = excluded.shopify_variant_legacy_id,
        shopify_inventory_item_gid = excluded.shopify_inventory_item_gid,
        product_handle = excluded.product_handle,
        product_status = excluded.product_status,
        shopify_published_at = coalesce(excluded.shopify_published_at, items.shopify_published_at),
        shopify_online_store_url = coalesce(excluded.shopify_online_store_url, items.shopify_online_store_url),
        shopify_last_seen_at = coalesce(excluded.shopify_last_seen_at, items.shopify_last_seen_at),
        variant_title = excluded.variant_title,
        sku = excluded.sku,
        title = excluded.title,
        is_active = true,
        shopify_inventory_available = excluded.shopify_inventory_available,
        updated_at = now()
      returning id
    `,
    [
      tenantId,
      input.productGid,
      input.productLegacyId,
      input.variantGid,
      input.variantLegacyId,
      input.inventoryItemGid,
      input.productHandle,
      input.productStatus,
      input.productPublishedAt,
      input.onlineStoreUrl,
      input.syncSeenAt,
      input.variantTitle,
      sku,
      title,
      isCurrentlyOnShop,
      input.inventoryQuantity,
    ],
  );

  return result.rows[0].id;
}

async function upsertShopifyOrderLineFallbackItem(
  db: QueryExecutor,
  tenantId: string,
  input: {
    lineItemGid: string;
    title: string | null;
    sku: string | null;
    variantGid: string | null;
    variantLegacyId: string | null;
  },
) {
  const fallbackId = input.lineItemGid.split("/").at(-1) ?? input.lineItemGid;
  const sku = input.sku?.trim() || `SHOPIFY-LINE-${fallbackId}`;
  const existing = await db.query<{ id: string }>(
    "select id from items where tenant_id = $1 and sku = $2",
    [tenantId, sku],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const result = await db.query<{ id: string }>(
    `
      insert into items (
        tenant_id, shopify_variant_gid, shopify_variant_legacy_id,
        sku, title, item_type, unit, is_sellable, is_purchasable, is_producible
      )
      values ($1, $2, $3, $4, $5, 'product', 'pcs', true, false, false)
      returning id
    `,
    [
      tenantId,
      input.variantGid,
      input.variantLegacyId,
      sku,
      input.title?.trim() || sku,
    ],
  );

  return result.rows[0].id;
}

async function loadCustomerDataRetentionDays(db: QueryExecutor, tenantId: string) {
  const result = await db.query<{ customer_data_retention_days: number }>(
    `
      insert into privacy_settings (tenant_id)
      values ($1)
      on conflict (tenant_id)
      do update set tenant_id = excluded.tenant_id
      returning customer_data_retention_days
    `,
    [tenantId],
  );

  return result.rows[0]?.customer_data_retention_days ?? 365;
}

function customerDataRetentionUntil(processedAt: string | null, retentionDays: number) {
  const baseDate = processedAt ? new Date(processedAt) : new Date();
  return new Date(baseDate.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

async function loadShopifyInstallationSnapshot(
  db: QueryExecutor,
  tenantId: string,
): Promise<ShopifyInstallationSnapshot> {
  const result = await db.query<ShopifyInstallationSnapshot>(
    `
      select id as shop_installation_id, shop_domain
      from shopify_installations
      where tenant_id = $1
      order by updated_at desc
      limit 1
    `,
    [tenantId],
  );

  return result.rows[0] ?? {
    shop_installation_id: null,
    shop_domain: "unknown-shop.myshopify.com",
  };
}

async function upsertShopifyProductRecord(
  db: QueryExecutor,
  tenantId: string,
  installation: ShopifyInstallationSnapshot,
  product: ShopifyProductNode,
) {
  const result = await db.query<{ id: string }>(
    `
      insert into shopify_products (
        tenant_id, shop_installation_id, shop_domain,
        shopify_product_gid, shopify_product_legacy_id,
        title, handle, vendor, product_type, status, tags_json,
        raw_payload_json, synced_at, deleted_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), null)
      on conflict (tenant_id, shopify_product_gid)
      do update set
        shop_installation_id = excluded.shop_installation_id,
        shop_domain = excluded.shop_domain,
        shopify_product_legacy_id = excluded.shopify_product_legacy_id,
        title = excluded.title,
        handle = excluded.handle,
        vendor = excluded.vendor,
        product_type = excluded.product_type,
        status = excluded.status,
        tags_json = excluded.tags_json,
        raw_payload_json = excluded.raw_payload_json,
        synced_at = now(),
        deleted_at = null,
        updated_at = now()
      returning id
    `,
    [
      tenantId,
      installation.shop_installation_id,
      installation.shop_domain,
      product.id,
      product.legacyResourceId,
      product.title,
      product.handle,
      product.vendor ?? null,
      product.productType ?? null,
      product.status,
      JSON.stringify(product.tags ?? []),
      JSON.stringify({
        id: product.id,
        legacyResourceId: product.legacyResourceId,
        title: product.title,
        handle: product.handle,
        vendor: product.vendor ?? null,
        productType: product.productType ?? null,
        status: product.status,
        tags: product.tags ?? [],
      }),
    ],
  );

  return result.rows[0].id;
}

async function upsertShopifyProductVariantRecord(
  db: QueryExecutor,
  tenantId: string,
  input: {
    shopifyProductId: string;
    itemId: string;
    product: ShopifyProductNode;
    variant: ShopifyProductVariantNode;
  },
) {
  const price =
    input.variant.price === null || input.variant.price === undefined
      ? null
      : Number(input.variant.price);
  await db.query(
    `
      insert into shopify_product_variants (
        tenant_id, shopify_product_id, item_id,
        shopify_product_gid, shopify_variant_gid, shopify_variant_legacy_id,
        sku, barcode, title, price,
        inventory_item_gid, inventory_item_legacy_id,
        raw_payload_json, synced_at, deleted_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), null)
      on conflict (tenant_id, shopify_variant_gid)
      do update set
        shopify_product_id = excluded.shopify_product_id,
        item_id = excluded.item_id,
        shopify_product_gid = excluded.shopify_product_gid,
        shopify_variant_legacy_id = excluded.shopify_variant_legacy_id,
        sku = excluded.sku,
        barcode = excluded.barcode,
        title = excluded.title,
        price = excluded.price,
        inventory_item_gid = excluded.inventory_item_gid,
        inventory_item_legacy_id = excluded.inventory_item_legacy_id,
        raw_payload_json = excluded.raw_payload_json,
        synced_at = now(),
        deleted_at = null,
        updated_at = now()
    `,
    [
      tenantId,
      input.shopifyProductId,
      input.itemId,
      input.product.id,
      input.variant.id,
      input.variant.legacyResourceId,
      input.variant.sku,
      input.variant.barcode ?? null,
      input.variant.title,
      Number.isFinite(price) ? price : null,
      input.variant.inventoryItem?.id ?? null,
      input.variant.inventoryItem?.legacyResourceId ?? null,
      JSON.stringify({
        id: input.variant.id,
        legacyResourceId: input.variant.legacyResourceId,
        sku: input.variant.sku,
        barcode: input.variant.barcode ?? null,
        title: input.variant.title,
        price: input.variant.price ?? null,
        inventoryItem: input.variant.inventoryItem ?? null,
      }),
    ],
  );
}

async function upsertShopifyProductNode(
  db: QueryExecutor,
  tenantId: string,
  installation: ShopifyInstallationSnapshot,
  product: ShopifyProductNode,
  syncSeenAt: string,
): Promise<ProductUpsertResult> {
  const shopifyProductId = await upsertShopifyProductRecord(
    db,
    tenantId,
    installation,
    product,
  );
  let variantsUpserted = 0;
  let itemsCreatedOrLinked = 0;

  for (const variant of product.variants.nodes) {
    const itemId = await upsertShopifyVariantItem(db, tenantId, {
      productGid: product.id,
      productLegacyId: product.legacyResourceId,
      productTitle: product.title,
      productHandle: product.handle,
      productStatus: product.status,
      productPublishedAt: product.publishedAt,
      onlineStoreUrl: product.onlineStoreUrl,
      variantGid: variant.id,
      variantLegacyId: variant.legacyResourceId,
      variantTitle: variant.title,
      sku: variant.sku,
      inventoryItemGid: variant.inventoryItem?.id ?? null,
      inventoryItemLegacyId: variant.inventoryItem?.legacyResourceId ?? null,
      inventoryQuantity: variant.inventoryQuantity,
      syncSeenAt,
    });
    await upsertShopifyProductVariantRecord(db, tenantId, {
      shopifyProductId,
      itemId,
      product,
      variant,
    });
    variantsUpserted += 1;
    itemsCreatedOrLinked += 1;
  }

  return {
    productsFetched: 1,
    productsUpserted: 1,
    variantsFetched: product.variants.nodes.length,
    variantsUpserted,
    itemsCreatedOrLinked,
    errors: [],
  };
}

async function upsertShopifyOrderNode(
  tx: QueryExecutor,
  tenantId: string,
  order: ShopifyOrderNode,
  retentionDays: number,
  availability: OrderSyncAvailability,
): Promise<SingleOrderUpsertResult> {
  const selectedAddress = selectShopifyOrderAddress(order);
  const addressDataAvailable =
    availability.shippingAddressAvailable ||
    availability.customerDefaultAddressAvailable;
  const ordersMissingShippingAddress: string[] = [];
  let shippingAddressesStored = 0;
  let orderShippingAddressesStored = 0;
  let customerDefaultAddressesStored = 0;
  let shippingAddressesMissing = 0;
  let customerDataReturnedCount = 0;
  let customerDataEncryptedCount = 0;
  let customerDataStoredCount = 0;
  let customerNameStoredCount = 0;
  let customerEmailStoredCount = 0;
  let shippingAddressEncryptedCount = 0;
  let shippingAddressStoredCount = 0;

  if (selectedAddress.address) {
    shippingAddressesStored += 1;
    if (selectedAddress.source === "order_shipping") {
      orderShippingAddressesStored += 1;
    }
    if (selectedAddress.source === "customer_default") {
      customerDefaultAddressesStored += 1;
    }
  } else if (addressDataAvailable) {
    shippingAddressesMissing += 1;
    ordersMissingShippingAddress.push(order.name);
  }
  if (
    order.customer?.displayName ||
    order.customer?.defaultEmailAddress?.emailAddress
  ) {
    customerDataReturnedCount += 1;
  }

  const encryptedCustomerName = availability.customerDataAvailable
    ? encryptCustomerDataForSync(order.customer?.displayName, "order customer name")
    : null;
  const encryptedCustomerEmail = availability.customerDataAvailable
    ? encryptCustomerDataForSync(
        order.customer?.defaultEmailAddress?.emailAddress,
        "order customer email",
      )
    : null;
  const encryptedShippingAddress = selectedAddress.address
    ? encryptCustomerDataForSync(
        JSON.stringify(selectedAddress.address),
        "order shipping address",
      )
    : null;
  if (encryptedCustomerName || encryptedCustomerEmail) {
    customerDataEncryptedCount += 1;
  }
  if (encryptedShippingAddress) {
    shippingAddressEncryptedCount += 1;
  }

  const orderResult = await tx.query<{
    id: string;
    has_customer_name: boolean;
    has_customer_email: boolean;
    has_shipping_address: boolean;
  }>(
    `
      insert into operations_orders (
        tenant_id, shopify_order_gid, shopify_order_legacy_id,
        order_name, status, customer_name, customer_email,
        customer_name_encrypted, customer_email_encrypted, customer_lookup_hash,
        customer_data_retention_until, shipping_address_encrypted,
        financial_status, fulfillment_status, processed_at
      )
      values ($1, $2, $3, $4, 'open', null, null, $5, $6, $7, $8, $9, $10, $11, $12)
      on conflict (tenant_id, order_name)
      do update set
        shopify_order_gid = excluded.shopify_order_gid,
        shopify_order_legacy_id = excluded.shopify_order_legacy_id,
        customer_name = null,
        customer_email = null,
        customer_name_encrypted = coalesce(
          excluded.customer_name_encrypted,
          operations_orders.customer_name_encrypted
        ),
        customer_email_encrypted = coalesce(
          excluded.customer_email_encrypted,
          operations_orders.customer_email_encrypted
        ),
        customer_lookup_hash = coalesce(
          excluded.customer_lookup_hash,
          operations_orders.customer_lookup_hash
        ),
        customer_data_redacted_at = case
          when excluded.customer_name_encrypted is not null
            or excluded.customer_email_encrypted is not null
          then null
          else operations_orders.customer_data_redacted_at
        end,
        customer_data_retention_until = coalesce(
          excluded.customer_data_retention_until,
          operations_orders.customer_data_retention_until
        ),
        shipping_address_encrypted = coalesce(
          excluded.shipping_address_encrypted,
          operations_orders.shipping_address_encrypted
        ),
        financial_status = excluded.financial_status,
        fulfillment_status = excluded.fulfillment_status,
        processed_at = excluded.processed_at,
        updated_at = now()
      returning id,
        customer_name_encrypted is not null as has_customer_name,
        customer_email_encrypted is not null as has_customer_email,
        shipping_address_encrypted is not null as has_shipping_address
    `,
    [
      tenantId,
      order.id,
      order.legacyResourceId,
      order.name,
      encryptedCustomerName,
      encryptedCustomerEmail,
      availability.customerDataAvailable
        ? hashCustomerLookup(
            order.customer?.defaultEmailAddress?.emailAddress,
            order.customer?.displayName,
          )
        : null,
      customerDataRetentionUntil(order.processedAt, retentionDays),
      encryptedShippingAddress,
      order.displayFinancialStatus,
      order.displayFulfillmentStatus,
      order.processedAt,
    ],
  );
  const storedOrder = orderResult.rows[0];
  if (!storedOrder) {
    throw new Error("Order sync did not return a stored order row.");
  }
  if (storedOrder.has_customer_name) customerNameStoredCount += 1;
  if (storedOrder.has_customer_email) customerEmailStoredCount += 1;
  if (storedOrder.has_customer_name || storedOrder.has_customer_email) {
    customerDataStoredCount += 1;
  }
  if (storedOrder.has_shipping_address) shippingAddressStoredCount += 1;

  let lines = 0;
  for (const line of order.lineItems.nodes) {
    const itemId =
      line.variant && line.variant.product
        ? await upsertShopifyVariantItem(tx, tenantId, {
            productGid: line.variant.product.id,
            productLegacyId: line.variant.product.legacyResourceId,
            productTitle: line.variant.product.title,
            productHandle: line.variant.product.handle,
            productStatus: line.variant.product.status,
            productPublishedAt: null,
            onlineStoreUrl: null,
            variantGid: line.variant.id,
            variantLegacyId: line.variant.legacyResourceId,
            variantTitle: line.variant.title,
            sku: line.variant.sku ?? line.sku,
            inventoryItemGid: line.variant.inventoryItem?.id ?? null,
            inventoryItemLegacyId: line.variant.inventoryItem?.legacyResourceId ?? null,
            inventoryQuantity: null,
            syncSeenAt: new Date().toISOString(),
          })
        : await upsertShopifyOrderLineFallbackItem(tx, tenantId, {
            lineItemGid: line.id,
            title: line.title,
            sku: line.sku,
            variantGid: line.variant?.id ?? null,
            variantLegacyId: line.variant?.legacyResourceId ?? null,
          });

    await tx.query(
      `
        insert into operations_order_lines (
          tenant_id, operations_order_id, item_id, quantity, unit,
          shopify_line_item_gid, shopify_variant_gid, sku, title
        )
        values ($1, $2, $3, $4, 'pcs', $5, $6, $7, $8)
        on conflict (tenant_id, operations_order_id, item_id)
        do update set
          quantity = excluded.quantity,
          shopify_line_item_gid = excluded.shopify_line_item_gid,
          shopify_variant_gid = excluded.shopify_variant_gid,
          sku = excluded.sku,
          title = excluded.title
      `,
      [
        tenantId,
        storedOrder.id,
        itemId,
        line.quantity,
        line.id,
        line.variant?.id ?? null,
        line.variant?.sku ?? line.sku,
        line.title,
      ],
    );
    lines += 1;
  }

  return {
    lines,
    customerDataReturnedCount,
    customerDataEncryptedCount,
    customerDataStoredCount,
    customerNameStoredCount,
    customerEmailStoredCount,
    shippingAddressEncryptedCount,
    shippingAddressStoredCount,
    shippingAddressesStored,
    orderShippingAddressesStored,
    customerDefaultAddressesStored,
    shippingAddressesMissing,
    ordersMissingShippingAddress,
  };
}

export async function syncShopifyProducts(
  db: QueryExecutor,
  tenantId: string,
  admin: ShopifyAdmin,
) {
  return withKitTransaction(db, async (tx) => {
    type ProductSyncData = {
      products: {
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
        nodes: ShopifyProductNode[];
      };
    };

    const installation = await loadShopifyInstallationSnapshot(tx, tenantId);
    const syncSeenAt = new Date().toISOString();
    const syncedProductGids: string[] = [];
    const errors: string[] = [];
    let after: string | null = null;
    let productsFetched = 0;
    let productsUpserted = 0;
    let variantsFetched = 0;
    let variantsUpserted = 0;
    let itemsCreatedOrLinked = 0;

    do {
      const data: ProductSyncData = await graphqlJson<ProductSyncData>(
        admin,
        PRODUCT_SYNC_QUERY,
        { first: 50, after },
      );
      productsFetched += data.products.nodes.length;

      for (const product of data.products.nodes) {
        syncedProductGids.push(product.id);
        const upserted = await upsertShopifyProductNode(
          tx,
          tenantId,
          installation,
          product,
          syncSeenAt,
        );
        productsUpserted += upserted.productsUpserted;
        variantsFetched += upserted.variantsFetched;
        variantsUpserted += upserted.variantsUpserted;
        itemsCreatedOrLinked += upserted.itemsCreatedOrLinked;
        errors.push(...upserted.errors);
      }

      after = data.products.pageInfo.hasNextPage
        ? data.products.pageInfo.endCursor
        : null;
    } while (after);

    const missing = await tx.query<{ count: string }>(
      `
        update items
        set is_active = false,
            product_status = 'MISSING',
            shopify_inventory_available = null,
            updated_at = now()
        where tenant_id = $1
          and shopify_product_gid is not null
          and not (shopify_product_gid = any($2::text[]))
        returning id
      `,
      [tenantId, syncedProductGids],
    );

    return {
      products: productsFetched,
      variants: variantsFetched,
      productsFetched,
      productsUpserted,
      variantsFetched,
      variantsUpserted,
      itemsCreatedOrLinked,
      errors,
      markedMissing: missing.rows.length,
    };
  });
}

export async function syncShopifyProductByGid(
  db: QueryExecutor,
  tenantId: string,
  admin: ShopifyAdmin,
  productGid: string,
) {
  return withKitTransaction(db, async (tx) => {
    const installation = await loadShopifyInstallationSnapshot(tx, tenantId);
    type ProductByIdData = { node: ShopifyProductNode | null };
    const data = await graphqlJson<ProductByIdData>(
      admin,
      PRODUCT_BY_ID_SYNC_QUERY,
      { id: productGid },
    );

    if (!data.node) {
      throw new Error(`Shopify product ${productGid} was not found.`);
    }

    return upsertShopifyProductNode(
      tx,
      tenantId,
      installation,
      data.node,
      new Date().toISOString(),
    );
  });
}

export async function markShopifyProductDeletedByGid(
  db: QueryExecutor,
  tenantId: string,
  productGid: string,
) {
  return withKitTransaction(db, async (tx) => {
    const product = await tx.query<{ id: string }>(
      `
        update shopify_products
        set deleted_at = coalesce(deleted_at, now()),
            synced_at = now(),
            updated_at = now()
        where tenant_id = $1
          and shopify_product_gid = $2
        returning id
      `,
      [tenantId, productGid],
    );
    const variants = await tx.query<{ id: string }>(
      `
        update shopify_product_variants
        set deleted_at = coalesce(deleted_at, now()),
            synced_at = now(),
            updated_at = now()
        where tenant_id = $1
          and shopify_product_gid = $2
        returning id
      `,
      [tenantId, productGid],
    );
    const items = await tx.query<{ id: string }>(
      `
        update items
        set is_active = false,
            product_status = 'MISSING',
            shopify_inventory_available = null,
            updated_at = now()
        where tenant_id = $1
          and shopify_product_gid = $2
        returning id
      `,
      [tenantId, productGid],
    );

    return {
      productsMarkedDeleted: product.rows.length,
      variantsMarkedDeleted: variants.rows.length,
      itemsMarkedMissing: items.rows.length,
    };
  });
}

export async function syncShopifyOrders(
  db: QueryExecutor,
  tenantId: string,
  admin: ShopifyAdmin,
) {
  return withKitTransaction(db, async (tx) => {
    const retentionDays = await loadCustomerDataRetentionDays(tx, tenantId);
    type OrderSyncData = {
      orders: { nodes: ShopifyOrderNode[] };
    };

    let customerDataAvailable = true;
    let shippingAddressAvailable = true;
    let customerDefaultAddressAvailable = true;
    let protectedCustomerDataUnavailable = false;
    let fallbackQueryUsed = false;
    let protectedCustomerDataDeniedAt: "none" | "full_order_query" | "customer_fallback_query" =
      "none";
    let data: OrderSyncData;
    try {
      data = await graphqlJson<OrderSyncData>(admin, ORDER_SYNC_QUERY, { first: 25 });
    } catch (error) {
      if (!isProtectedCustomerDataError(error)) throw error;

      protectedCustomerDataUnavailable = true;
      fallbackQueryUsed = true;
      shippingAddressAvailable = false;
      protectedCustomerDataDeniedAt = "full_order_query";
      try {
        data = await graphqlJson<OrderSyncData>(
          admin,
          ORDER_SYNC_WITH_CUSTOMER_QUERY,
          { first: 25 },
        );
      } catch (customerError) {
        if (!isProtectedCustomerDataError(customerError)) throw customerError;

        protectedCustomerDataUnavailable = true;
        fallbackQueryUsed = true;
        customerDataAvailable = false;
        customerDefaultAddressAvailable = false;
        protectedCustomerDataDeniedAt = "customer_fallback_query";
        data = await graphqlJson<OrderSyncData>(
          admin,
          ORDER_SYNC_WITHOUT_CUSTOMER_QUERY,
          { first: 25 },
        );
      }
    }

    let lines = 0;
    let customerDataReturnedCount = 0;
    let customerDataEncryptedCount = 0;
    let customerDataStoredCount = 0;
    let customerNameStoredCount = 0;
    let customerEmailStoredCount = 0;
    let shippingAddressEncryptedCount = 0;
    let shippingAddressStoredCount = 0;
    let shippingAddressesStored = 0;
    let orderShippingAddressesStored = 0;
    let customerDefaultAddressesStored = 0;
    let shippingAddressesMissing = 0;
    const ordersMissingShippingAddress: string[] = [];
    for (const order of data.orders.nodes) {
      const upserted = await upsertShopifyOrderNode(
        tx,
        tenantId,
        order,
        retentionDays,
        {
          customerDataAvailable,
          shippingAddressAvailable,
          customerDefaultAddressAvailable,
        },
      );
      lines += upserted.lines;
      customerDataReturnedCount += upserted.customerDataReturnedCount;
      customerDataEncryptedCount += upserted.customerDataEncryptedCount;
      customerDataStoredCount += upserted.customerDataStoredCount;
      customerNameStoredCount += upserted.customerNameStoredCount;
      customerEmailStoredCount += upserted.customerEmailStoredCount;
      shippingAddressEncryptedCount += upserted.shippingAddressEncryptedCount;
      shippingAddressStoredCount += upserted.shippingAddressStoredCount;
      shippingAddressesStored += upserted.shippingAddressesStored;
      orderShippingAddressesStored += upserted.orderShippingAddressesStored;
      customerDefaultAddressesStored += upserted.customerDefaultAddressesStored;
      shippingAddressesMissing += upserted.shippingAddressesMissing;
      ordersMissingShippingAddress.push(...upserted.ordersMissingShippingAddress);
    }

    return {
      orders: data.orders.nodes.length,
      lines,
      customerDataAvailable,
      customerDataReturnedCount,
      customerDataEncryptedCount,
      customerDataStoredCount,
      customerNameStoredCount,
      customerEmailStoredCount,
      shippingAddressAvailable,
      customerDefaultAddressAvailable,
      protectedCustomerDataUnavailable,
      fallbackQueryUsed,
      protectedCustomerDataDeniedAt,
      shippingAddressesStored,
      shippingAddressEncryptedCount,
      shippingAddressStoredCount,
      orderShippingAddressesStored,
      customerDefaultAddressesStored,
      shippingAddressesMissing,
      ordersMissingShippingAddress,
    };
  });
}

export async function syncShopifyOrderByGid(
  db: QueryExecutor,
  tenantId: string,
  admin: ShopifyAdmin,
  orderGid: string,
) {
  return withKitTransaction(db, async (tx) => {
    const retentionDays = await loadCustomerDataRetentionDays(tx, tenantId);
    type OrderByIdData = { node: ShopifyOrderNode | null };

    let customerDataAvailable = true;
    let shippingAddressAvailable = true;
    let customerDefaultAddressAvailable = true;
    let protectedCustomerDataUnavailable = false;
    let fallbackQueryUsed = false;
    let protectedCustomerDataDeniedAt: "none" | "full_order_query" | "customer_fallback_query" =
      "none";
    let data: OrderByIdData;

    try {
      data = await graphqlJson<OrderByIdData>(admin, ORDER_BY_ID_SYNC_QUERY, {
        id: orderGid,
      });
    } catch (error) {
      if (!isProtectedCustomerDataError(error)) throw error;

      protectedCustomerDataUnavailable = true;
      fallbackQueryUsed = true;
      shippingAddressAvailable = false;
      protectedCustomerDataDeniedAt = "full_order_query";
      try {
        data = await graphqlJson<OrderByIdData>(
          admin,
          ORDER_BY_ID_WITH_CUSTOMER_QUERY,
          { id: orderGid },
        );
      } catch (customerError) {
        if (!isProtectedCustomerDataError(customerError)) throw customerError;

        protectedCustomerDataUnavailable = true;
        fallbackQueryUsed = true;
        customerDataAvailable = false;
        customerDefaultAddressAvailable = false;
        protectedCustomerDataDeniedAt = "customer_fallback_query";
        data = await graphqlJson<OrderByIdData>(
          admin,
          ORDER_BY_ID_WITHOUT_CUSTOMER_QUERY,
          { id: orderGid },
        );
      }
    }

    if (!data.node) {
      throw new Error(`Shopify order ${orderGid} was not found.`);
    }

    const upserted = await upsertShopifyOrderNode(
      tx,
      tenantId,
      data.node,
      retentionDays,
      {
        customerDataAvailable,
        shippingAddressAvailable,
        customerDefaultAddressAvailable,
      },
    );

    return {
      orders: 1,
      lines: upserted.lines,
      customerDataAvailable,
      customerDataReturnedCount: upserted.customerDataReturnedCount,
      customerDataEncryptedCount: upserted.customerDataEncryptedCount,
      customerDataStoredCount: upserted.customerDataStoredCount,
      customerNameStoredCount: upserted.customerNameStoredCount,
      customerEmailStoredCount: upserted.customerEmailStoredCount,
      shippingAddressAvailable,
      customerDefaultAddressAvailable,
      protectedCustomerDataUnavailable,
      fallbackQueryUsed,
      protectedCustomerDataDeniedAt,
      shippingAddressesStored: upserted.shippingAddressesStored,
      shippingAddressEncryptedCount: upserted.shippingAddressEncryptedCount,
      shippingAddressStoredCount: upserted.shippingAddressStoredCount,
      orderShippingAddressesStored: upserted.orderShippingAddressesStored,
      customerDefaultAddressesStored: upserted.customerDefaultAddressesStored,
      shippingAddressesMissing: upserted.shippingAddressesMissing,
      ordersMissingShippingAddress: upserted.ordersMissingShippingAddress,
    };
  });
}

export async function syncShopifyCustomers(
  db: QueryExecutor,
  tenantId: string,
  admin: ShopifyAdmin,
) {
  return withKitTransaction(db, async (tx) => {
    type CustomerNode = {
      id: string;
      legacyResourceId: string | null;
      displayName?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      defaultEmailAddress?: {
        emailAddress: string | null;
      } | null;
      numberOfOrders?: number | null;
      amountSpent?: {
        amount: string;
        currencyCode: string;
      } | null;
      createdAt: string | null;
      updatedAt: string | null;
    };

    let customerDataAvailable = true;
    let data: { customers: { nodes: CustomerNode[] } };

    try {
      data = await graphqlJson<{ customers: { nodes: CustomerNode[] } }>(
        admin,
        CUSTOMER_SYNC_QUERY,
        { first: 50 },
      );
    } catch (error) {
      if (!isProtectedCustomerDataError(error)) throw error;
      customerDataAvailable = false;
      data = await graphqlJson<{ customers: { nodes: CustomerNode[] } }>(
        admin,
        CUSTOMER_SYNC_WITHOUT_PROTECTED_DATA_QUERY,
        { first: 50 },
      );
    }

    for (const customer of data.customers.nodes) {
      const email = customer.defaultEmailAddress?.emailAddress ?? null;
      await tx.query(
        `
          insert into operation_customers (
            tenant_id, shopify_customer_gid, shopify_customer_legacy_id,
            display_name, email, display_name_encrypted, email_encrypted,
            first_name_encrypted, last_name_encrypted, customer_lookup_hash,
            number_of_orders, amount_spent, amount_spent_currency,
            shopify_created_at, shopify_updated_at, synced_at
          )
          values (
            $1, $2, $3,
            null, null, $4, $5,
            $6, $7, $8,
            $9, $10, $11,
            $12, $13, now()
          )
          on conflict (tenant_id, shopify_customer_gid)
          do update set
            shopify_customer_legacy_id = excluded.shopify_customer_legacy_id,
            display_name = null,
            email = null,
            display_name_encrypted = excluded.display_name_encrypted,
            email_encrypted = excluded.email_encrypted,
            first_name_encrypted = excluded.first_name_encrypted,
            last_name_encrypted = excluded.last_name_encrypted,
            customer_lookup_hash = excluded.customer_lookup_hash,
            number_of_orders = excluded.number_of_orders,
            amount_spent = excluded.amount_spent,
            amount_spent_currency = excluded.amount_spent_currency,
            shopify_created_at = excluded.shopify_created_at,
            shopify_updated_at = excluded.shopify_updated_at,
            customer_data_redacted_at = null,
            synced_at = now(),
            updated_at = now()
        `,
        [
          tenantId,
          customer.id,
          customer.legacyResourceId,
          encryptCustomerData(customer.displayName),
          encryptCustomerData(email),
          encryptCustomerData(customer.firstName),
          encryptCustomerData(customer.lastName),
          hashCustomerLookup(email, customer.displayName),
          customer.numberOfOrders ?? 0,
          customer.amountSpent?.amount ?? null,
          customer.amountSpent?.currencyCode ?? null,
          customer.createdAt,
          customer.updatedAt,
        ],
      );
    }

    return { customers: data.customers.nodes.length, customerDataAvailable };
  });
}

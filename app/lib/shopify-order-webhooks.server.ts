import type { QueryExecutor } from "./kit-db.server";
import type { ShopifyAdmin } from "./shopify-sync.server";
import { syncShopifyOrderByGid } from "./shopify-sync.server";

type ShopifyOrderWebhookInput = {
  shop: string | null | undefined;
  topic: string | null | undefined;
  payload: unknown;
  webhookId: string | null | undefined;
};

type ShopifyAdminResolver = (shopDomain: string) => Promise<ShopifyAdmin>;

type InstallationContext = {
  shop_installation_id: string;
  tenant_id: string;
  shop_domain: string;
};

type WebhookEventRow = {
  id: string;
};

export type ShopifyOrderWebhookResult = {
  status: "processed" | "failed" | "ignored_duplicate";
  eventId: string | null;
  resourceGid: string | null;
  message: string;
};

function normalizeWebhookTopic(topic: string | null | undefined) {
  return String(topic || "").trim().toUpperCase();
}

function getPayloadObject(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
}

function getShopifyOrderGid(payload: unknown) {
  const record = getPayloadObject(payload);
  const graphqlId = record.admin_graphql_api_id;
  if (typeof graphqlId === "string" && graphqlId.startsWith("gid://shopify/Order/")) {
    return graphqlId;
  }

  const id = record.id;
  if (typeof id === "number" || typeof id === "string") {
    const trimmed = String(id).trim();
    if (trimmed) return `gid://shopify/Order/${trimmed}`;
  }

  return null;
}

function minimalOrderPayloadMetadata(payload: unknown) {
  const record = getPayloadObject(payload);
  return {
    id: record.id ?? null,
    admin_graphql_api_id: record.admin_graphql_api_id ?? null,
    name: record.name ?? null,
    created_at: record.created_at ?? null,
    updated_at: record.updated_at ?? null,
  };
}

async function loadInstallationForShop(
  db: QueryExecutor,
  shopDomain: string,
) {
  const result = await db.query<InstallationContext>(
    `
      select
        shopify_installations.id as shop_installation_id,
        shopify_installations.tenant_id,
        shopify_installations.shop_domain
      from shopify_installations
      inner join tenants
        on tenants.id = shopify_installations.tenant_id
       and tenants.shop_domain = shopify_installations.shop_domain
      where shopify_installations.shop_domain = $1
        and shopify_installations.status = 'active'
        and tenants.status = 'active'
      limit 1
    `,
    [shopDomain],
  );

  return result.rows[0] ?? null;
}

async function insertWebhookEvent(
  db: QueryExecutor,
  input: {
    shopDomain: string;
    installation: InstallationContext | null;
    topic: string;
    webhookId: string;
    resourceGid: string | null;
    payload: unknown;
  },
) {
  const result = await db.query<WebhookEventRow>(
    `
      insert into webhook_events (
        shop_domain, shop_installation_id, tenant_id, topic, webhook_id,
        resource_gid, status, payload_json
      )
      values ($1, $2, $3, $4, $5, $6, 'received', $7)
      on conflict (webhook_id) do nothing
      returning id
    `,
    [
      input.shopDomain,
      input.installation?.shop_installation_id ?? null,
      input.installation?.tenant_id ?? null,
      input.topic,
      input.webhookId,
      input.resourceGid,
      JSON.stringify(minimalOrderPayloadMetadata(input.payload)),
    ],
  );

  return result.rows[0] ?? null;
}

async function markWebhookEvent(
  db: QueryExecutor,
  eventId: string,
  status: "processed" | "failed",
  errorMessage?: string,
) {
  await db.query(
    `
      update webhook_events
      set status = $2,
          error_message = $3,
          processed_at = now()
      where id = $1
    `,
    [eventId, status, errorMessage ?? null],
  );
}

async function recordWebhookSystemEvent(
  db: QueryExecutor,
  tenantId: string,
  title: string,
  message: string,
  sourceRef: string,
  metadata: Record<string, unknown>,
) {
  await db.query(
    `
      insert into case_events (
        tenant_id, event_type, title, message, actor_type, source, source_ref, metadata
      )
      values ($1, 'shopify_webhook', $2, $3, 'system', 'shopify_webhook', $4, $5)
    `,
    [tenantId, title, message, sourceRef, JSON.stringify(metadata)],
  );
}

export async function handleShopifyOrderWebhook(
  db: QueryExecutor,
  input: ShopifyOrderWebhookInput,
  resolveAdmin: ShopifyAdminResolver,
): Promise<ShopifyOrderWebhookResult> {
  const shopDomain = String(input.shop || "").trim();
  const topic = normalizeWebhookTopic(input.topic);
  const webhookId = String(input.webhookId || "").trim();
  const resourceGid = getShopifyOrderGid(input.payload);

  if (!shopDomain) {
    return {
      status: "failed",
      eventId: null,
      resourceGid,
      message: "Shopify order webhook did not include a shop domain.",
    };
  }

  if (!webhookId) {
    return {
      status: "failed",
      eventId: null,
      resourceGid,
      message: "Shopify order webhook did not include a webhook ID.",
    };
  }

  const installation = await loadInstallationForShop(db, shopDomain);
  const inserted = await insertWebhookEvent(db, {
    shopDomain,
    installation,
    topic,
    webhookId,
    resourceGid,
    payload: input.payload,
  });

  if (!inserted) {
    return {
      status: "ignored_duplicate",
      eventId: null,
      resourceGid,
      message: "Duplicate Shopify order webhook ignored.",
    };
  }

  if (!installation) {
    const message = `No active Operations Kit tenant is mapped to Shopify shop ${shopDomain}.`;
    await markWebhookEvent(db, inserted.id, "failed", message);
    return {
      status: "failed",
      eventId: inserted.id,
      resourceGid,
      message,
    };
  }

  if (!resourceGid) {
    const message = "Shopify order webhook did not include a usable order resource ID.";
    await markWebhookEvent(db, inserted.id, "failed", message);
    await recordWebhookSystemEvent(
      db,
      installation.tenant_id,
      "Shopify order webhook missing order ID",
      message,
      webhookId,
      { topic, shopDomain },
    );
    return {
      status: "failed",
      eventId: inserted.id,
      resourceGid,
      message,
    };
  }

  try {
    const admin = await resolveAdmin(shopDomain);
    await syncShopifyOrderByGid(db, installation.tenant_id, admin, resourceGid);
    await markWebhookEvent(db, inserted.id, "processed");
    return {
      status: "processed",
      eventId: inserted.id,
      resourceGid,
      message: "Shopify order webhook processed.",
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Shopify order webhook processing failed.";
    await markWebhookEvent(db, inserted.id, "failed", message);
    await recordWebhookSystemEvent(
      db,
      installation.tenant_id,
      "Shopify order webhook failed",
      message,
      webhookId,
      { topic, shopDomain, resourceGid },
    );
    return {
      status: "failed",
      eventId: inserted.id,
      resourceGid,
      message,
    };
  }
}

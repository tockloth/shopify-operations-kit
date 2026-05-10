import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useParams,
} from "react-router";

import { MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { loadSuppliers, saveSupplierMaster } from "../lib/operations-kit.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  const suppliers = await loadSuppliers(context.pool, context.ctx.tenantId);
  const supplier = suppliers.find((entry: any) => entry.id === params.supplierId);

  return {
    configured: true,
    supplier,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  await saveSupplierMaster(context.pool, context.ctx.tenantId, {
    supplierId: params.supplierId,
    name: String(form.get("name") || ""),
    email: String(form.get("email") || ""),
    phone: String(form.get("phone") || ""),
    website: String(form.get("website") || ""),
    notes: String(form.get("notes") || ""),
    isActive: form.get("isActive") !== "inactive",
  });

  return redirect("/app/suppliers");
};

export default function SupplierDetail() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const params = useParams();
  if (!data.configured) {
    return (
      <SetupBanner
        message={data.setupError ?? "Database setup is incomplete."}
      />
    );
  }
  if (!data.supplier) {
    return (
      <s-page heading="Supplier not found">
        <s-section>
          <s-link href="/app/suppliers">Back to suppliers</s-link>
          <s-paragraph>No supplier exists for {params.supplierId}.</s-paragraph>
        </s-section>
      </s-page>
    );
  }

  const supplier = data.supplier as any;

  return (
    <s-page heading={supplier.name}>
      <s-section>
        <s-link href="/app/suppliers">Back to suppliers</s-link>
        {actionData?.message ? (
          <s-banner tone="critical">{actionData.message}</s-banner>
        ) : null}
      </s-section>
      <s-section heading="Supplier details">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <Form method="post">
            <s-stack direction="block" gap="base">
              <s-grid grid-template-columns="repeat(2, minmax(0, 1fr))" gap="base">
                <s-text-field
                  label="Supplier name"
                  name="name"
                  value={supplier.name ?? ""}
                  required
                ></s-text-field>
                <s-email-field
                  label="Email"
                  name="email"
                  value={supplier.email ?? ""}
                ></s-email-field>
                <s-text-field
                  label="Phone"
                  name="phone"
                  value={supplier.phone ?? ""}
                ></s-text-field>
                <s-url-field
                  label="Website"
                  name="website"
                  value={supplier.website ?? ""}
                ></s-url-field>
              </s-grid>
              <s-select
                label="Status"
                name="isActive"
                value={supplier.is_active ? "active" : "inactive"}
              >
                <s-option value="active">Active</s-option>
                <s-option value="inactive">Inactive</s-option>
              </s-select>
              <s-text-area
                label="Notes"
                name="notes"
                rows={4}
                value={supplier.notes ?? ""}
              ></s-text-area>
              <s-box padding="small" borderWidth="base" borderRadius="base">
                <s-stack direction="inline" gap="base">
                  <MoneylessBadge
                    tone={supplier.is_active ? "success" : "neutral"}
                  >
                    {supplier.is_active ? "Active" : "Inactive"}
                  </MoneylessBadge>
                  <s-text>{supplier.product_count} product assignments</s-text>
                  <s-text>{supplier.preferred_count} preferred products</s-text>
                </s-stack>
              </s-box>
              <s-button-group gap="base">
                <s-button variant="primary" type="submit">
                  Save supplier
                </s-button>
                <s-link href="/app/suppliers">Cancel</s-link>
              </s-button-group>
            </s-stack>
          </Form>
        </s-box>
      </s-section>
    </s-page>
  );
}

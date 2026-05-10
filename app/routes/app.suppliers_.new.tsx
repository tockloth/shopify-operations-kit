import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";

import { SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { saveSupplierMaster } from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  return { configured: true };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  await saveSupplierMaster(context.pool, context.ctx.tenantId, {
    name: String(form.get("name") || ""),
    email: String(form.get("email") || ""),
    phone: String(form.get("phone") || ""),
    website: String(form.get("website") || ""),
    notes: String(form.get("notes") || ""),
    isActive: form.get("isActive") !== "inactive",
  });

  return redirect("/app/suppliers");
};

export default function NewSupplier() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured) {
    return (
      <SetupBanner
        message={data.setupError ?? "Database setup is incomplete."}
      />
    );
  }

  return (
    <s-page heading="Create supplier">
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
                  placeholder="Acme Components"
                  required
                ></s-text-field>
                <s-email-field
                  label="Email"
                  name="email"
                  placeholder="orders@supplier.example"
                ></s-email-field>
                <s-text-field
                  label="Phone"
                  name="phone"
                  placeholder="+49 451 000000"
                ></s-text-field>
                <s-url-field
                  label="Website"
                  name="website"
                  placeholder="https://supplier.example"
                ></s-url-field>
              </s-grid>
              <s-text-area
                label="Notes"
                name="notes"
                rows={4}
                placeholder="Ordering terms, contacts, constraints"
              ></s-text-area>
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

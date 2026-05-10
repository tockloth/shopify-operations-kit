import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";

import { SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  loadAccessControlSettings,
  upsertOperationUser,
} from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) {
    return { configured: false, setupError: context.setupError };
  }

  return {
    configured: true,
    access: await loadAccessControlSettings(context.pool, context.ctx.tenantId),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { message: context.setupError };

  const form = await request.formData();
  await upsertOperationUser(context.pool, context.ctx.tenantId, {
    email: String(form.get("email") || ""),
    displayName: String(form.get("displayName") || ""),
    groupKey: String(form.get("groupKey") || ""),
    isAdmin: form.get("isAdmin") === "on",
  });

  return redirect("/app/settings/users");
};

export default function NewSettingsUser() {
  const data = useLoaderData<typeof loader>();
  if (!data.configured || !("access" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  return (
    <s-page heading="New user">
      <s-section>
        <div className="kit-toolbar">
          <div>
            <s-heading>Create employee</s-heading>
            <div className="kit-list-summary">
              All development users currently receive the shared password
              Operations123!.
            </div>
          </div>
          <s-link href="/app/settings/users">Back to users</s-link>
        </div>
      </s-section>
      <s-section heading="User details">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <Form method="post">
            <s-stack direction="block" gap="base">
              <s-grid grid-template-columns="repeat(2, minmax(0, 1fr))" gap="base">
                <s-text-field
                  label="Email"
                  name="email"
                  value="procurement2@tockloth.com"
                ></s-text-field>
                <s-text-field
                  label="Display name"
                  name="displayName"
                  value="Procurement User 2"
                ></s-text-field>
                <s-select label="Group" name="groupKey" value="procurement">
                  {(data.access?.groups ?? []).map((group: any) => (
                    <s-option key={group.key} value={group.key}>
                      {group.name}
                    </s-option>
                  ))}
                </s-select>
                <s-checkbox label="Admin" name="isAdmin"></s-checkbox>
              </s-grid>
              <s-stack direction="inline" gap="base">
                <s-button variant="primary" type="submit">Save user</s-button>
                <s-link href="/app/settings/users">Cancel</s-link>
              </s-stack>
            </s-stack>
          </Form>
        </s-box>
      </s-section>
    </s-page>
  );
}

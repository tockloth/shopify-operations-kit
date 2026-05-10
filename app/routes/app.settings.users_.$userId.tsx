import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";

import { SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  loadAccessControlSettings,
  upsertOperationUser,
} from "../lib/operations-kit.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) {
    return { configured: false, setupError: context.setupError };
  }

  const access = await loadAccessControlSettings(context.pool, context.ctx.tenantId);
  const user = access.users.find((entry: any) => entry.id === params.userId);

  return {
    configured: true,
    access,
    user,
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

export default function EditSettingsUser() {
  const data = useLoaderData<typeof loader>();
  if (!data.configured || !("access" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }
  if (!data.user) {
    return (
      <s-page heading="User not found">
        <s-section>
          <s-link href="/app/settings/users">Back to users</s-link>
        </s-section>
      </s-page>
    );
  }

  const user = data.user as any;
  const groupKey = String(user.group_keys ?? "").split(",")[0] || "masterdata";

  return (
    <s-page heading={user.display_name}>
      <s-section>
        <div className="kit-toolbar">
          <div>
            <s-heading>Edit employee</s-heading>
            <div className="kit-list-summary">
              Change the user's display name, admin flag and primary group.
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
                  value={user.email}
                ></s-text-field>
                <s-text-field
                  label="Display name"
                  name="displayName"
                  value={user.display_name}
                ></s-text-field>
                <s-select label="Group" name="groupKey" value={groupKey}>
                  {(data.access?.groups ?? []).map((group: any) => (
                    <s-option key={group.key} value={group.key}>
                      {group.name}
                    </s-option>
                  ))}
                </s-select>
                <s-checkbox
                  label="Admin"
                  name="isAdmin"
                  defaultChecked={Boolean(user.is_admin)}
                ></s-checkbox>
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

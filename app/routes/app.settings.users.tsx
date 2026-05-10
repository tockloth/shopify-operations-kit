import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import {
  loadAccessControlSettings,
  setOperationUserActive,
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
  const intent = String(form.get("intent"));

  if (intent === "setOperationUserActive") {
    const result = await setOperationUserActive(
      context.pool,
      context.ctx.tenantId,
      String(form.get("userId") || ""),
      String(form.get("isActive") || "") === "true",
    );
    return { message: `${result.updated} user record updated.` };
  }

  return { message: "No action was performed." };
};

export default function SettingsUsers() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.configured || !("access" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  return (
    <s-page heading="Users">
      <s-section>
        <div className="kit-toolbar">
          <div>
            <s-heading>Employees and groups</s-heading>
            <div className="kit-list-summary">
              Users are assigned to fixed Operations Kit groups. Authentication
              uses the shared development password until role-based login is
              hardened.
            </div>
          </div>
          <div className="kit-toolbar-actions">
            <s-link href="/app/settings">Settings</s-link>
            <s-link href="/app/settings/users/new">New user</s-link>
          </div>
        </div>
      </s-section>
      {actionData?.message ? (
        <s-section>
          <s-box padding="base" borderWidth="base" borderRadius="base">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-box>
        </s-section>
      ) : null}
      <s-section heading="User master data">
        <DataTable
          headings={["User", "Groups", "Status", "Admin", "Action"]}
          rows={(data.access?.users ?? []).map((user: any) => ({
            id: user.id,
            href: `/app/settings/users/${user.id}`,
            cells: [
              <strong>{user.display_name} · {user.email}</strong>,
              user.groups ?? "No group",
              <MoneylessBadge tone={user.is_active ? "success" : "neutral"}>
                {user.is_active ? "Active" : "Inactive"}
              </MoneylessBadge>,
              user.is_admin ? "Yes" : "No",
              <Form method="post">
                <input type="hidden" name="intent" value="setOperationUserActive" />
                <input type="hidden" name="userId" value={user.id} />
                <input
                  type="hidden"
                  name="isActive"
                  value={user.is_active ? "false" : "true"}
                />
                <s-button type="submit">
                  {user.is_active ? "Deactivate" : "Activate"}
                </s-button>
              </Form>,
            ],
          }))}
        />
      </s-section>
      <s-section heading="Groups and permissions">
        <DataTable
          headings={["Group", "Description", "Permissions"]}
          rows={(data.access?.groups ?? []).map((group: any) => [
            <strong>{group.name}</strong>,
            group.description ?? "",
            group.permissions ?? "No permissions",
          ])}
        />
      </s-section>
    </s-page>
  );
}

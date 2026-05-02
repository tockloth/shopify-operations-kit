import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { loadWarehouseTasks } from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    tasks: await loadWarehouseTasks(context.pool, context.ctx.tenantId),
  };
};

export default function Warehouse() {
  const data = useLoaderData<typeof loader>();
  if (!data.configured || !("tasks" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  return (
    <s-page heading="Warehouse tasks">
      <s-section>
        <s-paragraph>
          Warehouse work makes execution visible: component picks for
          production, putaway cards after QC, and pack tasks for logistics.
        </s-paragraph>
      </s-section>
      <s-section heading="Open work">
        <DataTable
          headings={["Task", "Item", "Quantity", "Type", "Status"]}
          rows={(data.tasks ?? []).map((task: any) => [
            <strong>{task.title}</strong>,
            task.sku ? `${task.sku} ${task.item_title}` : "Unlinked",
            task.quantity ? Number(task.quantity).toLocaleString() : "",
            task.task_type,
            <MoneylessBadge tone={task.status === "done" ? "success" : "info"}>
              {task.status}
            </MoneylessBadge>,
          ])}
        />
      </s-section>
    </s-page>
  );
}

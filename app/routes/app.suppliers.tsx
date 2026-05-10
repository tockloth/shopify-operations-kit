import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { loadSuppliers } from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured)
    return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    suppliers: await loadSuppliers(context.pool, context.ctx.tenantId),
  };
};

export default function Suppliers() {
  const data = useLoaderData<typeof loader>();
  if (!data.configured || !("suppliers" in data)) {
    return (
      <SetupBanner
        message={data.setupError ?? "Database setup is incomplete."}
      />
    );
  }

  return (
    <s-page heading="Suppliers">
      <s-section>
        <div className="kit-toolbar">
          <div>
            <s-heading>Supplier master data</s-heading>
            <div className="kit-list-summary">
              Suppliers are maintained once and then assigned to purchased
              products with supplier-specific lead times, prices and lot sizes.
            </div>
          </div>
          <div className="kit-toolbar-actions">
            <s-link href="/app/suppliers/new">Create supplier</s-link>
          </div>
        </div>
      </s-section>

      <s-section heading="Supplier master data">
        <DataTable
          headings={[
            "Supplier",
            "Email",
            "Products",
            "Preferred",
            "Status",
            "Updated",
          ]}
          rows={(data.suppliers ?? []).map((supplier: any) => ({
            id: supplier.id,
            href: `/app/suppliers/${supplier.id}`,
            cells: [
              <strong>{supplier.name}</strong>,
              supplier.email ?? "No email",
              supplier.product_count,
              supplier.preferred_count,
              <MoneylessBadge tone={supplier.is_active ? "success" : "neutral"}>
                {supplier.is_active ? "Active" : "Inactive"}
              </MoneylessBadge>,
              supplier.updated_at
                ? new Date(supplier.updated_at).toLocaleString()
                : "New",
            ],
          }))}
        />
      </s-section>
    </s-page>
  );
}

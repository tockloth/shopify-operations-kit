import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { DataTable, MoneylessBadge, SetupBanner } from "../components/KitUi";
import { requireOperationsKitContext } from "../lib/app-context.server";
import { loadCases } from "../lib/operations-kit.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await requireOperationsKitContext(request);
  if (!context.configured) return { configured: false, setupError: context.setupError };

  return {
    configured: true,
    caseData: await loadCases(context.pool, context.ctx.tenantId),
  };
};

export default function Cases() {
  const data = useLoaderData<typeof loader>();
  if (!data.configured || !("caseData" in data)) {
    return <SetupBanner message={data.setupError ?? "Database setup is incomplete."} />;
  }

  return (
    <s-page heading="Operational cases and evidence">
      <s-section>
        <s-paragraph>
          Cases and ledger events show why operational work exists and what was
          decided or generated. This keeps planning, procurement and production
          evidence in the Shopify embedded workflow.
        </s-paragraph>
      </s-section>
      <s-section heading="Open cases">
        <DataTable
          headings={["Case", "Type", "Priority", "Status"]}
          rows={(data.caseData?.cases ?? []).map((operationCase: any) => [
            <strong>{operationCase.summary}</strong>,
            operationCase.case_type,
            operationCase.priority,
            <MoneylessBadge>{operationCase.status}</MoneylessBadge>,
          ])}
        />
      </s-section>
      <s-section heading="Recent ledger activity">
        <DataTable
          headings={["Event", "Message", "Source", "When"]}
          rows={(data.caseData?.events ?? []).map((event: any) => [
            <strong>{event.title}</strong>,
            event.message,
            event.source_ref ?? event.source,
            new Date(event.created_at).toLocaleString(),
          ])}
        />
      </s-section>
    </s-page>
  );
}

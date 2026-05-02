import { Link } from "react-router";

type BadgeTone = "info" | "auto" | "neutral" | "success" | "caution" | "warning" | "critical";

export function MoneylessBadge({
  tone,
  children,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
}) {
  return <s-badge tone={tone ?? "info"}>{children}</s-badge>;
}

export function SetupBanner({ message }: { message: string }) {
  return (
    <s-section>
      <s-box padding="base" borderWidth="base" borderRadius="base">
        <s-stack direction="block" gap="small">
          <s-heading>Database setup required</s-heading>
          <s-paragraph>{message}</s-paragraph>
          <s-paragraph>
            Start Supabase locally, export <code>OPERATIONS_KIT_DATABASE_URL</code>,
            then restart the Shopify preview.
          </s-paragraph>
        </s-stack>
      </s-box>
    </s-section>
  );
}

export function KpiCard({ label, value, href }: { label: string; value: string | number; href?: string }) {
  const content = (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small">
        <s-heading>{value}</s-heading>
        <s-text>{label}</s-text>
      </s-stack>
    </s-box>
  );

  return href ? <Link to={href}>{content}</Link> : content;
}

export function DataTable({
  headings,
  rows,
}: {
  headings: string[];
  rows: Array<React.ReactNode[] | { id?: string; href?: string; cells: React.ReactNode[] }>;
}) {
  if (rows.length === 0) {
    return (
      <s-box padding="base" borderWidth="base" borderRadius="base">
        <s-paragraph>No records yet.</s-paragraph>
      </s-box>
    );
  }

  return (
    <div className="kit-resource-table">
    <s-table variant="auto">
      <s-table-header-row>
        {headings.map((heading) => (
          <s-table-header key={heading}>{heading}</s-table-header>
        ))}
      </s-table-header-row>
      <s-table-body>
        {rows.map((row, index) => {
          const cells = Array.isArray(row) ? row : row.cells;
          const href = Array.isArray(row) ? undefined : row.href;
          const rowId = Array.isArray(row) ? `row-${index}` : (row.id ?? `row-${index}`);
          const delegateId = href ? `${rowId}-primary-action` : undefined;

          return (
          <s-table-row key={rowId} clickDelegate={delegateId}>
            {cells.map((cell, cellIndex) => (
              <s-table-cell key={cellIndex}>
                {cellIndex === 0 && href ? (
                  <s-link id={delegateId} href={href}>
                    {cell}
                  </s-link>
                ) : (
                  cell
                )}
              </s-table-cell>
            ))}
          </s-table-row>
          );
        })}
      </s-table-body>
    </s-table>
    </div>
  );
}

export function NextAction({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small">
        <s-heading>{title}</s-heading>
        {children}
      </s-stack>
    </s-box>
  );
}

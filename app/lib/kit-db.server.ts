import pg from "pg";

const { Pool } = pg;

declare global {
  // eslint-disable-next-line no-var
  var operationsKitPgPool: pg.Pool | undefined;
}

export interface QueryExecutor {
  query<T = unknown>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

export function getOperationsKitDatabaseUrl() {
  return (
    process.env.OPERATIONS_KIT_DATABASE_URL ||
    process.env.OPERATIONS_LEDGER_DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    null
  );
}

export function getOperationsKitPool() {
  const connectionString = getOperationsKitDatabaseUrl();

  if (!connectionString) return null;

  if (!global.operationsKitPgPool) {
    global.operationsKitPgPool = new Pool({ connectionString });
  }

  return global.operationsKitPgPool;
}

export async function withKitTransaction<T>(
  executor: QueryExecutor,
  work: (client: QueryExecutor) => Promise<T>,
) {
  if (!("connect" in executor) || "release" in executor) return work(executor);

  const client = await (executor as pg.Pool).connect();

  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

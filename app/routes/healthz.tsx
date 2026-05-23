import { getOperationsKitPool } from "../lib/kit-db.server";

export async function loader() {
  let database: "reachable" | "not_checked" = "not_checked";
  const pool = getOperationsKitPool();

  if (pool) {
    try {
      await pool.query("select 1");
      database = "reachable";
    } catch {
      database = "not_checked";
    }
  }

  return Response.json({
    ok: true,
    service: "operations-kit",
    database,
  });
}

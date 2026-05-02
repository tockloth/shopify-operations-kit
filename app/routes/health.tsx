export async function loader() {
  return Response.json({ ok: true, app: "operations-kit" });
}

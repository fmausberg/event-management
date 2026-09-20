// Placeholder only: no payload parsing, imports, database writes or synchronization.
// TODO: Verify official webhook delivery/authentication and payload contracts first.
export function POST() {
  return Response.json({ error: "Not implemented" }, { status: 501 });
}

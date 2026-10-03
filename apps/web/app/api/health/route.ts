// Public liveness check. Deliberately does not touch the database: an unauthenticated
// endpoint should not be able to wake or load it. Database status is on the Today page.
export const dynamic = "force-static";

export function GET() {
  return Response.json({ ok: true });
}

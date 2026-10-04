// A log-safe description of an error. Database errors from drizzle carry the whole SQL statement
// and every bound value in their message, which here would be financial data, so only the error's
// name and a short code (Plaid's error code, or Postgres's) are ever logged.
export function describeError(e: unknown): string {
  const any = e as { code?: unknown; cause?: { code?: unknown } } | null;
  const code =
    typeof any?.code === "string" ? any.code : typeof any?.cause?.code === "string" ? `db:${any.cause.code}` : null;
  return `${e instanceof Error ? e.name : "error"}${code ? ` ${code}` : ""}`;
}

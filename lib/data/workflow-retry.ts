export async function embeddingStepError(error: unknown, attempt: number): Promise<Error> {
  // The package's CommonJS entry is a TypeScript plugin. Dynamic import keeps
  // the runtime API available to both Node test tooling and bundled steps.
  const { FatalError, RetryableError } = await import("workflow");
  const status = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : undefined;
  if (status && [400, 401, 402, 403, 404, 422].includes(status)) {
    return new FatalError(`Embedding provider rejected the request (HTTP ${status})`);
  }
  // Workflow retries are durable delays, so provider outages don't hold a
  // function open or immediately repeat requests against an exhausted quota.
  return new RetryableError(error instanceof Error ? error.message : "Embedding provider unavailable", {
    retryAfter: Math.min(300_000, 30_000 * 2 ** Math.max(0, attempt - 1)),
  });
}

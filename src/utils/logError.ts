export function logError(
  scope: string,
  operation: string,
  error: unknown,
  details?: Record<string, unknown>
): void {
  const message = error instanceof Error ? error.message : String(error);

  if (details && Object.keys(details).length > 0) {
    console.error(`[${scope}] ${operation} failed: ${message}`, details);
    return;
  }

  console.error(`[${scope}] ${operation} failed: ${message}`);
}

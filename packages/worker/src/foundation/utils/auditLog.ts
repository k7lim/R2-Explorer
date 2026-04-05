/**
 * Structured audit logging for security-relevant events (VULN-38).
 * Uses console.log with JSON for Cloudflare Workers log integration.
 * Non-blocking — callers should use ctx.waitUntil() for async operations.
 */
export type AuditEvent =
	| "auth_failure"
	| "auth_success"
	| "share_access"
	| "share_created"
	| "share_deleted"
	| "file_deleted"
	| "rate_limited";

export function auditLog(
	event: AuditEvent,
	details: Record<string, unknown>,
): void {
	console.log(
		JSON.stringify({
			audit: true,
			event,
			timestamp: new Date().toISOString(),
			...details,
		}),
	);
}

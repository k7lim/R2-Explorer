import type { MiddlewareHandler } from "hono";
import { auditLog } from "../utils/auditLog";

/**
 * Simple sliding-window rate limiter using in-memory Map.
 * Workers may have multiple isolates, so this is per-isolate only —
 * for full protection, configure Cloudflare Rate Limiting rules externally.
 * This provides a defense-in-depth layer (VULN-14).
 *
 * Concurrency model (P14): the ipRequestCounts Map lives per isolate.
 * Cloudflare may spawn many isolates, so a determined attacker hitting
 * different colos can exceed the per-isolate cap by an order of magnitude.
 * The authoritative cap is the Cloudflare Rate Limiting rule configured at
 * the route level; this middleware is the in-isolate fast path for the
 * common case of a single attacker hitting one POP.
 */
const ipRequestCounts = new Map<
	string,
	{ count: number; windowStart: number }
>();

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 100; // per window per IP for public endpoints
const AUTH_MAX_REQUESTS = 20; // per window per IP for the basic-auth surface

function isRateLimited(
	ip: string,
	maxRequests: number,
	scope: string,
): boolean {
	const now = Date.now();
	const key = `${scope}:${ip}`;
	const entry = ipRequestCounts.get(key);

	if (!entry || now - entry.windowStart > WINDOW_MS) {
		ipRequestCounts.set(key, { count: 1, windowStart: now });
		return false;
	}

	entry.count++;
	return entry.count > maxRequests;
}

// Periodically prune stale entries to prevent unbounded growth
let lastPrune = Date.now();
function pruneIfNeeded() {
	const now = Date.now();
	if (now - lastPrune > WINDOW_MS * 2) {
		lastPrune = now;
		for (const [key, entry] of ipRequestCounts) {
			if (now - entry.windowStart > WINDOW_MS) {
				ipRequestCounts.delete(key);
			}
		}
	}
}

function clientIp(headerGetter: (name: string) => string | undefined): string {
	return (
		headerGetter("cf-connecting-ip") ||
		headerGetter("x-forwarded-for") ||
		"unknown"
	);
}

/**
 * Rate limiter for the public /share endpoint.
 * 100 requests/minute per IP.
 */
export const shareRateLimiter: MiddlewareHandler = async (c, next) => {
	pruneIfNeeded();
	const ip = clientIp((name) => c.req.header(name));

	if (isRateLimited(ip, MAX_REQUESTS, "share")) {
		// fp-mmt Gap A: surface 429s in the audit trail (P17 — rails need
		// breadcrumbs). P12: never include credentials in the payload.
		auditLog("rate_limited", {
			ip,
			endpoint: c.req.path,
			scope: "share",
			limit: MAX_REQUESTS,
			windowMs: WINDOW_MS,
		});
		return c.json({ error: "Rate limit exceeded" }, 429);
	}

	await next();
};

/**
 * Rate limiter for the authenticated /api surface.
 * 20 requests/minute per IP, applied BEFORE basicAuth so that password
 * spraying against /api/server/config or any other route hits a wall
 * regardless of credential validity.
 */
export const authRateLimiter: MiddlewareHandler = async (c, next) => {
	pruneIfNeeded();
	const ip = clientIp((name) => c.req.header(name));

	if (isRateLimited(ip, AUTH_MAX_REQUESTS, "auth")) {
		// fp-mmt Gap A: surface 429s in the audit trail (P17 — rails need
		// breadcrumbs). P12: never include credentials in the payload.
		auditLog("rate_limited", {
			ip,
			endpoint: c.req.path,
			scope: "auth",
			limit: AUTH_MAX_REQUESTS,
			windowMs: WINDOW_MS,
		});
		return c.json({ error: "Rate limit exceeded" }, 429);
	}

	await next();
};

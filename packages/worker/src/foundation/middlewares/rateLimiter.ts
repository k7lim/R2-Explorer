import type { MiddlewareHandler } from "hono";

/**
 * Simple sliding-window rate limiter using in-memory Map.
 * Workers may have multiple isolates, so this is per-isolate only —
 * for full protection, configure Cloudflare Rate Limiting rules externally.
 * This provides a defense-in-depth layer (VULN-14).
 */
const ipRequestCounts = new Map<
	string,
	{ count: number; windowStart: number }
>();

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 100; // per window per IP for public endpoints

function isRateLimited(ip: string, maxRequests: number): boolean {
	const now = Date.now();
	const entry = ipRequestCounts.get(ip);

	if (!entry || now - entry.windowStart > WINDOW_MS) {
		ipRequestCounts.set(ip, { count: 1, windowStart: now });
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

/**
 * Rate limiter for the public /share endpoint.
 * 100 requests/minute per IP.
 */
export const shareRateLimiter: MiddlewareHandler = async (c, next) => {
	pruneIfNeeded();
	const ip =
		c.req.header("cf-connecting-ip") ||
		c.req.header("x-forwarded-for") ||
		"unknown";

	if (isRateLimited(ip, MAX_REQUESTS)) {
		return c.json({ error: "Rate limit exceeded" }, 429);
	}

	await next();
};

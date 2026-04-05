import type { MiddlewareHandler } from "hono";
import type { AppContext } from "../../types";

/**
 * CSRF protection middleware (VULN-36).
 * For state-changing requests (POST, PUT, DELETE, PATCH), validates that
 * the Origin header matches the expected deployment URL.
 * GET/HEAD/OPTIONS are safe methods and are allowed through.
 *
 * Combined with the CORS fix from WP-4, this provides defense-in-depth
 * against cross-site request forgery.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const csrfProtection: MiddlewareHandler = async (c, next) => {
	if (SAFE_METHODS.has(c.req.method)) {
		return next();
	}

	const origin = c.req.header("origin");

	// If no Origin header, check Referer as fallback
	// (some older browsers omit Origin on same-origin POST)
	if (!origin) {
		const referer = c.req.header("referer");
		if (referer) {
			try {
				const refererOrigin = new URL(referer).origin;
				const requestOrigin = new URL(c.req.url).origin;
				if (refererOrigin === requestOrigin) {
					return next();
				}
			} catch {
				// Invalid referer URL — reject
			}
		}
		// No Origin or Referer: allow (could be non-browser client like curl/WebDAV)
		// The basic auth check already gates access
		return next();
	}

	// Validate Origin matches the request's own origin
	const requestOrigin = new URL(c.req.url).origin;
	if (origin === requestOrigin) {
		return next();
	}

	// Check against configured CORS allowlist if available
	const config = (c as unknown as AppContext).get("config");
	if (config?.cors && typeof config.cors === "object") {
		const allowedOrigins = config.cors.allowedOrigins || [];
		if (allowedOrigins.includes(origin)) {
			return next();
		}
	}

	return c.json({ error: "CSRF validation failed: origin mismatch" }, 403);
};

import type { MiddlewareHandler } from "hono";

/**
 * Adds defense-in-depth security headers to all responses.
 * - CSP: restricts script/style sources
 * - X-Frame-Options: prevents clickjacking
 * - X-Content-Type-Options: prevents MIME sniffing
 * - Strict-Transport-Security: enforces HTTPS
 * - Cache-Control on API responses: prevents caching of sensitive data
 */
export const securityHeadersMiddleware: MiddlewareHandler = async (c, next) => {
	await next();

	c.header(
		"Content-Security-Policy",
		"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:",
	);
	c.header("X-Frame-Options", "DENY");
	c.header("X-Content-Type-Options", "nosniff");
	c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");

	// Prevent caching of API responses containing sensitive data
	if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/share/")) {
		c.header("Cache-Control", "no-store");
	}
};

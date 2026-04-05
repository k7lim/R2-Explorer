import type { Next } from "hono";
import type { AppContext } from "../../types";

/**
 * Middleware that validates the :bucket param against actual R2Bucket bindings.
 * Returns 404 for unknown bucket names instead of leaking binding info via 500.
 */
export async function bucketValidationMiddleware(c: AppContext, next: Next) {
	const bucketName = c.req.param("bucket");

	if (!bucketName) {
		return Response.json({ msg: "404, not found!" }, { status: 404 });
	}

	const binding = c.env[bucketName];

	if (
		!binding ||
		typeof binding !== "object" ||
		binding.constructor.name !== "R2Bucket"
	) {
		return Response.json({ msg: "404, not found!" }, { status: 404 });
	}

	await next();
}

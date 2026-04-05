import { OpenAPIRoute } from "chanfana";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { auditLog } from "../../foundation/utils/auditLog";
import { validateKey } from "../../foundation/utils/validateKey";
import type { AppContext } from "../../types";

export class DeleteObject extends OpenAPIRoute {
	schema = {
		operationId: "post-bucket-delete-object",
		tags: ["Buckets"],
		summary: "Delete object",
		request: {
			params: z.object({
				bucket: z.string(),
			}),
			body: {
				content: {
					"application/json": {
						schema: z.object({
							key: z.string().describe("base64 encoded file key"),
						}),
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();

		const bucketName = data.params.bucket; // Store bucket name
		const bucket = c.env[bucketName] as R2Bucket | undefined; // Explicitly type as potentially undefined

		if (!bucket) {
			// Using Hono's HTTPException for proper error response
			throw new HTTPException(500, {
				message: `Bucket binding not found: ${bucketName}`,
			});
		}

		const key = decodeURIComponent(escape(atob(data.body.key)));
		validateKey(key);

		// Soft-delete: move to .trash/ instead of hard delete (VULN-47),
		// mirroring r2-webdav's soft-delete pattern for consistency.
		const object = await bucket.get(key);
		if (object) {
			const timestamp = new Date().toISOString();
			const randomSuffix = crypto.randomUUID().slice(0, 8);
			const trashKey = `.trash/${timestamp}-${randomSuffix}/${key}`;
			await bucket.put(trashKey, object.body, {
				httpMetadata: object.httpMetadata,
				customMetadata: {
					...object.customMetadata,
					trash_original_key: key,
					trash_deleted_at: timestamp,
					trash_deleted_by: c.get("authentication_username") || "unknown",
					trash_source: "r2-explorer",
				},
			});
		}
		await bucket.delete(key);

		auditLog("file_deleted", {
			bucket: bucketName,
			key,
			user: c.get("authentication_username") || "unknown",
		});

		return { success: true };
	}
}

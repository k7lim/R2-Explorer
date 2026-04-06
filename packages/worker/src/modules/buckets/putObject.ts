import { OpenAPIRoute } from "chanfana";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { decodeBase64Key } from "../../foundation/utils/decodeBase64Key";
import { validateKey } from "../../foundation/utils/validateKey";
import { validateMetadataKeys } from "../../foundation/utils/validateMetadataKeys";
import type { AppContext } from "../../types";

export class PutObject extends OpenAPIRoute {
	schema = {
		operationId: "post-bucket-upload-object",
		tags: ["Buckets"],
		summary: "Upload object",
		request: {
			body: {
				content: {
					"application/octet-stream": {
						schema: z.object({}).openapi({
							type: "string",
							format: "binary",
						}),
					},
				},
			},
			params: z.object({
				bucket: z.string(),
			}),
			query: z.object({
				key: z.string().describe("base64 encoded file key"),
				customMetadata: z
					.string()
					.nullable()
					.optional()
					.describe("base64 encoded json string"),
				httpMetadata: z
					.string()
					.nullable()
					.optional()
					.describe("base64 encoded json string"),
			}),
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();

		const bucketName = data.params.bucket;
		const bucket = c.env[bucketName] as R2Bucket | undefined;

		if (!bucket) {
			throw new HTTPException(500, {
				message: `Bucket binding not found: ${bucketName}`,
			});
		}

		// Reject uploads exceeding 100MB to prevent storage cost DoS (VULN-30)
		const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;
		const contentLength = c.req.header("content-length");
		if (contentLength && Number.parseInt(contentLength, 10) > MAX_UPLOAD_SIZE) {
			throw new HTTPException(413, {
				message: "Upload exceeds maximum allowed size (100MB)",
			});
		}

		const key = decodeBase64Key(data.query.key);
		validateKey(key);

		let customMetadata = undefined;
		if (data.query.customMetadata) {
			try {
				customMetadata = JSON.parse(decodeBase64Key(data.query.customMetadata));
			} catch {
				throw new HTTPException(400, {
					message: "Invalid customMetadata: expected base64-encoded JSON",
				});
			}
		}

		let httpMetadata = undefined;
		if (data.query.httpMetadata) {
			try {
				httpMetadata = JSON.parse(decodeBase64Key(data.query.httpMetadata));
			} catch {
				throw new HTTPException(400, {
					message: "Invalid httpMetadata: expected base64-encoded JSON",
				});
			}
		}

		validateMetadataKeys(customMetadata);

		return await bucket.put(key, c.req.raw.body, {
			customMetadata: customMetadata,
			httpMetadata: httpMetadata,
		});
	}
}

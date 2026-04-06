import { OpenAPIRoute } from "chanfana";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { decodeBase64Key } from "../../../foundation/utils/decodeBase64Key";
import { validateKey } from "../../../foundation/utils/validateKey";
import { validateMetadataKeys } from "../../../foundation/utils/validateMetadataKeys";
import type { AppContext } from "../../../types";

export class CreateUpload extends OpenAPIRoute {
	schema = {
		operationId: "post-multipart-create-upload",
		tags: ["Multipart"],
		summary: "Create upload",
		request: {
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

		const bucket = c.env[data.params.bucket];

		if (
			!bucket ||
			typeof bucket !== "object" ||
			!("createMultipartUpload" in bucket)
		) {
			return Response.json(
				{ error: `Bucket binding not found: ${data.params.bucket}` },
				{ status: 500 },
			);
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

		validateMetadataKeys(customMetadata);

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

		return await bucket.createMultipartUpload(key, {
			customMetadata: customMetadata,
			httpMetadata: httpMetadata,
		});
	}
}

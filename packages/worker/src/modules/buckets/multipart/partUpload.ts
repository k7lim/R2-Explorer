import { OpenAPIRoute } from "chanfana";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { decodeBase64Key } from "../../../foundation/utils/decodeBase64Key";
import { validateKey } from "../../../foundation/utils/validateKey";
import type { AppContext } from "../../../types";

export class PartUpload extends OpenAPIRoute {
	schema = {
		operationId: "post-multipart-part-upload",
		tags: ["Multipart"],
		summary: "Part upload",
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
				uploadId: z.string(),
				partNumber: z.number().int(),
			}),
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();

		const bucket = c.env[data.params.bucket] as R2Bucket;

		const key = decodeBase64Key(data.query.key);
		validateKey(key);

		const multipartUpload = bucket.resumeMultipartUpload(
			key,
			data.query.uploadId,
		);

		try {
			return await multipartUpload.uploadPart(
				data.query.partNumber,
				c.req.raw.body,
			);
		} catch (error: any) {
			throw new HTTPException(400, { message: error.message });
		}
	}
}

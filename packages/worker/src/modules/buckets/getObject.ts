import { OpenAPIRoute } from "chanfana";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { decodeBase64Key } from "../../foundation/utils/decodeBase64Key";
import { validateKey } from "../../foundation/utils/validateKey";
import type { AppContext } from "../../types";

export class GetObject extends OpenAPIRoute {
	schema = {
		operationId: "get-bucket-object",
		tags: ["Buckets"],
		summary: "Get Object",
		request: {
			params: z.object({
				bucket: z.string(),
				key: z.string().describe("base64 encoded file key"),
			}),
		},
		responses: {
			"200": {
				description: "File binary",
				schema: z.string().openapi({ format: "binary" }),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();

		const bucketName = data.params.bucket;
		const bucket = c.env[bucketName] as R2Bucket;

		const filePath = decodeBase64Key(data.params.key);
		validateKey(filePath);

		const object = await bucket.get(filePath);

		if (object === null) {
			throw new HTTPException(404, { message: "Object Not Found" });
		}

		const headers = new Headers();
		object.writeHttpMetadata(headers);
		headers.set("etag", object.httpEtag);
		headers.set("content-length", object.size.toString());

		const fileName = filePath.split("/").pop() || "download";
		const asciiFileName = fileName
			.replace(/[^\x20-\x7E]/g, "_")
			.replace(/"/g, "'");
		headers.set(
			"Content-Disposition",
			`attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
		);

		return new Response(object.body, {
			headers,
		});
	}
}

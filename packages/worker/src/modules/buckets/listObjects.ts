import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { decodeBase64Key } from "../../foundation/utils/decodeBase64Key";
import { validateKey } from "../../foundation/utils/validateKey";
import type { AppContext } from "../../types";

export class ListObjects extends OpenAPIRoute {
	schema = {
		operationId: "get-bucket-list-objects",
		tags: ["Buckets"],
		summary: "List objects",
		request: {
			params: z.object({
				bucket: z.string(),
			}),
			query: z.object({
				limit: z.number().optional(),
				prefix: z
					.string()
					.nullable()
					.optional()
					.describe("base64 encoded prefix"),
				cursor: z.string().nullable().optional(),
				delimiter: z.string().nullable().optional(),
				startAfter: z.string().nullable().optional(),
				include: z.enum(["httpMetadata", "customMetadata"]).array().optional(),
			}),
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();

		const bucketName = data.params.bucket;
		const bucket = c.env[bucketName] as R2Bucket;

		// fp-75s: LIST is a read path, so the bucket owner is allowed to
		// enumerate the soft-deleted/.trash/, .versions/, .operations/
		// reserved prefixes. .r2-explorer/ stays write-and-read protected
		// because it stores share-link metadata + PBKDF2 hashes.
		const prefix = data.query.prefix
			? validateKey(decodeBase64Key(data.query.prefix), {
					allowReservedReadPrefix: true,
				})
			: undefined;

		return await bucket.list({
			limit: data.query.limit,
			prefix,
			cursor: data.query.cursor,
			startAfter: data.query.startAfter,
			delimiter: data.query.delimiter ? data.query.delimiter : "",
			// @ts-ignore
			include: data.query.include,
		});
	}
}

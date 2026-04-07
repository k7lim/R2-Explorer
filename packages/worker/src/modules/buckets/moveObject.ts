import { OpenAPIRoute } from "chanfana";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { decodeBase64Key } from "../../foundation/utils/decodeBase64Key";
import { validateKey } from "../../foundation/utils/validateKey";
import { validateMetadataKeys } from "../../foundation/utils/validateMetadataKeys";
import type { AppContext } from "../../types";

export class MoveObject extends OpenAPIRoute {
	schema = {
		operationId: "post-bucket-move-object",
		tags: ["Buckets"],
		summary: "Move object",
		request: {
			params: z.object({
				bucket: z.string(),
			}),
			body: {
				content: {
					"application/json": {
						schema: z.object({
							oldKey: z.string().describe("base64 encoded file key"),
							newKey: z.string().describe("base64 encoded file key"),
						}),
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();

		const bucketName = data.params.bucket;
		const bucket = c.env[bucketName] as R2Bucket;

		const oldKey = decodeBase64Key(data.body.oldKey);
		const newKey = decodeBase64Key(data.body.newKey);
		validateKey(oldKey);
		validateKey(newKey);

		const head = await bucket.head(oldKey);

		if (head === null) {
			throw new HTTPException(404, {
				message: `Source object not found: ${oldKey}`,
			});
		}

		validateMetadataKeys(head.customMetadata);

		const object = await bucket.get(oldKey);

		if (object === null) {
			throw new HTTPException(404, {
				message: `Source object not found: ${oldKey}`,
			});
		}

		const putResult = await bucket.put(newKey, object.body, {
			customMetadata: object.customMetadata,
			httpMetadata: object.httpMetadata,
		});

		if (!putResult) {
			throw new HTTPException(500, {
				message: "Move failed: could not write to destination",
			});
		}

		// Non-atomic: put succeeded, now delete source. If delete fails the
		// object exists at both keys — caller should clean up. R2 provides no
		// transactional move, so a crash here causes duplication (Principle 14).
		try {
			await bucket.delete(oldKey);
		} catch (deleteError) {
			return c.json(
				{
					warning:
						"Object copied to new location but source could not be deleted",
					newKey,
					oldKey,
				},
				207,
			);
		}

		return putResult;
	}
}

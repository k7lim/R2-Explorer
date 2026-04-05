import { OpenAPIRoute } from "chanfana";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { auditLog } from "../../foundation/utils/auditLog";
import { timingSafeEqual } from "../../foundation/utils/timingSafeEqual";
import type { AppContext, ShareMetadata } from "../../types";

export class GetShareLink extends OpenAPIRoute {
	schema = {
		operationId: "post-share-link",
		tags: ["Sharing"],
		summary: "Access shared file",
		security: [], // Public endpoint - no auth required
		request: {
			params: z.object({
				shareId: z.string().describe("Share ID"),
			}),
			body: {
				content: {
					"application/json": {
						schema: z.object({
							password: z
								.string()
								.optional()
								.describe("Password for protected shares"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "File retrieved successfully",
			},
			"401": {
				description: "Password required or incorrect",
			},
			"404": {
				description: "Share link not found",
			},
			"410": {
				description: "Share link expired",
			},
			"403": {
				description: "Download limit reached",
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const shareId = data.params.shareId;

		// Search only verified R2 buckets for the share metadata (VULN-26)
		// Use constructor name check instead of iterating all env bindings,
		// which avoids probing non-R2 bindings and leaking timing info.
		let shareMetadata: ShareMetadata | null = null;
		let bucket: R2Bucket | null = null;

		for (const [key, value] of Object.entries(c.env)) {
			if (
				!value ||
				typeof value !== "object" ||
				(value as { constructor: { name: string } }).constructor.name !==
					"R2Bucket"
			) {
				continue;
			}

			const currentBucket = value as R2Bucket;
			const shareObject = await currentBucket.get(
				`.r2-explorer/sharable-links/${shareId}.json`,
			);

			if (shareObject) {
				shareMetadata = JSON.parse(await shareObject.text()) as ShareMetadata;
				bucket = currentBucket;
				break;
			}
		}

		if (!shareMetadata || !bucket) {
			throw new HTTPException(404, {
				message: "Share link not found",
			});
		}

		// Check expiration
		if (shareMetadata.expiresAt && Date.now() > shareMetadata.expiresAt) {
			throw new HTTPException(410, {
				message: "Share link expired",
			});
		}

		// Check download limit
		if (
			shareMetadata.maxDownloads &&
			shareMetadata.currentDownloads >= shareMetadata.maxDownloads
		) {
			throw new HTTPException(403, {
				message: "Download limit reached",
			});
		}

		// Validate password if required
		if (shareMetadata.passwordHash) {
			const password = data.body?.password;
			if (!password) {
				throw new HTTPException(401, {
					message: "Password required",
				});
			}

			let providedHash: string;
			const encoder = new TextEncoder();

			if (shareMetadata.passwordSalt) {
				// PBKDF2 path (new shares)
				const salt = new Uint8Array(
					(shareMetadata.passwordSalt.match(/.{2}/g) || []).map((h) =>
						Number.parseInt(h, 16),
					),
				);
				const keyMaterial = await crypto.subtle.importKey(
					"raw",
					encoder.encode(password),
					"PBKDF2",
					false,
					["deriveBits"],
				);
				const hashBuffer = await crypto.subtle.deriveBits(
					{ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
					keyMaterial,
					256,
				);
				providedHash = Array.from(new Uint8Array(hashBuffer))
					.map((b) => b.toString(16).padStart(2, "0"))
					.join("");
			} else {
				// Legacy SHA-256 path (pre-existing shares without salt)
				const hashBuffer = await crypto.subtle.digest(
					"SHA-256",
					encoder.encode(password),
				);
				providedHash = Array.from(new Uint8Array(hashBuffer))
					.map((b) => b.toString(16).padStart(2, "0"))
					.join("");
			}

			if (!timingSafeEqual(providedHash, shareMetadata.passwordHash)) {
				throw new HTTPException(401, {
					message: "Incorrect password",
				});
			}
		}

		// Increment download counter BEFORE serving the file to mitigate TOCTOU
		// race on maxDownloads. A failed download still counts — this is safer
		// than allowing concurrent requests to bypass the limit. Note: a small
		// race window remains since R2 has no atomic increment; see Principle 14.
		shareMetadata.currentDownloads++;
		await bucket.put(
			`.r2-explorer/sharable-links/${shareId}.json`,
			JSON.stringify(shareMetadata),
			{
				httpMetadata: { contentType: "application/json" },
				customMetadata: {
					targetBucket: shareMetadata.bucket,
					targetKey: shareMetadata.key,
				},
			},
		);

		// Fetch the actual file after counter increment
		const file = await bucket.get(shareMetadata.key);

		if (!file) {
			throw new HTTPException(404, {
				message: "Shared file not found",
			});
		}

		auditLog("share_access", {
			shareId,
			key: shareMetadata.key,
			ip: c.req.header("cf-connecting-ip") || "unknown",
		});

		// Return the file with proper headers
		const headers = new Headers();
		file.writeHttpMetadata(headers);
		headers.set("etag", file.httpEtag);

		// Add content disposition for download
		const fileName = shareMetadata.key.split("/").pop() || "download";
		headers.set(
			"Content-Disposition",
			`attachment; filename="${encodeURIComponent(fileName)}"`,
		);

		return new Response(file.body, {
			headers,
		});
	}
}

import type { ExecutionContext } from "hono";
import PostalMime from "postal-mime";
import { getCurrentTimestampMilliseconds } from "../../foundation/dates";
import { validateKey } from "../../foundation/utils/validateKey";
import type { AppEnv, R2ExplorerConfig } from "../../types";

async function streamToArrayBuffer(stream, streamSize) {
	const result = new Uint8Array(streamSize);
	let bytesRead = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		result.set(value, bytesRead);
		bytesRead += value.length;
	}
	return result;
}

function sanitizeFilename(name: string): string {
	const basename = name.split("/").pop()?.split("\\").pop() || "attachment";
	let cleaned = "";
	for (const ch of basename) {
		if (ch.charCodeAt(0) >= 0x20) cleaned += ch;
	}
	return cleaned.replace(/\.\./g, "").replace(/[?#%]/g, "_");
}

function truncate(value: string | undefined | null, limit: number): string {
	return (value ?? "").substring(0, limit);
}

export async function receiveEmail(
	event: { raw: unknown; rawSize: unknown },
	env: AppEnv,
	ctx: ExecutionContext,
	config: R2ExplorerConfig,
) {
	let bucket;

	if (
		config?.emailRouting &&
		typeof config.emailRouting === "object" &&
		config.emailRouting.targetBucket &&
		env[config.emailRouting.targetBucket]
	) {
		bucket = env[config.emailRouting.targetBucket];
	}

	if (!bucket) {
		// Bucket not set, default to first defined
		for (const [key, value] of Object.entries(env)) {
			// @ts-ignore
			if (value.get && value.put) {
				bucket = value;
				break;
			}
		}
	}

	if (!bucket) {
		throw new Error(
			"No R2 bucket binding found for email routing. Configure emailRouting.targetBucket or add an R2 bucket binding.",
		);
	}

	const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
	const parser = new PostalMime();
	const parsedEmail = await parser.parse(rawEmail);

	const emailPath = `${getCurrentTimestampMilliseconds()}-${crypto.randomUUID()}`;

	await bucket.put(
		`.r2-explorer/emails/inbox/${emailPath}.json`,
		JSON.stringify(parsedEmail),
		{
			customMetadata: {
				subject: truncate(parsedEmail.subject, 256),
				from_address: truncate(parsedEmail.from?.address, 254),
				from_name: truncate(parsedEmail.from?.name, 128),
				to_address:
					parsedEmail.to.length > 0
						? truncate(parsedEmail.to[0].address, 254)
						: null,
				to_name:
					parsedEmail.to.length > 0
						? truncate(parsedEmail.to[0].name, 128)
						: null,
				has_attachments: parsedEmail.attachments.length > 0,
				read: false,
				timestamp: Date.now(),
			},
		},
	);

	for (const att of parsedEmail.attachments) {
		const safeFilename = sanitizeFilename(att.filename);
		const key = `.r2-explorer/emails/inbox/${emailPath}/${safeFilename}`;
		validateKey(key, { allowR2ExplorerPrefix: true });
		await bucket.put(key, att.content);
	}
}

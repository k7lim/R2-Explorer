import { HTTPException } from "hono/http-exception";

/**
 * Metadata key prefixes reserved by the WebDAV layer. Allowing authenticated
 * users to set these via R2-Explorer would corrupt WebDAV state (VULN-33).
 */
const RESERVED_KEY_PATTERNS = [
	"lock_",
	"resourcetype",
	"dead_prop_",
	"trash_",
	"schema_version",
];

/**
 * Rejects custom metadata whose keys collide with WebDAV-interpreted
 * conventions, preventing cross-service state corruption.
 */
export function validateMetadataKeys(
	metadata: Record<string, unknown> | undefined,
): void {
	if (!metadata) return;

	for (const key of Object.keys(metadata)) {
		const lower = key.toLowerCase();
		for (const pattern of RESERVED_KEY_PATTERNS) {
			if (lower === pattern || lower.startsWith(pattern)) {
				throw new HTTPException(400, {
					message: `Invalid metadata key "${key}": reserved for internal use`,
				});
			}
		}
	}
}

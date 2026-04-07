import { HTTPException } from "hono/http-exception";

/**
 * Decodes a base64-encoded R2 key from a URL parameter.
 * Uses a single decode path instead of multiple fallbacks,
 * preventing encoding confusion attacks (VULN-22).
 */
export function decodeBase64Key(encoded: string): string {
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
			Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
		);
	} catch {
		throw new HTTPException(400, {
			message: "Invalid key encoding: expected valid base64",
		});
	}
}

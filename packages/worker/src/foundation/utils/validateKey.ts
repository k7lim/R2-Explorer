import { HTTPException } from "hono/http-exception";

/**
 * Validates a decoded R2 object key, rejecting dangerous patterns.
 * Throws HTTPException(400) on invalid input.
 */
export function validateKey(key: string): string {
	// Reject control characters (U+0000 through U+001F)
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional validation of user input
	if (/[\u0000-\u001f]/.test(key)) {
		throw new HTTPException(400, {
			message: "Invalid key: contains control characters",
		});
	}

	// Reject path traversal
	const segments = key.split("/");
	if (segments.some((s) => s === ".." || s === ".")) {
		throw new HTTPException(400, {
			message: "Invalid key: contains traversal sequences",
		});
	}

	// Reject percent-encoded sequences (encoding happens at HTTP layer)
	if (/%[0-9a-fA-F]{2}/.test(key)) {
		throw new HTTPException(400, {
			message: "Invalid key: contains percent-encoded characters",
		});
	}

	// Reject query/fragment injection
	if (/[?#]/.test(key)) {
		throw new HTTPException(400, {
			message: "Invalid key: contains query or fragment characters",
		});
	}

	// Reject reserved internal prefix
	if (key.startsWith(".r2-explorer/")) {
		throw new HTTPException(400, {
			message: "Invalid key: reserved internal prefix",
		});
	}

	return key;
}

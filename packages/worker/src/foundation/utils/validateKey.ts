import { HTTPException } from "hono/http-exception";

interface ValidateKeyOptions {
	/**
	 * Allow keys under `.r2-explorer/`. Only legitimate share-link writers
	 * (CreateShareLink/DeleteShareLink) should set this — that prefix holds
	 * sensitive share metadata including PBKDF2 password hashes.
	 */
	allowR2ExplorerPrefix?: boolean;
	/**
	 * Allow read-side prefixes under `.trash/`, `.versions/`, `.operations/`.
	 * Set on LIST endpoints so the bucket owner can enumerate soft-deleted
	 * entries (restore-from-trash), browse historical versions, and inspect
	 * operational metadata. Write paths (PUT/POST/MKCOL/COPY-dest/MOVE-dest)
	 * never set this — those prefixes remain write-protected for end users
	 * while the worker continues to write to them internally via raw bucket
	 * calls that bypass validateKey. fp-75s.
	 */
	allowReservedReadPrefix?: boolean;
}

/**
 * Validates a decoded R2 object key, rejecting dangerous patterns.
 * Throws HTTPException(400) on invalid input.
 */
export function validateKey(key: string, options?: ValidateKeyOptions): string {
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

	// Reject backslashes
	if (key.includes("\\")) {
		throw new HTTPException(400, {
			message: "Invalid key: contains backslash",
		});
	}

	// Reject reserved internal prefix (unless caller is a legitimate writer)
	if (key.startsWith(".r2-explorer/") && !options?.allowR2ExplorerPrefix) {
		throw new HTTPException(400, {
			message: "Invalid key: reserved internal prefix",
		});
	}

	// fp-75s: write-protected reserved prefixes — block by default but allow
	// LIST/read paths to opt in via allowReservedReadPrefix. The bucket owner
	// needs to enumerate `.trash/` to restore soft-deleted files.
	if (
		!options?.allowReservedReadPrefix &&
		(key.startsWith(".trash/") ||
			key.startsWith(".versions/") ||
			key.startsWith(".operations/"))
	) {
		throw new HTTPException(400, {
			message: "Invalid key: reserved internal prefix",
		});
	}

	return key;
}

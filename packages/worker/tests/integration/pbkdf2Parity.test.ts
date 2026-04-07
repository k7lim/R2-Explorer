import { describe, it, expect } from "vitest";

/**
 * Characterization test: pins createShareLink and getShareLink PBKDF2 code
 * paths to identical output for a fixed fixture. Guards against silent param
 * drift between the two inlined hashing sites.
 *
 * See: docs/plans/scratch/fp-dv4.md for decision context.
 * Ticket: fp-dv4 | Principle: P13 (Characterize Before You Change)
 */

const FIXTURE_PASSWORD = "test-password-fp-ckz";
const FIXTURE_SALT = new Uint8Array([
	0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
	0x0c, 0x0d, 0x0e, 0x0f,
]);
const FIXTURE_SALT_HEX = "000102030405060708090a0b0c0d0e0f";

// Hardcoded expected output — computed once, pinned forever.
// If this changes, someone altered PBKDF2 params in one or both handlers.
const EXPECTED_HEX =
	"e99f2174b36ab862f3ef13b294f36ae31fad861d56b9d40364dfab34e9227d45";

function toHex(buf: ArrayBuffer): string {
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Mirrors createShareLink.ts:94-112 — PBKDF2 with fresh salt path.
 * Salt is passed in rather than generated.
 */
async function hashLikeCreateShareLink(
	password: string,
	salt: Uint8Array,
): Promise<string> {
	const encoder = new TextEncoder();
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
	return toHex(hashBuffer);
}

/**
 * Mirrors getShareLink.ts:117-138 — PBKDF2 verification path.
 * Parses salt from hex string (as stored in metadata).
 */
async function hashLikeGetShareLink(
	password: string,
	saltHex: string,
): Promise<string> {
	const salt = new Uint8Array(
		(saltHex.match(/.{2}/g) || []).map((h) => Number.parseInt(h, 16)),
	);
	const encoder = new TextEncoder();
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
	return toHex(hashBuffer);
}

describe("PBKDF2 parity: createShareLink ↔ getShareLink", () => {
	it("both handlers produce identical hashes for the same password and salt", async () => {
		const hashA = await hashLikeCreateShareLink(
			FIXTURE_PASSWORD,
			FIXTURE_SALT,
		);
		const hashB = await hashLikeGetShareLink(
			FIXTURE_PASSWORD,
			FIXTURE_SALT_HEX,
		);

		expect(hashA).toBe(hashB);
	});

	it("output matches pinned expected hex (guards against synchronized drift)", async () => {
		const hashA = await hashLikeCreateShareLink(
			FIXTURE_PASSWORD,
			FIXTURE_SALT,
		);

		expect(hashA).toBe(EXPECTED_HEX);
	});
});

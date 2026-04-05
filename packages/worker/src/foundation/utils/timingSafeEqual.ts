/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 * Compares the full encoded byte sequences regardless of where they differ.
 */
export function timingSafeEqual(a: string, b: string): boolean {
	const encoder = new TextEncoder();
	const left = encoder.encode(a);
	const right = encoder.encode(b);

	if (left.byteLength !== right.byteLength) {
		// Still do a full comparison to avoid leaking length info via timing
		let mismatch = 1;
		for (let i = 0; i < left.byteLength; i++) {
			mismatch |= left[i] ^ (right[i % right.byteLength] ?? 0);
		}
		return false;
	}

	let mismatch = 0;
	for (let i = 0; i < left.byteLength; i++) {
		mismatch |= left[i] ^ right[i];
	}
	return mismatch === 0;
}

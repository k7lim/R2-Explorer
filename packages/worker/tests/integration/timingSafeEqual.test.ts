import { describe, expect, it } from "vitest";
import { timingSafeEqual } from "../../src/foundation/utils/timingSafeEqual";

describe("timingSafeEqual", () => {
	it("returns true for equal-length matching strings", () => {
		expect(timingSafeEqual("secret", "secret")).toBe(true);
	});

	it("returns false for equal-length differing strings", () => {
		expect(timingSafeEqual("secret", "socret")).toBe(false);
	});

	it("returns false for different-length strings", () => {
		expect(timingSafeEqual("short", "longer-string")).toBe(false);
	});

	it("returns true for both empty strings", () => {
		expect(timingSafeEqual("", "")).toBe(true);
	});
});

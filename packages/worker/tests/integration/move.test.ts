import { createExecutionContext, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, createTestRequest } from "./setup";

describe("MoveObject (POST /api/buckets/:bucket/move)", () => {
	let app: ReturnType<typeof createTestApp>;
	let MY_TEST_BUCKET_1: R2Bucket;
	const BUCKET_NAME = "MY_TEST_BUCKET_1";
	const SOURCE_KEY = "move-source.txt";
	const SOURCE_CONTENT = "Move me!";
	const POISONED_KEY = "poisoned-move-source.txt";

	beforeEach(async () => {
		app = createTestApp();
		MY_TEST_BUCKET_1 = env.MY_TEST_BUCKET_1;

		if (MY_TEST_BUCKET_1) {
			const listed = await MY_TEST_BUCKET_1.list();
			const keysToDelete = listed.objects.map((obj) => obj.key);
			if (keysToDelete.length > 0) {
				await MY_TEST_BUCKET_1.delete(keysToDelete);
			}
			await MY_TEST_BUCKET_1.put(SOURCE_KEY, SOURCE_CONTENT, {
				customMetadata: { project: "r2-explorer" },
			});
			await MY_TEST_BUCKET_1.put(POISONED_KEY, "corrupted", {
				customMetadata: { lock_records: "x" },
			});
		}
	});

	afterEach(async () => {
		if (MY_TEST_BUCKET_1) {
			const listed = await MY_TEST_BUCKET_1.list();
			const keysToDelete = listed.objects.map((obj) => obj.key);
			if (keysToDelete.length > 0) {
				await MY_TEST_BUCKET_1.delete(keysToDelete);
			}
		}
	});

	it("should move an existing file to a new key", async () => {
		const destKey = "moved-dest.txt";
		const request = createTestRequest(
			`/api/buckets/${BUCKET_NAME}/move`,
			"POST",
			{
				oldKey: btoa(SOURCE_KEY),
				newKey: btoa(destKey),
			},
			{ "Content-Type": "application/json" },
		);
		const response = await app.fetch(request, env, createExecutionContext());
		expect(response.status).toBe(200);
		await response.text();

		// Destination exists with correct content
		const destObj = await MY_TEST_BUCKET_1.get(destKey);
		expect(destObj).not.toBeNull();
		expect(await destObj!.text()).toBe(SOURCE_CONTENT);

		// Source deleted
		const sourceObj = await MY_TEST_BUCKET_1.get(SOURCE_KEY);
		expect(sourceObj).toBeNull();
	});

	it("should return 404 when source object does not exist", async () => {
		const request = createTestRequest(
			`/api/buckets/${BUCKET_NAME}/move`,
			"POST",
			{
				oldKey: btoa("non-existent.txt"),
				newKey: btoa("dest.txt"),
			},
			{ "Content-Type": "application/json" },
		);
		const response = await app.fetch(request, env, createExecutionContext());
		expect(response.status).toBe(404);
		const body = await response.text();
		expect(body).toContain("Source object not found");
	});

	it("should return 400 when source has reserved metadata keys", async () => {
		const request = createTestRequest(
			`/api/buckets/${BUCKET_NAME}/move`,
			"POST",
			{
				oldKey: btoa(POISONED_KEY),
				newKey: btoa("moved-poisoned.txt"),
			},
			{ "Content-Type": "application/json" },
		);
		const response = await app.fetch(request, env, createExecutionContext());
		expect(response.status).toBe(400);
		const body = await response.text();
		expect(body).toContain("reserved for internal use");
	});
});

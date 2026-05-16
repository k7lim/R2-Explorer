import { createExecutionContext, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, createTestRequest } from "./setup";

describe("Share Links Endpoints", () => {
	let app: ReturnType<typeof createTestApp>;
	let MY_TEST_BUCKET_1: R2Bucket;
	const testFileName = "test-file.txt";
	const testFileContent = "Hello World - Test File";

	beforeEach(async () => {
		app = createTestApp();
		MY_TEST_BUCKET_1 = env.MY_TEST_BUCKET_1;

		// Clean up bucket before each test
		if (MY_TEST_BUCKET_1) {
			const listed = await MY_TEST_BUCKET_1.list();
			const keysToDelete = listed.objects.map((obj) => obj.key);
			if (keysToDelete.length > 0) {
				await MY_TEST_BUCKET_1.delete(keysToDelete);
			}
		}

		// Create a test file
		await MY_TEST_BUCKET_1.put(testFileName, testFileContent);
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

	describe("Create Share Link (POST /api/buckets/:bucket/:key/share)", () => {
		it.skip("should create a basic share link without options", async () => {
			const encodedKey = btoa(testFileName);
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{},
			);

			const response = await app.fetch(request, env, createExecutionContext());

			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				shareId: string;
				shareUrl: string;
				expiresAt?: number;
			};

			expect(body.shareId).toBeDefined();
			expect(body.shareId).toHaveLength(10);
			expect(body.shareUrl).toContain(`/share/${body.shareId}`);
			expect(body.expiresAt).toBeUndefined();

			// Verify share metadata was stored
			const shareMetadata = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${body.shareId}.json`,
			);
			expect(shareMetadata).toBeDefined();
		});

		it("should create share link with expiration", async () => {
			const encodedKey = btoa(testFileName);
			const expiresIn = 3600; // 1 hour
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{ expiresIn },
			);

			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(200);

			const body = (await response.json()) as {
				shareId: string;
				shareUrl: string;
				expiresAt?: number;
			};

			expect(body.expiresAt).toBeDefined();
			expect(body.expiresAt).toBeGreaterThan(Date.now());
			expect(body.expiresAt).toBeLessThanOrEqual(Date.now() + expiresIn * 1000);

			// Verify metadata includes expiration
			const shareMetadata = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${body.shareId}.json`,
			);
			const metadata = JSON.parse((await shareMetadata?.text()) || "{}");
			expect(metadata.expiresAt).toBe(body.expiresAt);
		});

		it("should create share link with password", async () => {
			const encodedKey = btoa(testFileName);
			const password = "test-password-123";
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{ password },
			);

			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(200);

			const body = (await response.json()) as { shareId: string };

			// Verify password is hashed in metadata
			const shareMetadata = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${body.shareId}.json`,
			);
			const metadata = JSON.parse((await shareMetadata?.text()) || "{}");
			expect(metadata.passwordHash).toBeDefined();
			expect(metadata.passwordHash).not.toBe(password); // Should be hashed
			expect(metadata.passwordHash).toHaveLength(64); // SHA-256 hex length
		});

		it("should create share link with max downloads", async () => {
			const encodedKey = btoa(testFileName);
			const maxDownloads = 5;
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{ maxDownloads },
			);

			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(200);

			const body = (await response.json()) as { shareId: string };

			// Verify max downloads in metadata
			const shareMetadata = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${body.shareId}.json`,
			);
			const metadata = JSON.parse((await shareMetadata?.text()) || "{}");
			expect(metadata.maxDownloads).toBe(maxDownloads);
			expect(metadata.currentDownloads).toBe(0);
		});

		it("should return 404 for non-existent file", async () => {
			const encodedKey = btoa("non-existent-file.txt");
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{},
			);

			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(404);
		});

		it("should create share link with all options", async () => {
			const encodedKey = btoa(testFileName);
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{
					expiresIn: 7200,
					password: "secure-password",
					maxDownloads: 10,
				},
			);

			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(200);

			const body = (await response.json()) as {
				shareId: string;
				expiresAt: number;
			};

			const shareMetadata = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${body.shareId}.json`,
			);
			const metadata = JSON.parse((await shareMetadata?.text()) || "{}");

			expect(metadata.expiresAt).toBeDefined();
			expect(metadata.passwordHash).toBeDefined();
			expect(metadata.maxDownloads).toBe(10);
			expect(metadata.bucket).toBe("MY_TEST_BUCKET_1");
			expect(metadata.key).toBe(testFileName);
			expect(metadata.currentDownloads).toBe(0);
		});
	});

	describe("Share Landing Page (GET /share/:shareId)", () => {
		let shareId: string;

		beforeEach(async () => {
			// Create a share for testing
			const encodedKey = btoa(testFileName);
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{},
			);
			const response = await app.fetch(request, env, createExecutionContext());
			const body = (await response.json()) as { shareId: string };
			shareId = body.shareId;
		});

		it("should return HTML landing page with CSP nonce", async () => {
			const request = new Request(`http://localhost/share/${shareId}`, {
				method: "GET",
			});

			const response = await app.fetch(request, env, createExecutionContext());

			expect(response.status).toBe(200);
			const html = await response.text();
			expect(html).toContain("<!DOCTYPE html>");
			expect(html).toContain(testFileName);
			expect(html).toContain("Download");

			// CSP header must include the nonce used in the script tag
			const csp = response.headers.get("Content-Security-Policy") || "";
			const nonceMatch = html.match(/<script nonce="([0-9a-f]+)">/);
			expect(nonceMatch).not.toBeNull();
			expect(csp).toContain(`'nonce-${nonceMatch?.[1]}'`);
		});

		it("should render correct landing page for non-protected share", async () => {
			const request = new Request(`http://localhost/share/${shareId}`, {
				method: "GET",
			});

			const response = await app.fetch(request, env, createExecutionContext());
			const html = await response.text();

			// No password input element (CSS selector in <style> doesn't count)
			expect(html).not.toContain('<input type="password"');
			// Button says "Download", not "Unlock & Download"
			expect(html).toContain(">Download</button>");
			// Must NOT auto-call download — browsers block it without user gesture
			expect(html).not.toContain("download();");
			// Should use addEventListener (not inline onclick) for CSP compliance
			expect(html).toContain("addEventListener");
			// Should have a nonce on the script tag
			expect(html).toMatch(/<script nonce="[0-9a-f]+">/);
			// Should have an error div for displaying fetch failures
			expect(html).toContain('id="error"');
			// Should POST to the correct share endpoint
			expect(html).toContain(`fetch("/share/${shareId}"`);
			expect(html).toContain('"POST"');
		});

		it("should render correct landing page for password-protected share", async () => {
			const encodedKey = btoa(testFileName);
			const createResp = await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{ password: "secret123" },
				),
				env,
				createExecutionContext(),
			);
			const { shareId: protectedId } = (await createResp.json()) as {
				shareId: string;
			};

			const request = new Request(`http://localhost/share/${protectedId}`, {
				method: "GET",
			});
			const response = await app.fetch(request, env, createExecutionContext());
			const html = await response.text();

			expect(response.status).toBe(200);
			// Must have a password input element
			expect(html).toContain('<input type="password"');
			// Button says "Unlock & Download"
			expect(html).toContain(">Unlock & Download</button>");
			// Must NOT auto-call download
			expect(html).not.toContain("download();");
			// Should use addEventListener (not inline onclick) for CSP compliance
			expect(html).toContain("addEventListener");
			// Should have a nonce on the script tag
			expect(html).toMatch(/<script nonce="[0-9a-f]+">/);
			// Should have an error div for wrong-password feedback
			expect(html).toContain('id="error"');
			// Should POST to the correct share endpoint
			expect(html).toContain(`fetch("/share/${protectedId}"`);
			expect(html).toContain('"POST"');
		});

		it("should return 404 HTML for non-existent share", async () => {
			const request = new Request(
				"http://localhost/share/aaaabbbbccccddddeeeeffffaaaabbbb",
				{ method: "GET" },
			);

			const response = await app.fetch(request, env, createExecutionContext());

			expect(response.status).toBe(404);
			const html = await response.text();
			expect(html).toContain("Not Found");
			expect(html).toContain("does not exist");
		});

		it("should return 404 for invalid share ID format", async () => {
			const request = new Request("http://localhost/share/not-a-hex-value!", {
				method: "GET",
			});

			const response = await app.fetch(request, env, createExecutionContext());

			expect(response.status).toBe(404);
			const html = await response.text();
			expect(html).toContain("Invalid share link");
		});

		it("should return 410 HTML for expired share", async () => {
			const encodedKey = btoa(testFileName);
			const createResp = await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{ expiresIn: -1 },
				),
				env,
				createExecutionContext(),
			);
			const { shareId: expiredId } = (await createResp.json()) as {
				shareId: string;
			};

			const request = new Request(`http://localhost/share/${expiredId}`, {
				method: "GET",
			});
			const response = await app.fetch(request, env, createExecutionContext());

			expect(response.status).toBe(410);
			const html = await response.text();
			expect(html).toContain("Link Expired");
		});

		it("should return 403 HTML when download limit reached", async () => {
			const encodedKey = btoa(testFileName);
			const createResp = await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{ maxDownloads: 1 },
				),
				env,
				createExecutionContext(),
			);
			const { shareId: limitedId } = (await createResp.json()) as {
				shareId: string;
			};

			// Exhaust the download limit via POST (consume body to release R2 stream)
			const downloadResp = await app.fetch(
				new Request(`http://localhost/share/${limitedId}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				}),
				env,
				createExecutionContext(),
			);
			await downloadResp.arrayBuffer();

			// Now GET should show the limit-reached page
			const request = new Request(`http://localhost/share/${limitedId}`, {
				method: "GET",
			});
			const response = await app.fetch(request, env, createExecutionContext());

			expect(response.status).toBe(403);
			const html = await response.text();
			expect(html).toContain("download limit");
		});

		it("should not increment download counter on GET", async () => {
			// GET the landing page multiple times
			for (let i = 0; i < 3; i++) {
				await app.fetch(
					new Request(`http://localhost/share/${shareId}`, {
						method: "GET",
					}),
					env,
					createExecutionContext(),
				);
			}

			// Counter should still be 0
			const metadata = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${shareId}.json`,
			);
			const data = JSON.parse((await metadata?.text()) || "{}");
			expect(data.currentDownloads).toBe(0);
		});

		it("should generate unique nonces per request", async () => {
			const nonces: string[] = [];
			for (let i = 0; i < 3; i++) {
				const response = await app.fetch(
					new Request(`http://localhost/share/${shareId}`, {
						method: "GET",
					}),
					env,
					createExecutionContext(),
				);
				const html = await response.text();
				const match = html.match(/<script nonce="([0-9a-f]+)">/);
				expect(match).not.toBeNull();
				nonces.push(match?.[1] ?? "");
			}

			// All three nonces should be different
			const unique = new Set(nonces);
			expect(unique.size).toBe(3);
		});
	});

	describe("Security headers on non-share routes", () => {
		it("should have default strict CSP on API routes", async () => {
			const request = createTestRequest("/api/server/config");
			const response = await app.fetch(request, env, createExecutionContext());

			const csp = response.headers.get("Content-Security-Policy") || "";
			expect(csp).toContain("script-src 'self'");
			expect(csp).not.toContain("nonce");
		});

		it("should have nosniff on share POST download", async () => {
			const encodedKey = btoa(testFileName);
			const createResp = await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{},
				),
				env,
				createExecutionContext(),
			);
			const { shareId: sid } = (await createResp.json()) as {
				shareId: string;
			};

			const response = await app.fetch(
				new Request(`http://localhost/share/${sid}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				}),
				env,
				createExecutionContext(),
			);
			await response.arrayBuffer();

			expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
		});
	});

	describe("Access Share Link (POST /share/:shareId)", () => {
		let shareId: string;

		beforeEach(async () => {
			const encodedKey = btoa(testFileName);
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{},
			);
			const response = await app.fetch(request, env, createExecutionContext());
			const body = (await response.json()) as { shareId: string };
			shareId = body.shareId;
		});

		it("should download file via POST", async () => {
			const request = new Request(`http://localhost/share/${shareId}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});

			const response = await app.fetch(request, env, createExecutionContext());

			expect(response.status).toBe(200);
			const content = await response.text();
			expect(content).toBe(testFileContent);
			expect(response.headers.get("Content-Disposition")).toContain(
				testFileName,
			);
		});

		it("should increment download counter on POST", async () => {
			for (let i = 0; i < 2; i++) {
				const resp = await app.fetch(
					new Request(`http://localhost/share/${shareId}`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({}),
					}),
					env,
					createExecutionContext(),
				);
				await resp.arrayBuffer();
			}

			const metadata = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${shareId}.json`,
			);
			const data = JSON.parse((await metadata?.text()) || "{}");
			expect(data.currentDownloads).toBe(2);
		});

		it("should return 404 for non-existent share via POST", async () => {
			const request = new Request(
				"http://localhost/share/aaaabbbbccccddddeeeeffffaaaabbbb",
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				},
			);

			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(404);
		});

		it("should return 410 for expired share via POST", async () => {
			const encodedKey = btoa(testFileName);
			const createResp = await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{ expiresIn: -1 },
				),
				env,
				createExecutionContext(),
			);
			const { shareId: expiredId } = (await createResp.json()) as {
				shareId: string;
			};

			const request = new Request(`http://localhost/share/${expiredId}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			});
			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(410);
		});

		it("should enforce download limits via POST", async () => {
			const encodedKey = btoa(testFileName);
			const createResp = await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{ maxDownloads: 2 },
				),
				env,
				createExecutionContext(),
			);
			const { shareId: limitedId } = (await createResp.json()) as {
				shareId: string;
			};

			const makePostRequest = () =>
				new Request(`http://localhost/share/${limitedId}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				});

			const r1 = await app.fetch(
				makePostRequest(),
				env,
				createExecutionContext(),
			);
			await r1.arrayBuffer();
			const r2 = await app.fetch(
				makePostRequest(),
				env,
				createExecutionContext(),
			);
			await r2.arrayBuffer();
			const r3 = await app.fetch(
				makePostRequest(),
				env,
				createExecutionContext(),
			);

			expect(r1.status).toBe(200);
			expect(r2.status).toBe(200);
			expect(r3.status).toBe(403);
		});

		it("should require password for protected shares via POST", async () => {
			const encodedKey = btoa(testFileName);
			const password = "secret123";
			const createResp = await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{ password },
				),
				env,
				createExecutionContext(),
			);
			const { shareId: protectedId } = (await createResp.json()) as {
				shareId: string;
			};

			// Without password → 401
			const noPassResp = await app.fetch(
				new Request(`http://localhost/share/${protectedId}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				}),
				env,
				createExecutionContext(),
			);
			expect(noPassResp.status).toBe(401);

			// Wrong password → 401
			const wrongPassResp = await app.fetch(
				new Request(`http://localhost/share/${protectedId}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password: "wrong" }),
				}),
				env,
				createExecutionContext(),
			);
			expect(wrongPassResp.status).toBe(401);

			// Correct password → 200
			const correctPassResp = await app.fetch(
				new Request(`http://localhost/share/${protectedId}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password }),
				}),
				env,
				createExecutionContext(),
			);
			expect(correctPassResp.status).toBe(200);
			const content = await correctPassResp.text();
			expect(content).toBe(testFileContent);
		});
	});

	describe("List Shares (GET /api/buckets/:bucket/shares)", () => {
		it("should list all shares in bucket", async () => {
			// Create multiple shares
			const encodedKey = btoa(testFileName);

			await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{},
				),
				env,
				createExecutionContext(),
			);

			await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{ maxDownloads: 5 },
				),
				env,
				createExecutionContext(),
			);

			// List shares
			const request = createTestRequest("/api/buckets/MY_TEST_BUCKET_1/shares");
			const response = await app.fetch(request, env, createExecutionContext());

			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				shares: Array<{
					shareId: string;
					shareUrl: string;
					key: string;
					isExpired: boolean;
					hasPassword: boolean;
				}>;
			};

			expect(body.shares).toHaveLength(2);
			expect(body.shares[0].shareId).toBeDefined();
			expect(body.shares[0].shareUrl).toContain("/share/");
			expect(body.shares[0].key).toBe(testFileName);
			expect(body.shares[0].isExpired).toBe(false);
		});

		it("should return empty array for bucket with no shares", async () => {
			const request = createTestRequest("/api/buckets/MY_TEST_BUCKET_1/shares");
			const response = await app.fetch(request, env, createExecutionContext());

			expect(response.status).toBe(200);
			const body = (await response.json()) as { shares: Array<unknown> };
			expect(body.shares).toHaveLength(0);
		});

		it("should show expired status for shares", async () => {
			// Create expired share
			const encodedKey = btoa(testFileName);
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{ expiresIn: -1 },
			);
			await app.fetch(request, env, createExecutionContext());

			// List shares
			const listRequest = createTestRequest(
				"/api/buckets/MY_TEST_BUCKET_1/shares",
			);
			const response = await app.fetch(
				listRequest,
				env,
				createExecutionContext(),
			);
			const body = (await response.json()) as {
				shares: Array<{ isExpired: boolean }>;
			};

			expect(body.shares[0].isExpired).toBe(true);
		});

		it("should indicate password protection status", async () => {
			const encodedKey = btoa(testFileName);

			// Create share with password
			await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{ password: "secret" },
				),
				env,
				createExecutionContext(),
			);

			// Create share without password
			await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{},
				),
				env,
				createExecutionContext(),
			);

			const request = createTestRequest("/api/buckets/MY_TEST_BUCKET_1/shares");
			const response = await app.fetch(request, env, createExecutionContext());
			const body = (await response.json()) as {
				shares: Array<{ hasPassword: boolean }>;
			};

			expect(body.shares).toHaveLength(2);
			expect(body.shares.some((s) => s.hasPassword === true)).toBe(true);
			expect(body.shares.some((s) => s.hasPassword === false)).toBe(true);
		});
	});

	describe("Delete Share Link (DELETE /api/buckets/:bucket/share/:shareId)", () => {
		let shareId: string;

		beforeEach(async () => {
			// Create a share for testing
			const encodedKey = btoa(testFileName);
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{},
			);
			const response = await app.fetch(request, env, createExecutionContext());
			const body = (await response.json()) as { shareId: string };
			shareId = body.shareId;
		});

		it("should delete/revoke a share link", async () => {
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/share/${shareId}`,
				"DELETE",
			);

			const response = await app.fetch(request, env, createExecutionContext());

			expect(response.status).toBe(200);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(true);

			// Verify share metadata was deleted
			const shareMetadata = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${shareId}.json`,
			);
			expect(shareMetadata).toBeNull();
		});

		it("should return 404 when deleting non-existent share", async () => {
			const request = createTestRequest(
				"/api/buckets/MY_TEST_BUCKET_1/share/nonexistent",
				"DELETE",
			);

			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(404);
		});

		it("should make share inaccessible after deletion", async () => {
			// Delete the share
			await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/share/${shareId}`,
					"DELETE",
				),
				env,
				createExecutionContext(),
			);

			// GET landing page should 404
			const getResponse = await app.fetch(
				new Request(`http://localhost/share/${shareId}`, {
					method: "GET",
				}),
				env,
				createExecutionContext(),
			);
			expect(getResponse.status).toBe(404);

			// POST download should also 404
			const postResponse = await app.fetch(
				new Request(`http://localhost/share/${shareId}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				}),
				env,
				createExecutionContext(),
			);
			expect(postResponse.status).toBe(404);
		});
	});

	// fp-mmt Gaps C+D — share lifecycle audit logging.
	describe("Audit logging (fp-mmt)", () => {
		function readAudits(spy: ReturnType<typeof vi.spyOn>) {
			const calls: Array<Record<string, unknown>> = [];
			for (const call of spy.mock.calls) {
				const first = call[0];
				if (typeof first !== "string") continue;
				try {
					const parsed = JSON.parse(first) as Record<string, unknown>;
					if (parsed?.audit === true) {
						calls.push(parsed);
					}
				} catch {
					// not an audit line
				}
			}
			return calls;
		}

		it("emits share_created on createShareLink success", async () => {
			const spy = vi.spyOn(console, "log");
			try {
				const encodedKey = btoa(testFileName);
				const response = await app.fetch(
					createTestRequest(
						`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
						"POST",
						{ expiresIn: 3600, maxDownloads: 5 },
					),
					env,
					createExecutionContext(),
				);
				expect(response.status).toBe(200);
				const body = (await response.json()) as { shareId: string };

				const audits = readAudits(spy);
				const created = audits.find(
					(a) => a.event === "share_created" && a.shareId === body.shareId,
				);
				expect(created).toBeDefined();
				expect(created).toMatchObject({
					event: "share_created",
					bucket: "MY_TEST_BUCKET_1",
					key: testFileName,
					maxDownloads: 5,
				});
				expect(created?.expiresAt).toBeDefined();
				// P12: never serialize credential material in audit payload.
				const serialized = JSON.stringify(created);
				expect(serialized).not.toContain("passwordHash");
				expect(serialized).not.toContain("passwordSalt");
			} finally {
				spy.mockRestore();
			}
		});

		it("emits share_deleted on deleteShareLink success", async () => {
			// Pre-create a share with a separate (un-spied) call.
			const encodedKey = btoa(testFileName);
			const createResponse = await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{},
				),
				env,
				createExecutionContext(),
			);
			const { shareId } = (await createResponse.json()) as { shareId: string };

			const spy = vi.spyOn(console, "log");
			try {
				const response = await app.fetch(
					createTestRequest(
						`/api/buckets/MY_TEST_BUCKET_1/share/${shareId}`,
						"DELETE",
					),
					env,
					createExecutionContext(),
				);
				expect(response.status).toBe(200);

				const audits = readAudits(spy);
				const deleted = audits.find(
					(a) => a.event === "share_deleted" && a.shareId === shareId,
				);
				expect(deleted).toBeDefined();
				expect(deleted).toMatchObject({
					event: "share_deleted",
					bucket: "MY_TEST_BUCKET_1",
				});
				expect(deleted?.deletedBy).toBeDefined();
			} finally {
				spy.mockRestore();
			}
		});
	});
});

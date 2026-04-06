import { createExecutionContext, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateKey } from "../../src/foundation/utils/validateKey";
import { R2Explorer } from "../../src/index"; // Changed to named import
import type { R2ExplorerEmail } from "../../src/modules/emails/receiveEmail"; // For typing
import { createTestApp, createTestRequest } from "./setup";

// Helper function to create mock email event
function createMockEmailEvent(rawEmailString: string): {
	raw: ReadableStream;
	rawSize: number;
	from: string;
	to: string;
} {
	const encoder = new TextEncoder();
	const rawEmailBytes = encoder.encode(rawEmailString);
	const rawEmailStream = new ReadableStream({
		start(controller) {
			controller.enqueue(rawEmailBytes);
			controller.close();
		},
	});
	// Extract from and to for the mock EmailMessage object
	const fromMatch = rawEmailString.match(/^From: (.*)$/m);
	const toMatch = rawEmailString.match(/^To: (.*)$/m);
	return {
		raw: rawEmailStream,
		rawSize: rawEmailBytes.byteLength,
		from: fromMatch ? fromMatch[1].trim() : "sender@example.com",
		to: toMatch ? toMatch[1].trim() : "receiver@example.com",
	};
}

describe("Email Endpoints", () => {
	describe("SendEmail (POST /api/emails/send)", () => {
		it("should return unavailable when email sending is not configured", async () => {
			const app = createTestApp();
			const request = createTestRequest(
				"/api/emails/send",
				"POST",
				{
					from: "test@example.com",
					to: "recipient@example.com",
					subject: "Test Email",
					content: "This is a test.",
				},
				{ "Content-Type": "application/json" },
			);
			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body).toEqual({ success: false, error: "unavailable" });
		});

		it("should return unauthorized when in readonly mode", async () => {
			const app = createTestApp({ readonly: true });
			const request = createTestRequest(
				"/api/emails/send",
				"POST",
				{
					from: "test@example.com",
					to: "recipient@example.com",
					subject: "Test Email",
					content: "This is a test.",
				},
				{ "Content-Type": "application/json" },
			);
			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(401);
			const body = await response.json();
			expect(body).toEqual({
				success: false,
				errors: [
					{
						code: 10005,
						message:
							"This instance is in ReadOnly Mode, no changes are allowed!",
					},
				],
			});
		});
	});

	describe("receiveEmail (worker email handler)", () => {
		let MY_TEST_BUCKET_1: R2Bucket;
		const BUCKET_NAME = "MY_TEST_BUCKET_1";
		const emailPrefix = ".r2-explorer/emails/inbox/";

		beforeEach(async () => {
			MY_TEST_BUCKET_1 = env.MY_TEST_BUCKET_1;
			if (MY_TEST_BUCKET_1) {
				const listed = await MY_TEST_BUCKET_1.list({ prefix: emailPrefix });
				const keysToDelete = listed.objects.map((obj) => obj.key);
				if (keysToDelete.length > 0) {
					await MY_TEST_BUCKET_1.delete(keysToDelete);
				}
				// Clean up any potential attachments or alternative view files too
				const allListed = await MY_TEST_BUCKET_1.list();
				const allKeysToDelete = allListed.objects
					.filter((o) => o.key.startsWith(emailPrefix))
					.map((o) => o.key);
				if (allKeysToDelete.length > 0) {
					await MY_TEST_BUCKET_1.delete(allKeysToDelete);
				}
			} else {
				console.warn(
					"MY_TEST_BUCKET_1 binding not found in receiveEmail beforeEach.",
				);
			}
		});

		afterEach(async () => {
			if (MY_TEST_BUCKET_1) {
				const listed = await MY_TEST_BUCKET_1.list({ prefix: emailPrefix });
				const keysToDelete = listed.objects.map((obj) => obj.key);
				if (keysToDelete.length > 0) {
					await MY_TEST_BUCKET_1.delete(keysToDelete);
				}
				const allListed = await MY_TEST_BUCKET_1.list();
				const allKeysToDelete = allListed.objects
					.filter((o) => o.key.startsWith(emailPrefix))
					.map((o) => o.key);
				if (allKeysToDelete.length > 0) {
					await MY_TEST_BUCKET_1.delete(allKeysToDelete);
				}
			}
		});

		it("should process and store an email with specified targetBucket", async () => {
			if (!MY_TEST_BUCKET_1)
				throw new Error("MY_TEST_BUCKET_1 not available for test");
			const appInstance = R2Explorer({
				emailRouting: { targetBucket: BUCKET_NAME },
			});

			const rawEmailString =
				"From: test-sender@example.com\nTo: test-receiver@example.com\nSubject: Test Subject 1\n\nThis is the email body.";
			const mockEvent = createMockEmailEvent(rawEmailString);

			await appInstance.email(mockEvent as any, env, createExecutionContext());

			const listed = await MY_TEST_BUCKET_1.list({ prefix: emailPrefix });
			expect(listed.objects.length).toBe(1);
			const emailObjectKey = listed.objects[0].key;
			expect(emailObjectKey.endsWith(".json")).toBe(true);

			const r2Object = await MY_TEST_BUCKET_1.get(emailObjectKey);
			expect(r2Object).not.toBeNull();
			if (!r2Object) return;

			const emailData = (await r2Object.json()) as R2ExplorerEmail;
			expect(emailData.subject).toBe("Test Subject 1");
			// Corrected based on PostalMime structure used in receiveEmail.ts
			expect(emailData.from?.address).toBe("test-sender@example.com");
			expect(emailData.to?.[0]?.address).toBe("test-receiver@example.com");
			expect(emailData.text?.trim()).toBe("This is the email body.");

			expect(r2Object.customMetadata?.subject).toBe("Test Subject 1");
			expect(r2Object.customMetadata?.from_address).toBe(
				"test-sender@example.com",
			);
			expect(r2Object.customMetadata?.to_address).toBe(
				"test-receiver@example.com",
			);
		});

		it("should process and store an email with an attachment", async () => {
			if (!MY_TEST_BUCKET_1)
				throw new Error("MY_TEST_BUCKET_1 not available for test");
			const appInstance = R2Explorer({
				emailRouting: { targetBucket: BUCKET_NAME },
			});

			const rawEmailWithAttachment =
				'From: attachment-sender@example.com\nTo: attachment-receiver@example.com\nSubject: With Attachment\nContent-Type: multipart/mixed; boundary=boundary\n\n--boundary\nContent-Type: text/plain\n\nEmail body.\n--boundary\nContent-Type: text/plain; name="test-attachment.txt"\nContent-Disposition: attachment; filename="test-attachment.txt"\n\nAttachment content.\n--boundary--';
			const mockEvent = createMockEmailEvent(rawEmailWithAttachment);

			await appInstance.email(mockEvent as any, env, createExecutionContext());

			const listed = await MY_TEST_BUCKET_1.list({ prefix: emailPrefix });
			// Expect 2 objects: the .json email and the attachment
			const jsonEmailObject = listed.objects.find((o) =>
				o.key.endsWith(".json"),
			);
			expect(jsonEmailObject).toBeDefined();
			if (!jsonEmailObject) return;

			const emailData = (await (
				await MY_TEST_BUCKET_1.get(jsonEmailObject.key)
			)?.json()) as R2ExplorerEmail;
			expect(emailData.subject).toBe("With Attachment");
			expect(emailData.attachments?.length).toBe(1);
			expect(emailData.attachments?.[0].filename).toBe("test-attachment.txt");

			// Construct expected attachment key based on the main email key
			const emailKeyWithoutExtension = jsonEmailObject.key.substring(
				0,
				jsonEmailObject.key.lastIndexOf(".json"),
			);
			const attachmentKey = `${emailKeyWithoutExtension}/test-attachment.txt`;

			const attachmentObject = await MY_TEST_BUCKET_1.get(attachmentKey);
			expect(attachmentObject).not.toBeNull();
			if (!attachmentObject) return;
			const attachmentText = await attachmentObject.text();
			expect(attachmentText.trim()).toBe("Attachment content.");
		});

		it("should neutralize attachment with percent-encoded traversal in filename", async () => {
			if (!MY_TEST_BUCKET_1)
				throw new Error("MY_TEST_BUCKET_1 not available for test");
			const appInstance = R2Explorer({
				emailRouting: { targetBucket: BUCKET_NAME },
			});

			// sanitizeFilename strips path components and replaces %, so this
			// exercises the defense-in-depth: basename extraction defuses the
			// traversal, and validateKey would catch any residual encoding.
			const rawEmail =
				'From: attacker@example.com\nTo: victim@example.com\nSubject: Malicious\nContent-Type: multipart/mixed; boundary=boundary\n\n--boundary\nContent-Type: text/plain\n\nBody.\n--boundary\nContent-Type: text/plain; name="file%2e%2e/escape.txt"\nContent-Disposition: attachment; filename="file%2e%2e/escape.txt"\n\nEvil content.\n--boundary--';
			const mockEvent = createMockEmailEvent(rawEmail);

			await appInstance.email(mockEvent as any, env, createExecutionContext());

			const listed = await MY_TEST_BUCKET_1.list({ prefix: emailPrefix });
			const attachmentObj = listed.objects.find(
				(o) => !o.key.endsWith(".json"),
			);
			expect(attachmentObj).toBeDefined();
			// The key must not contain traversal or encoded sequences
			expect(attachmentObj!.key).not.toContain("..");
			expect(attachmentObj!.key).not.toMatch(/%[0-9a-fA-F]{2}/);
		});

		it("should reject attachment with control character in filename", async () => {
			if (!MY_TEST_BUCKET_1)
				throw new Error("MY_TEST_BUCKET_1 not available for test");
			const appInstance = R2Explorer({
				emailRouting: { targetBucket: BUCKET_NAME },
			});

			// Control char \x01 in the attachment filename — sanitizeFilename strips it,
			// but the resulting key is still validated by validateKey.
			const rawEmail =
				'From: attacker@example.com\nTo: victim@example.com\nSubject: Control Char\nContent-Type: multipart/mixed; boundary=boundary\n\n--boundary\nContent-Type: text/plain\n\nBody.\n--boundary\nContent-Type: text/plain; name="bad\x01file.txt"\nContent-Disposition: attachment; filename="bad\x01file.txt"\n\nEvil content.\n--boundary--';
			const mockEvent = createMockEmailEvent(rawEmail);

			// sanitizeFilename strips control chars, so this should succeed with a cleaned name
			await appInstance.email(mockEvent as any, env, createExecutionContext());

			const listed = await MY_TEST_BUCKET_1.list({ prefix: emailPrefix });
			const attachmentObj = listed.objects.find(
				(o) => !o.key.endsWith(".json"),
			);
			expect(attachmentObj).toBeDefined();
			// The control char should have been stripped from the key
			expect(attachmentObj!.key).not.toMatch(/[\x00-\x1f]/);
		});

		it("should store normal attachment successfully with validateKey", async () => {
			if (!MY_TEST_BUCKET_1)
				throw new Error("MY_TEST_BUCKET_1 not available for test");
			const appInstance = R2Explorer({
				emailRouting: { targetBucket: BUCKET_NAME },
			});

			const rawEmail =
				'From: sender@example.com\nTo: receiver@example.com\nSubject: Normal PDF\nContent-Type: multipart/mixed; boundary=boundary\n\n--boundary\nContent-Type: text/plain\n\nBody.\n--boundary\nContent-Type: application/pdf; name="normal.pdf"\nContent-Disposition: attachment; filename="normal.pdf"\n\nPDF content.\n--boundary--';
			const mockEvent = createMockEmailEvent(rawEmail);

			await appInstance.email(mockEvent as any, env, createExecutionContext());

			const listed = await MY_TEST_BUCKET_1.list({ prefix: emailPrefix });
			const attachmentObj = listed.objects.find(
				(o) => !o.key.endsWith(".json"),
			);
			expect(attachmentObj).toBeDefined();
			expect(attachmentObj!.key).toContain("normal.pdf");
		});

		it.skip("should process and store an email in the default bucket if targetBucket not specified", async () => {
			if (!MY_TEST_BUCKET_1)
				throw new Error("MY_TEST_BUCKET_1 not available for test");
			// Assuming MY_TEST_BUCKET_1 is discoverable and becomes the default
			const appInstance = R2Explorer({});

			const rawEmailString =
				"From: default-sender@example.com\nTo: default-receiver@example.com\nSubject: Default Bucket Test\n\nDefault body.";
			const mockEvent = createMockEmailEvent(rawEmailString);

			await appInstance.email(mockEvent as any, env, createExecutionContext());

			const listed = await MY_TEST_BUCKET_1.list({ prefix: emailPrefix });
			expect(listed.objects.length).toBe(1);
			const emailObjectKey = listed.objects[0].key;
			expect(emailObjectKey.endsWith(".json")).toBe(true);

			const r2Object = await MY_TEST_BUCKET_1.get(emailObjectKey);
			expect(r2Object).not.toBeNull();
			if (!r2Object) return;
			const emailData = (await r2Object.json()) as R2ExplorerEmail;
			expect(emailData.subject).toBe("Default Bucket Test");
		});
	});
});

describe("validateKey (email-related scenarios)", () => {
	it("rejects percent-encoded dot sequences", () => {
		expect(() => validateKey("files/%2e%2e/etc/passwd")).toThrow(
			"percent-encoded",
		);
	});

	it("rejects percent-encoded slash", () => {
		expect(() => validateKey("files/foo%2fbar")).toThrow("percent-encoded");
	});

	it("rejects literal traversal", () => {
		expect(() => validateKey("files/../etc/passwd")).toThrow("traversal");
	});

	it("rejects control characters", () => {
		expect(() => validateKey("file\x00name")).toThrow("control characters");
	});

	it("rejects backslashes", () => {
		expect(() => validateKey("files\\escape")).toThrow("backslash");
	});

	it("rejects .r2-explorer/ prefix by default", () => {
		expect(() => validateKey(".r2-explorer/emails/test")).toThrow(
			"reserved internal prefix",
		);
	});

	it("allows .r2-explorer/ prefix when allowR2ExplorerPrefix is true", () => {
		expect(
			validateKey(".r2-explorer/emails/test", {
				allowR2ExplorerPrefix: true,
			}),
		).toBe(".r2-explorer/emails/test");
	});

	it("still rejects .trash/ even with allowR2ExplorerPrefix", () => {
		expect(() =>
			validateKey(".trash/malicious", { allowR2ExplorerPrefix: true }),
		).toThrow("reserved internal prefix");
	});

	it("still rejects .versions/ even with allowR2ExplorerPrefix", () => {
		expect(() =>
			validateKey(".versions/malicious", { allowR2ExplorerPrefix: true }),
		).toThrow("reserved internal prefix");
	});

	it("still rejects .operations/ even with allowR2ExplorerPrefix", () => {
		expect(() =>
			validateKey(".operations/malicious", { allowR2ExplorerPrefix: true }),
		).toThrow("reserved internal prefix");
	});

	it("accepts clean keys", () => {
		expect(validateKey("photos/vacation/beach.jpg")).toBe(
			"photos/vacation/beach.jpg",
		);
	});
});

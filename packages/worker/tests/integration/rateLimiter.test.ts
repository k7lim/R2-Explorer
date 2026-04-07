import { createExecutionContext, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, createTestRequest } from "./setup";

// fp-mmt Gap A — authRateLimiter + rate_limited audit events
//
// The in-memory ipRequestCounts Map is module-scoped per isolate. Vitest
// pool-workers uses singleWorker mode (see vitest.config.mts), so the Map
// persists across tests in the same file. Each test uses a unique cf-connecting-ip
// header to avoid bleed.

type AuditCall = {
	audit: boolean;
	event: string;
	timestamp: string;
} & Record<string, unknown>;

function captureAudits(): {
	getCalls: () => AuditCall[];
	restore: () => void;
} {
	const spy = vi.spyOn(console, "log");
	return {
		getCalls: () => {
			const out: AuditCall[] = [];
			for (const call of spy.mock.calls) {
				const first = call[0];
				if (typeof first !== "string") continue;
				try {
					const parsed = JSON.parse(first) as Record<string, unknown>;
					if (parsed && parsed.audit === true) {
						out.push(parsed as AuditCall);
					}
				} catch {
					// not JSON / not an audit line — ignore
				}
			}
			return out;
		},
		restore: () => spy.mockRestore(),
	};
}

async function fireWithIp(
	app: ReturnType<typeof createTestApp>,
	path: string,
	ip: string,
): Promise<Response> {
	const request = createTestRequest(path, "GET", undefined, {
		"cf-connecting-ip": ip,
	});
	return app.fetch(request, env, createExecutionContext());
}

describe("rateLimiter (fp-mmt Gap A)", () => {
	let audits: ReturnType<typeof captureAudits>;

	beforeEach(() => {
		audits = captureAudits();
	});

	afterEach(() => {
		audits.restore();
	});

	describe("authRateLimiter", () => {
		const AUTH_LIMIT = 20;

		it("does not block under the limit", async () => {
			const app = createTestApp({
				basicAuth: { username: "user", password: "pass" },
			});
			const ip = "10.0.0.1";

			// Fire AUTH_LIMIT requests — none should be rate limited.
			for (let i = 0; i < AUTH_LIMIT; i++) {
				const response = await fireWithIp(app, "/api/server/config", ip);
				expect(response.status).not.toBe(429);
			}

			const rateLimited = audits.getCalls().filter(
				(c) => c.event === "rate_limited" && c.scope === "auth",
			);
			expect(rateLimited).toHaveLength(0);
		});

		it("blocks the (limit+1)th request and emits a rate_limited audit", async () => {
			const app = createTestApp({
				basicAuth: { username: "user", password: "pass" },
			});
			const ip = "10.0.0.2";

			let lastResponse: Response | undefined;
			for (let i = 0; i < AUTH_LIMIT + 1; i++) {
				lastResponse = await fireWithIp(app, "/api/server/config", ip);
			}
			expect(lastResponse?.status).toBe(429);

			const rateLimited = audits.getCalls().filter(
				(c) => c.event === "rate_limited" && c.scope === "auth",
			);
			expect(rateLimited.length).toBeGreaterThanOrEqual(1);
			expect(rateLimited[0]).toMatchObject({
				audit: true,
				event: "rate_limited",
				scope: "auth",
				ip,
				limit: AUTH_LIMIT,
			});
		});

		it("does not leak credentials in the audit payload (P12)", async () => {
			const app = createTestApp({
				basicAuth: { username: "user", password: "supersecret" },
			});
			const ip = "10.0.0.3";

			// Fire authorization headers carrying a password — limiter must
			// trip and the audit must NOT echo any credential material.
			for (let i = 0; i < AUTH_LIMIT + 1; i++) {
				const request = createTestRequest(
					"/api/server/config",
					"GET",
					undefined,
					{
						"cf-connecting-ip": ip,
						Authorization: `Basic ${btoa("user:supersecret")}`,
					},
				);
				await app.fetch(request, env, createExecutionContext());
			}

			const rateLimited = audits.getCalls().filter(
				(c) => c.event === "rate_limited" && c.scope === "auth" && c.ip === ip,
			);
			expect(rateLimited.length).toBeGreaterThanOrEqual(1);
			for (const entry of rateLimited) {
				const serialized = JSON.stringify(entry);
				expect(serialized).not.toContain("supersecret");
				expect(serialized).not.toContain("Basic ");
				expect(serialized).not.toContain("password");
			}
		});
	});

	describe("shareRateLimiter", () => {
		const SHARE_LIMIT = 100;

		it("emits a rate_limited audit on the (limit+1)th /share/* request", async () => {
			const app = createTestApp();
			const ip = "10.0.0.4";

			// We don't care about the share-id resolution; non-existent shares
			// return 404 but still pass through the limiter.
			let lastResponse: Response | undefined;
			for (let i = 0; i < SHARE_LIMIT + 1; i++) {
				const request = createTestRequest("/share/none", "POST", {}, {
					"cf-connecting-ip": ip,
				});
				lastResponse = await app.fetch(request, env, createExecutionContext());
			}
			expect(lastResponse?.status).toBe(429);

			const rateLimited = audits.getCalls().filter(
				(c) => c.event === "rate_limited" && c.scope === "share" && c.ip === ip,
			);
			expect(rateLimited.length).toBeGreaterThanOrEqual(1);
			expect(rateLimited[0]).toMatchObject({
				audit: true,
				event: "rate_limited",
				scope: "share",
				ip,
				limit: SHARE_LIMIT,
			});
		});
	});
});

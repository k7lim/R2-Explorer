---
"r2-explorer": minor
---

Add `authRateLimiter` middleware (20 requests/minute per IP) on `/api/*` so password-spraying attempts hit a wall before reaching the basic-auth verifier. Both `authRateLimiter` and the existing `shareRateLimiter` now emit a `rate_limited` audit event on every 429 (P17 — rails need breadcrumbs). The `share_created` and `share_deleted` audit events are now emitted from `createShareLink` and `deleteShareLink` (VULN-38). `getShareLink` prefers the `config.buckets` allowlist when configured to avoid probing unrelated bindings (VULN-26 hardening). Audit payloads never include credential material (P12).

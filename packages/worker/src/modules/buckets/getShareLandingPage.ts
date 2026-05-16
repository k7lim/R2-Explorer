import type { Context } from "hono";
import type { AppEnv, AppVariables, ShareMetadata } from "../../types";

function generateNonce(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export async function getShareLandingPage(
	c: Context<{ Bindings: AppEnv; Variables: AppVariables }>,
) {
	const shareId = c.req.param("shareId");

	// Validate shareId is a hex string to prevent XSS via URL path injection
	if (!shareId || !/^[0-9a-f]+$/.test(shareId)) {
		return c.html(errorPage("Not Found", "Invalid share link."), 404);
	}

	// Look up share metadata to determine file name and whether password is required
	const configBuckets = c.get("config")?.buckets;
	const candidates: Array<[string, unknown]> = configBuckets
		? Object.keys(configBuckets).map((name) => [name, c.env[name]])
		: Object.entries(c.env);

	let shareMetadata: ShareMetadata | null = null;

	for (const [_key, value] of candidates) {
		if (
			!value ||
			typeof value !== "object" ||
			(value as { constructor: { name: string } }).constructor.name !==
				"R2Bucket"
		) {
			continue;
		}

		const currentBucket = value as R2Bucket;
		const shareObject = await currentBucket.get(
			`.r2-explorer/sharable-links/${shareId}.json`,
		);

		if (shareObject) {
			shareMetadata = JSON.parse(await shareObject.text()) as ShareMetadata;
			break;
		}
	}

	if (!shareMetadata) {
		return c.html(
			errorPage("Not Found", "This share link does not exist."),
			404,
		);
	}

	if (shareMetadata.expiresAt && Date.now() > shareMetadata.expiresAt) {
		return c.html(
			errorPage("Link Expired", "This share link has expired."),
			410,
		);
	}

	if (
		shareMetadata.maxDownloads &&
		shareMetadata.currentDownloads >= shareMetadata.maxDownloads
	) {
		return c.html(
			errorPage("Unavailable", "This file has reached its download limit."),
			403,
		);
	}

	const fileName = shareMetadata.key.split("/").pop() || "download";
	const needsPassword = !!shareMetadata.passwordHash;

	const nonce = generateNonce();
	// Override the global CSP for this response to allow our nonced script
	c.header(
		"Content-Security-Policy",
		`default-src 'self'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self' blob:`,
	);

	return c.html(landingPage(shareId, fileName, needsPassword, nonce));
}

function pageShell(title: string, body: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - FilePilot</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; color: #333; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); padding: 2.5rem; max-width: 420px; width: 90%; text-align: center; }
  .icon { font-size: 2.5rem; margin-bottom: 1rem; }
  h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
  .filename { font-size: 0.95rem; color: #666; word-break: break-all; margin-bottom: 1.5rem; }
  .error-msg { color: #666; margin-top: 0.5rem; }
  input[type="password"] { width: 100%; padding: 0.6rem 0.8rem; border: 1px solid #ddd; border-radius: 6px; font-size: 0.95rem; margin-bottom: 1rem; }
  input[type="password"]:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.15); }
  button { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 0.65rem 1.5rem; font-size: 0.95rem; cursor: pointer; width: 100%; }
  button:hover { background: #1d4ed8; }
  button:disabled { background: #93c5fd; cursor: not-allowed; }
  .error { color: #dc2626; font-size: 0.85rem; margin-bottom: 0.75rem; min-height: 1.2em; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function errorPage(title: string, message: string): string {
	return pageShell(
		title,
		`
<div class="card">
  <div class="icon">&#128683;</div>
  <h1>${title}</h1>
  <p class="error-msg">${message}</p>
</div>`,
	);
}

function landingPage(
	shareId: string,
	fileName: string,
	needsPassword: boolean,
	nonce: string,
): string {
	const escapedFileName = fileName
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

	const passwordField = needsPassword
		? `<input type="password" id="password" placeholder="Enter password" autocomplete="off" autofocus>
       <div class="error" id="error"></div>`
		: `<div class="error" id="error"></div>`;

	return pageShell(
		`Download ${escapedFileName}`,
		`
<div class="card">
  <div class="icon">&#128230;</div>
  <h1>Shared File</h1>
  <p class="filename">${escapedFileName}</p>
  ${passwordField}
  <button id="btn">${needsPassword ? "Unlock & Download" : "Download"}</button>
</div>
<script nonce="${nonce}">
document.getElementById("btn").addEventListener("click", async function() {
  const btn = this;
  const errEl = document.getElementById("error");
  if (errEl) errEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Downloading\u2026";

  const body = {};
  const pwInput = document.getElementById("password");
  if (pwInput && pwInput.value) {
    body.password = pwInput.value;
  }

  try {
    const res = await fetch("/share/${shareId}", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      if (errEl) errEl.textContent = "Incorrect password. Please try again.";
      btn.disabled = false;
      btn.textContent = "Unlock & Download";
      if (pwInput) { pwInput.value = ""; pwInput.focus(); }
      return;
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || "Download failed");
    }

    // Extract filename from Content-Disposition header
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const name = match ? decodeURIComponent(match[1]) : ${JSON.stringify(fileName)};

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    btn.textContent = "Downloaded!";
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
    else alert(e.message);
    btn.disabled = false;
    btn.textContent = ${JSON.stringify(needsPassword ? "Unlock & Download" : "Download")};
  }
});
</script>`,
	);
}

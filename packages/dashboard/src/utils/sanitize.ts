import DOMPurify from "dompurify";

const ALLOWED_TAGS = [
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"p",
	"br",
	"hr",
	"ul",
	"ol",
	"li",
	"blockquote",
	"pre",
	"code",
	"strong",
	"em",
	"del",
	"b",
	"i",
	"u",
	"a",
	"img",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
	"div",
	"span",
];

const ALLOWED_ATTR = [
	"href",
	"src",
	"alt",
	"title",
	"class",
	"target",
	"rel",
	"width",
	"height",
];

/**
 * Sanitize HTML using DOMPurify with a strict allowlist.
 */
export function sanitizeHtml(dirty: string): string {
	return DOMPurify.sanitize(dirty, {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
	});
}

/**
 * Escape HTML special characters to prevent injection.
 */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

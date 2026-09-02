import DOMPurify from "dompurify";

/**
 * Single sanitization entry point for HTML produced from user/LLM markdown
 * content. Strips scripts, event handlers, and javascript: URLs while
 * preserving standard formatting markup.
 *
 * Fails closed: throws rather than returning unsanitized HTML if DOMPurify
 * cannot run (e.g. no DOM — SSR/non-browser environments).
 */
export function sanitizeHtml(html: string): string {
  if (!DOMPurify.isSupported) {
    throw new Error("sanitizeHtml requires a DOM environment to sanitize safely; refusing to return unsanitized HTML.");
  }
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p", "br", "hr",
      "strong", "em", "del", "code", "pre",
      "a", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "blockquote",
      "table", "thead", "tbody", "tr", "th", "td",
      "sup", "sub", "span",
    ],
    ALLOWED_ATTR: ["href", "rel", "class"],
  });
}

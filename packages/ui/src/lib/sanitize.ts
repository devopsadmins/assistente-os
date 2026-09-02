import DOMPurify from "dompurify";

/**
 * Single sanitization entry point for HTML produced from user/LLM markdown
 * content. Strips scripts, event handlers, and javascript: URLs while
 * preserving standard formatting markup.
 */
export function sanitizeHtml(html: string): string {
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
    ALLOWED_ATTR: ["href", "target", "rel", "class", "data-citation-index"],
  });
}

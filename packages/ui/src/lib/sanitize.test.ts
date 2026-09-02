import { describe, expect, test } from "vitest";
import DOMPurify from "dompurify";
import { sanitizeHtml } from "./sanitize";

describe("sanitizeHtml", () => {
  test("strips <script> tags entirely", () => {
    const dirty = '<p>hello</p><script>alert("xss")</script>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("alert");
    expect(clean).toContain("<p>hello</p>");
  });

  test("strips inline event handler attributes", () => {
    const dirty = '<img src="x" onerror="alert(1)">';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("onerror");
  });

  test("strips javascript: URLs from links", () => {
    const dirty = '<a href="javascript:alert(1)">click</a>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("javascript:");
  });

  test("preserves safe formatting tags and attributes", () => {
    const safe = '<p>Some <strong>bold</strong> and <a href="https://example.com">a link</a>.</p>';
    const clean = sanitizeHtml(safe);
    expect(clean).toContain("<strong>bold</strong>");
    expect(clean).toContain('href="https://example.com"');
  });

  test("throws instead of returning unsanitized HTML when DOMPurify cannot run", () => {
    // DOMPurify.isSupported is a plain writable data property on the module
    // singleton (not a getter/setter), so it isn't spyable via
    // `vi.spyOn(obj, key, "get")` — flip it directly with defineProperty and
    // restore it afterward.
    const original = Object.getOwnPropertyDescriptor(DOMPurify, "isSupported");
    Object.defineProperty(DOMPurify, "isSupported", { value: false, configurable: true, writable: true });
    try {
      expect(() => sanitizeHtml("<p>x</p>")).toThrow(/requires a DOM/);
    } finally {
      if (original) {
        Object.defineProperty(DOMPurify, "isSupported", original);
      }
    }
  });
});

# A2b-1: Markdown, CodeBlock, Citation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the content-rendering trio from A1's product-component inventory — `Markdown`, `CodeBlock`, `Citation` — as real, tested, sanitized components in `@assistente-os/ui`. This is sub-project A2b's first slice; `Message`/`StreamingText`/`MessageList` (A2b-2) will compose these once they land.

**Architecture:** `Markdown` tokenizes its source with `marked.lexer()` and renders each top-level token as a React element: `code` tokens become a real `<CodeBlock>` element (no HTML-string round-trip), every other token's HTML is produced by `marked.parser([token])`, sanitized with `DOMPurify.sanitize()`, and mounted via one small internal `dangerouslySetInnerHTML` wrapper. `CodeBlock` is a standalone, un-highlighted (plain monospace) code block with a copy button and language badge — colorized syntax highlighting is explicitly deferred (see Global Constraints). `Citation` is a standalone chip+Popover component for direct use; inside `Markdown`, a `[[n]]` marker renders as a static, non-interactive `<sup>` — full interactive citations embedded in sanitized HTML are deferred to the same backlog item as highlighting.

**Tech Stack:** React 19, TypeScript, `marked` (markdown tokenizer/renderer), `dompurify` (HTML sanitizer), existing `@assistente-os/ui` primitives (`Popover`, `Button`), Vitest + Testing Library + `axe-core`.

**Spec:** `docs/superpowers/specs/2026-09-01-design-system-packages-ui-design.md` (§4 component inventory names `Markdown`, `CodeBlock`, `Citation` as product components; §7 / ADR-UI-001 already allowlists `marked` and `dompurify` for the `packages/ui` frontend zone).

## Global Constraints

- Every component that renders its own DOM element uses `React.forwardRef` and spreads `{...props}` with `className` composed via `cn(...)` **last** (established pattern from A2a).
- New dependencies come only from ADR-UI-001's frontend allowlist (`.github/scripts/deps-zones.mjs`'s `FRONTEND_ALLOW`): `marked` and `dompurify` are already listed — no ADR amendment needed for this plan.
- **No colorized syntax highlighting in this plan.** `CodeBlock` renders plain monospace text with a copy button and a language badge. Real tokenized highlighting (`shiki`, already pre-approved in the allowlist) is out of scope here — tracked as `DS10` in `docs/BACKLOG-DESIGN-SYSTEM.md` (added by Task 3's commit).
- **No interactive citations embedded inside `Markdown`'s sanitized HTML in this plan.** `Markdown` renders `[[n]]` as a static `<sup>` marker (no click/popover). The standalone `Citation` component (chip + Popover) is real and interactive, but is not wired into `Markdown`'s HTML output — also tracked as `DS10`.
- Every new component ships a Ladle story (`*.stories.tsx`) — this closes the story-completeness gap flagged during A2a (`docs/BACKLOG-DESIGN-SYSTEM.md`, resolved pattern: write the story in the same task as the component, never a follow-up).
- Every interactive component (`CodeBlock`'s copy button, `Citation`'s trigger) gets an `expectNoA11yViolations` smoke test using the shared helper at `src/test/axe.ts` — import it directly from that path (`../test/axe`), never from the package barrel (`src/index.ts` does **not** re-export it — this was a deliberate A2a final-review fix to keep `axe-core`/`vitest` out of consumer bundles).
- `Markdown` MUST be tested against a raw `<script>`/`onerror=` XSS payload to prove sanitization actually strips it — this is the component's core safety property, not incidental coverage.
- Barrel exports go in `src/index.ts`, appended after the existing `ScrollArea`/`Toaster`/`useToast` exports, in task order.
- Any `npm install` that touches `package-lock.json` MUST have that lockfile diff committed in the same commit as the `package.json` change — omitting it is an automatic review rejection (established in every A2a task from Task 3 onward).
- Run `npm test`, `npm run typecheck`, and `npm run catalog:build` (all from `packages/ui`) before every commit that touches source files.

---

## File Structure

- `packages/ui/package.json` — add `marked`, `dompurify` (and `@types/dompurify` is not needed; `dompurify` ships its own types since v3).
- `packages/ui/src/lib/sanitize.ts` — tiny shared `sanitizeHtml(html: string): string` wrapper around `DOMPurify.sanitize`, so both `Markdown` and any future consumer call the same configured instance.
- `packages/ui/src/lib/sanitize.test.ts` — unit tests for the wrapper (XSS stripping, allowed tags survive).
- `packages/ui/src/components/code-block.tsx` — `CodeBlock` component.
- `packages/ui/src/components/code-block.test.tsx`
- `packages/ui/src/components/code-block.stories.tsx`
- `packages/ui/src/components/markdown.tsx` — `Markdown` component (consumes `CodeBlock`, `sanitizeHtml`).
- `packages/ui/src/components/markdown.test.tsx`
- `packages/ui/src/components/markdown.stories.tsx`
- `packages/ui/src/components/citation.tsx` — `Citation` component (consumes `Popover`/`PopoverTrigger`/`PopoverContent`).
- `packages/ui/src/components/citation.test.tsx`
- `packages/ui/src/components/citation.stories.tsx`
- `packages/ui/src/index.ts` — barrel additions.
- `docs/BACKLOG-DESIGN-SYSTEM.md` — add `DS10` (highlighting + interactive-citations-in-markdown deferral), append a Rastreio de mudança row.

---

## Task 1: `sanitizeHtml` wrapper + `CodeBlock`

**Files:**
- Create: `packages/ui/src/lib/sanitize.ts`
- Create: `packages/ui/src/lib/sanitize.test.ts`
- Create: `packages/ui/src/components/code-block.tsx`
- Create: `packages/ui/src/components/code-block.test.tsx`
- Create: `packages/ui/src/components/code-block.stories.tsx`
- Modify: `packages/ui/package.json` (add `marked`, `dompurify`)
- Modify: `packages/ui/src/index.ts` (export `CodeBlock`)

**Interfaces:**
- Produces: `sanitizeHtml(html: string): string` from `../lib/sanitize`, used by Task 2's `Markdown`.
- Produces: `CodeBlock` React component, `export interface CodeBlockProps { code: string; lang?: string; className?: string }`, used directly by Task 2's `Markdown` (as a real element, not HTML).

- [ ] **Step 1: Install dependencies**

```bash
cd packages/ui
npm install marked@14.1.4 dompurify@3.2.3
```

Verify `package.json` now lists both under `"dependencies"` and that `package-lock.json` at the repo root changed. Both commands' exact versions above are what to pin — if `npm install` resolves different patch versions because those exact versions are no longer available, use whatever it resolves and note the actual versions in your report; do not hand-edit the lockfile.

- [ ] **Step 2: Write the failing test for `sanitizeHtml`**

```typescript
// packages/ui/src/lib/sanitize.test.ts
import { describe, expect, test } from "vitest";
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
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/sanitize.test.ts`
Expected: FAIL — `sanitize.ts` does not exist yet (`Cannot find module './sanitize'`).

- [ ] **Step 4: Implement `sanitizeHtml`**

```typescript
// packages/ui/src/lib/sanitize.ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/sanitize.test.ts`
Expected: PASS (4/4)

- [ ] **Step 6: Write the failing tests for `CodeBlock`**

```typescript
// packages/ui/src/components/code-block.test.tsx
import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodeBlock } from "./code-block";
import { expectNoA11yViolations } from "../test/axe";

test("renders the code text verbatim inside a monospace block", () => {
  render(<CodeBlock code="const x = 1;" lang="ts" />);
  expect(screen.getByText("const x = 1;")).toBeInTheDocument();
});

test("shows the language badge when lang is provided", () => {
  render(<CodeBlock code="const x = 1;" lang="ts" />);
  expect(screen.getByText("ts")).toBeInTheDocument();
});

test("omits the language badge when lang is absent", () => {
  render(<CodeBlock code="plain text" />);
  expect(screen.queryByText("ts")).not.toBeInTheDocument();
});

test("copy button writes the exact code to the clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  const user = userEvent.setup({ pointerEventsCheck: 0 });

  render(<CodeBlock code="const x = 1;" lang="ts" />);
  await user.click(screen.getByRole("button", { name: /copiar código/i }));

  expect(writeText).toHaveBeenCalledWith("const x = 1;");
});

test("renders text content safely even when the code string contains HTML-like syntax", () => {
  render(<CodeBlock code="<script>alert(1)</script>" />);
  expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
});

test("has no a11y violations", async () => {
  const { container } = render(<CodeBlock code="const x = 1;" lang="ts" />);
  await expectNoA11yViolations(container);
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx vitest run src/components/code-block.test.tsx`
Expected: FAIL — `code-block.tsx` does not exist.

- [ ] **Step 8: Implement `CodeBlock`**

```tsx
// packages/ui/src/components/code-block.tsx
import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";

export interface CodeBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  code: string;
  lang?: string;
}

export const CodeBlock = React.forwardRef<HTMLDivElement, CodeBlockProps>(
  ({ code, lang, className, ...props }, ref) => {
    const [copied, setCopied] = React.useState(false);

    const handleCopy = React.useCallback(() => {
      navigator.clipboard.writeText(code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    }, [code]);

    return (
      <div
        ref={ref}
        className={cn("group relative overflow-hidden rounded-md border border-border bg-muted", className)}
        {...props}
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-xs text-muted-foreground">{lang ?? ""}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            aria-label="Copiar código"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <pre className="overflow-x-auto p-3">
          <code className="font-mono text-sm text-foreground">{code}</code>
        </pre>
      </div>
    );
  },
);
CodeBlock.displayName = "CodeBlock";
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run src/components/code-block.test.tsx`
Expected: PASS (6/6)

- [ ] **Step 10: Write the Ladle story**

```tsx
// packages/ui/src/components/code-block.stories.tsx
import type { Story } from "@ladle/react";
import { CodeBlock } from "./code-block";

export const Default: Story = () => (
  <CodeBlock lang="ts" code={"function greet(name: string) {\n  return `Hello, ${name}!`;\n}"} />
);

export const NoLanguage: Story = () => <CodeBlock code="plain text without a language tag" />;
```

- [ ] **Step 11: Export from the barrel**

In `packages/ui/src/index.ts`, after the `useToast` export line, add:

```typescript
export { CodeBlock, type CodeBlockProps } from "./components/code-block";
```

- [ ] **Step 12: Run full checks**

```bash
npm test
npm run typecheck
npm run catalog:build
```

Expected: all green.

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json src/lib/sanitize.ts src/lib/sanitize.test.ts \
  src/components/code-block.tsx src/components/code-block.test.tsx src/components/code-block.stories.tsx \
  src/index.ts
git commit -m "feat(ui): sanitizeHtml wrapper + CodeBlock (plain, copy button, lang badge)"
```

(Run `git add` from `packages/ui/`, or prefix each path with `packages/ui/` if committing from the repo root — confirm your cwd with `git status --porcelain` before staging, since a path mismatch silently stages nothing.)

---

## Task 2: `Markdown`

**Files:**
- Create: `packages/ui/src/components/markdown.tsx`
- Create: `packages/ui/src/components/markdown.test.tsx`
- Create: `packages/ui/src/components/markdown.stories.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `sanitizeHtml(html: string): string` from `../lib/sanitize` (Task 1). `CodeBlock` from `./code-block` (Task 1), used as `<CodeBlock code={...} lang={...} />`.
- Produces: `Markdown` component, `export interface MarkdownProps { source: string; className?: string }`, consumed by A2b-2's `Message` (future plan, not this one).

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/ui/src/components/markdown.test.tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./markdown";

test("renders headings, bold, and links", () => {
  render(<Markdown source={"# Title\n\nSome **bold** text with a [link](https://example.com)."} />);
  expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
  expect(screen.getByText("bold")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "link" })).toHaveAttribute("href", "https://example.com");
});

test("renders GFM tables and strikethrough", () => {
  const source = "~~gone~~\n\n| A | B |\n| - | - |\n| 1 | 2 |";
  render(<Markdown source={source} />);
  expect(screen.getByText("gone").tagName).toBe("DEL");
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getByText("1")).toBeInTheDocument();
});

test("renders a fenced code block as a real CodeBlock element with a working copy button", () => {
  render(<Markdown source={"```ts\nconst x = 1;\n```"} />);
  expect(screen.getByText("const x = 1;")).toBeInTheDocument();
  expect(screen.getByText("ts")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /copiar código/i })).toBeInTheDocument();
});

test("sanitizes a raw <script> injection attempt embedded in the source", () => {
  const { container } = render(<Markdown source={'Hello <script>window.__pwned = true;</script> world'} />);
  expect(container.querySelector("script")).toBeNull();
  expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
});

test("renders a [[n]] citation marker as a static, non-interactive superscript", () => {
  render(<Markdown source={"Some claim [[1]] follows."} />);
  const marker = screen.getByText("1");
  expect(marker.tagName).toBe("SUP");
  expect(marker).not.toHaveAttribute("role", "button");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/markdown.test.tsx`
Expected: FAIL — `markdown.tsx` does not exist.

- [ ] **Step 3: Implement `Markdown`**

```tsx
// packages/ui/src/components/markdown.tsx
import * as React from "react";
import { marked, type Token } from "marked";
import { cn } from "../lib/cn";
import { sanitizeHtml } from "../lib/sanitize";
import { CodeBlock } from "./code-block";

export interface MarkdownProps {
  source: string;
  className?: string;
}

const CITATION_MARKER = /\[\[(\d+)\]\]/g;

function renderCitationMarkers(html: string): string {
  return html.replace(CITATION_MARKER, (_match, index: string) => `<sup class="ds-citation-marker">${index}</sup>`);
}

function HtmlBlock({ html }: { html: string }) {
  const safe = sanitizeHtml(renderCitationMarkers(html));
  // eslint-disable-next-line react/no-danger -- sanitized via DOMPurify above
  return <div dangerouslySetInnerHTML={{ __html: safe }} />;
}

export function Markdown({ source, className }: MarkdownProps) {
  const tokens = React.useMemo(() => marked.lexer(source, { gfm: true }), [source]);

  return (
    <div className={cn("ds-markdown space-y-3 text-sm text-foreground", className)}>
      {tokens.map((token: Token, index: number) =>
        token.type === "code" ? (
          <CodeBlock key={index} code={token.text} lang={token.lang || undefined} />
        ) : (
          <HtmlBlock key={index} html={marked.parser([token])} />
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/markdown.test.tsx`
Expected: PASS (5/5)

- [ ] **Step 5: Write the Ladle story**

```tsx
// packages/ui/src/components/markdown.stories.tsx
import type { Story } from "@ladle/react";
import { Markdown } from "./markdown";

const SAMPLE = `# Relatório

Um resumo com **destaque**, um [link](https://example.com) e uma citação [[1]].

- item um
- item dois

\`\`\`ts
function soma(a: number, b: number) {
  return a + b;
}
\`\`\`

| Métrica | Valor |
| --- | --- |
| Latência | 120ms |
`;

export const Default: Story = () => <Markdown source={SAMPLE} className="max-w-xl" />;
```

- [ ] **Step 6: Export from the barrel**

In `packages/ui/src/index.ts`, after the `CodeBlock` export, add:

```typescript
export { Markdown, type MarkdownProps } from "./components/markdown";
```

- [ ] **Step 7: Run full checks**

```bash
npm test
npm run typecheck
npm run catalog:build
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/components/markdown.tsx src/components/markdown.test.tsx src/components/markdown.stories.tsx src/index.ts
git commit -m "feat(ui): Markdown — token-level rendering with sanitized HTML + real CodeBlock elements"
```

---

## Task 3: `Citation` + backlog entry

**Files:**
- Create: `packages/ui/src/components/citation.tsx`
- Create: `packages/ui/src/components/citation.test.tsx`
- Create: `packages/ui/src/components/citation.stories.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `docs/BACKLOG-DESIGN-SYSTEM.md` (add `DS10`)

**Interfaces:**
- Consumes: `Popover`, `PopoverTrigger`, `PopoverContent` from `./popover` (existing, from A2a). `PopoverContent` requires `aria-label` or `aria-labelledby` — `Citation` supplies one internally.
- Produces: `Citation` component, `export interface CitationSource { title: string; url?: string; snippet?: string }`, `export interface CitationProps { index: number; source: CitationSource; className?: string }`. Standalone — not wired into `Markdown` in this plan (see Global Constraints / `DS10`).

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/ui/src/components/citation.test.tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Citation } from "./citation";
import { expectNoA11yViolations } from "../test/axe";

const source = { title: "Relatório de vendas Q3", url: "https://example.com/q3", snippet: "Crescimento de 12%." };

test("renders the citation index as a chip", () => {
  render(<Citation index={1} source={source} />);
  expect(screen.getByRole("button", { name: /citação 1/i })).toBeInTheDocument();
});

test("opens a popover with the source title and snippet on click", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<Citation index={1} source={source} />);

  await user.click(screen.getByRole("button", { name: /citação 1/i }));

  expect(await screen.findByText("Relatório de vendas Q3")).toBeInTheDocument();
  expect(screen.getByText("Crescimento de 12%.")).toBeInTheDocument();
});

test("renders the source link when a url is provided", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<Citation index={1} source={source} />);
  await user.click(screen.getByRole("button", { name: /citação 1/i }));

  expect(await screen.findByRole("link", { name: "Relatório de vendas Q3" })).toHaveAttribute(
    "href",
    "https://example.com/q3",
  );
});

test("omits the link when the source has no url", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<Citation index={2} source={{ title: "Nota interna" }} />);
  await user.click(screen.getByRole("button", { name: /citação 2/i }));

  expect(await screen.findByText("Nota interna")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

test("has no a11y violations", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const { container } = render(<Citation index={1} source={source} />);
  await expectNoA11yViolations(container);
  await user.click(screen.getByRole("button", { name: /citação 1/i }));
  await screen.findByText("Relatório de vendas Q3");
  await expectNoA11yViolations(container);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/citation.test.tsx`
Expected: FAIL — `citation.tsx` does not exist.

- [ ] **Step 3: Implement `Citation`**

```tsx
// packages/ui/src/components/citation.tsx
import * as React from "react";
import { cn } from "../lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export interface CitationSource {
  title: string;
  url?: string;
  snippet?: string;
}

export interface CitationProps {
  index: number;
  source: CitationSource;
  className?: string;
}

export function Citation({ index, source, className }: CitationProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Citação ${index}`}
          className={cn(
            "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1.5",
            "text-xs font-medium text-secondary-foreground",
            "hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {index}
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={`Detalhe da citação ${index}`} className="w-64 space-y-1">
        {source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            {source.title}
          </a>
        ) : (
          <p className="text-sm font-medium">{source.title}</p>
        )}
        {source.snippet ? <p className="text-xs text-muted-foreground">{source.snippet}</p> : null}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/citation.test.tsx`
Expected: PASS (5/5)

- [ ] **Step 5: Write the Ladle story**

```tsx
// packages/ui/src/components/citation.stories.tsx
import type { Story } from "@ladle/react";
import { Citation } from "./citation";

export const WithLink: Story = () => (
  <p className="text-sm">
    Crescimento de receita no trimestre <Citation index={1} source={{ title: "Relatório Q3", url: "https://example.com/q3", snippet: "Crescimento de 12% ano a ano." }} />.
  </p>
);

export const WithoutLink: Story = () => (
  <p className="text-sm">
    Conforme registrado em ata <Citation index={2} source={{ title: "Ata da reunião de 2026-08-30" }} />.
  </p>
);
```

- [ ] **Step 6: Export from the barrel**

In `packages/ui/src/index.ts`, after the `Markdown` export, add:

```typescript
export { Citation, type CitationProps, type CitationSource } from "./components/citation";
```

- [ ] **Step 7: Add `DS10` to the design-system backlog**

Read `docs/BACKLOG-DESIGN-SYSTEM.md` first to match its existing board-table and per-item format exactly. Add a board row (P2, effort medium, depende: A2b-1) and a full item write-up along these lines (adjust prose to match the doc's established voice):

- **Objetivo:** `CodeBlock` ganha destaque de sintaxe real (via `shiki`, já pré-aprovado no allowlist) e `Markdown` passa a renderizar marcadores `[[n]]` como `<Citation>` interativos de verdade, não como `<sup>` estático.
- **Estado atual:** `CodeBlock` renderiza texto monoespaçado sem cor; `Markdown` renderiza `[[n]]` como texto estático sem popover.
- **Gap:** nenhum componente interativo (Popover) pode ser montado dentro de HTML produzido via `dangerouslySetInnerHTML` sem uma estratégia de delegação de evento + âncora virtual do Radix Popper (`virtualRef`) — decisão de design deliberadamente adiada em A2b-1 para não acoplar essa complexidade ao primeiro corte.
- **Aceitação:** highlight de sintaxe visível em pelo menos 3 linguagens testadas; clique em `[[n]]` dentro de um `<Markdown>` abre o mesmo Popover que `<Citation>` usa isoladamente.
- **Arquivos:** `packages/ui/src/components/code-block.tsx`, `packages/ui/src/components/markdown.tsx`, `packages/ui/src/components/citation.tsx`.
- **Relacionado:** A2b-1 (`docs/superpowers/plans/2026-09-02-design-system-content-components.md`).

Also append a row to the doc's "Rastreio de mudança" table noting DS10 was added.

- [ ] **Step 8: Run full checks**

```bash
npm test
npm run typecheck
npm run catalog:build
```

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/components/citation.tsx src/components/citation.test.tsx src/components/citation.stories.tsx src/index.ts \
  ../../docs/BACKLOG-DESIGN-SYSTEM.md
git commit -m "feat(ui): Citation (chip + Popover); docs(backlog): DS10 — syntax highlight + interactive citations-in-markdown"
```

---

## Self-Review Notes

- **Spec coverage:** A1 spec §4 names `Markdown`, `CodeBlock`, `Citation` — all three implemented. Colorized highlighting and citation-in-markdown interactivity are named exclusions (Global Constraints), tracked as `DS10`, not silent gaps.
- **Type consistency:** `CodeBlockProps` (Task 1) is consumed identically in `Markdown` (Task 2: `code`, `lang`). `CitationSource`/`CitationProps` (Task 3) are self-contained, not consumed elsewhere in this plan.
- **No placeholders:** every step ships literal code, not descriptions.
- **XSS coverage:** `sanitize.test.ts` (Task 1) and `markdown.test.tsx` (Task 2) both assert against real injection payloads, not just "renders safely" hand-waving.

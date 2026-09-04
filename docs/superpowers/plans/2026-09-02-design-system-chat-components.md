# A2b-2: Message, MessageList, StreamingText Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the chat-turn trio from the design system's product-component inventory — `Message`, `MessageList`, `StreamingText` — as real, tested components in `@assistente-os/ui`. This is sub-project A2b's second slice; A2b-1 (`Markdown`/`CodeBlock`/`Citation`, already in `main`) supplies the content-rendering primitives these three compose. Sub-project B's `ThreadScreen` (spec §4 of the app-redesign design) is the eventual consumer — not part of this plan.

**Architecture:** `Message` is a role-styled turn wrapper (avatar/content/footer slots, `user` right-aligned vs `assistant` left-aligned, chat-bubble tokens from `tokens.css`). `MessageList` wraps `ScrollArea` (using the `viewportRef` DS1 added), auto-scrolls to the newest turn on mount, and re-follows new content via a `MutationObserver` on its content wrapper — but only while the reader hasn't scrolled away, surfacing a "jump to latest" button when they have. `StreamingText` joins a `chunks: string[]` prop into one string and renders it through the existing `Markdown` component, with a blinking caret appended after it; `Markdown`'s tokenizer already tolerates incomplete/malformed input (unclosed fences, unclosed emphasis) without throwing, which is what "streams safely" rests on here — this plan adds no new parsing logic, just proves that tolerance holds under realistic partial-chunk inputs.

**Tech Stack:** React 19, TypeScript, existing `@assistente-os/ui` primitives (`ScrollArea`, `Button`, `Avatar`) and `Markdown`/`Citation` (from A2b-1), `lucide-react` (already a dependency) for icons, Vitest + Testing Library + `axe-core`.

**Spec:** `docs/superpowers/specs/2026-09-01-design-system-packages-ui-design.md` (§4 component inventory — the `MessageList`/`Message`/`StreamingText` rows — and §5/§6 for the catalog and testing conventions this plan follows).

## Global Constraints

- Every component that renders its own DOM element uses `React.forwardRef` and spreads `{...props}` with `className` composed via `cn(...)` **last** (established pattern from A2a). A2b-1's `Markdown`/`Citation` skipped this — tracked as a gap in `DS7` of `docs/BACKLOG-DESIGN-SYSTEM.md` — this plan does not repeat it.
- No new dependencies. `Message`, `MessageList`, `StreamingText` are built entirely from existing `@assistente-os/ui` primitives and `Markdown` (A2b-1). Icons come from `lucide-react`, already installed.
- Every new component ships a Ladle story (`*.stories.tsx`) covering real variants and states per spec §5 (not just a bare default) — written in the same task as the component.
- `jsdom` in this repo stubs `ResizeObserver` as a no-op (see `packages/ui/vitest.setup.ts`) but implements `MutationObserver` natively. `MessageList`'s auto-follow-on-new-content uses `MutationObserver` specifically so the behavior is unit-testable, not `ResizeObserver`.
- `scrollHeight`/`clientHeight` are always `0` in `jsdom` (no real layout engine). Tests that need scroll geometry stub them via `vi.spyOn(Element.prototype, "scrollHeight"/"clientHeight", "get")`, restored with `vi.restoreAllMocks()` in `afterEach` — the same "mock the platform gap, restore after" discipline already used for the clipboard mock in `code-block.test.tsx`.
- `expectNoA11yViolations` (from `../test/axe`, never the package barrel — established in A2a) is required only where a component has its own interactive/focusable surface: `MessageList`'s "jump to latest" button qualifies. `Message` and `StreamingText` are content-display components with no interactive element of their own — same category as `Markdown` (A2b-1), which also carries no axe test — so neither gets one here.
- Barrel exports go in `src/index.ts`, appended after the existing `Citation` export, in task order.
- Run `npm test`, `npm run typecheck`, and `npm run catalog:build` (all from `packages/ui`) before every commit that touches source files.

---

## File Structure

- `packages/ui/src/components/message.tsx` — `Message` component.
- `packages/ui/src/components/message.test.tsx`
- `packages/ui/src/components/message.stories.tsx`
- `packages/ui/src/components/message-list.tsx` — `MessageList` component.
- `packages/ui/src/components/message-list.test.tsx`
- `packages/ui/src/components/message-list.stories.tsx`
- `packages/ui/src/components/streaming-text.tsx` — `StreamingText` component (consumes `Markdown`).
- `packages/ui/src/components/streaming-text.test.tsx`
- `packages/ui/src/components/streaming-text.stories.tsx`
- `packages/ui/src/index.ts` — barrel additions.

All three components are independent of each other at the code level (no task in this plan consumes another task's output) — only `StreamingText` has a cross-plan dependency, on the already-shipped `Markdown` from A2b-1.

---

## Task 1: `Message`

**Files:**
- Create: `packages/ui/src/components/message.tsx`
- Create: `packages/ui/src/components/message.test.tsx`
- Create: `packages/ui/src/components/message.stories.tsx`
- Modify: `packages/ui/src/index.ts` (export `Message`)

**Interfaces:**
- Produces: `Message` component, `export type MessageRole = "user" | "assistant"`, `export interface MessageProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "role"> { role: MessageRole; avatar?: React.ReactNode; footer?: React.ReactNode }`. Not consumed by any other task in this plan — used only for a realistic demo inside Task 2's story file.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/ui/src/components/message.test.tsx
import * as React from "react";
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Message } from "./message";

test("renders children inside the message bubble", () => {
  render(<Message role="assistant">Hello there</Message>);
  expect(screen.getByText("Hello there")).toBeInTheDocument();
});

test("marks the role on the root element", () => {
  const { container } = render(<Message role="user">Hi</Message>);
  expect(container.firstElementChild).toHaveAttribute("data-role", "user");
});

test('reverses layout and applies the user bubble styling for role="user"', () => {
  const { container } = render(<Message role="user">Hi</Message>);
  const root = container.firstElementChild as HTMLElement;
  expect(root.className).toContain("flex-row-reverse");
  expect(screen.getByText("Hi").className).toContain("bg-chat-user");
});

test('applies the assistant bubble styling for role="assistant" without reversing layout', () => {
  const { container } = render(<Message role="assistant">Hi</Message>);
  const root = container.firstElementChild as HTMLElement;
  expect(root.className).not.toContain("flex-row-reverse");
  expect(screen.getByText("Hi").className).toContain("bg-chat-assistant");
});

test("renders the avatar slot when provided", () => {
  render(
    <Message role="assistant" avatar={<span data-testid="av">A</span>}>
      Hi
    </Message>,
  );
  expect(screen.getByTestId("av")).toBeInTheDocument();
});

test("omits the avatar slot entirely when none is provided", () => {
  render(<Message role="assistant">Hi</Message>);
  expect(screen.queryByTestId("av")).not.toBeInTheDocument();
});

test("renders the footer slot below the content", () => {
  render(
    <Message role="assistant" footer={<span data-testid="ft">footer</span>}>
      Hi
    </Message>,
  );
  expect(screen.getByTestId("ft")).toBeInTheDocument();
});

test("forwards a ref to the root element", () => {
  const ref = React.createRef<HTMLDivElement>();
  render(
    <Message role="assistant" ref={ref}>
      Hi
    </Message>,
  );
  expect(ref.current).not.toBeNull();
  expect(ref.current).toHaveAttribute("data-role", "assistant");
});

test("spreads additional props onto the root element", () => {
  render(
    <Message role="assistant" data-testid="msg-root">
      Hi
    </Message>,
  );
  expect(screen.getByTestId("msg-root")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/message.test.tsx`
Expected: FAIL — `message.tsx` does not exist.

- [ ] **Step 3: Implement `Message`**

```tsx
// packages/ui/src/components/message.tsx
import * as React from "react";
import { cn } from "../lib/cn";

export type MessageRole = "user" | "assistant";

export interface MessageProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "role"> {
  role: MessageRole;
  avatar?: React.ReactNode;
  footer?: React.ReactNode;
}

export const Message = React.forwardRef<HTMLDivElement, MessageProps>(
  ({ role, avatar, footer, children, className, ...props }, ref) => {
    const isUser = role === "user";
    return (
      <div
        ref={ref}
        data-role={role}
        className={cn("flex items-start gap-3", isUser && "flex-row-reverse", className)}
        {...props}
      >
        {avatar ? <div className="shrink-0">{avatar}</div> : null}
        <div className={cn("flex max-w-[80%] flex-col gap-1", isUser && "items-end")}>
          <div
            className={cn(
              "rounded-lg px-3 py-2 text-sm",
              isUser ? "bg-chat-user text-chat-user-foreground" : "bg-chat-assistant text-chat-assistant-foreground",
            )}
          >
            {children}
          </div>
          {footer ? <div className="flex items-center gap-2 text-xs text-muted-foreground">{footer}</div> : null}
        </div>
      </div>
    );
  },
);
Message.displayName = "Message";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/message.test.tsx`
Expected: PASS (9/9)

- [ ] **Step 5: Write the Ladle story**

```tsx
// packages/ui/src/components/message.stories.tsx
import type { Story } from "@ladle/react";
import { Message } from "./message";
import { Avatar, AvatarFallback } from "./avatar";
import { Button } from "./button";
import { Citation } from "./citation";

export const AssistantDefault: Story = () => (
  <Message
    role="assistant"
    avatar={
      <Avatar>
        <AvatarFallback>A</AvatarFallback>
      </Avatar>
    }
  >
    Aqui está um resumo do que encontrei.
  </Message>
);

export const UserDefault: Story = () => (
  <Message
    role="user"
    avatar={
      <Avatar>
        <AvatarFallback>V</AvatarFallback>
      </Avatar>
    }
  >
    Pode me explicar melhor?
  </Message>
);

export const WithFooter: Story = () => (
  <Message
    role="assistant"
    avatar={
      <Avatar>
        <AvatarFallback>A</AvatarFallback>
      </Avatar>
    }
    footer={
      <>
        <Citation index={1} source={{ title: "Relatório Q3", url: "https://example.com" }} />
        <Button variant="ghost" size="sm" className="h-6 px-2">
          Copiar
        </Button>
      </>
    }
  >
    A receita cresceu 12% no trimestre.
  </Message>
);

export const LongContent: Story = () => (
  <Message
    role="assistant"
    avatar={
      <Avatar>
        <AvatarFallback>A</AvatarFallback>
      </Avatar>
    }
  >
    {"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20)}
  </Message>
);

export const WithoutAvatar: Story = () => <Message role="user">Sem avatar.</Message>;
```

- [ ] **Step 6: Export from the barrel**

In `packages/ui/src/index.ts`, after the `Citation` export line, add:

```typescript
export { Message, type MessageProps, type MessageRole } from "./components/message";
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
git add src/components/message.tsx src/components/message.test.tsx src/components/message.stories.tsx src/index.ts
git commit -m "feat(ui): Message — role-styled chat turn (avatar/content/footer slots)"
```

(Run `git add` from `packages/ui/`, or prefix each path with `packages/ui/` if committing from the repo root — confirm your cwd with `git status --porcelain` before staging.)

---

## Task 2: `MessageList`

**Files:**
- Create: `packages/ui/src/components/message-list.tsx`
- Create: `packages/ui/src/components/message-list.test.tsx`
- Create: `packages/ui/src/components/message-list.stories.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `ScrollArea`'s `viewportRef?: React.Ref<HTMLDivElement>` prop (already shipped, DS1) and `Button` (existing). Task 1's `Message` is used only in this task's story file for a realistic demo — no runtime/type dependency.
- Produces: `MessageList` component, `export interface MessageListProps extends React.HTMLAttributes<HTMLDivElement> {}` (children required by convention, typed via the inherited `children?: React.ReactNode`). Not consumed elsewhere in this plan.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/ui/src/components/message-list.test.tsx
import { afterEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageList } from "./message-list";
import { expectNoA11yViolations } from "../test/axe";

function stubScrollGeometry(scrollHeight: number, clientHeight: number) {
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(scrollHeight);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(clientHeight);
}

afterEach(() => {
  vi.restoreAllMocks();
});

function getViewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector("[data-radix-scroll-area-viewport]");
  if (!el) throw new Error("viewport not found in rendered MessageList");
  return el as HTMLElement;
}

test("scrolls to the bottom on mount", () => {
  stubScrollGeometry(500, 200);
  const { container } = render(
    <MessageList>
      <div>msg 1</div>
    </MessageList>,
  );
  expect(getViewport(container).scrollTop).toBe(500);
});

test("shows the jump-to-latest button once the reader scrolls away from the bottom", () => {
  stubScrollGeometry(500, 200);
  const { container } = render(
    <MessageList>
      <div>msg 1</div>
    </MessageList>,
  );
  const viewport = getViewport(container);
  expect(screen.queryByRole("button", { name: /ir para o final/i })).not.toBeInTheDocument();

  viewport.scrollTop = 100; // far from the 500-scrollHeight bottom, past the 48px threshold
  viewport.dispatchEvent(new Event("scroll", { bubbles: true }));

  expect(screen.getByRole("button", { name: /ir para o final/i })).toBeInTheDocument();
});

test("clicking the jump-to-latest button scrolls to the bottom and hides the button", async () => {
  stubScrollGeometry(500, 200);
  const user = userEvent.setup();
  const { container } = render(
    <MessageList>
      <div>msg 1</div>
    </MessageList>,
  );
  const viewport = getViewport(container);
  viewport.scrollTop = 0;
  viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  const button = screen.getByRole("button", { name: /ir para o final/i });

  await user.click(button);

  expect(viewport.scrollTop).toBe(500);
  expect(screen.queryByRole("button", { name: /ir para o final/i })).not.toBeInTheDocument();
});

test("auto-scrolls when new content is appended while already at the bottom", async () => {
  stubScrollGeometry(500, 200);
  const { container, rerender } = render(
    <MessageList>
      <div>msg 1</div>
    </MessageList>,
  );
  const viewport = getViewport(container);
  expect(viewport.scrollTop).toBe(500); // mounted already at the bottom

  stubScrollGeometry(700, 200); // the new message made the content taller
  rerender(
    <MessageList>
      <div>msg 1</div>
      <div>msg 2</div>
    </MessageList>,
  );

  await waitFor(() => expect(viewport.scrollTop).toBe(700));
});

test("does not yank the scroll position when new content arrives after the reader scrolled up", async () => {
  stubScrollGeometry(500, 200);
  const { container, rerender } = render(
    <MessageList>
      <div>msg 1</div>
    </MessageList>,
  );
  const viewport = getViewport(container);
  viewport.scrollTop = 50;
  viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  expect(screen.getByRole("button", { name: /ir para o final/i })).toBeInTheDocument();

  stubScrollGeometry(700, 200);
  rerender(
    <MessageList>
      <div>msg 1</div>
      <div>msg 2</div>
    </MessageList>,
  );

  // Let the MutationObserver's microtask run, then confirm it declined to move the viewport.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(viewport.scrollTop).toBe(50);
  expect(screen.getByRole("button", { name: /ir para o final/i })).toBeInTheDocument();
});

test("has no a11y violations once the jump-to-latest button is visible", async () => {
  stubScrollGeometry(500, 200);
  const { container } = render(
    <MessageList>
      <div>msg 1</div>
    </MessageList>,
  );
  const viewport = getViewport(container);
  viewport.scrollTop = 0;
  viewport.dispatchEvent(new Event("scroll", { bubbles: true }));
  await expectNoA11yViolations(container);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/message-list.test.tsx`
Expected: FAIL — `message-list.tsx` does not exist.

- [ ] **Step 3: Implement `MessageList`**

```tsx
// packages/ui/src/components/message-list.tsx
import * as React from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { ScrollArea } from "./scroll-area";

export interface MessageListProps extends React.HTMLAttributes<HTMLDivElement> {}

const BOTTOM_THRESHOLD_PX = 48;

export const MessageList = React.forwardRef<HTMLDivElement, MessageListProps>(
  ({ children, className, ...props }, ref) => {
    const viewportRef = React.useRef<HTMLDivElement>(null);
    const contentRef = React.useRef<HTMLDivElement>(null);
    const atBottomRef = React.useRef(true);
    const [atBottom, setAtBottom] = React.useState(true);

    const scrollToBottom = React.useCallback(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      viewport.scrollTop = viewport.scrollHeight;
      atBottomRef.current = true;
      setAtBottom(true);
    }, []);

    // Opening a thread lands on the newest turn, not the oldest.
    React.useEffect(() => {
      scrollToBottom();
      // Mount-only: intentionally does not re-run on scrollToBottom identity
      // changes (it's a stable useCallback with an empty dep array anyway).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    React.useEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const handleScroll = () => {
        const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
        const next = distance <= BOTTOM_THRESHOLD_PX;
        atBottomRef.current = next;
        setAtBottom(next);
      };
      viewport.addEventListener("scroll", handleScroll);
      return () => viewport.removeEventListener("scroll", handleScroll);
    }, []);

    React.useEffect(() => {
      const content = contentRef.current;
      if (!content) return;
      // ResizeObserver is stubbed as a no-op in this repo's jsdom test setup
      // (vitest.setup.ts), so MutationObserver drives auto-follow instead —
      // it also directly covers the real target case (StreamingText
      // appending text as chunks arrive), and unlike ResizeObserver, is
      // exercisable in tests.
      const observer = new MutationObserver(() => {
        if (atBottomRef.current) scrollToBottom();
      });
      observer.observe(content, { childList: true, subtree: true, characterData: true });
      return () => observer.disconnect();
    }, [scrollToBottom]);

    return (
      <div ref={ref} className={cn("relative h-full min-h-0", className)} {...props}>
        <ScrollArea className="h-full" viewportRef={viewportRef}>
          <div ref={contentRef} className="flex flex-col gap-4 p-4">
            {children}
          </div>
        </ScrollArea>
        {!atBottom ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="absolute bottom-4 left-1/2 -translate-x-1/2 gap-1.5 shadow-md"
            onClick={scrollToBottom}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Ir para o final
          </Button>
        ) : null}
      </div>
    );
  },
);
MessageList.displayName = "MessageList";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/message-list.test.tsx`
Expected: PASS (7/7)

- [ ] **Step 5: Write the Ladle story**

```tsx
// packages/ui/src/components/message-list.stories.tsx
import type { Story } from "@ladle/react";
import { MessageList } from "./message-list";
import { Message } from "./message";

export const Default: Story = () => (
  <div style={{ height: 320 }}>
    <MessageList>
      <Message role="assistant">Como posso ajudar hoje?</Message>
      <Message role="user">Preciso de um resumo do relatório de vendas.</Message>
      <Message role="assistant">Claro — a receita cresceu 12% no trimestre.</Message>
    </MessageList>
  </div>
);

export const ManyMessagesOverflow: Story = () => (
  <div style={{ height: 320 }}>
    <MessageList>
      {Array.from({ length: 30 }, (_, i) => (
        <Message key={i} role={i % 2 === 0 ? "assistant" : "user"}>
          Mensagem número {i + 1}.
        </Message>
      ))}
    </MessageList>
  </div>
);
```

- [ ] **Step 6: Export from the barrel**

In `packages/ui/src/index.ts`, after the `Message` export, add:

```typescript
export { MessageList, type MessageListProps } from "./components/message-list";
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
git add src/components/message-list.tsx src/components/message-list.test.tsx src/components/message-list.stories.tsx src/index.ts
git commit -m "feat(ui): MessageList — auto-scrolling turn container with jump-to-latest"
```

---

## Task 3: `StreamingText`

**Files:**
- Create: `packages/ui/src/components/streaming-text.tsx`
- Create: `packages/ui/src/components/streaming-text.test.tsx`
- Create: `packages/ui/src/components/streaming-text.stories.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `Markdown` (`export interface MarkdownProps { source: string; className?: string }`, from A2b-1, `../components/markdown`), used as `<Markdown source={joinedChunks} />`.
- Produces: `StreamingText` component, `export interface StreamingTextProps extends React.HTMLAttributes<HTMLDivElement> { chunks: string[] }`. Not consumed elsewhere in this plan.

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/ui/src/components/streaming-text.test.tsx
import * as React from "react";
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { StreamingText } from "./streaming-text";

test("renders the concatenated chunks as markdown", () => {
  render(<StreamingText chunks={["Hello ", "**world**"]} />);
  expect(screen.getByText("world").tagName).toBe("STRONG");
  expect(screen.getByText(/Hello/)).toBeInTheDocument();
});

test("shows a caret while mounted", () => {
  const { container } = render(<StreamingText chunks={["Hi"]} />);
  expect(container.querySelector(".ds-streaming-caret")).not.toBeNull();
});

test("tolerates an unclosed code fence mid-stream without crashing", () => {
  expect(() =>
    render(<StreamingText chunks={["Here's the fix:\n\n```ts\nconst x = 1;"]} />),
  ).not.toThrow();
  expect(screen.getByText(/const x = 1;/)).toBeInTheDocument();
});

test("tolerates an unclosed bold marker mid-stream without crashing", () => {
  expect(() => render(<StreamingText chunks={["This is **still typ"]} />)).not.toThrow();
  expect(screen.getByText(/still typ/)).toBeInTheDocument();
});

test("appends new chunks without remounting the already-rendered content", () => {
  const { container, rerender } = render(<StreamingText chunks={["Hello"]} />);
  const firstNode = container.firstElementChild;
  rerender(<StreamingText chunks={["Hello", " world"]} />);
  expect(container.firstElementChild).toBe(firstNode);
});

test("forwards a ref to the root element", () => {
  const ref = React.createRef<HTMLDivElement>();
  render(<StreamingText chunks={["Hi"]} ref={ref} />);
  expect(ref.current).not.toBeNull();
  expect(ref.current?.className).toContain("ds-streaming-text");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/streaming-text.test.tsx`
Expected: FAIL — `streaming-text.tsx` does not exist.

- [ ] **Step 3: Implement `StreamingText`**

```tsx
// packages/ui/src/components/streaming-text.tsx
import * as React from "react";
import { cn } from "../lib/cn";
import { Markdown } from "./markdown";

export interface StreamingTextProps extends React.HTMLAttributes<HTMLDivElement> {
  chunks: string[];
}

export const StreamingText = React.forwardRef<HTMLDivElement, StreamingTextProps>(
  ({ chunks, className, ...props }, ref) => {
    const source = React.useMemo(() => chunks.join(""), [chunks]);
    return (
      <div ref={ref} className={cn("ds-streaming-text", className)} {...props}>
        <Markdown source={source} />
        <span
          aria-hidden="true"
          className="ds-streaming-caret ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current align-text-bottom"
        />
      </div>
    );
  },
);
StreamingText.displayName = "StreamingText";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/streaming-text.test.tsx`
Expected: PASS (6/6)

- [ ] **Step 5: Write the Ladle story**

```tsx
// packages/ui/src/components/streaming-text.stories.tsx
import type { Story } from "@ladle/react";
import * as React from "react";
import { StreamingText } from "./streaming-text";

const DEMO_CHUNKS = [
  "Aqui está o que encontrei",
  ": a receita cresceu ",
  "**12%**",
  " no último trimestre",
  ".\n\n- Fonte: relatório interno\n- Período: Q3",
];

export const Default: Story = () => <StreamingText chunks={DEMO_CHUNKS} />;

export const Live: Story = () => {
  const [count, setCount] = React.useState(1);
  React.useEffect(() => {
    if (count >= DEMO_CHUNKS.length) return;
    const id = setTimeout(() => setCount((c) => c + 1), 500);
    return () => clearTimeout(id);
  }, [count]);
  return <StreamingText chunks={DEMO_CHUNKS.slice(0, count)} />;
};
```

- [ ] **Step 6: Export from the barrel**

In `packages/ui/src/index.ts`, after the `MessageList` export, add:

```typescript
export { StreamingText, type StreamingTextProps } from "./components/streaming-text";
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
git add src/components/streaming-text.tsx src/components/streaming-text.test.tsx src/components/streaming-text.stories.tsx src/index.ts
git commit -m "feat(ui): StreamingText — incremental chunk rendering over Markdown with a caret"
```

---

## Self-Review Notes

- **Spec coverage:** A1 spec §4 names `MessageList`, `Message`, `StreamingText` with their "como se usa" signatures — all three implemented matching those signatures (`<Message role="assistant" footer={…}>…</Message>`, `<MessageList>{messages}</MessageList>`, `<StreamingText chunks={stream} />`). §6's explicit behavioral contracts for this slice — "`StreamingText` anexa sem remontar" — has a dedicated test (Task 3, "appends new chunks without remounting"). `MessageList`'s "auto-scroll ao fim; botão 'ir pra última' quando desgrudado" has dedicated tests for both halves (Task 2).
- **Deliberate simplifications, not silent gaps:** the caret in `StreamingText` sits after the whole rendered `Markdown` block rather than glued to the exact last character of text — correct and simple for the common single-paragraph-growing case, visually just below the block for multi-paragraph content. `aria-live` announcement of streaming/new-message content is out of scope (no accessibility requirement for this was in the spec; matches its own "Cortes YAGNI" framing) — worth a follow-up if screen-reader users of `ThreadScreen` report the gap during B's implementation, not before.
- **Type consistency:** `MessageListProps` (Task 2) doesn't depend on `MessageProps` (Task 1) — checked, no shared identifiers to drift. `StreamingTextProps.chunks: string[]` (Task 3) matches the spec's `chunks={stream}` usage; `Markdown`'s real, already-shipped `MarkdownProps { source: string; className?: string }` is used exactly as declared, no invented API surface.
- **No placeholders:** every step ships literal code, not descriptions.
- **Cross-task conflicts:** none — the three components share no files outside `src/index.ts` (sequential, non-overlapping insertion points) and no runtime code path.

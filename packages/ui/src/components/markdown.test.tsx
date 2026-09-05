import { createRef } from "react";
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMarkedInstance, Markdown } from "./markdown";

test("DS7: forwards ref to the wrapper div and passes through arbitrary DOM attributes", () => {
  const ref = createRef<HTMLDivElement>();
  render(<Markdown ref={ref} source="oi" id="thread-42" data-testid="markdown-root" aria-label="Resposta" />);
  expect(ref.current).not.toBeNull();
  expect(ref.current).toHaveAttribute("id", "thread-42");
  expect(ref.current).toHaveAttribute("data-testid", "markdown-root");
  expect(ref.current).toHaveAttribute("aria-label", "Resposta");
});

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

// DS11: antes, imagem e checkbox de task list sumiam inteiras (o node,
// não só o estilo) porque `img`/`input` não estavam em ALLOWED_TAGS.
test("renders a GFM image with src/alt", () => {
  const { container } = render(<Markdown source={"![um gato](https://example.com/gato.png)"} />);
  const img = container.querySelector("img");
  expect(img).not.toBeNull();
  expect(img).toHaveAttribute("src", "https://example.com/gato.png");
  expect(img).toHaveAttribute("alt", "um gato");
});

test("renders GFM task-list checkboxes as disabled (read-only, not a form)", () => {
  const { container } = render(<Markdown source={"- [ ] pendente\n- [x] feito"} />);
  const boxes = container.querySelectorAll('input[type="checkbox"]');
  expect(boxes).toHaveLength(2);
  expect(boxes[0]).toBeDisabled();
  expect(boxes[0]).not.toBeChecked();
  expect(boxes[1]).toBeDisabled();
  expect(boxes[1]).toBeChecked();
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

test("renders a [[n]] marker as plain text when no `sources` prop backs it (anti-spoofing)", () => {
  render(<Markdown source={"Some claim [[1]] follows."} />);
  expect(screen.getByText(/\[\[1\]\] follows\./)).toBeInTheDocument();
  expect(screen.queryByText("1", { selector: "sup" })).toBeNull();
});

test("renders a [[n]] citation marker as an interactive superscript when a matching source exists", () => {
  render(<Markdown source={"Some claim [[1]] follows."} sources={[{ title: "Fonte A" }]} />);
  const marker = screen.getByText("1");
  expect(marker.tagName).toBe("SUP");
  expect(marker).toHaveAttribute("role", "button");
  expect(marker).toHaveAttribute("tabindex", "0");
});

test("renders a [[n]] marker as plain text when the index has no corresponding source", () => {
  render(<Markdown source={"Some claim [[2]] follows."} sources={[{ title: "Fonte A" }]} />);
  expect(screen.getByText(/\[\[2\]\] follows\./)).toBeInTheDocument();
});

test("clicking a citation marker opens a popover with the source details", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <Markdown
      source={"Some claim [[1]] follows."}
      sources={[{ title: "Fonte A", url: "https://example.com/a", snippet: "trecho relevante" }]}
    />,
  );
  await user.click(screen.getByText("1"));
  expect(await screen.findByRole("link", { name: "Fonte A" })).toHaveAttribute("href", "https://example.com/a");
  expect(screen.getByText("trecho relevante")).toBeInTheDocument();
});

test("activates a citation marker via keyboard (Enter)", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<Markdown source={"Some claim [[1]] follows."} sources={[{ title: "Fonte A" }]} />);
  const marker = screen.getByText("1");
  marker.focus();
  await user.keyboard("{Enter}");
  expect(await screen.findByText("Fonte A")).toBeInTheDocument();
});

test("drops empty spacer blocks between blocks instead of doubling the layout gap", () => {
  const source = "# Title\n\nSome paragraph.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```";
  const { container } = render(<Markdown source={source} />);
  const emptyDivs = Array.from(container.querySelectorAll("div")).filter((el) => el.innerHTML === "");
  expect(emptyDivs).toHaveLength(0);
});

test("does not transform a citation marker written literally inside inline code", () => {
  render(<Markdown source={"Use `[[1]]` literally."} />);
  const code = screen.getByText("[[1]]");
  expect(code.tagName).toBe("CODE");
});

test("does not transform a citation-marker-shaped string inside a link title attribute", () => {
  // sanitizeHtml's ALLOWED_ATTR intentionally excludes `title` (see Fix 3 in
  // the final-review fix brief) — a link's title is stripped before it ever
  // reaches the DOM, both before and after this fix. Asserting against the
  // final sanitized DOM can't distinguish "title survived, correctly
  // un-corrupted" from "title never survived at all", so it can't prove the
  // guarantee under test. Assert instead against a real citationMarker-aware
  // Marked instance's own rendered HTML — the exact same call `Markdown`
  // makes internally, before sanitization — which is where the old
  // regex-based citation-marker replace used to splice a `<sup>` into the
  // middle of the attribute string. `hasSource` is forced to `true` so the
  // extension is actually exercised regardless of the title text.
  const marked = createMarkedInstance(() => true);
  const html = marked.parser(marked.lexer('[click](https://example.com "hi [[1]] there")'));
  expect(html).toContain('title="hi [[1]] there"');

  render(<Markdown source={'[click](https://example.com "hi [[1]] there")'} />);
  expect(screen.getByRole("link", { name: "click" })).toHaveAttribute("href", "https://example.com");
});

test("does not execute an onerror handler embedded via raw HTML in the source", () => {
  const { container } = render(
    <Markdown source={'<img src="x" onerror="window.__pwned = true;">'} />,
  );
  expect(container.querySelector("img[onerror]")).toBeNull();
  expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
});

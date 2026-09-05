import { expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  expect(screen.getByTestId("code-block-lang")).toHaveTextContent("");
});

test("shows only the language token when the fence info string has extra content", () => {
  render(<CodeBlock code="const x = 1;" lang='ts title="a.ts"' />);
  expect(screen.getByTestId("code-block-lang")).toHaveTextContent("ts");
});

test("copy button writes the exact code to the clipboard", async () => {
  // @testing-library/user-event's setup() installs its own (getter-only)
  // navigator.clipboard as a side effect, so the mock must be installed
  // via defineProperty *after* setup() — Object.assign before setup() gets
  // silently discarded, and Object.assign after setup() throws ("has only
  // a getter") since the installed property has no setter.
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });

  try {
    render(<CodeBlock code="const x = 1;" lang="ts" />);
    await user.click(screen.getByRole("button", { name: /copiar código/i }));
    expect(writeText).toHaveBeenCalledWith("const x = 1;");
  } finally {
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    }
  }
});

test("renders text content safely even when the code string contains HTML-like syntax", () => {
  render(<CodeBlock code="<script>alert(1)</script>" />);
  expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
});

test("has no a11y violations", async () => {
  const { container } = render(<CodeBlock code="const x = 1;" lang="ts" />);
  // Espera o efeito de highlight (assíncrono) terminar antes de sair do
  // teste — senão o setState do shiki chega depois do teste já ter
  // encerrado, e o React acusa "not wrapped in act(...)" no teste seguinte.
  await waitFor(() => screen.getByTestId("code-block-highlighted"));
  await expectNoA11yViolations(container);
});

// DS10: highlight real via shiki — assíncrono (import dinâmico +
// codeToHtml), então o render síncrono inicial ainda cai no <pre><code>
// plano (os testes acima continuam válidos sem alteração); estes esperam o
// efeito assíncrono terminar pra verificar o resultado colorido.
for (const [lang, code] of [
  ["typescript", "const x: number = 1;"],
  ["python", "def f(x):\n    return x"],
  ["bash", 'echo "hi"'],
] as const) {
  test(`highlights real ${lang} syntax (tokens split across colored spans, not one plain text node)`, async () => {
    render(<CodeBlock code={code} lang={lang} />);
    const highlighted = await waitFor(() => screen.getByTestId("code-block-highlighted"), { timeout: 10_000 });
    // shiki tokeniza em vários <span>; o texto não vive mais num nó só —
    // prova de highlight real, não só "renderizou alguma coisa".
    expect(highlighted.querySelectorAll("span").length).toBeGreaterThan(1);
    expect(highlighted.textContent?.replace(/\s+/g, " ").trim()).toBe(code.replace(/\s+/g, " ").trim());
  });
}

test("falls back to plain <pre><code> for an unrecognized lang (no crash, no highlight)", async () => {
  render(<CodeBlock code="whatever" lang="not-a-real-language-xyz" />);
  // Não há "terminou de tentar" observável pra um lang inválido (a Promise
  // nem chega a ser criada) — dá um instante pro efeito rodar e confirma que
  // o fallback nunca é trocado pelo bloco destacado.
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(screen.queryByTestId("code-block-highlighted")).toBeNull();
  expect(screen.getByText("whatever")).toBeInTheDocument();
});

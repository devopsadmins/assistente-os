import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Field } from "./field";
import { Input } from "./input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./select";
import { expectNoA11yViolations } from "../test/axe";

test("wires label, hint, and injects id/aria-describedby onto the child", () => {
  render(
    <Field label="E-mail" htmlFor="email" hint="usamos só pra login">
      <Input />
    </Field>,
  );
  const input = screen.getByLabelText("E-mail");
  expect(input).toHaveAttribute("id", "email");
  expect(screen.getByText("usamos só pra login")).toHaveAttribute("id", "email-hint");
  expect(input.getAttribute("aria-describedby")).toContain("email-hint");
});

test("shows error instead of hint and marks aria-invalid", () => {
  render(
    <Field label="Senha" htmlFor="pwd" hint="mín. 8 caracteres" error="senha muito curta">
      <Input type="password" />
    </Field>,
  );
  const input = screen.getByLabelText("Senha");
  expect(screen.queryByText("mín. 8 caracteres")).not.toBeInTheDocument();
  expect(screen.getByText("senha muito curta")).toHaveAttribute("id", "pwd-error");
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input.getAttribute("aria-describedby")).toContain("pwd-error");
});

// DS3: Field's cloneElement path can't reach into a composed control like
// <Select> — its root is a Radix context provider with no DOM node of its
// own, so injected props vanish. The render-prop form hands the caller the
// computed ids directly, to wire onto whichever inner element makes sense.
test("DS3: render-prop child wires aria-labelledby/aria-describedby onto SelectTrigger, and the label is clickable", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0, delay: null });
  render(
    <Field label="Tier do modelo" htmlFor="model-tier" hint="afeta custo e latência">
      {({ labelId, controlId, describedBy, invalid }) => (
        <Select defaultValue="local">
          <SelectTrigger id={controlId} aria-labelledby={labelId} aria-describedby={describedBy} aria-invalid={invalid}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">local</SelectItem>
            <SelectItem value="zen">zen</SelectItem>
          </SelectContent>
        </Select>
      )}
    </Field>,
  );

  const trigger = screen.getByRole("combobox", { name: "Tier do modelo" });
  expect(trigger.getAttribute("aria-describedby")).toContain("model-tier-hint");
  expect(trigger).not.toHaveAttribute("aria-invalid");

  // clicking the <label> focuses/opens the labeled control, same as a native input
  await user.click(screen.getByText("Tier do modelo"));
  expect(await screen.findByText("zen")).toBeInTheDocument();
});

test("DS3: render-prop child marks aria-invalid when Field has an error", () => {
  render(
    <Field label="Tier do modelo" htmlFor="model-tier" error="obrigatório">
      {({ labelId, describedBy, invalid }) => (
        <Select>
          <SelectTrigger aria-labelledby={labelId} aria-describedby={describedBy} aria-invalid={invalid}>
            <SelectValue placeholder="Escolha" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">local</SelectItem>
          </SelectContent>
        </Select>
      )}
    </Field>,
  );
  const trigger = screen.getByRole("combobox", { name: "Tier do modelo" });
  expect(trigger).toHaveAttribute("aria-invalid", "true");
  expect(trigger.getAttribute("aria-describedby")).toContain("model-tier-error");
});

test("DS3: Field + Select composition has no a11y violations", async () => {
  const { container } = render(
    <Field label="Tier do modelo" htmlFor="model-tier" hint="afeta custo e latência">
      {({ labelId, describedBy, invalid }) => (
        <Select defaultValue="local">
          <SelectTrigger aria-labelledby={labelId} aria-describedby={describedBy} aria-invalid={invalid}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local">local</SelectItem>
          </SelectContent>
        </Select>
      )}
    </Field>,
  );
  await expectNoA11yViolations(container);
});

import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "./field";
import { Input } from "./input";

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

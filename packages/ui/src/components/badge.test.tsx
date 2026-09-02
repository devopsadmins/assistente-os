import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

test("renders default variant", () => {
  render(<Badge>Novo</Badge>);
  expect(screen.getByText("Novo").className).toMatch(/bg-primary\b/);
});

test("renders destructive variant", () => {
  render(<Badge variant="destructive">Erro</Badge>);
  expect(screen.getByText("Erro").className).toMatch(/bg-destructive\b/);
});

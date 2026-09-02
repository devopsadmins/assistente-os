import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Label } from "./label";

test("associates with a control via htmlFor", () => {
  render(
    <>
      <Label htmlFor="x">Nome</Label>
      <input id="x" />
    </>,
  );
  expect(screen.getByLabelText("Nome")).toBeInTheDocument();
});

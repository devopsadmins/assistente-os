import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScrollArea } from "./scroll-area";

test("renders its children inside a scrollable viewport", () => {
  render(
    <ScrollArea className="h-20">
      <p>conteúdo rolável</p>
    </ScrollArea>,
  );
  expect(screen.getByText("conteúdo rolável")).toBeInTheDocument();
});

import { expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Separator } from "./separator";

test("renders a horizontal separator by default", () => {
  const { container } = render(<Separator />);
  expect(container.firstChild).toHaveAttribute("data-orientation", "horizontal");
});

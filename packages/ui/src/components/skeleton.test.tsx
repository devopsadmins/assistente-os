import { expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./skeleton";

test("renders a pulsing placeholder block", () => {
  const { container } = render(<Skeleton className="h-4 w-32" />);
  expect(container.firstChild).toHaveClass("animate-pulse");
});

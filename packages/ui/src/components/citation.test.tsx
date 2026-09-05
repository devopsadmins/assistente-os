import { createRef } from "react";
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Citation } from "./citation";
import { expectNoA11yViolations } from "../test/axe";

const source = { title: "Relatório de vendas Q3", url: "https://example.com/q3", snippet: "Crescimento de 12%." };

test("DS7: forwards ref to the underlying button and passes through arbitrary DOM attributes", () => {
  const ref = createRef<HTMLButtonElement>();
  render(<Citation ref={ref} index={1} source={source} data-testid="citation-1" />);
  const button = screen.getByRole("button", { name: /citação 1/i });
  expect(ref.current).toBe(button);
  expect(button).toHaveAttribute("data-testid", "citation-1");
});

test("renders the citation index as a chip", () => {
  render(<Citation index={1} source={source} />);
  expect(screen.getByRole("button", { name: /citação 1/i })).toBeInTheDocument();
});

test("opens a popover with the source title and snippet on click", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<Citation index={1} source={source} />);

  await user.click(screen.getByRole("button", { name: /citação 1/i }));

  expect(await screen.findByText("Relatório de vendas Q3")).toBeInTheDocument();
  expect(screen.getByText("Crescimento de 12%.")).toBeInTheDocument();
});

test("renders the source link when a url is provided", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<Citation index={1} source={source} />);
  await user.click(screen.getByRole("button", { name: /citação 1/i }));

  expect(await screen.findByRole("link", { name: "Relatório de vendas Q3" })).toHaveAttribute(
    "href",
    "https://example.com/q3",
  );
});

test("omits the link when the source has no url", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(<Citation index={2} source={{ title: "Nota interna" }} />);
  await user.click(screen.getByRole("button", { name: /citação 2/i }));

  expect(await screen.findByText("Nota interna")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

test("has no a11y violations", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const { container } = render(<Citation index={1} source={source} />);
  await expectNoA11yViolations(container);
  await user.click(screen.getByRole("button", { name: /citação 1/i }));
  await screen.findByText("Relatório de vendas Q3");
  await expectNoA11yViolations(container);
});

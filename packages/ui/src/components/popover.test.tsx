import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";
import { Button } from "./button";
import { expectNoA11yViolations } from "../test/axe";

test("opens content on trigger click", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0, delay: null });
  render(
    <Popover>
      <PopoverTrigger asChild>
        <Button>Abrir</Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Detalhes">Conteúdo flutuante</PopoverContent>
    </Popover>,
  );
  expect(screen.queryByText("Conteúdo flutuante")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Abrir" }));
  expect(screen.getByText("Conteúdo flutuante")).toBeInTheDocument();
});

test("has no a11y violations", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0, delay: null });
  const { container } = render(
    <Popover>
      <PopoverTrigger asChild>
        <Button>Abrir</Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Detalhes">Conteúdo flutuante</PopoverContent>
    </Popover>,
  );
  await user.click(screen.getByRole("button", { name: "Abrir" }));
  await expectNoA11yViolations(container);
});

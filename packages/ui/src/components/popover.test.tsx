import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";
import { Button } from "./button";

test("opens content on trigger click", async () => {
  const user = userEvent.setup();
  render(
    <Popover>
      <PopoverTrigger asChild>
        <Button>Abrir</Button>
      </PopoverTrigger>
      <PopoverContent>Conteúdo flutuante</PopoverContent>
    </Popover>,
  );
  expect(screen.queryByText("Conteúdo flutuante")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Abrir" }));
  expect(screen.getByText("Conteúdo flutuante")).toBeInTheDocument();
});

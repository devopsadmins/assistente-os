import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "./dropdown-menu";
import { Button } from "./button";

test("opens with keyboard (Enter) and navigates items with ArrowDown, activates with Enter", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const onSelectA = vi.fn();
  render(
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>Ações</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onSelectA}>Renomear</DropdownMenuItem>
        <DropdownMenuItem>Excluir</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  const trigger = screen.getByRole("button", { name: "Ações" });
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(await screen.findByText("Renomear")).toBeInTheDocument();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(onSelectA).not.toHaveBeenCalled(); // ArrowDown moved off "Renomear" onto "Excluir" first
});

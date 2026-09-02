import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./dialog";
import { Button } from "./button";
import { expectNoA11yViolations } from "../test/axe";

function Example() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Abrir</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Título</DialogTitle>
        <DialogDescription>Descrição do diálogo</DialogDescription>
        <button>dentro</button>
      </DialogContent>
    </Dialog>
  );
}

test("opens on trigger click and traps focus inside", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Abrir" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("dentro")).toBeInTheDocument();
});

test("closes on Escape and restores focus to the trigger", async () => {
  const user = userEvent.setup();
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "Abrir" });
  await user.click(trigger);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("has no a11y violations while open", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Abrir" }));
  await expectNoA11yViolations(screen.getByRole("dialog"));
});

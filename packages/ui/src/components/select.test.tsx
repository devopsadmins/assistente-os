import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./select";
import { expectNoA11yViolations } from "../test/axe";

test("opens and selects an item, updating the displayed value", async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0, delay: null });
  render(
    <Select defaultValue="local">
      <SelectTrigger aria-label="Tier">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="local">local</SelectItem>
        <SelectItem value="zen">zen</SelectItem>
      </SelectContent>
    </Select>,
  );
  expect(screen.getByRole("combobox")).toHaveTextContent("local");
  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByText("zen"));
  expect(screen.getByRole("combobox")).toHaveTextContent("zen");
});

test("has no a11y violations", async () => {
  const { container } = render(
    <Select defaultValue="local">
      <SelectTrigger aria-label="Tier">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="local">local</SelectItem>
        <SelectItem value="zen">zen</SelectItem>
      </SelectContent>
    </Select>,
  );
  await expectNoA11yViolations(container);
});

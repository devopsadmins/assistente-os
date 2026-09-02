import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./select";

test("opens and selects an item, updating the displayed value", async () => {
  const user = userEvent.setup();
  render(
    <Select defaultValue="local">
      <SelectTrigger>
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

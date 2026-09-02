import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "./tooltip";
import { Button } from "./button";

test("shows content on hover", async () => {
  const user = userEvent.setup();
  render(
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button>Alvo</Button>
        </TooltipTrigger>
        <TooltipContent>Dica</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );
  await user.hover(screen.getByRole("button", { name: "Alvo" }));
  // Radix TooltipContent renders children twice — once visibly, once inside a
  // visually-hidden role="tooltip" span for a11y — so findByText("Dica") matches
  // both nodes and throws. Assert via the accessible role instead (brief gap; see
  // task-5-report.md).
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Dica");
});

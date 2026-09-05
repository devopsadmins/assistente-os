import { expect, test, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Toaster } from "./toaster";
import { useToast, __resetToastStoreForTests } from "../hooks/use-toast";
import { expectNoA11yViolations } from "../test/axe";

beforeEach(() => {
  __resetToastStoreForTests();
});

function Trigger() {
  const { toast } = useToast();
  return <button onClick={() => toast({ title: "Upload falhou", description: "tente de novo", variant: "destructive" })}>disparar</button>;
}

test("renders a toast pushed via useToast()", () => {
  render(
    <>
      <Trigger />
      <Toaster />
    </>,
  );
  act(() => {
    screen.getByText("disparar").click();
  });
  expect(screen.getByText("Upload falhou")).toBeInTheDocument();
  expect(screen.getByText("tente de novo")).toBeInTheDocument();
});

test("swipeDirection prop reaches Radix instead of the hardcoded default (DS7)", () => {
  const { container } = render(
    <>
      <Trigger />
      <Toaster swipeDirection="up" />
    </>,
  );
  act(() => {
    screen.getByText("disparar").click();
  });
  expect(container.querySelector('[data-swipe-direction="up"]')).not.toBeNull();
});

test("has no a11y violations", async () => {
  const { container } = render(
    <>
      <Trigger />
      <Toaster />
    </>,
  );
  act(() => {
    screen.getByText("disparar").click();
  });
  await expectNoA11yViolations(container, { disableRules: ["aria-allowed-role", "list"] });
});

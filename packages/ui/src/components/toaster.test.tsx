import { expect, test, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Toaster } from "./toaster";
import { useToast, __resetToastStoreForTests } from "../hooks/use-toast";

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

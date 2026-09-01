import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar, AvatarFallback } from "./avatar";

test("shows fallback when no image loads", () => {
  render(
    <Avatar>
      <AvatarFallback>EL</AvatarFallback>
    </Avatar>,
  );
  expect(screen.getByText("EL")).toBeInTheDocument();
});

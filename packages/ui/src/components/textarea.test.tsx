import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Textarea } from "./textarea";

test("renders a multi-row textarea", () => {
  render(<Textarea placeholder="msg" rows={4} />);
  const el = screen.getByPlaceholderText("msg") as HTMLTextAreaElement;
  expect(el.tagName).toBe("TEXTAREA");
  expect(el.rows).toBe(4);
});

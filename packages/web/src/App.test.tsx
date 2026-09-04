import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("renderiza o placeholder do scaffold usando o Message do @assistente-os/ui", () => {
    render(<App />);
    expect(screen.getByText(/packages\/web está de pé/i)).toBeInTheDocument();
  });
});

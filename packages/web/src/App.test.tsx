import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("mostra um aviso de configuração quando VITE_DEV_TOKEN/VITE_DEV_SOUL_ID não estão definidas", () => {
    render(<App />);
    expect(screen.getByText(/configure vite_dev_token/i)).toBeInTheDocument();
  });
});

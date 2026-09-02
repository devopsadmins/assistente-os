import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeProvider, useBrand, DEFAULT_BRAND_CONTEXT } from "./context";
import { DERIVED_VAR_KEYS, type BrandInput } from "./types";

const brand: BrandInput = {
  productName: "Elebece Assist",
  logo: { light: "https://x/l.svg" },
  primaryColor: "#3b82f6",
};

function Probe() {
  const b = useBrand();
  return <span data-testid="name">{b.productName}</span>;
}

test("useBrand without a provider returns the default product identity", () => {
  render(<Probe />);
  expect(screen.getByTestId("name")).toHaveTextContent(DEFAULT_BRAND_CONTEXT.productName);
});

test("ThemeProvider with a brand writes all 8 derived vars to :root and exposes productName", () => {
  render(
    <ThemeProvider brand={brand}>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByTestId("name")).toHaveTextContent("Elebece Assist");
  for (const key of DERIVED_VAR_KEYS) {
    expect(document.documentElement.style.getPropertyValue(key).trim()).not.toBe("");
  }
});

test("ThemeProvider with brand=null writes nothing and uses defaults", () => {
  render(
    <ThemeProvider brand={null}>
      <Probe />
    </ThemeProvider>,
  );
  expect(screen.getByTestId("name")).toHaveTextContent(DEFAULT_BRAND_CONTEXT.productName);
  expect(document.documentElement.style.getPropertyValue("--primary").trim()).toBe("");
});

test("unmounting ThemeProvider removes the vars it set", () => {
  const { unmount } = render(<ThemeProvider brand={brand}>x</ThemeProvider>);
  expect(document.documentElement.style.getPropertyValue("--primary").trim()).not.toBe("");
  unmount();
  for (const key of DERIVED_VAR_KEYS) {
    expect(document.documentElement.style.getPropertyValue(key).trim()).toBe("");
  }
});

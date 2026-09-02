import type { GlobalProvider } from "@ladle/react";
import { ThemeProvider } from "../src/theme/context";
import type { BrandInput } from "../src/theme/types";
import "../src/tokens.css";
import "./tailwind.css";

const PRESETS: Record<string, BrandInput | null> = {
  Default: null,
  Warm: { productName: "Warm Co", logo: { light: "" }, primaryColor: "#e2643b" },
  Cool: { productName: "Cool Co", logo: { light: "" }, primaryColor: "#2b7fd8" },
  "Near-grey": { productName: "Slate Co", logo: { light: "" }, primaryColor: "#6b7280" },
};

export const Provider: GlobalProvider = ({ children, globalState }) => {
  const key = globalState.control?.brand?.value ?? "Default";
  return <ThemeProvider brand={PRESETS[key] ?? null}>{children}</ThemeProvider>;
};

export const argTypes = {
  brand: {
    control: { type: "select" },
    options: Object.keys(PRESETS),
    defaultValue: "Default",
  },
};

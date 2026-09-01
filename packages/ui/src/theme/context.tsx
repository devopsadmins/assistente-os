import { createContext, useContext, useLayoutEffect, useMemo, type ReactNode } from "react";
import { deriveTheme } from "./derive";
import { DERIVED_VAR_KEYS, type BrandInput } from "./types";

interface BrandContextValue {
  productName: string;
  logo: { light: string; dark?: string };
}

export const DEFAULT_BRAND_CONTEXT: BrandContextValue = {
  productName: "Assistente OS",
  logo: { light: "" },
};

const BrandContext = createContext<BrandContextValue>(DEFAULT_BRAND_CONTEXT);

export function useBrand(): BrandContextValue {
  return useContext(BrandContext);
}

export function ThemeProvider({
  brand,
  children,
}: {
  brand?: BrandInput | null;
  children: ReactNode;
}) {
  const derived = useMemo(() => (brand ? deriveTheme(brand) : null), [brand]);

  useLayoutEffect(() => {
    if (!derived) return;
    const root = document.documentElement;
    for (const key of DERIVED_VAR_KEYS) {
      root.style.setProperty(key, derived.cssVars[key]);
    }
    return () => {
      for (const key of DERIVED_VAR_KEYS) root.style.removeProperty(key);
    };
  }, [derived]);

  const value = useMemo<BrandContextValue>(
    () => (derived ? { productName: derived.productName, logo: derived.logo } : DEFAULT_BRAND_CONTEXT),
    [derived],
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

// Public API of @assistente-os/ui. Populated as modules land.
export { cn } from "./lib/cn";

export {
  DERIVED_VAR_KEYS,
  InvalidBrandColorError,
  type BrandInput,
  type DerivedTheme,
  type DerivedVarKey,
  type Oklch,
} from "./theme/types";

export { deriveTheme, DEFAULT_DERIVED } from "./theme/derive";

export { ThemeProvider, useBrand, DEFAULT_BRAND_CONTEXT } from "./theme/context";

export { Button, buttonVariants, type ButtonProps } from "./components/button";
export { expectNoA11yViolations } from "./test/axe";

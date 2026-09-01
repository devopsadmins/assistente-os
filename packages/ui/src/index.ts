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

export { Label } from "./components/label";
export { Input } from "./components/input";
export { Textarea } from "./components/textarea";
export { Field, type FieldProps } from "./components/field";

export { Separator } from "./components/separator";
export { Skeleton } from "./components/skeleton";
export { Badge, badgeVariants, type BadgeProps } from "./components/badge";
export { Avatar, AvatarImage, AvatarFallback } from "./components/avatar";
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./components/card";

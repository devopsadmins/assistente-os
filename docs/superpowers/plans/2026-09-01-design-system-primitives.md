# Design System Components — Primitives (A2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shadcn-style primitive component layer to `@assistente-os/ui` — the ~19 Radix-based building blocks (Button, form controls, overlays, Tabs, Toast, etc.) that the product components (plan A2b) and the app (sub-project B) are built from.

**Architecture:** Each primitive is a thin, token-driven wrapper: a Radix UI unstyled primitive (behavior, a11y, keyboard nav) + `class-variance-authority` for variants + Tailwind utility classes that resolve to the CSS vars `packages/ui/src/tokens.css` already defines (`bg-primary`, `border-input`, `ring-ring`, …). No component ever hardcodes a color. Interactive primitives get a behavior test (focus trap, keyboard nav) and an axe a11y smoke test; every primitive gets a Ladle story.

**Tech Stack:** React 19, Radix UI primitives (`@radix-ui/react-*`), `class-variance-authority`, `axe-core` (a11y smoke), Vitest + Testing Library + jsdom (already configured in `packages/ui`).

**Spec:** `docs/superpowers/specs/2026-09-01-design-system-packages-ui-design.md` — §4 (component inventory), §6 (testing philosophy). This plan implements the **primitives** row of §4's inventory table only; the product components (`Message`, `Composer`, `ThreadList`, `AuthCard`, `SettingsPanel`, …) are plan **A2b**, written after this one lands. Read the spec alongside this plan.

## Global Constraints

- No component file under `packages/ui/src/components/**` may contain a raw color literal (`#…`, `rgb(`, `hsl(`, `oklch(`) — color only via a Tailwind class that resolves to a token var. Enforced by Task 10's sweep test.
- Every component is a `React.forwardRef` accepting `className` and merging it last via `cn()` from `packages/ui/src/lib/cn.ts` (`import { cn } from "../lib/cn"`), so consumers can always override/extend styling.
- Every component gets a `*.stories.tsx` beside it (Ladle picks up `src/**/*.stories.tsx` per the existing `.ladle/config.mjs`).
- Radix packages are already covered by `.github/scripts/deps-zones.mjs`'s `FRONTEND_ALLOW` rule `(d) => d.startsWith("@radix-ui/")` — no CI-guard changes needed in this plan. `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` are also already allowlisted. Versions are **pinned exact** (no `^`/`~`), per ADR-UI-001.
- Interactive Radix-based primitives (Dialog, DropdownMenu, Tabs, Select, Switch, Checkbox, Toast) get one behavior test proving the Radix contract works through our wrapper, plus one a11y smoke test via the `expectNoA11yViolations` helper (Task 1). Purely presentational primitives (Separator, Skeleton, Badge, Avatar, Card) get a rendering test only.
- `packages/ui` uses Vitest (established in A1). Commit after every task.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/ui/src/test/axe.ts` | `expectNoA11yViolations(container)` — thin `axe-core` helper shared by every a11y smoke test |
| `packages/ui/src/components/button.tsx` (+`.test.tsx`, `.stories.tsx`) | `Button` — cva variants, `asChild` via `@radix-ui/react-slot` |
| `packages/ui/src/components/label.tsx` `input.tsx` `textarea.tsx` `field.tsx` (+tests, +stories) | Form primitives; `Field` wraps label+hint+error+`aria-describedby` around any input |
| `packages/ui/src/components/separator.tsx` `skeleton.tsx` `badge.tsx` `avatar.tsx` `card.tsx` (+tests, +stories) | Presentational primitives |
| `packages/ui/src/components/dialog.tsx` `popover.tsx` (+tests, +stories) | Portal-based overlays with focus trap |
| `packages/ui/src/components/tooltip.tsx` `dropdown-menu.tsx` (+tests, +stories) | Hover/menu overlays with keyboard nav |
| `packages/ui/src/components/tabs.tsx` (+test, +story) | Tab navigation |
| `packages/ui/src/components/select.tsx` `switch.tsx` `checkbox.tsx` (+tests, +stories) | Form controls |
| `packages/ui/src/components/scroll-area.tsx` (+test, +story) | Styled scroll container |
| `packages/ui/src/components/toast.tsx` `toaster.tsx` + `packages/ui/src/hooks/use-toast.ts` (+tests, +story) | App-wide error/confirmation surface — FM6 depends on this |
| `packages/ui/src/components/no-hardcoded-color.test.ts` | Sweeps every file in `src/components/**` for raw color literals |
| `packages/ui/src/index.ts` | Barrel — every task appends its exports (cumulative, like A1) |

---

### Task 1: Setup — deps, axe helper, `Button`

**Files:**
- Modify: `packages/ui/package.json` (add deps below)
- Create: `packages/ui/src/test/axe.ts`
- Create: `packages/ui/src/components/button.tsx`
- Create: `packages/ui/src/components/button.test.tsx`
- Create: `packages/ui/src/components/button.stories.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn` from `../lib/cn` (A1).
- Produces: `Button` (forwardRef `<button>` or `asChild` passthrough), `buttonVariants` (the `cva` instance, exported so later components can reuse the same variant scale for link-styled buttons), `expectNoA11yViolations(container: Element): Promise<void>`.

- [ ] **Step 1: Add dependencies to `packages/ui/package.json`**

Add to `"dependencies"`:
```json
    "class-variance-authority": "0.7.1",
    "@radix-ui/react-slot": "1.1.1"
```
Add to `"devDependencies"`:
```json
    "axe-core": "4.10.2"
```
(Keep every existing entry; these are additions, pinned exact — no `^`.)

- [ ] **Step 2: Install**

Run: `npm install`
Expected: exits 0, `node_modules/@radix-ui/react-slot` and `node_modules/class-variance-authority` and `node_modules/axe-core` exist.

- [ ] **Step 3: Write `packages/ui/src/test/axe.ts`**

```ts
import axe from "axe-core";
import { expect } from "vitest";

/** Asserts zero axe-core violations for the given rendered container. */
export async function expectNoA11yViolations(container: Element): Promise<void> {
  const results = await axe.run(container);
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toHaveLength(0);
}
```

- [ ] **Step 4: Write the failing test — `packages/ui/src/components/button.test.tsx`**

```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";
import { expectNoA11yViolations } from "../test/axe";

test("renders the default variant with token classes", () => {
  render(<Button>Enviar</Button>);
  const btn = screen.getByRole("button", { name: "Enviar" });
  expect(btn.className).toMatch(/bg-primary\b/);
  expect(btn.className).toMatch(/text-primary-foreground\b/);
});

test("applies variant and size overrides", () => {
  render(
    <Button variant="ghost" size="lg">
      X
    </Button>,
  );
  const btn = screen.getByRole("button");
  expect(btn.className).toMatch(/h-12\b/);
  expect(btn.className).not.toMatch(/bg-primary\b/);
});

test("merges a caller className without dropping variant classes", () => {
  render(<Button className="w-full">Full</Button>);
  const btn = screen.getByRole("button");
  expect(btn.className).toMatch(/w-full\b/);
  expect(btn.className).toMatch(/bg-primary\b/);
});

test("asChild renders the child element instead of a <button>", () => {
  render(
    <Button asChild>
      <a href="/x">Link</a>
    </Button>,
  );
  expect(screen.getByRole("link", { name: "Link" })).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("disabled button is not clickable and is announced as disabled", async () => {
  const user = userEvent.setup();
  let clicked = false;
  render(
    <Button disabled onClick={() => (clicked = true)}>
      Off
    </Button>,
  );
  await user.click(screen.getByRole("button"));
  expect(clicked).toBe(false);
});

test("has no a11y violations", async () => {
  const { container } = render(<Button>Enviar</Button>);
  await expectNoA11yViolations(container);
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test -w @assistente-os/ui -- button`
Expected: FAIL — cannot resolve `./button`.

- [ ] **Step 6: Write `packages/ui/src/components/button.tsx`**

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the single child element instead of a <button>, passing all props/behavior through (Radix Slot). */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";
```

- [ ] **Step 7: Write `packages/ui/src/components/button.stories.tsx`**

```tsx
import { Button } from "./button";

export const Default = () => <Button>Enviar</Button>;
export const Variants = () => (
  <div style={{ display: "flex", gap: 8 }}>
    <Button variant="default">default</Button>
    <Button variant="secondary">secondary</Button>
    <Button variant="ghost">ghost</Button>
    <Button variant="destructive">destructive</Button>
    <Button variant="link">link</Button>
  </div>
);
export const Sizes = () => (
  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
    <Button size="sm">sm</Button>
    <Button size="md">md</Button>
    <Button size="lg">lg</Button>
  </div>
);
export const Disabled = () => <Button disabled>Desabilitado</Button>;
```

- [ ] **Step 8: Export from the barrel — append to `packages/ui/src/index.ts`**

```ts
export { Button, buttonVariants, type ButtonProps } from "./components/button";
export { expectNoA11yViolations } from "./test/axe";
```

- [ ] **Step 9: Run tests + typecheck**

Run: `npm test -w @assistente-os/ui`
Expected: PASS — all prior A1 tests plus 6 new in `button.test.tsx`.

Run: `npm run typecheck -w @assistente-os/ui`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): Button primitive + axe a11y test helper"
```

---

### Task 2: Form primitives — `Label`, `Input`, `Textarea`, `Field`

**Files:**
- Create: `packages/ui/src/components/label.tsx` `label.test.tsx` `label.stories.tsx`
- Create: `packages/ui/src/components/input.tsx` `input.test.tsx`
- Create: `packages/ui/src/components/textarea.tsx` `textarea.test.tsx`
- Create: `packages/ui/src/components/field.tsx` `field.test.tsx` `field.stories.tsx`
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn` (A1).
- Produces: `Label`, `Input`, `Textarea` (plain styled form elements, forwardRef), `Field` (wraps any single-input child: injects `id`, `aria-describedby`, `aria-invalid`; renders the label + optional hint/error text below).

- [ ] **Step 1: Write the failing tests**

`packages/ui/src/components/label.test.tsx`:
```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Label } from "./label";

test("associates with a control via htmlFor", () => {
  render(
    <>
      <Label htmlFor="x">Nome</Label>
      <input id="x" />
    </>,
  );
  expect(screen.getByLabelText("Nome")).toBeInTheDocument();
});
```

`packages/ui/src/components/input.test.tsx`:
```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./input";

test("accepts typed input", async () => {
  const user = userEvent.setup();
  render(<Input placeholder="e-mail" />);
  const el = screen.getByPlaceholderText("e-mail");
  await user.type(el, "a@b.com");
  expect(el).toHaveValue("a@b.com");
});

test("uses token border/ring classes", () => {
  render(<Input placeholder="x" />);
  expect(screen.getByPlaceholderText("x").className).toMatch(/border-input\b/);
});
```

`packages/ui/src/components/textarea.test.tsx`:
```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Textarea } from "./textarea";

test("renders a multi-row textarea", () => {
  render(<Textarea placeholder="msg" rows={4} />);
  const el = screen.getByPlaceholderText("msg") as HTMLTextAreaElement;
  expect(el.tagName).toBe("TEXTAREA");
  expect(el.rows).toBe(4);
});
```

`packages/ui/src/components/field.test.tsx`:
```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "./field";
import { Input } from "./input";

test("wires label, hint, and injects id/aria-describedby onto the child", () => {
  render(
    <Field label="E-mail" htmlFor="email" hint="usamos só pra login">
      <Input />
    </Field>,
  );
  const input = screen.getByLabelText("E-mail");
  expect(input).toHaveAttribute("id", "email");
  expect(screen.getByText("usamos só pra login")).toHaveAttribute("id", "email-hint");
  expect(input.getAttribute("aria-describedby")).toContain("email-hint");
});

test("shows error instead of hint and marks aria-invalid", () => {
  render(
    <Field label="Senha" htmlFor="pwd" hint="mín. 8 caracteres" error="senha muito curta">
      <Input type="password" />
    </Field>,
  );
  const input = screen.getByLabelText("Senha");
  expect(screen.queryByText("mín. 8 caracteres")).not.toBeInTheDocument();
  expect(screen.getByText("senha muito curta")).toHaveAttribute("id", "pwd-error");
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input.getAttribute("aria-describedby")).toContain("pwd-error");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w @assistente-os/ui -- label input textarea field`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Write `packages/ui/src/components/label.tsx`**

```tsx
import * as React from "react";
import { cn } from "../lib/cn";

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
      {...props}
    />
  ),
);
Label.displayName = "Label";
```

- [ ] **Step 4: Write `packages/ui/src/components/input.tsx`**

```tsx
import * as React from "react";
import { cn } from "../lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "aria-[invalid=true]:border-destructive",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
```

- [ ] **Step 5: Write `packages/ui/src/components/textarea.tsx`**

```tsx
import * as React from "react";
import { cn } from "../lib/cn";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "aria-[invalid=true]:border-destructive",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
```

- [ ] **Step 6: Write `packages/ui/src/components/field.tsx`**

```tsx
import * as React from "react";
import { cn } from "../lib/cn";
import { Label } from "./label";

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
}

/** Wraps a single input-like child: injects id/aria-describedby/aria-invalid, renders label + hint or error below. */
export function Field({ label, htmlFor, hint, error, className, children }: FieldProps) {
  const hintId = hint && !error ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {React.cloneElement(children, {
        id: htmlFor,
        "aria-describedby": describedBy,
        "aria-invalid": Boolean(error) || undefined,
      })}
      {hintId && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {errorId && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Write stories — `label.stories.tsx`, `field.stories.tsx`**

```tsx
// label.stories.tsx
import { Label } from "./label";
export const Default = () => <Label htmlFor="x">Nome</Label>;
```

```tsx
// field.stories.tsx
import { Field } from "./field";
import { Input } from "./input";
export const WithHint = () => (
  <Field label="E-mail" htmlFor="email" hint="usamos só pra login">
    <Input placeholder="voce@exemplo.com" />
  </Field>
);
export const WithError = () => (
  <Field label="Senha" htmlFor="pwd" error="senha muito curta">
    <Input type="password" />
  </Field>
);
```

- [ ] **Step 8: Export from the barrel — append to `packages/ui/src/index.ts`**

```ts
export { Label } from "./components/label";
export { Input } from "./components/input";
export { Textarea } from "./components/textarea";
export { Field, type FieldProps } from "./components/field";
```

- [ ] **Step 9: Run tests + typecheck**

Run: `npm test -w @assistente-os/ui`
Expected: PASS — prior tests + 6 new (1 label + 2 input + 1 textarea + 2 field).

Run: `npm run typecheck -w @assistente-os/ui`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): form primitives — Label, Input, Textarea, Field"
```

---

### Task 3: Presentational primitives — `Separator`, `Skeleton`, `Badge`, `Avatar`, `Card`

**Files:**
- Create: `packages/ui/src/components/separator.tsx` `separator.test.tsx`
- Create: `packages/ui/src/components/skeleton.tsx` `skeleton.test.tsx`
- Create: `packages/ui/src/components/badge.tsx` `badge.test.tsx`
- Create: `packages/ui/src/components/avatar.tsx` `avatar.test.tsx`
- Create: `packages/ui/src/components/card.tsx` `card.test.tsx` `card.stories.tsx`
- Modify: `packages/ui/package.json` (add `@radix-ui/react-avatar`)
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn`, `cva` pattern from Task 1 (Badge uses `cva` the same way Button does).
- Produces: `Separator`, `Skeleton`, `Badge` (+`badgeVariants`), `Avatar`/`AvatarImage`/`AvatarFallback`, `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`.

- [ ] **Step 1: Add dependency**

`packages/ui/package.json` `"dependencies"`, add:
```json
    "@radix-ui/react-avatar": "1.1.2",
    "@radix-ui/react-separator": "1.1.1"
```
Run: `npm install`

- [ ] **Step 2: Write the failing tests**

`separator.test.tsx`:
```tsx
import { expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Separator } from "./separator";

test("renders a horizontal separator by default", () => {
  const { container } = render(<Separator />);
  expect(container.firstChild).toHaveAttribute("data-orientation", "horizontal");
});
```

`skeleton.test.tsx`:
```tsx
import { expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./skeleton";

test("renders a pulsing placeholder block", () => {
  const { container } = render(<Skeleton className="h-4 w-32" />);
  expect(container.firstChild).toHaveClass("animate-pulse");
});
```

`badge.test.tsx`:
```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

test("renders default variant", () => {
  render(<Badge>Novo</Badge>);
  expect(screen.getByText("Novo").className).toMatch(/bg-primary\b/);
});

test("renders destructive variant", () => {
  render(<Badge variant="destructive">Erro</Badge>);
  expect(screen.getByText("Erro").className).toMatch(/bg-destructive\b/);
});
```

`avatar.test.tsx`:
```tsx
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
```

`card.test.tsx`:
```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./card";

test("composes header/content/footer with token classes", () => {
  render(
    <Card>
      <CardHeader>
        <CardTitle>Título</CardTitle>
        <CardDescription>Descrição</CardDescription>
      </CardHeader>
      <CardContent>Corpo</CardContent>
      <CardFooter>Rodapé</CardFooter>
    </Card>,
  );
  expect(screen.getByText("Título").tagName).toBe("H3");
  expect(screen.getByText("Corpo")).toBeInTheDocument();
  expect(screen.getByText("Descrição").className).toMatch(/text-muted-foreground\b/);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @assistente-os/ui -- separator skeleton badge avatar card`
Expected: FAIL.

- [ ] **Step 4: Write `packages/ui/src/components/separator.tsx`**

```tsx
import * as React from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { cn } from "../lib/cn";

export const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    orientation={orientation}
    decorative={decorative}
    className={cn(
      "shrink-0 bg-border",
      orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
      className,
    )}
    {...props}
  />
));
Separator.displayName = "Separator";
```

- [ ] **Step 5: Write `packages/ui/src/components/skeleton.tsx`**

```tsx
import * as React from "react";
import { cn } from "../lib/cn";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
```

- [ ] **Step 6: Write `packages/ui/src/components/badge.tsx`**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

export const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive text-destructive-foreground",
        outline: "border border-border text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

- [ ] **Step 7: Write `packages/ui/src/components/avatar.tsx`**

```tsx
import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cn } from "../lib/cn";

export const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", className)}
    {...props}
  />
));
Avatar.displayName = "Avatar";

export const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image ref={ref} className={cn("aspect-square h-full w-full object-cover", className)} {...props} />
));
AvatarImage.displayName = "AvatarImage";

export const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn("flex h-full w-full items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground", className)}
    {...props}
  />
));
AvatarFallback.displayName = "AvatarFallback";
```

- [ ] **Step 8: Write `packages/ui/src/components/card.tsx`**

```tsx
import * as React from "react";
import { cn } from "../lib/cn";

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("rounded-lg border border-border bg-card text-card-foreground shadow-sm", className)} {...props} />
  ),
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />,
);
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => <h3 ref={ref} className={cn("text-lg font-semibold leading-none", className)} {...props} />,
);
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />,
);
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />,
);
CardContent.displayName = "CardContent";

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />,
);
CardFooter.displayName = "CardFooter";
```

- [ ] **Step 9: Write `packages/ui/src/components/card.stories.tsx`**

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./card";
import { Button } from "./button";

export const Default = () => (
  <Card style={{ maxWidth: 360 }}>
    <CardHeader>
      <CardTitle>Criar assistente</CardTitle>
      <CardDescription>No que você quer que ele te ajude?</CardDescription>
    </CardHeader>
    <CardContent>Conteúdo do card.</CardContent>
    <CardFooter>
      <Button size="sm">Criar</Button>
    </CardFooter>
  </Card>
);
```

- [ ] **Step 10: Export from the barrel — append to `packages/ui/src/index.ts`**

```ts
export { Separator } from "./components/separator";
export { Skeleton } from "./components/skeleton";
export { Badge, badgeVariants, type BadgeProps } from "./components/badge";
export { Avatar, AvatarImage, AvatarFallback } from "./components/avatar";
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./components/card";
```

- [ ] **Step 11: Run tests + typecheck, then commit**

Run: `npm test -w @assistente-os/ui` — expect PASS, prior + 6 new.
Run: `npm run typecheck -w @assistente-os/ui` — expect exit 0.

```bash
git add packages/ui
git commit -m "feat(ui): presentational primitives — Separator, Skeleton, Badge, Avatar, Card"
```

---

### Task 4: Overlays A — `Dialog`, `Popover`

**Files:**
- Create: `packages/ui/src/components/dialog.tsx` `dialog.test.tsx` `dialog.stories.tsx`
- Create: `packages/ui/src/components/popover.tsx` `popover.test.tsx`
- Modify: `packages/ui/package.json` (add `@radix-ui/react-dialog`, `@radix-ui/react-popover`)
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn`, `expectNoA11yViolations` (Task 1).
- Produces: `Dialog`/`DialogTrigger`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogFooter`/`DialogClose`; `Popover`/`PopoverTrigger`/`PopoverContent`.

- [ ] **Step 1: Add dependencies**

`package.json` `"dependencies"`:
```json
    "@radix-ui/react-dialog": "1.1.4",
    "@radix-ui/react-popover": "1.1.4"
```
Run: `npm install`

- [ ] **Step 2: Write the failing tests**

`dialog.test.tsx` — this is the Global Constraint's "Dialog prende foco e restaura no close" contract from spec §6:
```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./dialog";
import { Button } from "./button";
import { expectNoA11yViolations } from "../test/axe";

function Example() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Abrir</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Título</DialogTitle>
        <DialogDescription>Descrição do diálogo</DialogDescription>
        <button>dentro</button>
      </DialogContent>
    </Dialog>
  );
}

test("opens on trigger click and traps focus inside", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Abrir" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("dentro")).toBeInTheDocument();
});

test("closes on Escape and restores focus to the trigger", async () => {
  const user = userEvent.setup();
  render(<Example />);
  const trigger = screen.getByRole("button", { name: "Abrir" });
  await user.click(trigger);
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("has no a11y violations while open", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("button", { name: "Abrir" }));
  await expectNoA11yViolations(screen.getByRole("dialog"));
});
```

`popover.test.tsx`:
```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";
import { Button } from "./button";

test("opens content on trigger click", async () => {
  const user = userEvent.setup();
  render(
    <Popover>
      <PopoverTrigger asChild>
        <Button>Abrir</Button>
      </PopoverTrigger>
      <PopoverContent>Conteúdo flutuante</PopoverContent>
    </Popover>,
  );
  expect(screen.queryByText("Conteúdo flutuante")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Abrir" }));
  expect(screen.getByText("Conteúdo flutuante")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @assistente-os/ui -- dialog popover`
Expected: FAIL.

- [ ] **Step 4: Write `packages/ui/src/components/dialog.tsx`**

```tsx
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn("fixed inset-0 z-50 bg-foreground/40", className)} {...props} />
));
DialogOverlay.displayName = "DialogOverlay";

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4",
        "rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg",
        "focus-visible:outline-none",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X className="h-4 w-4" />
        <span className="sr-only">Fechar</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex justify-end gap-2", className)} {...props} />;
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-lg font-semibold", className)} {...props} />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = "DialogDescription";
```

- [ ] **Step 5: Write `packages/ui/src/components/popover.tsx`**

```tsx
import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "../lib/cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md",
        "focus-visible:outline-none",
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";
```

- [ ] **Step 6: Write `packages/ui/src/components/dialog.stories.tsx`**

```tsx
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "./dialog";
import { Button } from "./button";

export const Default = () => (
  <Dialog>
    <DialogTrigger asChild>
      <Button>Abrir diálogo</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Confirmar</DialogTitle>
        <DialogDescription>Essa ação não pode ser desfeita.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">Cancelar</Button>
        </DialogClose>
        <Button variant="destructive">Confirmar</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
```

- [ ] **Step 7: Export from the barrel — append to `packages/ui/src/index.ts`**

```ts
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./components/dialog";
export { Popover, PopoverTrigger, PopoverContent } from "./components/popover";
```

- [ ] **Step 8: Run tests + typecheck, then commit**

Run: `npm test -w @assistente-os/ui` — expect PASS, prior + 4 new.
Run: `npm run typecheck -w @assistente-os/ui` — expect exit 0.

```bash
git add packages/ui
git commit -m "feat(ui): overlay primitives — Dialog, Popover"
```

---

### Task 5: Overlays B — `Tooltip`, `DropdownMenu`

**Files:**
- Create: `packages/ui/src/components/tooltip.tsx` `tooltip.test.tsx`
- Create: `packages/ui/src/components/dropdown-menu.tsx` `dropdown-menu.test.tsx` `dropdown-menu.stories.tsx`
- Modify: `packages/ui/package.json` (add `@radix-ui/react-tooltip`, `@radix-ui/react-dropdown-menu`)
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn` (A1).
- Produces: `TooltipProvider`/`Tooltip`/`TooltipTrigger`/`TooltipContent`; `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuContent`/`DropdownMenuItem`/`DropdownMenuSeparator`.

- [ ] **Step 1: Add dependencies**

```json
    "@radix-ui/react-tooltip": "1.1.6",
    "@radix-ui/react-dropdown-menu": "2.1.4"
```
Run: `npm install`

- [ ] **Step 2: Write the failing tests**

`tooltip.test.tsx`:
```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "./tooltip";
import { Button } from "./button";

test("shows content on hover", async () => {
  const user = userEvent.setup();
  render(
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button>Alvo</Button>
        </TooltipTrigger>
        <TooltipContent>Dica</TooltipContent>
      </Tooltip>
    </TooltipProvider>,
  );
  await user.hover(screen.getByRole("button", { name: "Alvo" }));
  expect(await screen.findByText("Dica")).toBeInTheDocument();
});
```

`dropdown-menu.test.tsx` — the Global Constraint's "DropdownMenu por teclado" contract from spec §6:
```tsx
import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "./dropdown-menu";
import { Button } from "./button";

test("opens with keyboard (Enter) and navigates items with ArrowDown, activates with Enter", async () => {
  const user = userEvent.setup();
  const onSelectA = vi.fn();
  render(
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>Ações</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onSelectA}>Renomear</DropdownMenuItem>
        <DropdownMenuItem>Excluir</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  const trigger = screen.getByRole("button", { name: "Ações" });
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(await screen.findByText("Renomear")).toBeInTheDocument();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(onSelectA).not.toHaveBeenCalled(); // ArrowDown moved off "Renomear" onto "Excluir" first
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @assistente-os/ui -- tooltip dropdown-menu`
Expected: FAIL.

- [ ] **Step 4: Write `packages/ui/src/components/tooltip.tsx`**

```tsx
import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "../lib/cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 rounded-md bg-foreground px-3 py-1.5 text-xs text-background shadow-md",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = "TooltipContent";
```

- [ ] **Step 5: Write `packages/ui/src/components/dropdown-menu.tsx`**

```tsx
import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "../lib/cn";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[8rem] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none",
      "focus:bg-accent focus:text-accent-foreground",
      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
```

- [ ] **Step 6: Write `packages/ui/src/components/dropdown-menu.stories.tsx`**

```tsx
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "./dropdown-menu";
import { Button } from "./button";

export const Default = () => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="secondary">Ações</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem>Renomear</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem>Excluir</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
```

- [ ] **Step 7: Export from the barrel — append to `packages/ui/src/index.ts`**

```ts
export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "./components/tooltip";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./components/dropdown-menu";
```

- [ ] **Step 8: Run tests + typecheck, then commit**

Run: `npm test -w @assistente-os/ui` — expect PASS, prior + 2 new.
Run: `npm run typecheck -w @assistente-os/ui` — expect exit 0.

```bash
git add packages/ui
git commit -m "feat(ui): overlay primitives — Tooltip, DropdownMenu"
```

---

### Task 6: `Tabs`

**Files:**
- Create: `packages/ui/src/components/tabs.tsx` `tabs.test.tsx` `tabs.stories.tsx`
- Modify: `packages/ui/package.json` (add `@radix-ui/react-tabs`)
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn`.
- Produces: `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`. Used by `AuthCard` and `SettingsPanel` in plan A2b.

- [ ] **Step 1: Add dependency**

```json
    "@radix-ui/react-tabs": "1.1.2"
```
Run: `npm install`

- [ ] **Step 2: Write the failing test — `packages/ui/src/components/tabs.test.tsx`**

```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";

function Example() {
  return (
    <Tabs defaultValue="login">
      <TabsList>
        <TabsTrigger value="login">Entrar</TabsTrigger>
        <TabsTrigger value="signup">Criar conta</TabsTrigger>
      </TabsList>
      <TabsContent value="login">form de login</TabsContent>
      <TabsContent value="signup">form de cadastro</TabsContent>
    </Tabs>
  );
}

test("shows the default tab's content and hides the other", () => {
  render(<Example />);
  expect(screen.getByText("form de login")).toBeInTheDocument();
  expect(screen.queryByText("form de cadastro")).not.toBeInTheDocument();
});

test("switches content on trigger click, and via ArrowRight + Enter from the keyboard", async () => {
  const user = userEvent.setup();
  render(<Example />);
  await user.click(screen.getByRole("tab", { name: "Criar conta" }));
  expect(screen.getByText("form de cadastro")).toBeInTheDocument();
  expect(screen.queryByText("form de login")).not.toBeInTheDocument();

  screen.getByRole("tab", { name: "Criar conta" }).focus();
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "Entrar" })).toHaveFocus();
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @assistente-os/ui -- tabs`
Expected: FAIL.

- [ ] **Step 4: Write `packages/ui/src/components/tabs.tsx`**

```tsx
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "../lib/cn";

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn("inline-flex items-center gap-1 rounded-md bg-muted p-1", className)}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
      "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      "data-[state=inactive]:text-muted-foreground",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn("mt-4 focus-visible:outline-none", className)} {...props} />
));
TabsContent.displayName = "TabsContent";
```

- [ ] **Step 5: Write `packages/ui/src/components/tabs.stories.tsx`**

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";

export const Default = () => (
  <Tabs defaultValue="login" style={{ width: 320 }}>
    <TabsList>
      <TabsTrigger value="login">Entrar</TabsTrigger>
      <TabsTrigger value="signup">Criar conta</TabsTrigger>
    </TabsList>
    <TabsContent value="login">Formulário de login aqui.</TabsContent>
    <TabsContent value="signup">Formulário de cadastro aqui.</TabsContent>
  </Tabs>
);
```

- [ ] **Step 6: Export from the barrel — append to `packages/ui/src/index.ts`**

```ts
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/tabs";
```

- [ ] **Step 7: Run tests + typecheck, then commit**

Run: `npm test -w @assistente-os/ui` — expect PASS, prior + 2 new.
Run: `npm run typecheck -w @assistente-os/ui` — expect exit 0.

```bash
git add packages/ui
git commit -m "feat(ui): Tabs primitive"
```

---

### Task 7: Form controls — `Select`, `Switch`, `Checkbox`

**Files:**
- Create: `packages/ui/src/components/select.tsx` `select.test.tsx`
- Create: `packages/ui/src/components/switch.tsx` `switch.test.tsx`
- Create: `packages/ui/src/components/checkbox.tsx` `checkbox.test.tsx` `checkbox.stories.tsx`
- Modify: `packages/ui/package.json` (add `@radix-ui/react-select`, `@radix-ui/react-switch`, `@radix-ui/react-checkbox`)
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn`.
- Produces: `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`; `Switch`; `Checkbox`.

- [ ] **Step 1: Add dependencies**

```json
    "@radix-ui/react-select": "2.1.4",
    "@radix-ui/react-switch": "1.1.2",
    "@radix-ui/react-checkbox": "1.1.3"
```
Run: `npm install`

- [ ] **Step 2: Write the failing tests**

`select.test.tsx`:
```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./select";

test("opens and selects an item, updating the displayed value", async () => {
  const user = userEvent.setup();
  render(
    <Select defaultValue="local">
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="local">local</SelectItem>
        <SelectItem value="zen">zen</SelectItem>
      </SelectContent>
    </Select>,
  );
  expect(screen.getByRole("combobox")).toHaveTextContent("local");
  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByText("zen"));
  expect(screen.getByRole("combobox")).toHaveTextContent("zen");
});
```

`switch.test.tsx`:
```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./switch";

test("toggles checked state on click", async () => {
  const user = userEvent.setup();
  render(<Switch aria-label="ativo" />);
  const el = screen.getByRole("switch", { name: "ativo" });
  expect(el).toHaveAttribute("aria-checked", "false");
  await user.click(el);
  expect(el).toHaveAttribute("aria-checked", "true");
});
```

`checkbox.test.tsx`:
```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "./checkbox";

test("toggles checked state on click and via Space", async () => {
  const user = userEvent.setup();
  render(<Checkbox aria-label="aceito" />);
  const el = screen.getByRole("checkbox", { name: "aceito" });
  expect(el).toHaveAttribute("aria-checked", "false");
  await user.click(el);
  expect(el).toHaveAttribute("aria-checked", "true");
  await user.keyboard(" ");
  expect(el).toHaveAttribute("aria-checked", "false");
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @assistente-os/ui -- select switch checkbox`
Expected: FAIL.

- [ ] **Step 4: Write `packages/ui/src/components/select.tsx`**

```tsx
import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm",
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn("z-50 min-w-[8rem] rounded-md border border-border bg-popover text-popover-foreground shadow-md", className)}
      {...props}
    >
      <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = "SelectContent";

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none",
      "focus:bg-accent focus:text-accent-foreground",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = "SelectItem";
```

- [ ] **Step 5: Write `packages/ui/src/components/switch.tsx`**

```tsx
import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../lib/cn";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors",
      "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block h-5 w-5 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-5" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
```

- [ ] **Step 6: Write `packages/ui/src/components/checkbox.tsx`**

```tsx
import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "../lib/cn";

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-input",
      "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator>
      <Check className="h-3.5 w-3.5" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";
```

- [ ] **Step 7: Write `packages/ui/src/components/checkbox.stories.tsx`**

```tsx
import { Checkbox } from "./checkbox";
import { Label } from "./label";

export const Default = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <Checkbox id="terms" />
    <Label htmlFor="terms">Aceito os termos</Label>
  </div>
);
```

- [ ] **Step 8: Export from the barrel — append to `packages/ui/src/index.ts`**

```ts
export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem } from "./components/select";
export { Switch } from "./components/switch";
export { Checkbox } from "./components/checkbox";
```

- [ ] **Step 9: Run tests + typecheck, then commit**

Run: `npm test -w @assistente-os/ui` — expect PASS, prior + 3 new.
Run: `npm run typecheck -w @assistente-os/ui` — expect exit 0.

```bash
git add packages/ui
git commit -m "feat(ui): form controls — Select, Switch, Checkbox"
```

---

### Task 8: `ScrollArea`

**Files:**
- Create: `packages/ui/src/components/scroll-area.tsx` `scroll-area.test.tsx` `scroll-area.stories.tsx`
- Modify: `packages/ui/package.json` (add `@radix-ui/react-scroll-area`)
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn`.
- Produces: `ScrollArea` — used by `MessageList`/`ThreadList` in plan A2b.

- [ ] **Step 1: Add dependency**

```json
    "@radix-ui/react-scroll-area": "1.2.2"
```
Run: `npm install`

- [ ] **Step 2: Write the failing test — `packages/ui/src/components/scroll-area.test.tsx`**

```tsx
import { expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScrollArea } from "./scroll-area";

test("renders its children inside a scrollable viewport", () => {
  render(
    <ScrollArea className="h-20">
      <p>conteúdo rolável</p>
    </ScrollArea>,
  );
  expect(screen.getByText("conteúdo rolável")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @assistente-os/ui -- scroll-area`
Expected: FAIL.

- [ ] **Step 4: Write `packages/ui/src/components/scroll-area.tsx`**

```tsx
import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "../lib/cn";

export const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root ref={ref} className={cn("relative overflow-hidden", className)} {...props}>
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">{children}</ScrollAreaPrimitive.Viewport>
    <ScrollAreaPrimitive.Scrollbar
      orientation="vertical"
      className="flex w-2.5 touch-none select-none border-l border-l-transparent p-px transition-colors"
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
    </ScrollAreaPrimitive.Scrollbar>
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
));
ScrollArea.displayName = "ScrollArea";
```

- [ ] **Step 5: Write `packages/ui/src/components/scroll-area.stories.tsx`**

```tsx
import { ScrollArea } from "./scroll-area";

export const Default = () => (
  <ScrollArea className="h-40 w-64 rounded-md border border-border p-4">
    {Array.from({ length: 30 }, (_, i) => (
      <p key={i}>linha {i + 1}</p>
    ))}
  </ScrollArea>
);
```

- [ ] **Step 6: Export from the barrel — append to `packages/ui/src/index.ts`**

```ts
export { ScrollArea } from "./components/scroll-area";
```

- [ ] **Step 7: Run tests + typecheck, then commit**

Run: `npm test -w @assistente-os/ui` — expect PASS, prior + 1 new.
Run: `npm run typecheck -w @assistente-os/ui` — expect exit 0.

```bash
git add packages/ui
git commit -m "feat(ui): ScrollArea primitive"
```

---

### Task 9: `Toast` + `Toaster` + `useToast`

**Files:**
- Create: `packages/ui/src/components/toast.tsx`
- Create: `packages/ui/src/components/toaster.tsx` `toaster.test.tsx` `toaster.stories.tsx`
- Create: `packages/ui/src/hooks/use-toast.ts` `use-toast.test.ts`
- Modify: `packages/ui/package.json` (add `@radix-ui/react-toast`)
- Modify: `packages/ui/src/index.ts`

**Interfaces:**
- Consumes: `cn`.
- Produces: `Toaster` (mount once at app root), `useToast(): { toast: (opts: ToastOptions) => void }`. This is the surface **FM6** (backlog: mensagens de erro amigáveis) depends on.

- [ ] **Step 1: Add dependency**

```json
    "@radix-ui/react-toast": "1.2.4"
```
Run: `npm install`

- [ ] **Step 2: Write the failing tests**

`packages/ui/src/hooks/use-toast.test.ts` — this hook holds a tiny module-level store (so any component can call `toast()` without prop-drilling, and `Toaster` reads the same store):
```ts
import { expect, test, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useToast, __resetToastStoreForTests } from "./use-toast";

beforeEach(() => {
  __resetToastStoreForTests();
});

test("toast() adds an entry that the hook exposes", () => {
  const { result } = renderHook(() => useToast());
  act(() => {
    result.current.toast({ title: "Salvo", variant: "default" });
  });
  expect(result.current.toasts).toHaveLength(1);
  expect(result.current.toasts[0].title).toBe("Salvo");
});

test("dismiss(id) removes the entry", () => {
  const { result } = renderHook(() => useToast());
  let id = "";
  act(() => {
    id = result.current.toast({ title: "Erro", variant: "destructive" });
  });
  expect(result.current.toasts).toHaveLength(1);
  act(() => {
    result.current.dismiss(id);
  });
  expect(result.current.toasts).toHaveLength(0);
});
```

`packages/ui/src/components/toaster.test.tsx`:
```tsx
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
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -w @assistente-os/ui -- use-toast toaster`
Expected: FAIL.

- [ ] **Step 4: Write `packages/ui/src/hooks/use-toast.ts`**

```ts
import { useSyncExternalStore } from "react";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: "default" | "destructive";
}

export interface ToastEntry extends ToastOptions {
  id: string;
}

let toasts: ToastEntry[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ToastEntry[] {
  return toasts;
}

function addToast(opts: ToastOptions): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  toasts = [...toasts, { ...opts, id }];
  emit();
  return id;
}

function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Test-only: clears the module-level toast store between tests. */
export function __resetToastStoreForTests(): void {
  toasts = [];
  emit();
}

export function useToast(): { toasts: ToastEntry[]; toast: (opts: ToastOptions) => string; dismiss: (id: string) => void } {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { toasts: snapshot, toast: addToast, dismiss: dismissToast };
}
```

- [ ] **Step 5: Write `packages/ui/src/components/toast.tsx`**

```tsx
import * as React from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { cn } from "../lib/cn";

export const ToastProvider = ToastPrimitive.Provider;
export const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn("fixed bottom-0 right-0 z-50 flex w-full max-w-sm flex-col gap-2 p-4", className)}
    {...props}
  />
));
ToastViewport.displayName = "ToastViewport";

export const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> & { variant?: "default" | "destructive" }
>(({ className, variant = "default", ...props }, ref) => (
  <ToastPrimitive.Root
    ref={ref}
    className={cn(
      "flex items-start justify-between gap-3 rounded-md border p-4 shadow-md",
      variant === "destructive"
        ? "border-destructive bg-destructive text-destructive-foreground"
        : "border-border bg-card text-card-foreground",
      className,
    )}
    {...props}
  />
));
Toast.displayName = "Toast";

export const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title ref={ref} className={cn("text-sm font-semibold", className)} {...props} />
));
ToastTitle.displayName = "ToastTitle";

export const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description ref={ref} className={cn("text-sm opacity-90", className)} {...props} />
));
ToastDescription.displayName = "ToastDescription";

export const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close ref={ref} className={cn("opacity-70 hover:opacity-100", className)} {...props}>
    <X className="h-4 w-4" />
  </ToastPrimitive.Close>
));
ToastClose.displayName = "ToastClose";
```

- [ ] **Step 6: Write `packages/ui/src/components/toaster.tsx`**

```tsx
import { useToast } from "../hooks/use-toast";
import { ToastProvider, ToastViewport, Toast, ToastTitle, ToastDescription, ToastClose } from "./toast";

/** Mount once at the app root. Renders whatever useToast().toast(...) pushes. */
export function Toaster() {
  const { toasts, dismiss } = useToast();
  return (
    <ToastProvider swipeDirection="right">
      {toasts.map(({ id, title, description, variant }) => (
        <Toast key={id} variant={variant} onOpenChange={(open) => !open && dismiss(id)}>
          <div className="grid gap-1">
            <ToastTitle>{title}</ToastTitle>
            {description && <ToastDescription>{description}</ToastDescription>}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
```

- [ ] **Step 7: Write `packages/ui/src/components/toaster.stories.tsx`**

```tsx
import { Toaster } from "./toaster";
import { Button } from "./button";
import { useToast } from "../hooks/use-toast";

function Demo() {
  const { toast } = useToast();
  return (
    <>
      <Button
        onClick={() =>
          toast({ title: "Upload falhou", description: "arquivo maior que o limite", variant: "destructive" })
        }
      >
        Disparar erro
      </Button>
      <Toaster />
    </>
  );
}

export const Default = () => <Demo />;
```

- [ ] **Step 8: Export from the barrel — append to `packages/ui/src/index.ts`**

```ts
export { Toaster } from "./components/toaster";
export { useToast, type ToastOptions } from "./hooks/use-toast";
```

- [ ] **Step 9: Run tests + typecheck, then commit**

Run: `npm test -w @assistente-os/ui` — expect PASS, prior + 4 new.
Run: `npm run typecheck -w @assistente-os/ui` — expect exit 0.

```bash
git add packages/ui
git commit -m "feat(ui): Toast/Toaster + useToast — app-wide error/confirmation surface (FM6)"
```

---

### Task 10: No-hardcoded-color sweep + full-suite integration check

**Files:**
- Create: `packages/ui/src/components/no-hardcoded-color.test.ts`

**Interfaces:**
- Consumes: every file under `packages/ui/src/components/**` (read as text, not imported).
- Produces: nothing new — this is the Global Constraint's enforcement, deferred from A1 spec §6 to A2 exactly for this moment (once components exist to sweep).

- [ ] **Step 1: Write `packages/ui/src/components/no-hardcoded-color.test.ts`**

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const componentsDir = fileURLToPath(new URL(".", import.meta.url));

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) continue;
    out.push(join(dir, entry.name));
  }
  return out;
}

const files = listSourceFiles(componentsDir);

test("found at least the primitives this plan added (sanity check the sweep isn't scanning an empty dir)", () => {
  expect(files.length).toBeGreaterThanOrEqual(19);
});

test.each(files.map((f) => [f.split("/").pop()!, f] as const))("%s has no raw color literal", (_name, path) => {
  const src = readFileSync(path, "utf8");
  expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(src).not.toMatch(/\brgb\(/);
  expect(src).not.toMatch(/\bhsl\(/);
  expect(src).not.toMatch(/\boklch\(/);
});
```

- [ ] **Step 2: Run it**

Run: `npm test -w @assistente-os/ui -- no-hardcoded-color`
Expected: PASS immediately — every component from Tasks 1–9 already only uses token-backed Tailwind classes. If it fails, it means an earlier task's component has a stray literal — fix that component's file, don't weaken this test.

- [ ] **Step 3: Run the full suite + typecheck + catalog build**

Run: `npm test -w @assistente-os/ui`
Expected: PASS — every test from Tasks 1–10.

Run: `npm run typecheck -w @assistente-os/ui`
Expected: exit 0.

Run: `npm run catalog:build -w @assistente-os/ui`
Expected: exit 0 — every new `*.stories.tsx` compiles into the static catalog.

- [ ] **Step 4: Commit**

```bash
git add packages/ui
git commit -m "test(ui): sweep for hardcoded color literals across all primitives"
```

---

## Self-Review

**1. Spec coverage (against `docs/superpowers/specs/2026-09-01-design-system-packages-ui-design.md` §4's primitives row):**

`Button`(1) · `Input`,`Textarea`,`Label`,`Field`(2) · `Card`,`Separator`,`Skeleton`,`Avatar`(3, +`Badge` which the spec's primitive list also names) · `Dialog`,`Popover`(4) · `Tooltip`,`DropdownMenu`(5) · `Tabs`(6) · `Select`,`Switch`,`Checkbox`(7) · `ScrollArea`(8) · `Toast`+`Toaster`(9). Every primitive named in spec §4's first table is covered. `Field`'s `aria-describedby` wiring matches spec text exactly. `Toaster`+`useToast` is called out in the spec as what **FM6** depends on — delivered in Task 9. The a11y-smoke and interaction-contract tests match spec §6 ("Dialog prende foco e restaura no close", "DropdownMenu navega por teclado") — covered in Tasks 4 and 5. The "no raw color literal" sweep (spec §6) is Task 10. Gaps: none — the product components (`Message`, `Composer`, `ThreadList`, `AuthCard`, `SettingsPanel`, marketing stubs) are explicitly plan **A2b**, not this plan.

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases" anywhere. Every step has literal, complete code. `useToast`'s test-reset export (`__resetToastStoreForTests`) is a real, used API, not a stub.

**3. Type consistency:**
- `cn` imported identically (`from "../lib/cn"`) in every component file, matching A1's actual export.
- `ButtonProps`/`badgeVariants` pattern (cva + `VariantProps`) is reused identically in `badge.tsx`.
- `Field`'s child contract (`React.ReactElement<{ id?; aria-describedby?; aria-invalid? }>`) matches what `Input`/`Textarea` accept (both spread `...props` onto a native element, so injected `id`/`aria-*` pass straight through).
- Every Radix wrapper follows the same `React.forwardRef<ElementRef<Primitive.X>, ComponentPropsWithoutRef<Primitive.X>>` shape — consistent across Tasks 3–9.
- Barrel exports (`index.ts`) are strictly additive across all 10 tasks — no task removes or renames an earlier task's export; verified by re-reading each task's Step "Export from the barrel" in order.
- `useToast`'s `ToastOptions`/`ToastEntry` types are exported once (Task 9) and not redefined elsewhere.

No issues found; nothing to fix.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-01-design-system-primitives.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

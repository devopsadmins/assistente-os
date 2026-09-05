import * as React from "react";
import { cn } from "../lib/cn";
import { Label } from "./label";

/** Computed a11y wiring handed to a `Field`'s render-prop child (DS3). */
export interface FieldRenderProps {
  /** `id` of the rendered `<Label>` — wire it to the control via `aria-labelledby` when the control isn't a plain `id`/`htmlFor`-labelable DOM node (e.g. `SelectTrigger`). */
  labelId: string;
  /** Same value as `htmlFor` — the id the control itself should carry when it *can* accept one directly. */
  controlId: string;
  describedBy?: string;
  invalid?: boolean;
}

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  className?: string;
  children:
    | React.ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>
    | ((render: FieldRenderProps) => React.ReactNode);
}

/**
 * Wraps a single control: renders label + hint/error below, and wires up
 * the a11y relationship between them in one of two ways.
 *
 * - **Element child** (`<Field ...><Input /></Field>`): `id`/
 *   `aria-describedby`/`aria-invalid` are injected via `cloneElement`. Only
 *   works when the child spreads its own props onto a real DOM element
 *   (`Input`, `Textarea`) — `cloneElement` is shallow, so it can't reach
 *   into a child that's itself a tree (e.g. `<Select><SelectTrigger>...`)
 *   to inject props on some inner node.
 * - **Render-prop child** (DS3, for composed controls like `Select` whose
 *   root is a context provider with no DOM node of its own — cloneElement
 *   would silently drop the injected props): `children` is a function
 *   receiving `{ labelId, controlId, describedBy, invalid }`; the caller
 *   wires those onto whichever inner element makes sense for that control
 *   (e.g. `aria-labelledby={labelId}` on `SelectTrigger`).
 */
export function Field({ label, htmlFor, hint, error, className, children }: FieldProps) {
  const labelId = `${htmlFor}-label`;
  const hintId = hint && !error ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const invalid = Boolean(error) || undefined;

  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label id={labelId} htmlFor={htmlFor}>{label}</Label>
      {typeof children === "function"
        ? children({ labelId, controlId: htmlFor, describedBy, invalid })
        : React.cloneElement(children, {
            id: htmlFor,
            "aria-describedby": describedBy,
            "aria-invalid": invalid,
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

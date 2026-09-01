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

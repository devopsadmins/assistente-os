import * as ToastPrimitive from "@radix-ui/react-toast";
import { useToast } from "../hooks/use-toast";
import { ToastProvider, ToastViewport, Toast, ToastTitle, ToastDescription, ToastClose } from "./toast";

export interface ToasterProps {
  /** Radix `Toast.Provider` `swipeDirection` — was hardcoded to "right" (DS7). */
  swipeDirection?: ToastPrimitive.ToastProviderProps["swipeDirection"];
  /** Radix `Toast.Provider` `duration` (ms) — wasn't exposed at all before (DS7); Radix's own default (5000ms) applies when omitted. */
  duration?: number;
}

/** Mount once at the app root. Renders whatever useToast().toast(...) pushes. */
export function Toaster({ swipeDirection = "right", duration }: ToasterProps = {}) {
  const { toasts, dismiss } = useToast();
  return (
    <ToastProvider swipeDirection={swipeDirection} duration={duration}>
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

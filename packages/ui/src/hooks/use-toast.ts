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

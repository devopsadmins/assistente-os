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
  expect(result.current.toasts[0]!.title).toBe("Salvo");
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

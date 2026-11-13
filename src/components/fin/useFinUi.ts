import { useEffect, useState } from "react";

/** true quando a janela é mais estreita que `max` px (celular). Sem matchMedia (testes), false. */
export function useNarrow(max = 640): boolean {
  const query = `(max-width: ${max - 1}px)`;
  const get = () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false);
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, [query]);
  return narrow;
}


/** Rola e foca o primeiro campo com erro (aria-invalid) — ou, sem campo marcado, a mensagem de erro do diálogo. */
export function focusFirstError(root: HTMLElement | null): void {
  if (!root) return;
  const target = root.querySelector<HTMLElement>('[aria-invalid="true"]') ?? root.querySelector<HTMLElement>('[role="alert"]');
  if (!target) return;
  target.scrollIntoView?.({ block: "center", behavior: "auto" });
  if (target.matches("input,select,textarea,button")) target.focus({ preventScroll: true });
}

/** Chame a cada tentativa de salvar: a cada nova tentativa (ou nova mensagem) o primeiro erro vem à vista. */
export function useFocusFirstError(rootRef: import("react").RefObject<HTMLElement>, signal: unknown): void {
  useEffect(() => {
    if (signal === null || signal === undefined || signal === false || signal === 0) return;
    const t = window.setTimeout(() => focusFirstError(rootRef.current), 0);
    return () => window.clearTimeout(t);
  }, [rootRef, signal]);
}


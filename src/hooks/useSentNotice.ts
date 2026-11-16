import { useCallback, useEffect, useRef, useState } from "react";

/** Aviso curto que some sozinho (usado depois de fechar o diálogo de envio). */
export function useSentNotice(ms = 8000): [string | null, (text: string) => void] {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback(
    (t: string) => {
      setText(t);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setText(null), ms);
    },
    [ms],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return [text, show];
}

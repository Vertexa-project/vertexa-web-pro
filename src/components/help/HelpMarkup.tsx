import type { ReactNode } from "react";

import { parseHelpMarkup } from "@/lib/help/markup";

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <strong key={`b${i++}`} className="font-semibold text-foreground">
        {m[1]}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function HelpMarkup({ body }: { body: string }) {
  const blocks = parseHelpMarkup(body);
  return (
    <div className="space-y-4 text-[15px] leading-7 text-foreground/90">
      {blocks.map((block, idx) => {
        switch (block.kind) {
          case "heading":
            return (
              <h2 key={idx} className="pt-2 text-lg font-semibold tracking-tight text-foreground">
                {renderInline(block.text)}
              </h2>
            );
          case "ordered":
            return (
              <ol key={idx} className="space-y-2.5">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-3">
                    <span
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                      aria-hidden
                    >
                      {j + 1}
                    </span>
                    <span className="min-w-0 flex-1">{renderInline(item)}</span>
                  </li>
                ))}
              </ol>
            );
          case "bullets":
            return (
              <ul key={idx} className="list-disc space-y-1.5 pl-6 marker:text-primary">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          default:
            return <p key={idx}>{renderInline(block.text)}</p>;
        }
      })}
    </div>
  );
}

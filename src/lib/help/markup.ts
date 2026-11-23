/**
 * Marcação simples dos tutoriais (sem HTML, sem links): "## Subtítulo", "1. passo",
 * "- item", parágrafos separados por linha em branco e **negrito**.
 * Tudo vira texto do React (escapado); nada do conteúdo é interpretado como HTML.
 */
export type HelpBlock =
  | { kind: "heading"; text: string }
  | { kind: "ordered"; items: string[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "paragraph"; text: string };

const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const BULLET = /^\s*[-•*]\s+(.*)$/;
const HEADING = /^\s*#{2,3}\s+(.*)$/;

export function parseHelpMarkup(body: string): HelpBlock[] {
  const blocks: HelpBlock[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "paragraph", text: para.join(" ") });
    para = [];
  };
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      continue;
    }
    const h = HEADING.exec(line);
    const o = ORDERED.exec(line);
    const b = BULLET.exec(line);
    if (h) {
      flushPara();
      blocks.push({ kind: "heading", text: h[1].trim() });
    } else if (o || b) {
      flushPara();
      const kind = o ? "ordered" : "bullets";
      const text = (o ?? b)![1].trim();
      const last = blocks[blocks.length - 1];
      if (last && last.kind === kind) last.items.push(text);
      else blocks.push({ kind, items: [text] });
    } else {
      // Continuação de item de lista (linha recuada) ou parágrafo.
      const last = blocks[blocks.length - 1];
      if (!para.length && /^\s{2,}/.test(raw) && last && (last.kind === "ordered" || last.kind === "bullets")) {
        last.items[last.items.length - 1] += ` ${line.trim()}`;
      } else {
        para.push(line.trim());
      }
    }
  }
  flushPara();
  return blocks;
}

/** Texto puro (para busca local e prévias): sem marcações. */
export function helpPlainText(body: string): string {
  return body
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*#{2,3}\s+/gm, "")
    .replace(/^\s*(\d+[.)]|[-•*])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

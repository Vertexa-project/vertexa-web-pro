import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * INCIDENTE 2026-07-30, FASE 2 — trava de FORMA dos embeds `professionals -> profiles`.
 *
 * POR QUE ESTE TESTE EXISTE, e por que ele é de TEXTO e não de comportamento:
 * quando `professionals` ganhou uma SEGUNDA FK para `profiles` (status_changed_by), todo embed
 * do PostgREST entre as duas passou a ser AMBÍGUO e devolveu 300/PGRST201. O painel caiu para
 * quem logou depois. E o defeito passou por TODOS os portões: o apply não deu erro, nenhum hash
 * mudou, `tsc` passou, a suíte passou — porque a ambiguidade não existe no TypeScript nem no
 * schema, ela existe na resolução do PostgREST, em tempo de requisição. A mitigação foi derrubar
 * a FK; a correção de verdade é NOMEAR a constraint no embed.
 *
 * Um teste de unidade não consegue falar com o PostgREST. O que ele CONSEGUE é garantir a única
 * coisa que impede o defeito de voltar: que a forma do embed continue explícita. É por isso que
 * este teste lê o fonte da camada api/ em vez de executar consulta.
 *
 * REGRA TRAVADA: todo embed de `profiles` cujo PAI DIRETO seja `professionals` — seja como raiz
 * (`.from("professionals").select(...)`) ou aninhado (`… professionals ( … )`) — tem de nomear
 * `professionals_profile_id_fkey`. Embeds de `profiles` sob OUTROS pais (patients, chat_messages,
 * professional_status_events…) não são alcançados por esta regra: aqueles pares têm uma FK só.
 */

const FK = "professionals_profile_id_fkey";
const API_DIR = path.dirname(fileURLToPath(import.meta.url));

interface EmbedRef {
  alias: string | null;
  table: string;
  hint: string | null;
}

/** Conteúdo entre o parêntese em `openIdx` e o seu fechamento. `null` se não fechar. */
function balancedBody(src: string, openIdx: number): string | null {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

/**
 * Embeds que são FILHOS DIRETOS deste corpo (profundidade 0 dentro dele). O que estiver mais
 * fundo pertence a outro pai e é ignorado de propósito — a regra é sobre pai DIRETO.
 */
function directChildEmbeds(body: string): EmbedRef[] {
  const found: EmbedRef[] = [];
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(") {
      if (depth === 0) {
        const m = /(?:([A-Za-z_]\w*)\s*:\s*)?([A-Za-z_]\w*)(?:!([A-Za-z_]\w*))?\s*$/.exec(body.slice(0, i));
        if (m) found.push({ alias: m[1] ?? null, table: m[2], hint: m[3] ?? null });
      }
      depth++;
    } else if (ch === ")") {
      depth--;
    }
  }
  return found;
}

/** Corpos dos embeds ANINHADOS de `table` (pega `professionals (` e `alias:professionals (`). */
function nestedContexts(src: string, table: string): string[] {
  // A negativa à esquerda evita casar o sufixo de `channel_professionals(`/`_professionals(`.
  const re = new RegExp(`(?<![A-Za-z0-9_])(?:[A-Za-z_]\\w*\\s*:\\s*)?${table}\\s*\\(`, "g");
  const bodies: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const body = balancedBody(src, m.index + m[0].length - 1);
    if (body !== null) bodies.push(body);
  }
  return bodies;
}

/** Corpos dos `.select(...)` cuja RAIZ é `.from("<table>")`. */
function rootSelects(src: string, table: string): string[] {
  const re = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)`, "g");
  const bodies: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const afterFrom = m.index + m[0].length;
    const rel = src.slice(afterFrom).indexOf(".select(");
    if (rel === -1) continue;
    const body = balancedBody(src, afterFrom + rel + ".select(".length - 1);
    if (body !== null) bodies.push(body);
  }
  return bodies;
}

/** Todo embed de `profiles` com pai DIRETO `professionals`, achatado num só lugar. */
function professionalsToProfilesEmbeds(src: string): EmbedRef[] {
  const contexts = [...rootSelects(src, "professionals"), ...nestedContexts(src, "professionals")];
  return contexts.flatMap((body) => directChildEmbeds(body).filter((e) => e.table === "profiles"));
}

function apiSourceFiles(): string[] {
  return readdirSync(API_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort();
}

describe("INCIDENTE Fase 2 — embeds professionals->profiles nomeiam a constraint", () => {
  it("nenhum embed professionals->profiles está ambíguo na camada api/", () => {
    const ambiguos: string[] = [];
    for (const file of apiSourceFiles()) {
      const src = readFileSync(path.join(API_DIR, file), "utf8");
      for (const e of professionalsToProfilesEmbeds(src)) {
        if (e.hint !== FK) {
          ambiguos.push(`${file}: ${e.alias ? `${e.alias}:` : ""}profiles${e.hint ? `!${e.hint}` : " (SEM constraint)"}`);
        }
      }
    }
    // Mensagem explícita: quem quebrar isto tem de saber o que fazer, não só que falhou.
    expect(ambiguos, `Embed(s) de profiles sob professionals sem \`!${FK}\`. Devolver a FK professionals_status_changed_by_fkey com um destes no ar reproduz o 300/PGRST201 de 30/07.`).toEqual([]);
  });

  it("a varredura encontra os embeds de verdade (senão o teste passaria vazio)", () => {
    const total = apiSourceFiles().reduce(
      (n, f) => n + professionalsToProfilesEmbeds(readFileSync(path.join(API_DIR, f), "utf8")).length,
      0,
    );
    // Guarda contra falso-verde: se um refactor esconder os embeds do scanner, isto acusa.
    expect(total).toBeGreaterThanOrEqual(9);
  });
});

/**
 * O teste acima só vale se ele for CAPAZ de falhar. Estes casos provam que a varredura acusa o
 * defeito, aceita a forma correta, e não sai atropelando embeds de outros pares.
 */
describe("a própria varredura — prova de que ela pega o defeito", () => {
  const bad = (s: string) => professionalsToProfilesEmbeds(s).filter((e) => e.hint !== FK);

  it("ACUSA embed cru aninhado sob professionals", () => {
    expect(bad(`professionals ( id, type, profile:profiles ( full_name ) )`)).toHaveLength(1);
  });

  it("ACUSA embed cru na raiz .from(professionals)", () => {
    expect(bad(`.from("professionals").select("id, profile:profiles ( full_name )")`)).toHaveLength(1);
  });

  it("ACUSA constraint ERRADA (nomear qualquer coisa não basta)", () => {
    expect(bad(`professionals ( profile:profiles!alguma_outra_fkey ( full_name ) )`)).toHaveLength(1);
  });

  it("ACEITA a forma correta, aninhada e na raiz", () => {
    expect(bad(`professionals ( id, profile:profiles!${FK} ( full_name ) )`)).toEqual([]);
    expect(bad(`.from("professionals").select("id, profile:profiles!${FK} ( full_name )")`)).toEqual([]);
  });

  it("IGNORA profiles sob outro pai (patients tem uma FK só)", () => {
    expect(professionalsToProfilesEmbeds(`patients ( profile:profiles ( full_name ) )`)).toEqual([]);
    expect(professionalsToProfilesEmbeds(`.from("patients").select("profile:profiles ( * )")`)).toEqual([]);
  });

  it("IGNORA nome de tabela/função que só TERMINA em professionals", () => {
    expect(professionalsToProfilesEmbeds(`channel_professionals ( profile:profiles ( full_name ) )`)).toEqual([]);
  });

  it("não confunde profiles NETO com filho direto de professionals", () => {
    // profiles aqui é filho de patients, que é filho de professionals.
    expect(professionalsToProfilesEmbeds(`professionals ( patients ( profile:profiles ( full_name ) ) )`)).toEqual([]);
  });
});

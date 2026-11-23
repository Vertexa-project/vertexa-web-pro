#!/usr/bin/env node
// Cartão 1317 · Gera o SQL do conteúdo inicial da Central de Ajuda a partir de docs/ajuda/tutoriais.json.
// Uso: node scripts/help-content-to-sql.mjs docs/ajuda/tutoriais.json > supabase/migrations/<ts>_help_center_conteudo.sql
// "on conflict do nothing": rodar de novo não apaga o que a Vertexa editou na Plataforma.
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "docs/ajuda/tutoriais.json";
const data = JSON.parse(readFileSync(file, "utf8"));

const q = (s) => `'${String(s ?? "").replace(/'/g, "''")}'`;
const slugRe = /^[a-z0-9-]{2,80}$/;
const catIds = new Set();
const out = [
  "-- Cartão 1317 · Conteúdo inicial da Central de Ajuda (gerado de docs/ajuda/tutoriais.json).",
  "-- Escrito a partir do sistema; a Vertexa edita na Plataforma. Não sobrescreve o que já existe.",
  "",
];

for (const c of data.categories) {
  if (!/^[a-z0-9-]{2,60}$/.test(c.id)) throw new Error(`categoria inválida: ${c.id}`);
  catIds.add(c.id);
  out.push(
    `insert into public.help_categories (id, title, description, position) values (${q(c.id)}, ${q(c.title)}, ${q(c.description)}, ${Number(c.position) || 0}) on conflict (id) do nothing;`,
  );
}
out.push("");
const slugs = new Set();
for (const a of data.articles) {
  if (!slugRe.test(a.slug)) throw new Error(`slug inválido: ${a.slug}`);
  if (slugs.has(a.slug)) throw new Error(`slug repetido: ${a.slug}`);
  if (!catIds.has(a.category)) throw new Error(`categoria desconhecida em ${a.slug}: ${a.category}`);
  slugs.add(a.slug);
  out.push(
    `insert into public.help_articles (slug, category_id, title, summary, body, position) values (${q(a.slug)}, ${q(a.category)}, ${q(a.title)}, ${q(a.summary)}, ${q(a.body)}, ${Number(a.position) || 0}) on conflict (slug) do nothing;`,
  );
}
process.stdout.write(out.join("\n") + "\n");

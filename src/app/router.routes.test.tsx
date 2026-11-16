import { describe, expect, it } from "vitest";
import type { RouteObject } from "react-router-dom";

import { router } from "./router";

function paths(routes: RouteObject[], base = ""): string[] {
  return routes.flatMap((r) => {
    const p = r.path ? `${base}/${r.path}`.replace(/\/+/g, "/") : base;
    return [...(r.path || r.index ? [r.index ? p || "/" : p] : []), ...paths(r.children ?? [], p)];
  });
}

describe("rotas: as novas existem e as antigas seguem montadas (deep link não quebra)", () => {
  const all = paths(router.routes);
  it.each([
    "/", "/agenda", "/relacionamento", "/relacionamento/campanhas", "/mensagens", "/campanhas", "/gestao", "/financeiro", "/financeiro/vendas",
    "/financeiro/repasse/fechamento", "/estoque", "/estoque/saldo", "/documentos", "/retencao", "/planos", "/pacientes/:id", "/configuracoes",
  ])("%s", (p) => {
    expect(all).toContain(p);
  });
});

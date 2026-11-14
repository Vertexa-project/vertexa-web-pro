// Registro de provedores. Para trocar o demo pelo provedor real: implemente PrescriptionProvider (ex.: memedProvider.ts: openSession abre o widget
// do provedor com o `sessionId` como referência externa; o webhook devolve o documento assinado) e registre-o aqui. Ver docs/financeiro-estoque/entrega-9.md.
import { demoProvider } from "./demoProvider";
import { ProviderNotAvailableError, type PrescriptionProvider, type ProviderId } from "./types";

const PROVIDERS: Partial<Record<ProviderId, PrescriptionProvider>> = { demo: demoProvider };

export function getPrescriptionProvider(id: string | null | undefined): PrescriptionProvider {
  const p = PROVIDERS[(id ?? "demo") as ProviderId];
  if (!p) throw new ProviderNotAvailableError(String(id));
  return p;
}
export * from "./types";
export { demoProvider };

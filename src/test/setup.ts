// SETUP COMPARTILHADO DOS TESTES (WP-INFRA-JSDOM).
//
// Mesma receita do vertexa-app-paciente: matchers de DOM + os polyfills que o jsdom não traz e
// que ESTE repo precisa em mais de uma tela.
//
// ⚠️ REGRA DE ONDE COLOCAR POLYFILL: aqui só entra o que serve a MAIS DE UMA tela. Lacuna de uma
// tela só (ex.: `scrollIntoView`, que só o chat chama) vai no arquivo de teste daquela tela — do
// contrário este setup vira um depósito e ninguém sabe mais o que é necessário para quê.
import "@testing-library/jest-dom/vitest";

// `matchMedia` não existe no jsdom. O painel o usa em vários pontos (o hook de tema, os
// utilitários responsivos do shadcn e o próprio Radix). Sem isto, montar qualquer tela que
// carregue esses caminhos estoura antes da primeira asserção.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// O Radix (AlertDialog, Select, Popover…) mede o viewport com ResizeObserver, que o jsdom também
// não implementa. É o mesmo caso do matchMedia: falta do ambiente, não do produto — e vale para
// TODA tela que use um componente do shadcn baseado em Radix, por isso mora aqui.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

// Entrada por XML da NF-e (escopo-v1 §8.2, E14): leitura no navegador (DOMParser, nada vai ao servidor até confirmar), de/para dos itens
// do fornecedor com os itens do cadastro e montagem das linhas da entrada. O XML nunca é executado: só lido como texto estruturado.
import { toCents } from "./money";

export class NfeError extends Error {
  constructor(public readonly code: "NFE_EMPTY" | "NFE_NOT_XML" | "NFE_NOT_NFE" | "NFE_NO_KEY" | "NFE_NO_ITEMS" | "NFE_TOO_BIG") { super(code); }
}
export const NFE_ERROR_TEXT: Record<NfeError["code"], string> = {
  NFE_EMPTY: "O arquivo está vazio.",
  NFE_NOT_XML: "Este arquivo não é um XML válido.",
  NFE_NOT_NFE: "Este XML não é uma NF-e (não encontrei a nota fiscal dentro dele).",
  NFE_NO_KEY: "Não encontrei a chave de acesso (44 dígitos) da nota.",
  NFE_NO_ITEMS: "A nota não tem itens.",
  NFE_TOO_BIG: "O arquivo é grande demais para uma NF-e (máximo 2 MB).",
};
export const NFE_MAX_BYTES = 2 * 1024 * 1024;

export interface NfeLot { code: string; expiry: string | null; qty: number | null }
export interface NfeItem {
  n: number;
  /** cProd: código do item NO FORNECEDOR (chave do de/para). */
  code: string;
  ean: string | null;
  name: string;
  unit: string;
  qty: number;
  /** Valor total do item em centavos, já descontado (vProd − vDesc). */
  totalCents: number;
  lots: NfeLot[];
}
export interface NfeDoc {
  key: string;
  number: string;
  series: string | null;
  issueDate: string | null;
  supplier: { taxId: string; name: string };
  freightCents: number;
  items: NfeItem[];
}

function child(el: Element | null, name: string): Element | null {
  if (!el) return null;
  for (const c of Array.from(el.children)) if (c.localName === name) return c;
  return null;
}
function path(el: Element | null, ...names: string[]): Element | null {
  let cur = el;
  for (const n of names) cur = child(cur, n);
  return cur;
}
function text(el: Element | null, ...names: string[]): string {
  return (path(el, ...names)?.textContent ?? "").trim();
}
function descendant(root: Element, name: string): Element | null {
  const all = root.getElementsByTagName("*");
  for (let i = 0; i < all.length; i++) if (all[i].localName === name) return all[i];
  return null;
}
const num = (s: string): number => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const digits = (s: string): string => s.replace(/\D/g, "");
function isoDate(s: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s.trim());
  return m ? m[1] : null;
}

/** Lê o texto de um XML de NF-e (procNFe ou NFe). Lança NfeError com mensagem pronta para a tela. */
export function parseNfeXml(xml: string): NfeDoc {
  if (!xml || !xml.trim()) throw new NfeError("NFE_EMPTY");
  if (xml.length > NFE_MAX_BYTES) throw new NfeError("NFE_TOO_BIG");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0 || !doc.documentElement) throw new NfeError("NFE_NOT_XML");
  const inf = descendant(doc.documentElement, "infNFe");
  if (!inf) throw new NfeError("NFE_NOT_NFE");
  const key = digits(inf.getAttribute("Id") ?? "") || digits(text(descendant(doc.documentElement, "infProt"), "chNFe"));
  if (key.length !== 44) throw new NfeError("NFE_NO_KEY");
  const ide = child(inf, "ide");
  const emit = child(inf, "emit");
  const items: NfeItem[] = [];
  let itemFreight = 0;
  for (const det of Array.from(inf.children).filter((c) => c.localName === "det")) {
    const prod = child(det, "prod");
    if (!prod) continue;
    const gross = toCents(num(text(prod, "vProd")));
    const discount = toCents(num(text(prod, "vDesc")));
    itemFreight += toCents(num(text(prod, "vFrete")));
    const eanRaw = text(prod, "cEAN");
    const ean = /^\d{8,14}$/.test(eanRaw) ? eanRaw : null;
    items.push({
      n: Number(det.getAttribute("nItem")) || items.length + 1,
      code: text(prod, "cProd"),
      ean,
      name: text(prod, "xProd"),
      unit: text(prod, "uCom"),
      qty: num(text(prod, "qCom")),
      totalCents: Math.max(gross - discount, 0),
      lots: Array.from(prod.children).filter((c) => c.localName === "rastro").map((r) => ({
        code: text(r, "nLote"), expiry: isoDate(text(r, "dVal")), qty: text(r, "qLote") ? num(text(r, "qLote")) : null,
      })).filter((l) => l.code),
    });
  }
  if (items.length === 0) throw new NfeError("NFE_NO_ITEMS");
  const totalFreight = toCents(num(text(path(child(inf, "total"), "ICMSTot"), "vFrete")));
  return {
    key,
    number: text(ide, "nNF"),
    series: text(ide, "serie") || null,
    issueDate: isoDate(text(ide, "dhEmi") || text(ide, "dEmi")),
    supplier: { taxId: digits(text(emit, "CNPJ") || text(emit, "CPF")), name: text(emit, "xNome") },
    freightCents: totalFreight || itemFreight,
    items,
  };
}

// ---------- de/para ----------
export interface CatalogItem { id: string; name: string; ean: string | null; purchaseUnit: string; purchaseToStockFactor: number; isActive: boolean }
export interface SupplierMap { supplierCode: string; itemId: string; conversionFactor: number }
export type MatchSource = "map" | "ean" | "name" | "none";
export interface NfeMatch {
  nfeItem: NfeItem;
  itemId: string | null;
  source: MatchSource;
  /** Quantas unidades de ESTOQUE vêm em 1 unidade da nota. */
  factor: number;
}

const norm = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Fator sugerido: o do de/para salvo; senão o do cadastro, se a unidade da nota é a unidade de compra do item; senão 1. */
export function suggestFactor(nfeUnit: string, item: CatalogItem | undefined, map: SupplierMap | undefined): number {
  if (map) return map.conversionFactor;
  if (item && norm(nfeUnit) === norm(item.purchaseUnit)) return item.purchaseToStockFactor;
  return 1;
}

/**
 * Vincula cada item da nota a um item do cadastro: 1º pelo de/para já salvo deste fornecedor (E14: «na próxima nota o mesmo código é vinculado sozinho»),
 * 2º pelo código de barras (EAN), 3º pelo nome igual. Sem vínculo, `itemId` fica nulo e a tela pede a escolha.
 */
export function matchNfeItems(items: NfeItem[], catalog: CatalogItem[], maps: SupplierMap[]): NfeMatch[] {
  const active = catalog.filter((c) => c.isActive);
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const mapByCode = new Map(maps.map((m) => [m.supplierCode, m]));
  return items.map((nfeItem) => {
    const map = mapByCode.get(nfeItem.code);
    if (map && byId.get(map.itemId)?.isActive) return { nfeItem, itemId: map.itemId, source: "map" as const, factor: map.conversionFactor };
    const byEan = nfeItem.ean ? active.find((c) => c.ean === nfeItem.ean) : undefined;
    if (byEan) return { nfeItem, itemId: byEan.id, source: "ean" as const, factor: suggestFactor(nfeItem.unit, byEan, undefined) };
    const byName = active.find((c) => norm(c.name) === norm(nfeItem.name));
    if (byName) return { nfeItem, itemId: byName.id, source: "name" as const, factor: suggestFactor(nfeItem.unit, byName, undefined) };
    return { nfeItem, itemId: null, source: "none" as const, factor: 1 };
  });
}

export interface NfeLineDraft {
  itemId: string | null;
  factor: number;
  lotCode: string;
  expiry: string;
  /** Linha ignorada (item da nota que não entra no estoque). */
  skip?: boolean;
}

export interface EntryLineInput {
  itemId: string;
  quantity: number;
  lineTotalCents: number;
  lotCode: string | null;
  expiryDate: string | null;
  supplierCode: string | null;
  conversionFactor: number;
}

/** Linhas da entrada: quantidade da nota × fator = unidades de estoque; o total em centavos é o da nota (vProd − vDesc). */
export function buildEntryLines(items: NfeItem[], drafts: NfeLineDraft[]): EntryLineInput[] {
  const out: EntryLineInput[] = [];
  items.forEach((it, i) => {
    const d = drafts[i];
    if (!d || d.skip || !d.itemId) return;
    out.push({
      itemId: d.itemId,
      quantity: Math.round(it.qty * d.factor * 1000) / 1000,
      lineTotalCents: it.totalCents,
      lotCode: d.lotCode.trim() || null,
      expiryDate: d.expiry || null,
      supplierCode: it.code || null,
      conversionFactor: d.factor,
    });
  });
  return out;
}

export type NfeLineErrors = Record<number, string>;
/** Confere as linhas antes de confirmar: item escolhido, fator, quantidade (inteira se o item não é fracionado) e lote/validade quando o item exige. */
export function validateNfeLines(items: NfeItem[], drafts: NfeLineDraft[], catalog: Map<string, { lotControl: boolean; fractional: boolean; name: string }>, today: string): NfeLineErrors {
  const errors: NfeLineErrors = {};
  items.forEach((it, i) => {
    const d = drafts[i];
    if (!d || d.skip) return;
    if (!d.itemId) { errors[i] = "Escolha o item do cadastro ou marque «não entra no estoque»."; return; }
    const meta = catalog.get(d.itemId);
    if (!(d.factor > 0)) { errors[i] = "O fator de conversão deve ser maior que zero."; return; }
    const stockQty = Math.round(it.qty * d.factor * 1000) / 1000;
    if (!(stockQty > 0)) { errors[i] = "Quantidade zerada."; return; }
    if (meta && !meta.fractional && !Number.isInteger(stockQty)) { errors[i] = `${meta.name} só entra em unidades inteiras: ajuste o fator.`; return; }
    if (meta?.lotControl && (!d.lotCode.trim() || !d.expiry)) { errors[i] = "Informe o lote e a validade."; return; }
    if (d.expiry && d.expiry < today) errors[i] = "A validade informada já passou.";
  });
  return errors;
}

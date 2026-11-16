// Importar pacientes (redesign parte 4): leitura de CSV/XLSX, ligação de colunas, validação linha a linha e duplicados.
// Tudo puro e sem rede: a tela mostra a prévia e só então chama a RPC import_patients, que revalida e confere duplicados de novo no servidor.
import { todayIsoBR } from "@/lib/domain/stockMoves";

export const IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_COLS = 60;

export type ImportField = "name" | "email" | "phone" | "birth_date" | "sex" | "goal" | "weight_kg" | "height_cm";

export const IMPORT_FIELDS: { key: ImportField; label: string; required?: boolean }[] = [
  { key: "name", label: "Nome completo", required: true },
  { key: "email", label: "E-mail" },
  { key: "phone", label: "Telefone / WhatsApp" },
  { key: "birth_date", label: "Data de nascimento" },
  { key: "sex", label: "Sexo" },
  { key: "goal", label: "Objetivo" },
  { key: "weight_kg", label: "Peso (kg)" },
  { key: "height_cm", label: "Altura (cm)" },
];

export const IMPORT_FIELD_LABEL: Record<ImportField, string> = Object.fromEntries(
  IMPORT_FIELDS.map((f) => [f.key, f.label]),
) as Record<ImportField, string>;

// ---------------------------------------------------------------------------------------------
// Texto delimitado (CSV)
// ---------------------------------------------------------------------------------------------

/** Escolhe o separador pelo cabeçalho (fora das aspas): `;` (Excel BR), `,` ou tabulação. */
export function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ";";
}

/** Lê CSV com aspas ("" = aspas), BOM, \r\n e separador `;`, `,` ou tab. Linhas totalmente vazias são descartadas. */
export function parseDelimited(input: string, delimiter?: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const sep = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) endCell();
    else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Ligação de colunas (cabeçalhos PT/EN do Dietbox, WebDiet e planilhas próprias)
// ---------------------------------------------------------------------------------------------

/** Minúsculas, sem acento e só letras/números: "Data de Nasc." → "datadenasc". */
export function normalizeHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const ALIASES: Record<ImportField, string[]> = {
  name: ["nome", "nomecompleto", "nomedopaciente", "paciente", "nomepaciente", "cliente", "nomedocliente", "name", "fullname", "patient", "patientname", "firstname"],
  email: ["email", "emaildopaciente", "emailpaciente", "emailprincipal", "correioeletronico", "mail", "emailaddress"],
  phone: ["telefone", "celular", "whatsapp", "whats", "fone", "telefonecelular", "telefonedocontato", "celularwhatsapp", "telefone1", "tel", "contato", "phone", "mobile", "cell", "cellphone", "phonenumber"],
  birth_date: ["datanascimento", "datadenascimento", "datanasc", "dtnasc", "dtnascimento", "nascimento", "datadenasc", "aniversario", "dn", "birthdate", "birthday", "dob", "dateofbirth"],
  sex: ["sexo", "genero", "sex", "gender"],
  goal: ["objetivo", "meta", "objetivodopaciente", "objetivoprincipal", "motivo", "motivodaconsulta", "goal", "objective"],
  weight_kg: ["peso", "pesokg", "pesoatual", "pesoinicial", "pesokgs", "weight", "weightkg", "currentweight"],
  height_cm: ["altura", "alturacm", "estatura", "height", "heightcm", "alturam"],
};

const ALIAS_LOOKUP = new Map<string, ImportField>();
for (const [field, list] of Object.entries(ALIASES) as [ImportField, string[]][]) {
  for (const a of list) ALIAS_LOOKUP.set(a, field);
}

/** Sugere o campo de cada coluna. Cada campo é ligado a UMA coluna (a primeira que casa); as demais ficam sem campo. */
export function suggestMapping(headers: string[]): (ImportField | null)[] {
  const used = new Set<ImportField>();
  return headers.map((h) => {
    const field = ALIAS_LOOKUP.get(normalizeHeader(h)) ?? null;
    if (!field || used.has(field)) return null;
    used.add(field);
    return field;
  });
}

// ---------------------------------------------------------------------------------------------
// Normalização e validação de cada campo
// ---------------------------------------------------------------------------------------------

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Telefone BR só com dígitos, sem o 55; 10 ou 11 dígitos, senão null. Mesma regra do servidor (import_phone_key). */
export function phoneKey(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function validIso(y: number, m: number, d: number): string | null {
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa ou aaaa-mm-dd (com ou sem hora). Ano de 2 dígitos não é aceito (ambíguo). Null = inválida. */
export function parseBirthDate(raw: string, today: string = todayIsoBR()): string | null {
  const t = raw.trim();
  let iso: string | null = null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(t);
  if (m) iso = validIso(Number(m[1]), Number(m[2]), Number(m[3]));
  else {
    m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?:\s.*)?$/.exec(t);
    if (m) iso = validIso(Number(m[3]), Number(m[2]), Number(m[1]));
  }
  if (!iso || iso > today) return null;
  return iso;
}

/** Número pt-BR ("70,5", "1.070,5", "70.5", "70,5 kg"). Null = inválido. */
export function parseNumberBR(raw: string): number | null {
  const t = raw.trim().toLowerCase().replace(/(kg|cm|m)$/, "").replace(/\s/g, "");
  if (!t) return null;
  const normalized = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  return Number(normalized);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseSex(raw: string): "feminino" | "masculino" | "outro" | null {
  const t = normalizeHeader(raw);
  if (["f", "fem", "feminino", "female", "mulher"].includes(t)) return "feminino";
  if (["m", "masc", "masculino", "male", "homem"].includes(t)) return "masculino";
  if (["o", "outro", "outros", "other", "naobinario", "nb"].includes(t)) return "outro";
  return null;
}

export interface CandidateValues {
  name: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  sex: "feminino" | "masculino" | "outro" | null;
  goal: string | null;
  weight_kg: number | null;
  height_cm: number | null;
}

export interface ImportCandidate {
  /** Linha na planilha (cabeçalho = 1; primeiro paciente = 2). */
  line: number;
  values: CandidateValues;
  /** Mensagens em português; com qualquer erro, a linha não entra. */
  errors: string[];
}

export interface RawImportRow {
  line: number;
  cells: string[];
}

/** Valida cada linha segundo a ligação de colunas. Campo não ligado fica vazio. */
export function buildCandidates(
  rows: RawImportRow[],
  mapping: (ImportField | null)[],
  today: string = todayIsoBR(),
): ImportCandidate[] {
  const col = (f: ImportField) => mapping.indexOf(f);
  return rows.map(({ line, cells }) => {
    const get = (f: ImportField): string => {
      const i = col(f);
      return i >= 0 ? (cells[i] ?? "").trim() : "";
    };
    const errors: string[] = [];
    const name = get("name").replace(/\s+/g, " ");
    if (!name) errors.push("Nome vazio");
    else if (name.length > 200) errors.push("Nome longo demais");

    const emailRaw = get("email");
    const email = emailRaw ? emailRaw.toLowerCase() : null;
    if (email && !EMAIL_RE.test(email)) errors.push("E-mail inválido");

    const phoneRaw = get("phone");
    if (phoneRaw && !phoneKey(phoneRaw)) errors.push("Telefone inválido");

    const birthRaw = get("birth_date");
    const birth = birthRaw ? parseBirthDate(birthRaw, today) : null;
    if (birthRaw && !birth) errors.push("Data de nascimento inválida");

    const sexRaw = get("sex");
    const sex = sexRaw ? parseSex(sexRaw) : null;
    if (sexRaw && !sex) errors.push("Sexo inválido");

    const weightRaw = get("weight_kg");
    let weight = weightRaw ? parseNumberBR(weightRaw) : null;
    if (weightRaw && (weight === null || weight < 20 || weight > 700)) {
      errors.push("Peso inválido");
      weight = null;
    }

    const heightRaw = get("height_cm");
    let height = heightRaw ? parseNumberBR(heightRaw) : null;
    if (height !== null && height > 0 && height < 3) height = height * 100; // "1,65" = metros
    if (heightRaw && (height === null || height < 50 || height > 260)) {
      errors.push("Altura inválida");
      height = null;
    }

    return {
      line,
      errors,
      values: {
        name,
        email,
        phone: phoneRaw || null,
        birth_date: birth,
        sex,
        goal: get("goal").slice(0, 200) || null,
        weight_kg: weight === null ? null : round2(weight),
        height_cm: height === null ? null : round2(height),
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Duplicados
// ---------------------------------------------------------------------------------------------

export interface ExistingPatientKey {
  email: string | null;
  name: string;
  birth_date: string | null;
  phone_key: string | null;
}

export type DuplicateReason = "email" | "telefone" | "nome_nascimento";

export interface DuplicateInfo {
  reason: DuplicateReason;
  /** Já cadastrado na clínica ou repetido mais acima no próprio arquivo. */
  where: "clinica" | "arquivo";
  /** Linha anterior do arquivo, quando where = arquivo. */
  otherLine?: number;
}

/** Nome comparável: sem acento, minúsculas e espaços únicos. */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Marca duplicados: mesmo e-mail, mesmo telefone ou mesmo nome + nascimento, já na clínica ou repetido no arquivo.
 * Linha com erro não entra na conta. No arquivo, a PRIMEIRA ocorrência vale e as seguintes são duplicadas.
 * Quando mais de um motivo vale, o e-mail (que nunca pode ser forçado) tem prioridade.
 */
export function detectDuplicates(candidates: ImportCandidate[], existing: ExistingPatientKey[]): Map<number, DuplicateInfo> {
  const inClinic = {
    email: new Set(existing.map((e) => e.email?.toLowerCase()).filter((x): x is string => !!x)),
    phone: new Set(existing.map((e) => e.phone_key).filter((x): x is string => !!x)),
    nb: new Set(existing.filter((e) => e.birth_date).map((e) => `${nameKey(e.name)}|${e.birth_date}`)),
  };
  const seen = { email: new Map<string, number>(), phone: new Map<string, number>(), nb: new Map<string, number>() };
  const out = new Map<number, DuplicateInfo>();
  for (const c of candidates) {
    if (c.errors.length > 0) continue;
    const email = c.values.email;
    const pk = phoneKey(c.values.phone);
    const nb = c.values.birth_date ? `${nameKey(c.values.name)}|${c.values.birth_date}` : null;
    let dup: DuplicateInfo | null = null;
    if (email && inClinic.email.has(email)) dup = { reason: "email", where: "clinica" };
    else if (email && seen.email.has(email)) dup = { reason: "email", where: "arquivo", otherLine: seen.email.get(email) };
    else if (pk && inClinic.phone.has(pk)) dup = { reason: "telefone", where: "clinica" };
    else if (pk && seen.phone.has(pk)) dup = { reason: "telefone", where: "arquivo", otherLine: seen.phone.get(pk) };
    else if (nb && inClinic.nb.has(nb)) dup = { reason: "nome_nascimento", where: "clinica" };
    else if (nb && seen.nb.has(nb)) dup = { reason: "nome_nascimento", where: "arquivo", otherLine: seen.nb.get(nb) };
    if (dup) {
      out.set(c.line, dup);
      continue;
    }
    if (email) seen.email.set(email, c.line);
    if (pk) seen.phone.set(pk, c.line);
    if (nb) seen.nb.set(nb, c.line);
  }
  return out;
}

export function duplicateLabel(d: DuplicateInfo): string {
  const base =
    d.reason === "email" ? "Mesmo e-mail" : d.reason === "telefone" ? "Mesmo telefone" : "Mesmo nome e nascimento";
  return d.where === "clinica" ? `${base} de um paciente já cadastrado` : `${base} da linha ${d.otherLine} deste arquivo`;
}

/** Só telefone ou nome+nascimento podem ser importados mesmo assim; e-mail repetido nunca (é a identidade do login). */
export const canForceDuplicate = (d: DuplicateInfo): boolean => d.reason !== "email";

// ---------------------------------------------------------------------------------------------
// Prévia → envio
// ---------------------------------------------------------------------------------------------

export type PreviewStatus = "pronto" | "erro" | "duplicado";

export interface PreviewRow {
  candidate: ImportCandidate;
  status: PreviewStatus;
  duplicate: DuplicateInfo | null;
}

export function buildPreview(candidates: ImportCandidate[], dups: Map<number, DuplicateInfo>): PreviewRow[] {
  return candidates.map((candidate) => {
    if (candidate.errors.length > 0) return { candidate, status: "erro", duplicate: null };
    const duplicate = dups.get(candidate.line) ?? null;
    return { candidate, status: duplicate ? "duplicado" : "pronto", duplicate };
  });
}

export interface ImportRpcRow {
  line: number;
  name: string;
  email: string | null;
  phone: string | null;
  birth_date: string | null;
  sex: string | null;
  goal: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  force: boolean;
}

/** Linhas que vão ao servidor: as prontas + os duplicados que a pessoa liberou (só os liberáveis). Erros nunca vão. */
export function buildImportPayload(preview: PreviewRow[], forced: ReadonlySet<number>): ImportRpcRow[] {
  const out: ImportRpcRow[] = [];
  for (const p of preview) {
    const isForced = p.status === "duplicado" && p.duplicate !== null && canForceDuplicate(p.duplicate) && forced.has(p.candidate.line);
    if (p.status !== "pronto" && !isForced) continue;
    const v = p.candidate.values;
    out.push({
      line: p.candidate.line,
      name: v.name,
      email: v.email,
      phone: v.phone,
      birth_date: v.birth_date,
      sex: v.sex,
      goal: v.goal,
      height_cm: v.height_cm,
      weight_kg: v.weight_kg,
      force: isForced,
    });
  }
  return out;
}

export function countPreview(preview: PreviewRow[], forced: ReadonlySet<number>) {
  const ready = preview.filter((p) => p.status === "pronto").length;
  const errors = preview.filter((p) => p.status === "erro").length;
  const duplicates = preview.filter((p) => p.status === "duplicado").length;
  const forcedCount = preview.filter(
    (p) => p.status === "duplicado" && p.duplicate && canForceDuplicate(p.duplicate) && forced.has(p.candidate.line),
  ).length;
  return { ready, errors, duplicates, forcedCount, toImport: ready + forcedCount };
}

/** "Importar 3 pacientes" / "Importar 1 paciente". */
export const importButtonLabel = (n: number) => `Importar ${n} ${n === 1 ? "paciente" : "pacientes"}`;

export interface ImportOutcome {
  imported: number;
  duplicates: number;
  errors: number;
}

/** "3 pacientes importados. 1 duplicado ficou de fora." (+ linhas com erro, se houver). */
export function importResultMessage(o: ImportOutcome): string {
  const parts = [`${o.imported} ${o.imported === 1 ? "paciente importado" : "pacientes importados"}.`];
  if (o.duplicates > 0) parts.push(`${o.duplicates} ${o.duplicates === 1 ? "duplicado ficou" : "duplicados ficaram"} de fora.`);
  if (o.errors > 0) parts.push(`${o.errors} ${o.errors === 1 ? "linha com erro não entrou" : "linhas com erro não entraram"}.`);
  return parts.join(" ");
}

/** Origem mostrada na Timeline/cadastro. */
export const importOriginLabel = (filename: string) => `Importado de ${filename}`;

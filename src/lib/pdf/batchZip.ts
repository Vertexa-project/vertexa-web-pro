// Relatório em lote em ZIP: um PDF por paciente (decisão de 21/10), baixados num único arquivo. Funções PURAS.
import { zipSync } from "fflate";

function slug(name: string): string {
  return (
    name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/(^-|-$)/g, "").toLowerCase() || "paciente"
  );
}

/** Nome do arquivo de um paciente dentro do ZIP; nomes repetidos ganham -2, -3… (nunca sobrescreve). */
export function zipEntryName(patientName: string, used: Set<string>): string {
  const base = `relatorio-${slug(patientName)}`;
  let name = `${base}.pdf`;
  for (let i = 2; used.has(name); i++) name = `${base}-${i}.pdf`;
  used.add(name);
  return name;
}

/** Monta o ZIP (PDF já é comprimido: guarda sem compressão, mais rápido). */
export function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) entries[f.name] = f.data;
  return zipSync(entries, { level: 0 });
}

/** Bytes de um Blob (navegadores têm blob.arrayBuffer; FileReader cobre ambientes sem ele). */
export function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer().then((b) => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

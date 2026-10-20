/**
 * RELATÓRIO DE EVOLUÇÃO (VERTEXA) — documento @react-pdf montado sobre a CASCA reutilizável
 * (ReportShell + primitivos). Puramente apresentacional: recebe `EvolutionReportData` já
 * resolvido (dados + fotos em data URI) e desenha 4 seções: KPIs, gráfico de peso vetorial,
 * antropometria/composição e fotos antes/depois. Cada seção degrada com elegância se vazia.
 *
 * Treino/Dieta reaproveitarão ReportShell + SectionTitle + KpiRow + DataTable trocando só o
 * conteúdo das seções (ver PASSO 7C do relatório).
 */
import type { ReactNode } from "react";
import { Text, View } from "@react-pdf/renderer";

import {
  Document,
  ReportShell,
  SectionTitle,
  KpiRow,
  DataTable,
  DeltaBadge,
  Chip,
  VriBadge,
  PhotoPair,
  EmptyState,
  type Kpi,
  type IdentityField,
} from "./primitives";
import { WeightChartPdf } from "./WeightChartPdf";
import { BRAND, STATUS, NEUTRAL, SP } from "./theme";
import { formatWeight, professionalTypeLabel } from "@/lib/domain/format";
import type { BodyAssessment, ProfessionalType, WeightPoint } from "@/types/db";
import type { ReportBrand } from "./primitives";

export interface EvolutionReportData {
  patientName: string;
  goal: string | null;
  sex: string | null;
  heightCm: number | null;
  professionalName: string | null;
  professionalType: ProfessionalType | null;
  clinicName: string;
  /** Identidade da clínica (logo/cor) — null = marca Vertexa. */
  brand?: ReportBrand | null;
  periodLabel: string; // ex.: "01/04/2026 – 30/06/2026"
  emittedAt: string; // ex.: "30 de jun. de 2026"
  startWeight: number | null;
  currentWeight: number | null;
  targetWeight: number | null;
  adherence: { score: number | null; level: string | null; streak: number | null; weeklyRate: number | null } | null;
  weightPoints: WeightPoint[]; // já filtrados ao período
  assessments: BodyAssessment[]; // já filtrados ao período (asc)
  /** Um par antes/depois por posição (frente/lado/costas); `label` null quando as fotos não têm posição. */
  photos: Array<{ label: string | null; beforeUri: string | null; beforeCaption: string; afterUri: string | null; afterCaption: string }> | null;
}

const num = (v: number, digits = 1) => v.toLocaleString("pt-BR", { maximumFractionDigits: digits });
const imcOf = (weight: number | null | undefined, heightCm: number | null | undefined): number | null => {
  if (weight == null || !heightCm) return null;
  const h = heightCm / 100;
  return weight / (h * h);
};

/** Lê uma medida numérica do jsonb measurements (aceita number ou string numérica). */
function measNum(meas: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!meas) return null;
  const v = meas[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

// Circunferências exibidas na tabela (chaves do jsonb measurements → rótulo).
const MEAS_ROWS: Array<{ key: string; label: string }> = [
  { key: "cintura", label: "Cintura" },
  { key: "quadril", label: "Quadril" },
  { key: "abdomen", label: "Abdômen" },
  { key: "torax", label: "Tórax" },
  { key: "braco", label: "Braço" },
  { key: "coxa", label: "Coxa" },
  { key: "panturrilha", label: "Panturrilha" },
];

function buildKpis(data: EvolutionReportData): Kpi[] {
  const current = data.currentWeight;
  const target = data.targetWeight;

  // Peso atual + meta (sem seta unicode — fora do subset das fontes; usamos "·").
  const pesoValue = formatWeight(current);
  let pesoSub: string;
  if (target != null && current != null) {
    const remaining = current - target;
    pesoSub = remaining > 0.05 ? `Meta ${formatWeight(target)} · faltam ${num(remaining)} kg` : `Meta ${formatWeight(target)} · atingida`;
  } else {
    pesoSub = target != null ? `Meta ${formatWeight(target)}` : "Meta não definida";
  }

  const streak = data.adherence?.streak;
  const score = data.adherence?.score;

  return [
    // "Objetivo" é texto: fonte menor (valueSize) p/ caber/quebrar sem cortar.
    { label: "Objetivo", value: data.goal ?? "—", valueSize: 12 },
    { label: "Peso atual · meta", value: pesoValue, sub: pesoSub },
    { label: "Sequência", value: streak != null ? `${streak} dias` : "—", sub: "dias ativos no app" },
    { label: "Adesão (VRI)", value: score != null ? `${score}` : "—", sub: <VriBadge level={data.adherence?.level} /> },
  ];
}

/**
 * Linhas da tabela de antropometria (Parâmetro | Início | Atual | Variação).
 * Peso e IMC saem da SÉRIE UNIFICADA (mesma do gráfico) → tabela coerente com a curva.
 * % Gordura vem das avaliações clínicas (primeira/última medição com valor).
 */
function anthropometryRows(data: EvolutionReportData) {
  const wp = data.weightPoints;
  const a = data.assessments;
  if (wp.length === 0 && a.length === 0) return null;

  let w0: number | null = null;
  let w1: number | null = null;
  let hasTwoW = false;
  if (wp.length > 0) {
    w0 = Number(wp[0].weight);
    w1 = Number(wp[wp.length - 1].weight);
    hasTwoW = wp.length >= 2;
  } else if (a.length > 0) {
    w0 = a[0].weight != null ? Number(a[0].weight) : null;
    w1 = a[a.length - 1].weight != null ? Number(a[a.length - 1].weight) : null;
    hasTwoW = a.length >= 2;
  }

  const dash = <Text style={{ fontSize: 9.5, color: NEUTRAL.inkFaint }}>—</Text>;
  const rows: Array<Record<string, ReactNode>> = [];

  rows.push({
    param: "Peso",
    inicio: w0 != null ? formatWeight(w0) : "—",
    atual: w1 != null ? formatWeight(w1) : "—",
    variacao: hasTwoW && w0 != null && w1 != null ? <DeltaBadge value={w1 - w0} unit="kg" goodDirection="down" /> : dash,
  });

  // % Gordura — primeira/última avaliação clínica QUE TENHAM valor.
  const bf0 = a.find((x) => x.body_fat_pct != null)?.body_fat_pct ?? null;
  const bfLast = [...a].reverse().find((x) => x.body_fat_pct != null)?.body_fat_pct ?? null;
  const bfBoth = bf0 != null && bfLast != null && bf0 !== bfLast;
  rows.push({
    param: "% Gordura",
    inicio: bf0 != null ? `${num(Number(bf0))}%` : "—",
    atual: bfLast != null ? `${num(Number(bfLast))}%` : "—",
    variacao: bfBoth ? <DeltaBadge value={Number(bfLast) - Number(bf0)} unit="%" goodDirection="down" /> : dash,
  });

  if (data.heightCm) {
    const imc0 = imcOf(w0, data.heightCm);
    const imc1 = imcOf(w1, data.heightCm);
    rows.push({
      param: "IMC",
      inicio: imc0 != null ? num(imc0) : "—",
      atual: imc1 != null ? num(imc1) : "—",
      variacao: hasTwoW && imc0 != null && imc1 != null ? <DeltaBadge value={imc1 - imc0} goodDirection="down" /> : dash,
    });
  }

  // Circunferências (cm) das avaliações clínicas — primeira/última medição COM valor por chave.
  for (const mk of MEAS_ROWS) {
    const firstM = a.find((x) => measNum(x.measurements, mk.key) != null);
    const lastM = [...a].reverse().find((x) => measNum(x.measurements, mk.key) != null);
    if (!firstM || !lastM) continue; // degrada: sem a medida, não cria a linha
    const c0 = measNum(firstM.measurements, mk.key) as number;
    const c1 = measNum(lastM.measurements, mk.key) as number;
    const both = firstM !== lastM && c0 !== c1;
    rows.push({
      param: mk.label,
      inicio: `${num(c0)} cm`,
      atual: `${num(c1)} cm`,
      variacao: both ? <DeltaBadge value={c1 - c0} unit="cm" goodDirection="down" /> : dash,
    });
  }

  return rows;
}

export function EvolutionReportDoc({ data }: { data: EvolutionReportData }) {
  const professionalLabel = data.professionalName
    ? data.professionalType
      ? `${data.professionalName} · ${professionalTypeLabel(data.professionalType)}`
      : data.professionalName
    : "—";

  const identity: IdentityField[] = [
    { label: "Profissional", value: professionalLabel },
    { label: "Clínica", value: data.clinicName },
    { label: "Período", value: data.periodLabel },
    { label: "Altura", value: data.heightCm ? `${num(data.heightCm, 0)} cm` : "—" },
  ];

  const rows = anthropometryRows(data);
  const wpFirst = data.weightPoints[0]?.date ?? null;
  const wpLast = data.weightPoints[data.weightPoints.length - 1]?.date ?? null;
  const anthroCaption =
    data.weightPoints.length > 0
      ? `Peso: ${fmtShort(wpFirst)} a ${fmtShort(wpLast)} · ${data.weightPoints.length} registros · ${data.assessments.length} avaliação(ões) clínica(s)`
      : data.assessments.length > 0
        ? `${data.assessments.length} avaliação(ões) clínica(s) no período`
        : null;

  const photoPairs = (data.photos ?? []).filter((p) => p.beforeUri || p.afterUri);
  const hasPhotos = photoPairs.length > 0;

  return (
    <Document title={`Relatório de Evolução — ${data.patientName}`} author={data.clinicName} subject="Relatório de Evolução do paciente" creator="VERTEXA">
      <ReportShell
        eyebrow="Relatório de Evolução"
        patientName={data.patientName}
        identity={identity}
        clinicName={data.clinicName}
        emittedAt={data.emittedAt}
        brand={data.brand ?? null}
      >
        <SectionTitle title="Indicadores" />
        <KpiRow items={buildKpis(data)} />

        <SectionTitle title="Evolução de peso" hint="peso (kg) no período" />
        <WeightChartPdf points={data.weightPoints} />
        <View style={{ flexDirection: "row", marginTop: SP.md }}>
          <View style={{ marginRight: SP.lg }}>
            <Chip label="Registro do app" color={BRAND.orangeDeep} tint={BRAND.orangeTint} dotColor={BRAND.orange} />
          </View>
          <Chip label="Avaliação clínica" color={STATUS.infoText} tint={STATUS.infoTint} dotColor={STATUS.info} />
        </View>

        <SectionTitle title="Antropometria e composição" hint={rows ? "início · atual" : undefined} />
        {rows ? (
          <>
            <DataTable
              columns={[
                { key: "param", label: "Parâmetro", flex: 2 },
                { key: "inicio", label: "Início", flex: 1.4, align: "right" },
                { key: "atual", label: "Atual", flex: 1.4, align: "right" },
                { key: "variacao", label: "Variação", flex: 1.6, align: "right" },
              ]}
              rows={rows}
            />
            {anthroCaption ? <Text style={{ fontSize: 7.5, color: NEUTRAL.inkFaint, marginTop: SP.sm }}>{anthroCaption}</Text> : null}
          </>
        ) : (
          <EmptyState text="Sem avaliações clínicas registradas no período." />
        )}

        <SectionTitle title="Fotos comparativas" />
        {hasPhotos ? (
          photoPairs.map((p, i) => (
            <View key={p.label ?? `p${i}`} wrap={false} style={i > 0 ? { marginTop: SP.lg } : undefined}>
              {p.label ? <Text style={{ fontSize: 9, fontWeight: 700, color: NEUTRAL.inkSoft, marginBottom: SP.sm }}>{p.label}</Text> : null}
              <PhotoPair before={{ uri: p.beforeUri, caption: p.beforeCaption }} after={{ uri: p.afterUri, caption: p.afterCaption }} />
            </View>
          ))
        ) : (
          <EmptyState text="Sem fotos de progresso no período. As fotos enviadas pelo paciente no app aparecerão aqui." />
        )}
      </ReportShell>
    </Document>
  );
}

// Data curta pt-BR sem depender do fuso (assessed_at é DATE "yyyy-mm-dd").
function fmtShort(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

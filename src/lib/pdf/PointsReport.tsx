/**
 * RELATÓRIO DE PONTOS / VRI (VERTEXA) — documento @react-pdf montado sobre a mesma CASCA
 * reutilizável do Relatório de Evolução (ReportShell + primitivos). Foco em PONTUAÇÃO/
 * ENGAJAMENTO (VRI), motivacional, pensado para o paciente LEVAR ao retorno.
 *
 * Puramente apresentacional: recebe `PointsReportData` já resolvido. O VRI é LIDO do último
 * adherence_snapshots (a web NUNCA recalcula — PENDÊNCIA #3). NÃO há métrica de EXECUÇÃO de
 * treino (S-EXEC não existe): só dados REAIS. Cada bloco degrada com elegância se vazio.
 */
import { Text, View, StyleSheet, Svg, Path } from "@react-pdf/renderer";

import {
  Document,
  ReportShell,
  SectionTitle,
  KpiRow,
  Chip,
  VriBadge,
  DeltaBadge,
  EmptyState,
  type Kpi,
  type IdentityField,
} from "./primitives";
import { WeightChartPdf } from "./WeightChartPdf";
import { BRAND, NEUTRAL, STATUS, SP, RADIUS, FONT, vriColor } from "./theme";
import { formatWeight, formatPercent, professionalTypeLabel } from "@/lib/domain/format";
import type { ProfessionalType, WeightPoint } from "@/types/db";

export interface PointsReportData {
  patientName: string;
  goal: string | null;
  professionalName: string | null;
  professionalType: ProfessionalType | null;
  clinicName: string;
  periodLabel: string; // ex.: "01/04/2026 – 30/06/2026"
  emittedAt: string; // ex.: "02 de jul. de 2026"
  // VRI LIDO do snapshot (nunca recalculado). null = sem pontuação registrada ainda.
  vri: {
    score: number | null;
    level: string | null;
    status: string | null;
    streak: number | null;
    weeklyRate: number | null;
  } | null;
  positiveFactors: string[];
  riskFactors: string[];
  startWeight: number | null;
  currentWeight: number | null;
  targetWeight: number | null;
  weightPoints: WeightPoint[]; // já filtrados ao período
  motivationalMessage: string; // copy derivada do nível (não é métrica inventada)
}

const STATUS_LABEL: Record<string, string> = {
  novo: "Novo",
  em_acompanhamento: "Em acompanhamento",
  atencao: "Em atenção",
  em_risco: "Em risco",
  inativo: "Inativo",
};

const h = StyleSheet.create({
  hero: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: NEUTRAL.hair,
    borderRadius: RADIUS.xl,
    backgroundColor: NEUTRAL.surface,
    overflow: "hidden",
  },
  heroAccent: { width: 6, backgroundColor: BRAND.orange },
  heroMain: { flex: 1, flexDirection: "row", alignItems: "center", paddingVertical: SP.xl, paddingHorizontal: SP.xxl },
  heroScoreCol: { flex: 1.3 },
  heroLabel: { fontSize: 8, letterSpacing: 0.8, textTransform: "uppercase", color: NEUTRAL.inkSoft, marginBottom: SP.sm },
  heroScoreRow: { flexDirection: "row", alignItems: "flex-end" },
  heroScore: { fontFamily: FONT.display, fontWeight: 800, fontSize: 46, lineHeight: 1 },
  heroScoreMax: { fontSize: 12, color: NEUTRAL.inkFaint, marginLeft: 4, marginBottom: 6 },
  heroBadgeRow: { flexDirection: "row", alignItems: "center", marginTop: SP.md },
  heroStatus: { fontSize: 9, color: NEUTRAL.inkSoft, marginLeft: SP.md },
  heroStats: { flex: 1, borderLeftWidth: 1, borderLeftColor: NEUTRAL.hair, paddingLeft: SP.xxl, marginLeft: SP.lg },
  heroStat: { marginBottom: SP.lg },
  heroStatValue: { fontFamily: FONT.display, fontWeight: 700, fontSize: 18, color: NEUTRAL.ink },
  heroStatLabel: { fontSize: 8, letterSpacing: 0.6, textTransform: "uppercase", color: NEUTRAL.inkSoft, marginTop: 1 },

  factorsWrap: { flexDirection: "row", flexWrap: "wrap" },
  factorChip: { marginRight: SP.sm, marginBottom: SP.sm },

  weightDeltaRow: { flexDirection: "row", alignItems: "center", marginTop: SP.md },
  weightDeltaLabel: { fontSize: 8.5, color: NEUTRAL.inkSoft, marginRight: SP.sm },

  callout: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: BRAND.orange,
    borderRadius: RADIUS.lg,
    backgroundColor: BRAND.orangeTintSoft,
    paddingVertical: SP.lg,
    paddingHorizontal: SP.xl,
  },
  calloutText: { fontSize: 10, color: NEUTRAL.ink, lineHeight: 1.5, flex: 1, marginLeft: SP.lg },
});

/** Estrela/spark autoral (não copia ícones de terceiros) para o recado motivacional. */
function SparkIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path d="M12 2 L14 9 L21 12 L14 15 L12 22 L10 15 L3 12 L10 9 Z" fill={color} />
    </Svg>
  );
}

function VriHero({ vri }: { vri: PointsReportData["vri"] }) {
  const score = vri?.score ?? null;
  const level = vri?.level ?? null;
  const c = vriColor(level);
  const statusLabel = vri?.status ? (STATUS_LABEL[vri.status] ?? vri.status) : null;

  return (
    <View style={h.hero}>
      <View style={h.heroAccent} />
      <View style={h.heroMain}>
        <View style={h.heroScoreCol}>
          <Text style={h.heroLabel}>Índice VERTEXA de Retenção (VRI)</Text>
          <View style={h.heroScoreRow}>
            <Text style={[h.heroScore, { color: score != null ? c.fg : NEUTRAL.inkFaint }]}>
              {score != null ? score : "—"}
            </Text>
            {score != null ? <Text style={h.heroScoreMax}>/100</Text> : null}
          </View>
          <View style={h.heroBadgeRow}>
            <VriBadge level={level} />
            {statusLabel ? <Text style={h.heroStatus}>{statusLabel}</Text> : null}
          </View>
        </View>
        <View style={h.heroStats}>
          <View style={h.heroStat}>
            <Text style={h.heroStatValue}>{vri?.streak != null ? `${vri.streak} dias` : "—"}</Text>
            <Text style={h.heroStatLabel}>Sequência ativa</Text>
          </View>
          <View>
            <Text style={h.heroStatValue}>{formatPercent(vri?.weeklyRate)}</Text>
            <Text style={h.heroStatLabel}>Adesão semanal</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

export function PointsReportDoc({ data }: { data: PointsReportData }) {
  const professionalLabel = data.professionalName
    ? data.professionalType
      ? `${data.professionalName} · ${professionalTypeLabel(data.professionalType)}`
      : data.professionalName
    : "—";

  const identity: IdentityField[] = [
    { label: "Profissional", value: professionalLabel },
    { label: "Clínica", value: data.clinicName },
    { label: "Período", value: data.periodLabel },
    { label: "Objetivo", value: data.goal ?? "—" },
  ];

  const weightKpis: Kpi[] = [
    { label: "Peso inicial", value: formatWeight(data.startWeight) },
    { label: "Peso atual", value: formatWeight(data.currentWeight) },
    { label: "Meta", value: formatWeight(data.targetWeight) },
  ];
  const hasWeightDelta = data.startWeight != null && data.currentWeight != null;
  const weightDelta = hasWeightDelta ? data.currentWeight! - data.startWeight! : 0;

  const hasPositives = data.positiveFactors.length > 0;
  const hasRisks = data.riskFactors.length > 0;

  return (
    <Document
      title={`Relatório de Pontos — ${data.patientName}`}
      author={data.clinicName}
      subject="Relatório de Pontos / VRI do paciente"
      creator="VERTEXA"
    >
      <ReportShell
        eyebrow="Relatório de Pontos"
        patientName={data.patientName}
        identity={identity}
        clinicName={data.clinicName}
        emittedAt={data.emittedAt}
        footerLabel="Relatório de Pontos"
      >
        <SectionTitle title="Sua pontuação de engajamento" hint="quanto maior, melhor" />
        <VriHero vri={data.vri} />

        <SectionTitle title="Seus pontos fortes" hint={hasPositives ? "o que está indo bem" : undefined} />
        {hasPositives ? (
          <View style={h.factorsWrap}>
            {data.positiveFactors.map((f, i) => (
              <View key={i} style={h.factorChip}>
                <Chip label={f} color={STATUS.successText} tint={STATUS.successTint} dotColor={STATUS.success} />
              </View>
            ))}
          </View>
        ) : (
          <EmptyState text="Registre treinos, peso e hábitos no app para desbloquear seus primeiros pontos fortes." />
        )}

        <SectionTitle title="Onde podemos evoluir juntos" />
        {hasRisks ? (
          <View style={h.factorsWrap}>
            {data.riskFactors.map((f, i) => (
              <View key={i} style={h.factorChip}>
                <Chip label={f} color={STATUS.warningText} tint={STATUS.warningTint} dotColor={STATUS.warning} />
              </View>
            ))}
          </View>
        ) : (
          <EmptyState text="Nenhum ponto de atenção no momento. Continue assim — você está no caminho certo!" />
        )}

        <SectionTitle title="Resumo de peso" hint="início · atual · meta" />
        <KpiRow items={weightKpis} />
        {hasWeightDelta ? (
          <View style={h.weightDeltaRow}>
            <Text style={h.weightDeltaLabel}>Variação no período:</Text>
            {/* goodDirection neutro: o objetivo varia (perda x ganho) — não julgamos a cor. */}
            <DeltaBadge value={weightDelta} unit="kg" goodDirection="neutral" />
          </View>
        ) : null}
        <View style={{ marginTop: SP.lg }}>
          <WeightChartPdf points={data.weightPoints} />
        </View>

        <SectionTitle title="Recado da sua equipe" />
        <View style={h.callout}>
          <SparkIcon color={BRAND.orange} />
          <Text style={h.calloutText}>{data.motivationalMessage}</Text>
        </View>
      </ReportShell>
    </Document>
  );
}

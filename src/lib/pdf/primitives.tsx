/**
 * Primitivos de relatório VERTEXA (@react-pdf/renderer) — a CASCA reutilizável.
 * Usados hoje pelo Relatório de Evolução e projetados para Treino/Dieta reaproveitarem:
 *   ReportShell (capa+cabeçalho+rodapé fixo) · SectionTitle · KpiCard/KpiRow ·
 *   DataTable · DeltaBadge · PhotoPair · Chip · VriBadge.
 * Nada aqui é específico de "evolução": recebem dados por props.
 */
import type { ReactNode } from "react";
import { Document, Page, View, Text, Image, Svg, Path, StyleSheet } from "@react-pdf/renderer";

import { BRAND, NEUTRAL, STATUS, FONT, PAGE, SP, RADIUS, vriColor } from "./theme";

// ============================================================ STYLES
/** Altura da moldura das fotos: retrato inteiro, e dois pares (posições) cabem numa página A4. */
const PHOTO_BOX_HEIGHT = 250;

const s = StyleSheet.create({
  page: {
    backgroundColor: NEUTRAL.canvas,
    color: NEUTRAL.ink,
    fontFamily: FONT.body,
    fontSize: 9.5,
    lineHeight: 1.4,
    paddingHorizontal: PAGE.padX,
    paddingTop: PAGE.padTop,
    paddingBottom: PAGE.padBottom,
  },

  // ---- Cabeçalho / capa (flui só na 1ª página) ----
  header: { marginBottom: SP.xl },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SP.xl,
  },
  wordmarkRow: { flexDirection: "row", alignItems: "center" },
  wordmark: {
    fontFamily: FONT.display,
    fontWeight: 800,
    fontSize: 15,
    letterSpacing: 1.5,
    color: NEUTRAL.ink,
    marginLeft: SP.sm,
  },
  eyebrow: {
    fontFamily: FONT.display,
    fontWeight: 700,
    fontSize: 8.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: BRAND.orangeDeep,
  },
  patientName: {
    fontFamily: FONT.display,
    fontWeight: 700,
    fontSize: 22,
    lineHeight: 1.15,
    color: NEUTRAL.ink,
    marginBottom: SP.sm,
  },
  docSubtitle: { fontSize: 9.5, color: NEUTRAL.inkSoft, marginBottom: SP.lg },
  accentRule: { height: 3, borderRadius: 2, backgroundColor: BRAND.orange, width: 46, marginBottom: SP.lg },

  // ---- Grade de identidade ----
  identity: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderColor: NEUTRAL.hair,
    borderRadius: RADIUS.lg,
    backgroundColor: NEUTRAL.surface,
    paddingVertical: SP.lg,
    paddingHorizontal: SP.md,
  },
  identityItem: { width: "25%", paddingHorizontal: SP.md },
  identityLabel: {
    fontSize: 7,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: NEUTRAL.inkFaint,
    marginBottom: 2,
  },
  identityValue: { fontSize: 9.5, fontWeight: 600, color: NEUTRAL.ink },

  // ---- Rodapé fixo (padrão canônico do react-pdf: Texts fixos absolutos separados) ----
  footerRule: { position: "absolute", left: PAGE.padX, right: PAGE.padX, bottom: 34, borderTopWidth: 1, borderTopColor: NEUTRAL.hair },
  footerLeft: { position: "absolute", left: PAGE.padX, bottom: 22, fontSize: 7.5, color: NEUTRAL.inkFaint },
  footerRight: { position: "absolute", left: PAGE.padX, right: PAGE.padX, bottom: 22, fontSize: 7.5, color: NEUTRAL.inkFaint, textAlign: "right" },

  // ---- SectionTitle ----
  section: { marginTop: SP.xxl, marginBottom: SP.lg },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionLeft: { flexDirection: "row", alignItems: "center" },
  sectionTick: { width: 3.5, height: 14, borderRadius: 2, backgroundColor: BRAND.orange, marginRight: SP.md },
  sectionTitle: { fontFamily: FONT.display, fontWeight: 700, fontSize: 12.5, color: NEUTRAL.ink },
  sectionHint: { fontSize: 8.5, color: NEUTRAL.inkFaint },
  sectionUnderline: { height: 1, backgroundColor: NEUTRAL.hair, marginTop: SP.md },

  // ---- KpiCard ----
  kpiRow: { flexDirection: "row" },
  kpiCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: NEUTRAL.hair,
    borderRadius: RADIUS.lg,
    backgroundColor: NEUTRAL.surface,
    padding: SP.lg,
  },
  kpiLabel: {
    fontSize: 7.5,
    letterSpacing: 0.7,
    textTransform: "uppercase",
    color: NEUTRAL.inkSoft,
    marginBottom: SP.sm,
  },
  kpiValue: { fontFamily: FONT.display, fontWeight: 700, fontSize: 17, lineHeight: 1.2, color: NEUTRAL.ink },
  kpiSub: { fontSize: 8, color: NEUTRAL.inkSoft, marginTop: SP.xs },

  // ---- DataTable ----
  table: { borderWidth: 1, borderColor: NEUTRAL.hair, borderRadius: RADIUS.lg, overflow: "hidden" },
  thead: { flexDirection: "row", backgroundColor: NEUTRAL.surfaceAlt, borderBottomWidth: 1, borderBottomColor: NEUTRAL.hairStrong },
  th: { fontSize: 8, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: NEUTRAL.inkSoft, paddingVertical: SP.md, paddingHorizontal: SP.lg },
  tr: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: NEUTRAL.hair, backgroundColor: NEUTRAL.surface },
  trAlt: { backgroundColor: NEUTRAL.surfaceAlt },
  td: { fontSize: 9.5, color: NEUTRAL.ink, paddingVertical: SP.md, paddingHorizontal: SP.lg },

  // ---- DeltaBadge ----
  delta: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", borderRadius: RADIUS.sm, paddingVertical: 2, paddingHorizontal: SP.sm },
  deltaText: { fontSize: 8.5, fontWeight: 600, marginLeft: 3 },

  // ---- Chip ----
  chip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", borderRadius: 999, paddingVertical: 2, paddingHorizontal: SP.md },
  chipDot: { width: 6, height: 6, borderRadius: 3, marginRight: SP.sm },
  chipText: { fontSize: 8, fontWeight: 600 },

  // ---- PhotoPair ----
  photoRow: { flexDirection: "row" },
  photoCol: { flex: 1 },
  // contain: a foto aparece INTEIRA (cabeça aos pés) em qualquer proporção (retrato 3:4, 9:16, paisagem),
  // com fundo neutro nas sobras. "cover" cortava o corpo e deformava a leitura da evolução.
  photo: { width: "100%", height: PHOTO_BOX_HEIGHT, borderRadius: RADIUS.md, objectFit: "contain", backgroundColor: NEUTRAL.surfaceAlt, borderWidth: 1, borderColor: NEUTRAL.hair },
  photoPlaceholder: {
    width: "100%",
    height: PHOTO_BOX_HEIGHT,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: NEUTRAL.hair,
    borderStyle: "dashed",
    backgroundColor: NEUTRAL.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  photoCaption: { fontSize: 8, color: NEUTRAL.inkSoft, marginTop: SP.sm, textAlign: "center" },
  photoTag: { fontSize: 7, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: NEUTRAL.inkFaint, textAlign: "center", marginBottom: SP.sm },

  // ---- Empty state ----
  empty: {
    borderWidth: 1,
    borderColor: NEUTRAL.hair,
    borderStyle: "dashed",
    borderRadius: RADIUS.lg,
    backgroundColor: NEUTRAL.surfaceAlt,
    paddingVertical: SP.xxl,
    alignItems: "center",
  },
  emptyText: { fontSize: 9, color: NEUTRAL.inkSoft },
});

// ============================================================ WORDMARK
/** Marca VERTEXA: "V duplo chevron" (autoral) + wordmark. Não copia identidade de terceiros. */
function Wordmark() {
  return (
    <View style={s.wordmarkRow}>
      <Svg width={16} height={16} viewBox="0 0 16 16">
        <Path d="M2 4 L8 11 L14 4" stroke={BRAND.orange} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M4.5 3.5 L8 8 L11.5 3.5" stroke={BRAND.orangeDeep} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
      <Text style={s.wordmark}>VERTEXA</Text>
    </View>
  );
}

/** Assinatura da clínica: logo (altura fixa, proporção preservada) + nome em destaque. */
function ClinicMark({ name, logoUri }: { name: string; logoUri: string | null }) {
  return (
    <View style={s.wordmarkRow}>
      {logoUri ? <Image src={logoUri} style={{ height: 30, maxWidth: 90, objectFit: "contain", marginRight: SP.md }} /> : null}
      <Text style={s.wordmark}>{name}</Text>
    </View>
  );
}

// ============================================================ REPORT SHELL
export interface IdentityField {
  label: string;
  value: string;
}
/** Identidade da clínica no cabeçalho: logo (data URI PNG/JPG) e cor do traço de destaque. */
export interface ReportBrand {
  logoUri: string | null;
  color: string | null;
}
export interface ReportShellProps {
  /** Quando presente, a CLÍNICA assina o cabeçalho (logo + nome) e a Vertexa vira assinatura secundária. */
  brand?: ReportBrand | null;
  eyebrow: string; // ex.: "Relatório de Evolução"
  patientName: string;
  subtitle?: string; // ex.: "Período: 01/04 – 30/06/2026"
  identity: IdentityField[]; // grade (Objetivo, Profissional, Clínica, ...)
  clinicName: string;
  emittedAt: string; // já formatado
  /** Rótulo do rodapé-direito (nome do relatório). Default preserva o Relatório de Evolução. */
  footerLabel?: string;
  children: ReactNode;
}

/** Uma <Page> A4 com capa/cabeçalho + rodapé fixo (marca/clínica/emissão). Reutilizável por todos os relatórios. */
export function ReportShell({ eyebrow, patientName, subtitle, identity, clinicName, emittedAt, footerLabel = "Relatório de Evolução", children, brand }: ReportShellProps) {
  return (
    <Page size="A4" style={s.page}>
      <View style={s.header}>
        <View style={s.headerTop}>
          {brand ? <ClinicMark name={clinicName} logoUri={brand.logoUri} /> : <Wordmark />}
          <Text style={s.eyebrow}>{eyebrow}</Text>
        </View>
        <View style={brand?.color ? [s.accentRule, { backgroundColor: brand.color }] : s.accentRule} />
        <Text style={s.patientName}>{patientName}</Text>
        {subtitle ? <Text style={s.docSubtitle}>{subtitle}</Text> : <View style={{ marginBottom: SP.md }} />}
        <View style={s.identity}>
          {identity.map((f, i) => (
            <View key={i} style={s.identityItem}>
              <Text style={s.identityLabel}>{f.label}</Text>
              <Text style={s.identityValue}>{f.value}</Text>
            </View>
          ))}
        </View>
      </View>

      {children}

      {/* Rodapé fixo (repete em todas as páginas). NOTA: a numeração dinâmica de página via
          prop `render` não é aplicada no BUILD BROWSER do @react-pdf v4 — por isso rótulo estático. */}
      <View fixed style={s.footerRule} />
      <Text fixed style={s.footerLeft}>
        {clinicName} · Emitido em {emittedAt} · Documento confidencial (LGPD)
      </Text>
      <Text fixed style={s.footerRight}>{brand ? "via VERTEXA" : "VERTEXA"} · {footerLabel}</Text>
    </Page>
  );
}

// Reexport para o documento montar o <Document> raiz.
export { Document };

// ============================================================ SECTION TITLE
export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={s.section}>
      <View style={s.sectionRow}>
        <View style={s.sectionLeft}>
          <View style={s.sectionTick} />
          <Text style={s.sectionTitle}>{title}</Text>
        </View>
        {hint ? <Text style={s.sectionHint}>{hint}</Text> : null}
      </View>
      <View style={s.sectionUnderline} />
    </View>
  );
}

// ============================================================ KPI
export interface Kpi {
  label: string;
  value: string;
  sub?: ReactNode;
  /** Sobrescreve o tamanho do valor (ex.: texto longo como "Objetivo"). Default 17. */
  valueSize?: number;
}
export function KpiRow({ items }: { items: Kpi[] }) {
  return (
    <View style={s.kpiRow}>
      {items.map((k, i) => (
        <View key={i} style={[s.kpiCard, i < items.length - 1 ? { marginRight: SP.md } : {}]}>
          <Text style={s.kpiLabel}>{k.label}</Text>
          <Text style={[s.kpiValue, k.valueSize ? { fontSize: k.valueSize, lineHeight: 1.2 } : {}]}>{k.value}</Text>
          {typeof k.sub === "string" ? <Text style={s.kpiSub}>{k.sub}</Text> : k.sub ? <View style={{ marginTop: SP.xs }}>{k.sub}</View> : null}
        </View>
      ))}
    </View>
  );
}

// ============================================================ DATA TABLE
export interface Column {
  key: string;
  label: string;
  flex?: number; // largura relativa (default 1)
  align?: "left" | "right" | "center";
}
export function DataTable({ columns, rows }: { columns: Column[]; rows: Array<Record<string, ReactNode>> }) {
  const alignStyle = (a?: Column["align"]) =>
    a === "right" ? ({ textAlign: "right" } as const) : a === "center" ? ({ textAlign: "center" } as const) : ({ textAlign: "left" } as const);
  const cellAlign = (a?: Column["align"]) =>
    a === "right" ? ({ alignItems: "flex-end" } as const) : a === "center" ? ({ alignItems: "center" } as const) : ({ alignItems: "flex-start" } as const);

  return (
    <View style={s.table}>
      <View style={s.thead}>
        {columns.map((c) => (
          <Text key={c.key} style={[s.th, { flex: c.flex ?? 1 }, alignStyle(c.align)]}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={[s.tr, ri % 2 === 1 ? s.trAlt : {}, ri === rows.length - 1 ? { borderBottomWidth: 0 } : {}]}>
          {columns.map((c) => {
            const content = row[c.key];
            return (
              <View key={c.key} style={[{ flex: c.flex ?? 1, paddingVertical: SP.md, paddingHorizontal: SP.lg }, cellAlign(c.align)]}>
                {typeof content === "string" || typeof content === "number" ? (
                  <Text style={[{ fontSize: 9.5, color: NEUTRAL.ink }, alignStyle(c.align)]}>{content}</Text>
                ) : (
                  content ?? <Text style={{ fontSize: 9.5, color: NEUTRAL.inkFaint }}>—</Text>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ============================================================ DELTA BADGE
type Direction = "up" | "down" | "flat";
export interface DeltaBadgeProps {
  value: number; // variação (assinada)
  unit?: string; // ex.: "kg", "%"
  digits?: number;
  /** Qual direção é "boa" (verde). Para peso em emagrecimento: "down". */
  goodDirection?: "up" | "down" | "neutral";
}
export function DeltaBadge({ value, unit = "", digits = 1, goodDirection = "neutral" }: DeltaBadgeProps) {
  const dir: Direction = value > 0.0001 ? "up" : value < -0.0001 ? "down" : "flat";
  let palette: { fg: string; tint: string } = { fg: STATUS.neutral, tint: STATUS.neutralTint };
  if (dir !== "flat" && goodDirection !== "neutral") {
    const good = dir === goodDirection;
    palette = good ? { fg: STATUS.successText, tint: STATUS.successTint } : { fg: STATUS.dangerText, tint: STATUS.dangerTint };
  } else if (dir !== "flat") {
    palette = { fg: NEUTRAL.inkSoft, tint: NEUTRAL.surfaceAlt };
  }

  const abs = Math.abs(value).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = dir === "up" ? "+" : dir === "down" ? "−" : "";
  const label = dir === "flat" ? `0${unit ? " " + unit : ""}` : `${sign}${abs}${unit ? " " + unit : ""}`;

  return (
    <View style={[s.delta, { backgroundColor: palette.tint }]}>
      {dir !== "flat" ? (
        <Svg width={7} height={7} viewBox="0 0 8 8">
          {dir === "up" ? (
            <Path d="M4 0 L8 7 L0 7 Z" fill={palette.fg} />
          ) : (
            <Path d="M0 1 L8 1 L4 8 Z" fill={palette.fg} />
          )}
        </Svg>
      ) : null}
      <Text style={[s.deltaText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

// ============================================================ CHIP
export function Chip({ label, color, tint, dotColor }: { label: string; color: string; tint: string; dotColor?: string }) {
  return (
    <View style={[s.chip, { backgroundColor: tint }]}>
      <View style={[s.chipDot, { backgroundColor: dotColor ?? color }]} />
      <Text style={[s.chipText, { color }]}>{label}</Text>
    </View>
  );
}

/** Badge de adesão (VRI) com cor por nível — reutiliza o vocabulário clínico. */
export function VriBadge({ level }: { level: string | null | undefined }) {
  const c = vriColor(level);
  const label = level ? level.charAt(0).toUpperCase() + level.slice(1) : "—";
  return <Chip label={label} color={c.text} tint={c.tint} />;
}

// ============================================================ PHOTO PAIR
export interface PhotoSlot {
  uri: string | null;
  caption: string;
}
export function PhotoPair({ before, after }: { before: PhotoSlot; after: PhotoSlot }) {
  const slot = (p: PhotoSlot, tag: string, marginRight?: boolean) => (
    <View style={[s.photoCol, marginRight ? { marginRight: SP.lg } : {}]}>
      <Text style={s.photoTag}>{tag}</Text>
      {p.uri ? (
        <Image src={p.uri} style={s.photo} />
      ) : (
        <View style={s.photoPlaceholder}>
          <Text style={s.emptyText}>Imagem indisponível</Text>
        </View>
      )}
      <Text style={s.photoCaption}>{p.caption}</Text>
    </View>
  );
  return (
    <View style={s.photoRow}>
      {slot(before, "Antes", true)}
      {slot(after, "Depois")}
    </View>
  );
}

// ============================================================ EMPTY
export function EmptyState({ text }: { text: string }) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}

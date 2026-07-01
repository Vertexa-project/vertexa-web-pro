/**
 * Gráfico de evolução de peso 100% VETORIAL para o PDF (@react-pdf Svg) — NÃO embute recharts.
 * Espelha o WeightChart do web: ponto laranja = registro do app; azul = avaliação clínica.
 * Eixos com rótulos, gridlines suaves, área com leve gradiente laranja, primeiro/último valor
 * em destaque. Recebe pontos JÁ filtrados pelo período. Degrada elegante se vazio/1 ponto.
 */
import { View, Text, Svg, Defs, LinearGradient, Stop, Line, Path, Circle, StyleSheet } from "@react-pdf/renderer";
import { parseISO, format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { BRAND, NEUTRAL, STATUS, RADIUS } from "./theme";
import type { WeightPoint } from "@/types/db";

const st = StyleSheet.create({
  yLabel: { position: "absolute", fontSize: 7.5, color: NEUTRAL.inkFaint, textAlign: "right" },
  xLabel: { position: "absolute", fontSize: 7.5, color: NEUTRAL.inkFaint, textAlign: "center" },
  valuePill: {
    position: "absolute",
    backgroundColor: NEUTRAL.surface,
    borderWidth: 1,
    borderColor: NEUTRAL.hair,
    borderRadius: RADIUS.sm,
    paddingVertical: 1,
    paddingHorizontal: 4,
  },
  valueText: { fontSize: 7.5, fontWeight: 700, textAlign: "center" },
  empty: {
    height: 150,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: NEUTRAL.hair,
    borderRadius: RADIUS.lg,
    backgroundColor: NEUTRAL.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: { fontSize: 9, color: NEUTRAL.inkSoft },
});

const shortDate = (iso: string) => format(parseISO(iso), "dd MMM", { locale: ptBR });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function WeightChartPdf({
  points,
  width = 515,
  height = 208,
}: {
  points: WeightPoint[];
  width?: number;
  height?: number;
}) {
  const data = points.filter((p) => p.weight != null && p.date);

  if (data.length === 0) {
    return (
      <View style={st.empty}>
        <Text style={st.emptyText}>Sem registros de peso no período.</Text>
      </View>
    );
  }

  // Área de plotagem.
  const padL = 40;
  const padR = 16;
  const padT = 14;
  const padB = 26;
  const x0 = padL;
  const x1 = width - padR;
  const y0 = padT;
  const y1 = height - padB;
  const plotW = x1 - x0;
  const plotH = y1 - y0;

  // Escala X por tempo.
  const times = data.map((d) => parseISO(d.date).getTime());
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const xFor = (ms: number) => (tMax > tMin ? x0 + ((ms - tMin) / (tMax - tMin)) * plotW : x0 + plotW / 2);

  // Escala Y por peso (domínio com folga).
  const ws = data.map((d) => Number(d.weight));
  let dMin = Math.floor(Math.min(...ws) - 1);
  let dMax = Math.ceil(Math.max(...ws) + 1);
  if (dMin === dMax) {
    dMin -= 1;
    dMax += 1;
  }
  const yFor = (w: number) => y1 - ((w - dMin) / (dMax - dMin)) * plotH;

  // Ticks Y (4 faixas → 5 valores), arredondados e sem duplicar.
  const tickCount = 4;
  const yTicks = Array.from(new Set(Array.from({ length: tickCount + 1 }, (_, i) => Math.round(dMin + (i * (dMax - dMin)) / tickCount))));

  // Ticks X (até 4 datas: primeira, ~1/3, ~2/3, última).
  const xIdx = data.length <= 4 ? data.map((_, i) => i) : [0, Math.round((data.length - 1) / 3), Math.round((2 * (data.length - 1)) / 3), data.length - 1];
  const xTickIdx = Array.from(new Set(xIdx));

  const coords = data.map((d) => ({ x: xFor(parseISO(d.date).getTime()), y: yFor(Number(d.weight)), src: d.source, w: Number(d.weight) }));

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(2)} ${y1} L ${coords[0].x.toFixed(2)} ${y1} Z`;

  const first = coords[0];
  const last = coords[coords.length - 1];
  const fmtVal = (w: number) => `${w.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}`;

  return (
    <View style={{ position: "relative", width, height }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="wl-area" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={BRAND.orange} stopOpacity={0.22} />
            <Stop offset="1" stopColor={BRAND.orange} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        {/* Gridlines horizontais */}
        {yTicks.map((t, i) => {
          const y = yFor(t);
          return <Line key={i} x1={x0} y1={y} x2={x1} y2={y} stroke={NEUTRAL.hair} strokeWidth={0.75} />;
        })}

        {/* Área + linha (só com 2+ pontos) */}
        {coords.length >= 2 ? <Path d={areaPath} fill="url(#wl-area)" /> : null}
        {coords.length >= 2 ? <Path d={linePath} stroke={BRAND.orange} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}

        {/* Pontos por origem */}
        {coords.map((c, i) => (
          <Circle key={i} cx={c.x} cy={c.y} r={3} fill={c.src === "app" ? BRAND.orange : STATUS.info} stroke={NEUTRAL.surface} strokeWidth={1.2} />
        ))}
      </Svg>

      {/* Rótulos Y */}
      {yTicks.map((t, i) => (
        <Text key={`y${i}`} style={[st.yLabel, { top: yFor(t) - 4, left: 0, width: padL - 6 }]}>
          {t}
        </Text>
      ))}

      {/* Rótulos X */}
      {xTickIdx.map((idx) => {
        const c = coords[idx];
        return (
          <Text key={`x${idx}`} style={[st.xLabel, { top: y1 + 6, left: clamp(c.x - 20, 0, width - 40), width: 40 }]}>
            {shortDate(data[idx].date)}
          </Text>
        );
      })}

      {/* Destaque primeiro/último valor */}
      <View style={[st.valuePill, { top: clamp(first.y - 18, 2, y1), left: clamp(first.x - 14, 0, width - 34), minWidth: 28 }]}>
        <Text style={[st.valueText, { color: NEUTRAL.inkSoft }]}>{fmtVal(first.w)}</Text>
      </View>
      <View style={[st.valuePill, { top: clamp(last.y - 18, 2, y1), left: clamp(last.x - 14, 0, width - 34), minWidth: 28, borderColor: BRAND.orange }]}>
        <Text style={[st.valueText, { color: BRAND.orangeDeep }]}>{fmtVal(last.w)}</Text>
      </View>
    </View>
  );
}

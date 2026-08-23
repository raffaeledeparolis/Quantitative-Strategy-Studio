import React, { useState, useMemo } from "react";
import {
  BarChart, Bar, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Shuffle, Info, AlertTriangle, Loader2, PlayCircle, Download, RotateCcw, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { C, FONT_SERIF, FONT_SANS, FONT_MONO, Card, Button, Field, KPI, inputStyle } from "./CommonUI";
import { BacktestResult, MoneyManagement, MonteCarloConfig, MonteCarloResult } from "../types";
import { fmtPct, fmtNum, fmtMoney } from "../lib/csvHelper";
import { computeReliabilityScore, buildNarrative, mcSummaryToCSV } from "../lib/monteCarloEngine";
import { downloadText } from "../lib/backtestEngine";
import { exportBacktestPdfReport } from "../lib/pdfReportGenerator";

interface Step5MonteCarloProps {
  result: BacktestResult;
  mm: MoneyManagement;
  config: MonteCarloConfig;
  setConfig: React.Dispatch<React.SetStateAction<MonteCarloConfig>>;
  mcResult: MonteCarloResult | null;
  running: boolean;
  error: string | null;
  onRun: () => void;
  onBack: () => void;
  onReset: () => void;
  onScenario: () => void;
}

export function Step5MonteCarlo({
  result,
  mm,
  config,
  setConfig,
  mcResult,
  running,
  error,
  onRun,
  onBack,
  onReset,
  onScenario,
}: Step5MonteCarloProps) {
  const { trades, metrics } = result;
  const [exportingPdf, setExportingPdf] = useState(false);
  const n = trades.length;

  const handleExportPdf = async () => {
    try {
      setExportingPdf(true);
      await exportBacktestPdfReport({
        result,
        mm,
        mcResult,
        strategyTitle: "Strategia Quantitativa - Monte Carlo",
      });
    } catch (err) {
      console.error("PDF export error:", err);
    } finally {
      setExportingPdf(false);
    }
  };

  const iterValid = Number.isFinite(config.iterations) && config.iterations >= 100 && config.iterations <= 20000;
  const ruinValid = Number.isFinite(config.ruinThresholdPct) && config.ruinThresholdPct > 0 && config.ruinThresholdPct < 100;

  const actualTradeEquity = useMemo(() => [mm.initialCapital, ...trades.map((t) => t.equityAfter)], [trades, mm.initialCapital]);

  const fanChartData = useMemo(() => {
    if (!mcResult) return [];
    return mcResult.bands.map((b, i) => {
      const actual = actualTradeEquity[i];
      return {
        ...b,
        actual,
        baseP5: b.p5,
        bandP5P25: b.p25 - b.p5,
        bandP25P75: b.p75 - b.p25,
        bandP75P95: b.p95 - b.p75,
        outOfBand: actual != null && (actual < b.p5 || actual > b.p95),
      };
    });
  }, [mcResult, actualTradeEquity]);

  const outOfBandCount = useMemo(() => fanChartData.filter((d) => d.outOfBand).length, [fanChartData]);
  const outOfBandPct = fanChartData.length ? outOfBandCount / fanChartData.length : 0;

  const reliability = useMemo(() => (mcResult ? computeReliabilityScore(metrics, mcResult, trades, mm) : null), [mcResult, metrics, trades, mm]);
  const narrative = useMemo(
    () => (mcResult && reliability ? buildNarrative(metrics, mcResult, reliability, mm, n) : []),
    [mcResult, reliability, metrics, mm, n]
  );

  return (
    <div id="step-5-container">
      <Card style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: FONT_SERIF, fontSize: 19, color: C.primaryDark, marginTop: 0, display: "flex", alignItems: "center", gap: 9 }}>
          <Shuffle size={19} /> 5. Monte Carlo Analysis
        </h2>
        <p style={{ fontSize: 13.5, color: C.muted, marginTop: -6 }}>
          Ricampiona i {n} trade del backtest per generare sequenze alternative plausibili e misurare la robustezza statistica.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginTop: 6 }}>
          <Field label="Numero di iterazioni" hint="min 100, max 20.000">
            <input
              id="input-mc-iterations"
              type="number"
              step="100"
              min="100"
              max="20000"
              value={config.iterations}
              onChange={(e) => setConfig({ ...config, iterations: parseInt(e.target.value, 10) })}
              style={inputStyle}
            />
          </Field>
          <Field label="Metodo di ricampionamento">
            <select
              id="select-mc-method"
              value={config.method}
              onChange={(e) => setConfig({ ...config, method: e.target.value as "bootstrap" | "permutation" })}
              style={inputStyle}
            >
              <option value="bootstrap">Bootstrap (con reinserimento)</option>
              <option value="permutation">Permutazione (solo riordino)</option>
            </select>
          </Field>
          <Field label="Soglia di rovina (% del capitale)" hint="es. 50 = equity scesa al 50% del capitale">
            <input
              id="input-mc-ruin-threshold"
              type="number"
              step="5"
              min="1"
              max="99"
              value={config.ruinThresholdPct}
              onChange={(e) => setConfig({ ...config, ruinThresholdPct: parseFloat(e.target.value) })}
              style={inputStyle}
            />
          </Field>
        </div>

        <div style={{ background: C.amberLight, border: `1px solid ${C.amber}55`, borderRadius: 8, padding: 12, fontSize: 12.5, marginBottom: 18 }}>
          <Info size={13} style={{ verticalAlign: -2 }} color={C.amber} /> <b>Bootstrap</b> ricampiona con reinserimento (stima rischio sequenza + incertezza campionaria). <b>Permutazione</b> riordina gli stessi trade (isola l'effetto-ordine).
        </div>

        {n < 30 && (
          <div style={{ background: C.redLight, border: `1px solid ${C.red}33`, borderRadius: 8, padding: 12, fontSize: 12.5, color: C.red, marginBottom: 18 }}>
            <AlertTriangle size={13} style={{ verticalAlign: -2 }} /> Solo {n} trade nel backtest: con campioni piccoli i risultati Monte Carlo vanno letti con cautela.
          </div>
        )}

        {error && (
          <div style={{ background: C.redLight, border: `1px solid ${C.red}33`, borderRadius: 8, padding: 12, fontSize: 13, color: C.red, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <Button
          id="btn-run-monte-carlo"
          onClick={onRun}
          disabled={!iterValid || !ruinValid || running}
          icon={running ? Loader2 : PlayCircle}
        >
          {running ? "Simulazione in corso..." : mcResult ? "Riesegui Monte Carlo" : "Esegui Monte Carlo"}
        </Button>
      </Card>

      {mcResult && (
        <>
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10, marginBottom: 6 }}>
              <KPI label="Rischio di rovina" value={fmtPct(mcResult.riskOfRuin)} negative={mcResult.riskOfRuin > 0.05} />
              <KPI label="Prob. rendimento positivo" value={fmtPct(mcResult.probPositive)} negative={mcResult.probPositive < 0.5} />
              <KPI label="Drawdown mediano (MC)" value={fmtPct(mcResult.ddStats.p50)} />
              <KPI label="Drawdown worst-case (p95)" value={fmtPct(mcResult.ddStats.p95)} negative />
              <KPI label="Drawdown giorn. medio (MC)" value={fmtPct(mcResult.avgDailyDDStats.p50)} negative={mcResult.avgDailyDDStats.p50 < 0} />
              <KPI label="Profit factor mediano (MC)" value={fmtNum(mcResult.pfStats.p50)} />
            </div>
            <div style={{ fontSize: 11.5, color: C.muted, fontFamily: FONT_SANS }}>
              Basato su {mcResult.iterations.toLocaleString("it-IT")} iterazioni · soglia rovina: {mcResult.ruinThresholdPct}% del capitale
            </div>
          </Card>

          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 4 }}>
              <div>
                <h3 style={{ fontFamily: FONT_SERIF, fontSize: 15, color: C.primaryDark, margin: 0 }}>Fan chart — percorsi simulati vs sequenza reale</h3>
                <p style={{ fontSize: 12, color: C.muted, marginTop: 4, marginBottom: 0, maxWidth: 560 }}>
                  Le bande mostrano dove si sarebbe potuta trovare l'equity nelle {mcResult.iterations.toLocaleString("it-IT")} simulazioni; la linea scura è la sequenza reale.
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5, fontFamily: FONT_SANS, fontSize: 11.5, flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 14, height: 10, background: C.primary, opacity: 0.16, borderRadius: 2, border: `1px solid ${C.primary}55` }} />
                  <span style={{ color: C.muted }}>Banda 5°–95° percentile</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 14, height: 10, background: C.primary, opacity: 0.38, borderRadius: 2, border: `1px solid ${C.primary}88` }} />
                  <span style={{ color: C.muted }}>Banda 25°–75° percentile</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 14, height: 2, background: C.amber, borderTop: `2px dashed ${C.amber}` }} />
                  <span style={{ color: C.muted }}>Mediana simulata</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ width: 14, height: 2.5, background: C.text, borderRadius: 1 }} />
                  <span style={{ color: C.muted }}>Sequenza reale osservata</span>
                </div>
              </div>
            </div>

            {outOfBandCount > 0 && (
              <div style={{ background: C.amberLight, border: `1px solid ${C.amber}55`, borderRadius: 8, padding: "8px 12px", fontSize: 12, marginTop: 12, marginBottom: 4 }}>
                <AlertTriangle size={12} color={C.amber} style={{ verticalAlign: -1, marginRight: 5 }} />
                La sequenza reale esce dalla banda 5°–95° in {outOfBandCount} trade su {fanChartData.length} ({fmtPct(outOfBandPct, 1)}).
              </div>
            )}

            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={fanChartData} margin={{ top: 14, right: 14, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="step" tick={{ fontSize: 10 }} label={{ value: "Trade #", position: "insideBottom", offset: -3, fontSize: 11, fill: C.muted }} />
                <YAxis tick={{ fontSize: 10 }} width={54} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
                <Tooltip
                  labelFormatter={(s) => `Dopo il trade #${s}`}
                  content={({ active, payload, label }) => {
                    if (!active || !payload || !payload.length) return null;
                    const d = payload[0]?.payload;
                    if (!d) return null;
                    return (
                      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 7, padding: "9px 12px", fontFamily: FONT_SANS, fontSize: 12, boxShadow: "0 4px 14px rgba(0,0,0,0.12)" }}>
                        <div style={{ fontWeight: 700, color: C.primaryDark, marginBottom: 6 }}>Dopo il trade #{label}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 10, rowGap: 3 }}>
                          <span style={{ color: C.text, fontWeight: 700 }}>Reale:</span>
                          <span style={{ fontWeight: 700, color: C.text }}>{d.actual != null ? fmtMoney(d.actual) : "—"}</span>
                          <span style={{ color: C.amber }}>Mediana simulata:</span>
                          <span>{fmtMoney(d.p50)}</span>
                          <span style={{ color: C.muted }}>Banda 25°–75°:</span>
                          <span>{fmtMoney(d.p25)} – {fmtMoney(d.p75)}</span>
                          <span style={{ color: C.muted }}>Banda 5°–95°:</span>
                          <span>{fmtMoney(d.p5)} – {fmtMoney(d.p95)}</span>
                        </div>
                        {d.outOfBand && <div style={{ marginTop: 6, color: C.amber, fontSize: 11 }}>⚠ fuori dalla banda 5°–95°</div>}
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={mm.initialCapital} stroke="#999" strokeDasharray="4 4" label={{ value: "capitale iniziale", fontSize: 9.5, fill: "#999", position: "insideBottomLeft" }} />

                <Area dataKey="baseP5" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />
                <Area dataKey="bandP5P25" stackId="band" stroke="none" fill={C.primary} fillOpacity={0.16} isAnimationActive={false} />
                <Area dataKey="bandP25P75" stackId="band" stroke="none" fill={C.primary} fillOpacity={0.38} isAnimationActive={false} />
                <Area dataKey="bandP75P95" stackId="band" stroke="none" fill={C.primary} fillOpacity={0.16} isAnimationActive={false} />

                <Line dataKey="p50" stroke={C.amber} strokeDasharray="5 4" dot={false} strokeWidth={1.6} isAnimationActive={false} />
                <Line dataKey="actual" stroke={C.text} dot={false} strokeWidth={2.4} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
            <Card>
              <h3 style={{ fontFamily: FONT_SERIF, fontSize: 14, color: C.primaryDark, marginTop: 0 }}>Rendimento totale</h3>
              <ResponsiveContainer width="100%" height={170}>
                <BarChart data={mcResult.histReturns}>
                  <XAxis dataKey="label" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 9 }} tickFormatter={(v) => fmtPct(v, 0)} />
                  <YAxis tick={{ fontSize: 9 }} width={28} />
                  <Tooltip formatter={(v: any) => [v, "# simulazioni"]} labelFormatter={(v: any) => fmtPct(v)} />
                  <ReferenceLine x={metrics.totalReturnPct} stroke={C.red} strokeWidth={1.6} label={{ value: "reale", fontSize: 9, fill: C.red, position: "top" }} />
                  <Bar dataKey="count" fill={C.primary} fillOpacity={0.55} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <h3 style={{ fontFamily: FONT_SERIF, fontSize: 14, color: C.primaryDark, marginTop: 0 }}>Max Drawdown</h3>
              <ResponsiveContainer width="100%" height={170}>
                <BarChart data={mcResult.histDD}>
                  <XAxis dataKey="label" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 9 }} tickFormatter={(v) => fmtPct(v, 0)} />
                  <YAxis tick={{ fontSize: 9 }} width={28} />
                  <Tooltip formatter={(v: any) => [v, "# simulazioni"]} labelFormatter={(v: any) => fmtPct(v)} />
                  <ReferenceLine x={metrics.maxDDPct} stroke={C.red} strokeWidth={1.6} label={{ value: "reale", fontSize: 9, fill: C.red, position: "top" }} />
                  <Bar dataKey="count" fill={C.red} fillOpacity={0.45} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <h3 style={{ fontFamily: FONT_SERIF, fontSize: 14, color: C.primaryDark, marginTop: 0 }}>Drawdown giorn. medio</h3>
              <ResponsiveContainer width="100%" height={170}>
                <BarChart data={mcResult.histAvgDailyDD}>
                  <XAxis dataKey="label" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 9 }} tickFormatter={(v) => fmtPct(v, 1)} />
                  <YAxis tick={{ fontSize: 9 }} width={28} />
                  <Tooltip formatter={(v: any) => [v, "# simulazioni"]} labelFormatter={(v: any) => fmtPct(v)} />
                  <ReferenceLine x={metrics.avgDailyDrawdownPct} stroke={C.red} strokeWidth={1.6} label={{ value: "reale", fontSize: 9, fill: C.red, position: "top" }} />
                  <Bar dataKey="count" fill="#2e86ab" fillOpacity={0.5} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <h3 style={{ fontFamily: FONT_SERIF, fontSize: 14, color: C.primaryDark, marginTop: 0 }}>Profit Factor</h3>
              <ResponsiveContainer width="100%" height={170}>
                <BarChart data={mcResult.histPF}>
                  <XAxis dataKey="label" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 9 }} tickFormatter={(v) => fmtNum(v, 1)} />
                  <YAxis tick={{ fontSize: 9 }} width={28} />
                  <Tooltip formatter={(v: any) => [v, "# simulazioni"]} labelFormatter={(v: any) => fmtNum(v)} />
                  <ReferenceLine x={Math.min(metrics.profitFactor, 10)} stroke={C.red} strokeWidth={1.6} label={{ value: "reale", fontSize: 9, fill: C.red, position: "top" }} />
                  <Bar dataKey="count" fill={C.amber} fillOpacity={0.5} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card style={{ marginBottom: 20 }}>
            <h3 style={{ fontFamily: FONT_SERIF, fontSize: 15, color: C.primaryDark, marginTop: 0 }}>Tabella riassuntiva — Reale vs Monte Carlo</h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, fontFamily: FONT_MONO }}>
                <thead>
                  <tr>
                    {["Metrica", "Reale", "MC p5", "MC p25", "MC mediana", "MC p75", "MC p95", "MC media"].map((h) => (
                      <th key={h} style={{ textAlign: h === "Metrica" ? "left" : "right", padding: "7px 9px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, fontSize: 11, color: C.muted, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: "6px 9px", fontFamily: FONT_SANS, fontWeight: 600 }}>Rendimento totale</td>
                    <td style={{ padding: "6px 9px", textAlign: "right", fontWeight: 700, color: C.primaryDark }}>{fmtPct(metrics.totalReturnPct)}</td>
                    {(["p5", "p25", "p50", "p75", "p95"] as const).map((k) => (
                      <td key={k} style={{ padding: "6px 9px", textAlign: "right" }}>{fmtPct(mcResult.returnStats[k])}</td>
                    ))}
                    <td style={{ padding: "6px 9px", textAlign: "right" }}>{fmtPct(mcResult.returnStats.mean)}</td>
                  </tr>
                  <tr style={{ background: "#f4f3ee" }}>
                    <td style={{ padding: "6px 9px", fontFamily: FONT_SANS, fontWeight: 600 }}>Max Drawdown</td>
                    <td style={{ padding: "6px 9px", textAlign: "right", fontWeight: 700, color: C.red }}>{fmtPct(metrics.maxDDPct)}</td>
                    {(["p5", "p25", "p50", "p75", "p95"] as const).map((k) => (
                      <td key={k} style={{ padding: "6px 9px", textAlign: "right" }}>{fmtPct(mcResult.ddStats[k])}</td>
                    ))}
                    <td style={{ padding: "6px 9px", textAlign: "right" }}>{fmtPct(mcResult.ddStats.mean)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "6px 9px", fontFamily: FONT_SANS, fontWeight: 600 }}>Drawdown giornaliero medio</td>
                    <td style={{ padding: "6px 9px", textAlign: "right", fontWeight: 700, color: C.red }}>{fmtPct(metrics.avgDailyDrawdownPct)}</td>
                    {(["p5", "p25", "p50", "p75", "p95"] as const).map((k) => (
                      <td key={k} style={{ padding: "6px 9px", textAlign: "right" }}>{fmtPct(mcResult.avgDailyDDStats[k])}</td>
                    ))}
                    <td style={{ padding: "6px 9px", textAlign: "right" }}>{fmtPct(mcResult.avgDailyDDStats.mean)}</td>
                  </tr>
                  <tr style={{ background: "#f4f3ee" }}>
                    <td style={{ padding: "6px 9px", fontFamily: FONT_SANS, fontWeight: 600 }}>Profit Factor</td>
                    <td style={{ padding: "6px 9px", textAlign: "right", fontWeight: 700, color: C.primaryDark }}>{fmtNum(metrics.profitFactor)}</td>
                    {(["p5", "p25", "p50", "p75", "p95"] as const).map((k) => (
                      <td key={k} style={{ padding: "6px 9px", textAlign: "right" }}>{fmtNum(mcResult.pfStats[k])}</td>
                    ))}
                    <td style={{ padding: "6px 9px", textAlign: "right" }}>{fmtNum(mcResult.pfStats.mean)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {reliability && (
            <Card style={{ marginBottom: 20 }}>
              <h3 style={{ fontFamily: FONT_SERIF, fontSize: 17, color: C.primaryDark, marginTop: 0 }}>Giudizio di affidabilità complessivo</h3>

              <div style={{ display: "flex", gap: 24, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
                <div
                  style={{
                    width: 118,
                    height: 118,
                    borderRadius: "50%",
                    flexShrink: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `7px solid ${reliability.verdictColor}`,
                    background: `${reliability.verdictColor}11`,
                  }}
                >
                  <div style={{ fontFamily: FONT_SANS, fontSize: 34, fontWeight: 800, color: reliability.verdictColor, lineHeight: 1 }}>{reliability.score}</div>
                  <div style={{ fontFamily: FONT_SANS, fontSize: 10.5, color: C.muted }}>su 100</div>
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontFamily: FONT_SANS, fontSize: 16, fontWeight: 700, color: reliability.verdictColor, marginBottom: 4 }}>{reliability.verdict}</div>
                  <div style={{ display: "flex", height: 9, borderRadius: 5, overflow: "hidden", border: `1px solid ${C.border}` }}>
                    {reliability.breakdown.map((b, i) => (
                      <div
                        key={i}
                        title={`${b.label}: ${b.points}/${b.max}`}
                        style={{
                          width: `${(b.max / 100) * 100}%`,
                          background: i % 2 === 0 ? reliability.verdictColor : `${reliability.verdictColor}99`,
                          opacity: b.points / b.max,
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ fontFamily: FONT_SANS, fontSize: 11, color: C.muted, marginTop: 5 }}>
                    Punteggio calcolato in automatico dai risultati Monte Carlo — euristica di rischio quantitativo.
                  </div>
                </div>
              </div>

              <h4 style={{ fontFamily: FONT_SANS, fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".03em", color: C.primaryDark, marginBottom: 8 }}>Commento sull'analisi</h4>
              {narrative.map((para, i) => (
                <p key={i} style={{ fontSize: 13.5, lineHeight: 1.65, color: C.text, marginTop: 0, marginBottom: 12 }}>{para}</p>
              ))}

              <h4 style={{ fontFamily: FONT_SANS, fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".03em", color: C.primaryDark, marginTop: 18, marginBottom: 8 }}>Dettaglio punteggio</h4>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginBottom: 18 }}>
                <thead>
                  <tr>
                    {["Criterio", "Punti", "Dettaglio"].map((h) => (
                      <th key={h} style={{ textAlign: h === "Criterio" ? "left" : h === "Punti" ? "center" : "left", padding: "6px 9px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, fontSize: 11, color: C.muted, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reliability.breakdown.map((b, i) => (
                    <tr key={i} style={{ background: i % 2 ? "#f4f3ee" : "transparent" }}>
                      <td style={{ padding: "7px 9px", fontFamily: FONT_SANS }}>{b.label}</td>
                      <td style={{ padding: "7px 9px", textAlign: "center", fontFamily: FONT_MONO, fontWeight: 700, color: b.points / b.max >= 0.66 ? C.primaryDark : b.points / b.max >= 0.33 ? C.amber : C.red }}>{b.points}/{b.max}</td>
                      <td style={{ padding: "7px 9px", fontFamily: FONT_SANS, fontSize: 12, color: C.muted }}>{b.note}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ padding: "8px 9px", fontFamily: FONT_SANS, fontWeight: 700 }}>Totale</td>
                    <td style={{ padding: "8px 9px", textAlign: "center", fontFamily: FONT_MONO, fontWeight: 800, color: reliability.verdictColor }}>{reliability.score}/100</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>

              <h4 style={{ fontFamily: FONT_SANS, fontSize: 12.5, textTransform: "uppercase", letterSpacing: ".03em", color: C.primaryDark, marginBottom: 8 }}>Miglioramenti consigliati</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {reliability.improvements.map((imp, i) => {
                  const sevColor = imp.sev === "alta" ? C.red : imp.sev === "media" ? C.amber : C.muted;
                  const sevBg = imp.sev === "alta" ? C.redLight : imp.sev === "media" ? C.amberLight : "#f4f3ee";
                  return (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: sevBg, border: `1px solid ${sevColor}33`, borderRadius: 7, padding: "9px 12px" }}>
                      <span style={{ fontFamily: FONT_SANS, fontSize: 9.5, fontWeight: 800, color: "#fff", background: sevColor, borderRadius: 4, padding: "2px 6px", textTransform: "uppercase", flexShrink: 0, marginTop: 1 }}>{imp.sev}</span>
                      <span style={{ fontSize: 13, lineHeight: 1.5 }}>{imp.text}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
            <Button
              id="btn-export-mc-pdf"
              variant="primary"
              icon={exportingPdf ? Loader2 : FileText}
              disabled={exportingPdf}
              onClick={handleExportPdf}
            >
              {exportingPdf ? "Generazione PDF..." : "Esporta Report Completo (PDF)"}
            </Button>
            <Button
              id="btn-export-mc-summary"
              variant="secondary"
              icon={Download}
              onClick={() => downloadText("monte_carlo_summary.csv", mcSummaryToCSV(mcResult, metrics, reliability))}
            >
              Esporta riepilogo (CSV)
            </Button>
          </div>
        </>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
        <Button id="btn-back-step-4" onClick={onBack} variant="ghost" icon={ChevronLeft}>
          Torna al report
        </Button>
        <div style={{ display: "flex", gap: 10 }}>
          <Button id="btn-mc-reset" onClick={onReset} variant="ghost" icon={RotateCcw}>
            Nuova simulazione
          </Button>
          <Button id="btn-next-step-6" onClick={onScenario} icon={ChevronRight} style={{ flexDirection: "row-reverse" }}>
            Avanti: Analisi di Scenario
          </Button>
        </div>
      </div>
    </div>
  );
}

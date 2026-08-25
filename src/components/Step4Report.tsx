import { useState, useMemo } from "react";
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { Download, RotateCcw, ChevronLeft, ChevronRight, AlertTriangle, FileText, Loader2 } from "lucide-react";
import { C, FONT_SERIF, FONT_SANS, FONT_MONO, Card, Button, KPI } from "./CommonUI";
import { BacktestResult, MoneyManagement } from "../types";
import { fmtDT, fmtMoney, fmtPct, fmtNum } from "../lib/csvHelper";
import {
  downsample, buildDirectionEquityCurve, mergeStepCurves, tradesToCSV, downloadText,
} from "../lib/backtestEngine";
import { histogramBins } from "../lib/monteCarloEngine";
import { exportBacktestPdfReport } from "../lib/pdfReportGenerator";

interface Step4ReportProps {
  result: BacktestResult;
  mm: MoneyManagement;
  onBack: () => void;
  onReset: () => void;
  onMonteCarlo: () => void;
}

export function Step4Report({ result, mm, onBack, onReset, onMonteCarlo }: Step4ReportProps) {
  const { trades, equityCurve, metrics } = result;
  const [page, setPage] = useState(0);
  const [exportingPdf, setExportingPdf] = useState(false);
  const pageSize = 12;

  const handleExportPdf = async () => {
    try {
      setExportingPdf(true);
      await exportBacktestPdfReport({
        result,
        mm,
        strategyTitle: "Strategia Quantitativa",
      });
    } catch (err) {
      console.error("PDF export error:", err);
    } finally {
      setExportingPdf(false);
    }
  };

  const eqChartData = useMemo(() => {
    let peak = -Infinity;
    const withDD = equityCurve.map((p) => {
      peak = Math.max(peak, p.equity);
      return { ...p, ddPct: peak > 0 ? ((p.equity - peak) / peak) * 100 : 0 };
    });
    return downsample(withDD, 600);
  }, [equityCurve]);

  const dirEquityData = useMemo(() => {
    const longCurve = buildDirectionEquityCurve(trades, "long", mm.initialCapital);
    const shortCurve = buildDirectionEquityCurve(trades, "short", mm.initialCapital);
    return mergeStepCurves(longCurve, shortCurve, "long", "short");
  }, [trades, mm.initialCapital]);

  const pnlHist = useMemo(() => histogramBins(trades.map((t) => t.pnl), 30), [trades]);

  const dailyDDChartData = useMemo(() => {
    const series = (metrics?.dailyDrawdownSeries || []).map((d) => ({
      dt: d.dt,
      ddPctScaled: d.ddPct * 100,
      ddPctOfInitialScaled: (d.ddPctOfInitial || 0) * 100,
    }));
    return downsample(series, 400);
  }, [metrics?.dailyDrawdownSeries]);

  const reasonData = useMemo(() => {
    if (!metrics?.byLegReason) return [];
    return Object.entries(metrics.byLegReason)
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.n - a.n);
  }, [metrics?.byLegReason]);

  if (!metrics) {
    return (
      <Card id="report-empty-card">
        <div style={{ textAlign: "center", padding: 30 }}>
          <AlertTriangle size={26} color={C.amber} />
          <p>Nessun trade generato con questa configurazione. Prova ad allentare le condizioni o verificare le colonne usate.</p>
          <Button id="btn-back-from-empty" onClick={onBack} icon={ChevronLeft}>
            Torna indietro
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div id="report-container">
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontFamily: FONT_SERIF, fontSize: 19, color: C.primaryDark, margin: 0 }}>4. Report</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              id="btn-export-backtest-pdf"
              variant="primary"
              icon={exportingPdf ? Loader2 : FileText}
              disabled={exportingPdf}
              onClick={handleExportPdf}
            >
              {exportingPdf ? "Generazione PDF..." : "Esporta Report (PDF)"}
            </Button>
            <Button
              id="btn-export-trade-log-csv"
              variant="secondary"
              icon={Download}
              onClick={() => downloadText("trade_log.csv", tradesToCSV(trades))}
            >
              Esporta trade log (CSV)
            </Button>
            <Button id="btn-report-reset" variant="ghost" icon={RotateCcw} onClick={onReset}>
              Nuova simulazione
            </Button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 22 }}>
          <KPI id="kpi-total-return" label="Rendimento totale" value={fmtPct(metrics.totalReturnPct)} negative={metrics.totalReturnPct < 0} />
          <KPI id="kpi-final-equity" label="Capitale finale" value={fmtMoney(metrics.finalEquity)} />
          <KPI id="kpi-win-rate" label="Win rate" value={fmtPct(metrics.winRate)} />
          <KPI id="kpi-profit-factor" label="Profit factor" value={fmtNum(metrics.profitFactor)} />
          <KPI id="kpi-max-dd" label="Max drawdown" value={Number.isFinite(metrics.maxDDPct) ? "-" + fmtPct(metrics.maxDDPct) : "—"} negative />
          <KPI id="kpi-avg-daily-dd" label="Drawdown giornaliero medio" value={Number.isFinite(metrics.avgDailyDrawdownPct) ? "-" + fmtPct(Math.abs(metrics.avgDailyDrawdownPct)) : "—"} negative={metrics.avgDailyDrawdownPct < 0} />
          <KPI id="kpi-num-trades" label="N. trade" value={metrics.n} />
          <KPI id="kpi-expectancy" label="Expectancy/trade" value={fmtMoney(metrics.expectancy)} negative={metrics.expectancy < 0} />
          <KPI id="kpi-avg-bars" label="Durata media (candele)" value={fmtNum(metrics.avgBarsHeld, 1)} />
          <KPI id="kpi-avg-win" label="Average Win" value={fmtMoney(metrics.avgWin)} />
          <KPI id="kpi-avg-loss" label="Average Loss" value={fmtMoney(metrics.avgLoss)} negative />
          <KPI id="kpi-win-loss-ratio" label="Ratio Win/Loss" value={fmtNum(metrics.ratioWinLoss)} />
          <KPI id="kpi-sharpe" label="Sharpe annualizzato" value={fmtNum(metrics.sharpeAnnual)} negative={metrics.sharpeAnnual < 0} />
          <KPI id="kpi-recovery-factor" label="Recovery factor" value={fmtNum(metrics.recoveryFactor)} />
          <KPI id="kpi-max-cons-win" label="Max win consecutivi" value={metrics.maxConsWin} />
          <KPI id="kpi-max-cons-loss" label="Max loss consecutivi" value={metrics.maxConsLoss} negative />
        </div>

        <h3 style={{ fontFamily: FONT_SERIF, fontSize: 15, color: C.primaryDark }}>Equity curve & drawdown</h3>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={eqChartData}>
            <defs>
              <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.primary} stopOpacity={0.25} />
                <stop offset="100%" stopColor={C.primary} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="dt" tickFormatter={fmtDT} tick={{ fontSize: 10 }} minTickGap={60} />
            <YAxis tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 10 }} width={44} />
            <Tooltip labelFormatter={fmtDT} formatter={(v: any, name: any) => [name === "equity" ? fmtMoney(v) : v.toFixed(2) + "%", name === "equity" ? "Equity" : "Drawdown"]} />
            <ReferenceLine y={mm.initialCapital} stroke="#999" strokeDasharray="4 4" />
            <Area type="monotone" dataKey="equity" stroke={C.primary} fill="url(#eqGrad)" strokeWidth={1.6} />
          </AreaChart>
        </ResponsiveContainer>
        <ResponsiveContainer width="100%" height={90}>
          <AreaChart data={eqChartData}>
            <XAxis dataKey="dt" tickFormatter={fmtDT} hide />
            <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={(v) => v.toFixed(0) + "%"} />
            <Tooltip labelFormatter={fmtDT} formatter={(v: any) => [v.toFixed(2) + "%", "Drawdown"]} />
            <Area type="monotone" dataKey="ddPct" stroke={C.red} fill={C.red} fillOpacity={0.25} strokeWidth={1} />
          </AreaChart>
        </ResponsiveContainer>

        <h4 style={{ fontFamily: FONT_SANS, fontSize: 12, textTransform: "uppercase", letterSpacing: ".03em", color: C.primaryDark, marginTop: 18, marginBottom: 4 }}>
          Drawdown giornaliero
        </h4>
        <p style={{ fontSize: 11.5, color: C.muted, marginTop: 0, marginBottom: 8 }}>
          Variazione % dell'equity tra inizio e fine di ogni giornata. Le giornate in utile sono a 0; solo le giornate in perdita contribuiscono alla media.
        </p>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={dailyDDChartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="dt" tickFormatter={fmtDT} tick={{ fontSize: 9.5 }} minTickGap={70} />
            <YAxis
              tick={{ fontSize: 10 }}
              width={48}
              domain={[(dataMin: number) => Math.min(dataMin * 1.1, -0.5), 0]}
              tickCount={6}
              tickFormatter={(v) => v.toFixed(1) + "%"}
            />
            <Tooltip
              labelFormatter={fmtDT}
              content={({ active, payload, label }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0]?.payload;
                if (!d) return null;
                return (
                  <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 7, padding: "9px 12px", fontFamily: FONT_SANS, fontSize: 12, boxShadow: "0 4px 14px rgba(0,0,0,0.12)" }}>
                    <div style={{ fontWeight: 700, color: C.primaryDark, marginBottom: 5 }}>{fmtDT(label)}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 10, rowGap: 3 }}>
                      <span style={{ color: C.muted }}>Rispetto a inizio giornata:</span>
                      <span style={{ fontWeight: 700, color: C.red }}>{d.ddPctScaled.toFixed(2)}%</span>
                      <span style={{ color: C.muted }}>Rispetto al capitale iniziale:</span>
                      <span style={{ fontWeight: 700, color: C.red }}>{d.ddPctOfInitialScaled.toFixed(2)}%</span>
                    </div>
                  </div>
                );
              }}
            />
            <ReferenceLine y={0} stroke="#999" />
            {Number.isFinite(metrics.avgDailyDrawdownPct) && (
              <ReferenceLine
                y={metrics.avgDailyDrawdownPct * 100}
                stroke={C.amber}
                strokeDasharray="4 3"
                strokeWidth={1.5}
                label={{ value: "media", fontSize: 9.5, fill: C.amber, position: "insideTopLeft" }}
              />
            )}
            <Bar dataKey="ddPctScaled" isAnimationActive={false}>
              {dailyDDChartData.map((d, i) => (
                <Cell key={i} fill={d.ddPctScaled < 0 ? C.red : "transparent"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <h3 style={{ fontFamily: FONT_SERIF, fontSize: 15, color: C.primaryDark, marginTop: 0 }}>Equity curve separata — Long vs Short</h3>
        <p style={{ fontSize: 12, color: C.muted, marginTop: -4 }}>
          Simula due strategie isolate: solo i trade long da un lato, solo gli short dall'altro.
        </p>
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={dirEquityData}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="dt" tickFormatter={fmtDT} tick={{ fontSize: 10 }} minTickGap={60} />
            <YAxis tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 10 }} width={44} />
            <Tooltip labelFormatter={fmtDT} formatter={(v: any, name: any) => [fmtMoney(v), name === "long" ? "Long" : "Short"]} />
            <ReferenceLine y={mm.initialCapital} stroke="#999" strokeDasharray="4 4" />
            <Line type="stepAfter" dataKey="long" stroke={C.primary} dot={false} strokeWidth={1.8} isAnimationActive={false} connectNulls />
            <Line type="stepAfter" dataKey="short" stroke={C.amber} dot={false} strokeWidth={1.8} isAnimationActive={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: "flex", gap: 18, marginTop: 6, fontSize: 11.5, fontFamily: FONT_SANS, color: C.muted }}>
          <span>
            <span style={{ display: "inline-block", width: 10, height: 10, background: C.primary, borderRadius: 2, marginRight: 5, verticalAlign: -1 }} />
            Long ({metrics.byDirection.long.n} trade)
          </span>
          <span>
            <span style={{ display: "inline-block", width: 10, height: 10, background: C.amber, borderRadius: 2, marginRight: 5, verticalAlign: -1 }} />
            Short ({metrics.byDirection.short.n} trade)
          </span>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        <Card>
          <h3 style={{ fontFamily: FONT_SERIF, fontSize: 15, color: C.primaryDark, marginTop: 0 }}>Win Rate mensile — Long vs Short</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={metrics.monthlyByDirection}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="month" tick={{ fontSize: 9.5 }} angle={-20} textAnchor="end" height={45} />
              <YAxis tick={{ fontSize: 10 }} width={36} domain={[0, 1]} tickFormatter={(v) => fmtPct(v, 0)} />
              <Tooltip formatter={(v: any, name: any) => [v == null ? "n/d" : fmtPct(v), name === "longWinRate" ? "Long" : "Short"]} labelFormatter={(m) => m} />
              <Bar dataKey="longWinRate" fill={C.primary} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="shortWinRate" fill={C.amber} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <h3 style={{ fontFamily: FONT_SERIF, fontSize: 15, color: C.primaryDark, marginTop: 0 }}>P&L per settimana</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={metrics.weekly}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="week" tick={{ fontSize: 8.5 }} angle={-35} textAnchor="end" height={55} />
              <YAxis tick={{ fontSize: 10 }} width={40} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
              <Tooltip formatter={(v: any) => fmtMoney(v)} labelFormatter={(w) => "Settimana del " + w} />
              <ReferenceLine y={0} stroke="#999" />
              <Bar dataKey="pnl" isAnimationActive={false}>
                {metrics.weekly.map((w, i) => (
                  <Cell key={i} fill={w.pnl >= 0 ? C.primary : C.red} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card style={{ marginBottom: 20 }}>
        <h3 style={{ fontFamily: FONT_SERIF, fontSize: 15, color: C.primaryDark, marginTop: 0 }}>Distribuzione P&L per trade</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={pnlHist}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="label" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 9.5 }} tickFormatter={(v) => fmtMoney(v)} />
            <YAxis tick={{ fontSize: 10 }} width={32} />
            <Tooltip formatter={(v: any) => [v, "# trade"]} labelFormatter={(v: any) => fmtMoney(v)} />
            <ReferenceLine x={0} stroke="#999" />
            <Bar dataKey="count" isAnimationActive={false}>
              {pnlHist.map((b, i) => (
                <Cell key={i} fill={(b.x0 + b.x1) / 2 >= 0 ? C.primary : C.red} fillOpacity={0.6} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        <Card>
          <h3 style={{ fontFamily: FONT_SERIF, fontSize: 15, color: C.primaryDark, marginTop: 0 }}>P&L mensile</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={metrics.monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="month" tick={{ fontSize: 10.5 }} />
              <YAxis tick={{ fontSize: 10 }} width={44} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
              <Tooltip formatter={(v: any) => fmtMoney(v)} />
              <ReferenceLine y={0} stroke="#999" />
              <Bar dataKey="pnl">
                {metrics.monthly.map((m, i) => (
                  <Cell key={i} fill={m.pnl >= 0 ? C.primary : C.red} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <h3 style={{ fontFamily: FONT_SERIF, fontSize: 15, color: C.primaryDark, marginTop: 0 }}>Esiti per motivo di uscita</h3>
          <p style={{ fontSize: 11, color: C.muted, marginTop: -4, marginBottom: 10 }}>
            Conteggio a livello di singola gamba di posizione (leg-level).
          </p>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={reasonData}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="reason" tick={{ fontSize: 9.5 }} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} width={32} />
              <Tooltip
                formatter={(v: any, n: any) => (n === "n" ? [v, "# eventi"] : [fmtMoney(v), "P&L"])}
                labelFormatter={(reason) => {
                  const row = reasonData.find((r) => r.reason === reason);
                  return row ? `${reason} — chiusura media: ${fmtNum(row.avgPctOfPosition, 0)}% della size` : reason;
                }}
              />
              <Bar dataKey="n">
                {reasonData.map((r, i) => (
                  <Cell key={i} fill={r.pnl >= 0 ? C.primary : C.red} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card style={{ marginBottom: 20 }}>
        <h3 style={{ fontFamily: FONT_SERIF, fontSize: 15, color: C.primaryDark, marginTop: 0 }}>Long vs Short</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Direzione", "# Trade", "Win Rate", "P&L Totale"].map((h) => (
                <th key={h} style={{ textAlign: h === "Direzione" ? "left" : "right", padding: "6px 10px", borderBottom: `2px solid ${C.border}`, color: C.muted, fontSize: 11.5, textTransform: "uppercase" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(["long", "short"] as const).map((d) => (
              <tr key={d}>
                <td style={{ padding: "6px 10px", fontWeight: 600 }}>{d === "long" ? "Long" : "Short"}</td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>{metrics.byDirection[d].n}</td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>{fmtPct(metrics.byDirection[d].winRate)}</td>
                <td style={{ padding: "6px 10px", textAlign: "right", color: metrics.byDirection[d].pnl >= 0 ? C.primaryDark : C.red, fontWeight: 600 }}>
                  {fmtMoney(metrics.byDirection[d].pnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontFamily: FONT_SERIF, fontSize: 15, color: C.primaryDark, margin: 0 }}>Trade log</h3>
          <div style={{ fontSize: 12, color: C.muted }}>
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, trades.length)} di {trades.length}
          </div>
        </div>
        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: FONT_MONO }}>
            <thead>
              <tr>
                {["#", "Dir", "Entry", "Prezzo Entry", "Exit", "Prezzo Exit", "Motivo", "Gambe", "Candele", "PnL", "Equity"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 8px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, fontSize: 11, color: C.muted, textTransform: "uppercase" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.slice(page * pageSize, (page + 1) * pageSize).map((t, idx) => (
                <tr key={idx} style={{ background: (page * pageSize + idx) % 2 ? "#f4f3ee" : "transparent" }}>
                  <td style={{ padding: "5px 8px" }}>{page * pageSize + idx + 1}</td>
                  <td style={{ padding: "5px 8px", color: t.direction === "long" ? C.primaryDark : C.amber, fontWeight: 700 }}>{t.direction.toUpperCase()}</td>
                  <td style={{ padding: "5px 8px" }}>{fmtDT(t.entryDt)}</td>
                  <td style={{ padding: "5px 8px", fontFamily: FONT_MONO }}>{fmtNum(t.entryPrice, 4)}</td>
                  <td style={{ padding: "5px 8px" }}>{fmtDT(t.exitDt)}</td>
                  <td style={{ padding: "5px 8px", fontFamily: FONT_MONO }}>{t.exitPrice != null ? fmtNum(t.exitPrice, 4) : "—"}</td>
                  <td style={{ padding: "5px 8px" }}>{t.exitReason}</td>
                  <td style={{ padding: "5px 8px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {(t.legs || []).map((leg, li) => (
                        <span
                          key={li}
                          title={`${leg.reason}: ${fmtNum(leg.pctOfPosition, 0)}% @ ${fmtNum(leg.price, 2)} → ${fmtMoney(leg.pnl)}`}
                          style={{
                            fontFamily: FONT_SANS,
                            fontSize: 9.5,
                            fontWeight: 700,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: leg.reason.startsWith("TP") ? C.primaryLight : leg.reason.startsWith("SL") ? C.redLight : leg.reason.startsWith("Timeout") ? "#f0efe8" : C.amberLight,
                            color: leg.reason.startsWith("TP") ? C.primaryDark : leg.reason.startsWith("SL") ? C.red : leg.reason.startsWith("Timeout") ? C.muted : C.amber,
                            whiteSpace: "nowrap",
                            cursor: "default",
                          }}
                        >
                          {leg.reason} {fmtNum(leg.pctOfPosition, 0)}%
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: "5px 8px" }}>{t.barsHeld}</td>
                  <td style={{ padding: "5px 8px", color: t.pnl >= 0 ? C.primaryDark : C.red, fontWeight: 700 }}>{fmtMoney(t.pnl)}</td>
                  <td style={{ padding: "5px 8px" }}>{fmtMoney(t.equityAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
          <Button id="btn-prev-page-trades" variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ← Prec.
          </Button>
          <Button id="btn-next-page-trades" variant="ghost" disabled={(page + 1) * pageSize >= trades.length} onClick={() => setPage((p) => p + 1)}>
            Succ. →
          </Button>
        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Button id="btn-back-step-3" onClick={onBack} variant="ghost" icon={ChevronLeft}>
          Modifica money management
        </Button>
        <Button id="btn-next-step-5" onClick={onMonteCarlo} icon={ChevronRight} style={{ flexDirection: "row-reverse" }}>
          Avanti: Monte Carlo Analysis
        </Button>
      </div>
    </div>
  );
}

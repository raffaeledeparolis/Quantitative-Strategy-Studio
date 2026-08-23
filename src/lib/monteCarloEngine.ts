import { Trade, MoneyManagement, BacktestMetrics, MonteCarloResult, ReliabilityScore, HistogramBin } from "../types";
import { mean, stdev } from "./backtestEngine";
import { fmtPct, fmtNum, fmtMoney } from "./csvHelper";

export function computeTradeReturns(trades: Trade[], initialCapital?: number): { retPct: number }[] {
  let prevEquity = initialCapital || (trades[0] ? Math.max(1, trades[0].equityAfter - trades[0].pnl) : 10000);
  return trades.map((t) => {
    const equityBefore = t.equityAfter != null ? t.equityAfter - t.pnl : prevEquity;
    const base = equityBefore > 0 ? equityBefore : prevEquity > 0 ? prevEquity : 10000;
    const retPct = t.pnl / base;
    prevEquity = t.equityAfter != null ? t.equityAfter : prevEquity + t.pnl;
    return { retPct: Number.isFinite(retPct) ? retPct : 0 };
  });
}

export function percentile(sortedArr: number[], p: number): number {
  if (!sortedArr || sortedArr.length === 0) return 0;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedArr[lo] ?? 0;
  const vLo = sortedArr[lo] ?? 0;
  const vHi = sortedArr[hi] ?? 0;
  return vLo + (vHi - vLo) * (idx - lo);
}

export function rankPercentile(sortedArr: number[], value: number): number {
  if (!sortedArr || sortedArr.length === 0) return 50;
  let lo = 0, hi = sortedArr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedArr[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return (lo / sortedArr.length) * 100;
}

export function histogramBins(data: number[], nBins: number, domainMin?: number, domainMax?: number): HistogramBin[] {
  const validData = (data || []).filter((v) => typeof v === "number" && !isNaN(v) && Number.isFinite(v));
  if (validData.length === 0) {
    return Array.from({ length: nBins }, (_, i) => ({
      x0: i,
      x1: i + 1,
      count: 0,
      label: i + 0.5,
    }));
  }
  const min = domainMin != null && !isNaN(domainMin) ? domainMin : Math.min(...validData);
  const max = domainMax != null && !isNaN(domainMax) ? domainMax : Math.max(...validData);
  const span = max - min || 1;
  const width = Math.max(1e-9, span / nBins);
  const bins = Array.from({ length: nBins }, (_, i) => ({
    x0: min + i * width,
    x1: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of validData) {
    let idx = Math.floor((v - min) / width);
    if (isNaN(idx) || idx < 0) idx = 0;
    if (idx >= nBins) idx = nBins - 1;
    if (bins[idx]) {
      bins[idx].count++;
    }
  }
  return bins.map((b) => ({ ...b, label: (b.x0 + b.x1) / 2 }));
}

export function shuffleArray<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function makeRng(seed: number) {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function runMonteCarlo(
  tradesOrReturns: (Trade | { retPct: number })[],
  mmOrCapital: MoneyManagement | number,
  config: {
    iterations: number;
    method: "bootstrap" | "permutation";
    ruinThresholdPct: number;
    avgTradesPerDay?: number;
  },
  sampleCap = 300
): MonteCarloResult {
  const initialCapital =
    typeof mmOrCapital === "number"
      ? mmOrCapital
      : (mmOrCapital?.initialCapital ?? 10000);

  const iterations = config.iterations || 1000;
  const method = config.method || "bootstrap";
  const ruinThresholdPct = config.ruinThresholdPct || 50;

  // Convert inputs to retPct array
  let tradeReturns: { retPct: number }[];
  if (
    tradesOrReturns.length > 0 &&
    "retPct" in tradesOrReturns[0] &&
    typeof (tradesOrReturns[0] as any).retPct === "number"
  ) {
    tradeReturns = tradesOrReturns as { retPct: number }[];
  } else {
    tradeReturns = computeTradeReturns(tradesOrReturns as Trade[], initialCapital);
  }

  const n = tradeReturns.length;
  const rets = tradeReturns.map((t) => (Number.isFinite(t.retPct) ? t.retPct : 0));
  const rng = makeRng(20240615);
  const ruinFloor = initialCapital * (1 - ruinThresholdPct / 100);

  // Compute avg trades per day if possible
  let avgTradesPerDay = config.avgTradesPerDay;
  if (!avgTradesPerDay && tradesOrReturns.length > 0 && "entryDt" in tradesOrReturns[0]) {
    const trades = tradesOrReturns as Trade[];
    const firstDt = trades[0].entryDt;
    const lastDt = trades[trades.length - 1].exitDt || trades[trades.length - 1].entryDt;
    const totalDays = Math.max(1, (lastDt - firstDt) / (86400 * 1000));
    avgTradesPerDay = Math.max(0.1, trades.length / totalDays);
  }
  const bucketSize = Math.max(1, Math.round(avgTradesPerDay || 1));

  const finalReturns = new Float64Array(iterations);
  const maxDDs = new Float64Array(iterations);
  const profitFactors = new Float64Array(iterations);
  const avgDailyDDs = new Float64Array(iterations);
  const ruinFlags = new Uint8Array(iterations);

  const everyK = Math.max(1, Math.floor(iterations / sampleCap));
  const samplePaths: number[][] = [];

  for (let it = 0; it < iterations; it++) {
    let seq: number[];
    if (method === "permutation") {
      seq = shuffleArray(rets, rng);
    } else {
      seq = new Array(n);
      for (let k = 0; k < n; k++) seq[k] = rets[Math.floor(rng() * n)];
    }

    let equity = initialCapital;
    let peak = initialCapital;
    let maxDD = 0;
    let grossProfit = 0, grossLoss = 0;
    let ruined = false;
    let bucketStartEquity = initialCapital;
    let sumNegDaily = 0, countNegDaily = 0;
    const path = it % everyK === 0 && samplePaths.length < sampleCap ? [equity] : null;

    for (let k = 0; k < n; k++) {
      const pnl = equity * seq[k];
      equity += pnl;
      if (pnl >= 0) grossProfit += pnl; else grossLoss += pnl;
      if (equity > peak) peak = equity;
      const ddPct = peak > 0 ? (peak - equity) / peak : 0;
      if (ddPct > maxDD) maxDD = ddPct;
      if (equity <= ruinFloor) ruined = true;
      if (path) path.push(equity);

      if ((k + 1) % bucketSize === 0) {
        const dayChange = bucketStartEquity > 0 ? (equity - bucketStartEquity) / bucketStartEquity : 0;
        if (dayChange < 0) { sumNegDaily += dayChange; countNegDaily++; }
        bucketStartEquity = equity;
      }
    }
    if (n % bucketSize !== 0) {
      const dayChange = bucketStartEquity > 0 ? (equity - bucketStartEquity) / bucketStartEquity : 0;
      if (dayChange < 0) { sumNegDaily += dayChange; countNegDaily++; }
    }

    finalReturns[it] = equity / initialCapital - 1;
    maxDDs[it] = maxDD;
    profitFactors[it] = grossLoss !== 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? 99 : 0;
    avgDailyDDs[it] = countNegDaily > 0 ? sumNegDaily / countNegDaily : 0;
    ruinFlags[it] = ruined ? 1 : 0;
    if (path) samplePaths.push(path);
  }

  const sortedReturns = Array.from(finalReturns).sort((a, b) => a - b);
  const sortedDD = Array.from(maxDDs).sort((a, b) => a - b);
  const finitePF = Array.from(profitFactors).filter((v) => Number.isFinite(v));
  const sortedPF = finitePF.sort((a, b) => a - b);
  const sortedAvgDailyDD = Array.from(avgDailyDDs).sort((a, b) => a - b);

  const PCTS = [5, 10, 25, 50, 75, 90, 95];
  const summarize = (sorted: number[]) => {
    if (!sorted || sorted.length === 0) {
      return { mean: 0, std: 0, min: 0, max: 0, p5: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0 };
    }
    const out: any = { mean: mean(sorted), std: stdev(sorted), min: sorted[0], max: sorted[sorted.length - 1] };
    PCTS.forEach((p) => { out["p" + p] = percentile(sorted, p); });
    return out;
  };

  const bandPcts = [5, 25, 50, 75, 95];
  const bands: { step: number; p5: number; p25: number; p50: number; p75: number; p95: number }[] = [];
  if (samplePaths.length > 0) {
    const steps = samplePaths[0].length;
    for (let s = 0; s < steps; s++) {
      const vals = samplePaths.map((p) => p[s]).sort((a, b) => a - b);
      const row: any = { step: s };
      bandPcts.forEach((p) => { row["p" + p] = percentile(vals, p); });
      bands.push(row);
    }
  }

  return {
    iterations,
    method,
    ruinThresholdPct,
    avgTradesPerDay: avgTradesPerDay || 1,
    bucketSize,
    riskOfRuin: ruinFlags.reduce((s, v) => s + v, 0) / iterations,
    probPositive: Array.from(finalReturns).filter((v) => v > 0).length / iterations,
    returnStats: summarize(sortedReturns),
    ddStats: summarize(sortedDD),
    pfStats: summarize(sortedPF),
    avgDailyDDStats: summarize(sortedAvgDailyDD),
    histReturns: histogramBins(Array.from(finalReturns), 28),
    histDD: histogramBins(Array.from(maxDDs), 28, 0),
    histPF: histogramBins(sortedPF.filter((v) => v < 10), 28, 0),
    histAvgDailyDD: histogramBins(Array.from(avgDailyDDs), 28),
    samplePaths,
    bands,
    sortedReturns,
    sortedDD,
    sortedPF,
    sortedAvgDailyDD,
  };
}

export function computeReliabilityScore(
  metrics: BacktestMetrics,
  mc: MonteCarloResult,
  trades: Trade[],
  mm: MoneyManagement
): ReliabilityScore {
  const n = trades.length;
  const breakdown: { label: string; points: number; max: number; note: string }[] = [];

  let sampleScore: number;
  if (n < 30) sampleScore = 1;
  else if (n < 60) sampleScore = 4;
  else if (n < 100) sampleScore = 6;
  else if (n < 200) sampleScore = 8;
  else if (n < 400) sampleScore = 9;
  else sampleScore = 10;
  breakdown.push({ label: "Dimensione campione", points: sampleScore, max: 10, note: `${n} trade osservati nel backtest` });

  const ror = mc.riskOfRuin;
  let ruinScore: number;
  if (ror <= 0.01) ruinScore = 20;
  else if (ror <= 0.05) ruinScore = 16;
  else if (ror <= 0.10) ruinScore = 10;
  else if (ror <= 0.20) ruinScore = 4;
  else ruinScore = 0;
  breakdown.push({ label: "Rischio di rovina", points: ruinScore, max: 20, note: `${fmtPct(ror)} di probabilità simulata di toccare la soglia di rovina` });

  const dd95 = mc.ddStats.p95;
  let ddScore: number;
  if (dd95 <= 0.15) ddScore = 15;
  else if (dd95 <= 0.25) ddScore = 11;
  else if (dd95 <= 0.40) ddScore = 6;
  else if (dd95 <= 0.60) ddScore = 2;
  else ddScore = 0;
  breakdown.push({ label: "Drawdown worst-case (p95 MC)", points: ddScore, max: 15, note: `${fmtPct(dd95)} nel 5% degli scenari peggiori` });

  const addd5 = mc.avgDailyDDStats.p5;
  let adddScore: number;
  if (addd5 >= -0.005) adddScore = 15;
  else if (addd5 >= -0.015) adddScore = 11;
  else if (addd5 >= -0.03) adddScore = 6;
  else if (addd5 >= -0.05) adddScore = 2;
  else adddScore = 0;
  breakdown.push({ label: "Drawdown giornaliero medio (worst-case p5 MC)", points: adddScore, max: 15, note: `${fmtPct(addd5)} nel 5% degli scenari peggiori (giornate sintetiche, ${mc.bucketSize} trade/giorno)` });

  const pf5 = mc.pfStats.p5;
  let pfScore: number;
  if (pf5 >= 1.5) pfScore = 15;
  else if (pf5 >= 1.2) pfScore = 11;
  else if (pf5 >= 1.0) pfScore = 7;
  else if (pf5 >= 0.8) pfScore = 3;
  else pfScore = 0;
  breakdown.push({ label: "Profit factor worst-case (p5 MC)", points: pfScore, max: 15, note: `${fmtNum(pf5)} nel 5% degli scenari peggiori` });

  const rank = rankPercentile(mc.sortedReturns, metrics.totalReturnPct);
  let luckScore: number;
  if (rank >= 25 && rank <= 75) luckScore = 10;
  else if (rank >= 10 && rank <= 90) luckScore = 7;
  else if (rank >= 5 && rank <= 95) luckScore = 4;
  else luckScore = 1;
  breakdown.push({ label: "Coerenza risultato storico vs MC", points: luckScore, max: 10, note: `il backtest reale si colloca al ${fmtNum(rank, 0)}° percentile della distribuzione simulata` });

  const pp = mc.probPositive;
  let posScore: number;
  if (pp >= 0.95) posScore = 15;
  else if (pp >= 0.85) posScore = 12;
  else if (pp >= 0.70) posScore = 8;
  else if (pp >= 0.50) posScore = 3;
  else posScore = 0;
  breakdown.push({ label: "Probabilità di rendimento positivo", points: posScore, max: 15, note: fmtPct(pp) });

  const score = Math.round(breakdown.reduce((s, b) => s + b.points, 0));

  let verdict: string, verdictColor: string;
  if (score >= 80) { verdict = "Affidabilità alta"; verdictColor = "#1F6F50"; }
  else if (score >= 60) { verdict = "Affidabilità media"; verdictColor = "#C79A2E"; }
  else if (score >= 40) { verdict = "Affidabilità bassa"; verdictColor = "#B5342B"; }
  else { verdict = "Affidabilità molto bassa"; verdictColor = "#B5342B"; }

  const improvements: { sev: "alta" | "media" | "bassa"; text: string }[] = [];
  if (n < 100) improvements.push({ sev: "alta", text: `Il campione è di sole ${n} operazioni: estendi il backtest su uno storico più lungo e su più regimi di mercato prima di trarre conclusioni statisticamente solide.` });
  if (ror > 0.05) improvements.push({ sev: "alta", text: `Rischio di rovina simulato del ${fmtPct(ror)}, sopra la soglia prudenziale del 5%: riduci il rischio per trade e/o rivedi l'ampiezza dello Stop Loss.` });
  if (dd95 > 0.30) improvements.push({ sev: "alta", text: `Nel 5% degli scenari peggiori il drawdown supera il ${fmtPct(dd95)}: valuta un position sizing più conservativo o un filtro di regime/volatilità per ridurre l'esposizione nelle fasi peggiori.` });
  if (addd5 < -0.03) improvements.push({ sev: "alta", text: `Nel 5% degli scenari peggiori il drawdown giornaliero medio scende sotto ${fmtPct(addd5)}: le giornate negative tendono ad essere marcate. Valuta un limite di perdita giornaliera o una riduzione del rischio.` });
  if (pf5 < 1) improvements.push({ sev: "alta", text: `Nel 5% degli scenari peggiori il profit factor scende sotto 1 (strategia in perdita netta): la redditività non è garantita in ogni condizione di mercato.` });
  if (rank > 85) improvements.push({ sev: "media", text: `Il risultato storico osservato si colloca nel ${fmtNum(rank, 0)}° percentile della distribuzione simulata: potrebbe riflettere una sequenza di trade particolarmente favorevole più che un vantaggio strutturale.` });
  if (rank < 15) improvements.push({ sev: "bassa", text: `Il risultato storico si colloca nella parte bassa (${fmtNum(rank, 0)}° percentile) della distribuzione simulata: la sequenza reale è stata relativamente sfavorevole, il che è un segnale neutro/positivo sulla robustezza.` });
  if ((mm.spread || 0) === 0) improvements.push({ sev: "media", text: `La simulazione non include costi di transazione (spread/commissioni): ripeti il test con costi realistici prima di valutare la redditività netta attesa.` });
  if (mm.entryTiming === "same_close") improvements.push({ sev: "bassa", text: `Il timing di ingresso "chiusura candela del segnale" è ottimistico rispetto a un'esecuzione reale: verifica i risultati anche con "apertura candela successiva".` });
  improvements.push({ sev: "bassa", text: `Esegui un test out-of-sample (walk-forward) su un periodo distinto da quello usato per validare la strategia, prima di allocare capitale reale.` });
  improvements.push({ sev: "bassa", text: `Verifica la sensitività ai parametri chiave (soglie indicatori, moltiplicatori ATR): piccole variazioni non dovrebbero stravolgere drasticamente i risultati.` });

  return { score, verdict, verdictColor, breakdown, improvements, rank };
}

export function buildNarrative(
  metrics: BacktestMetrics,
  mc: MonteCarloResult,
  reliability: ReliabilityScore,
  _mm: MoneyManagement,
  n: number
): string[] {
  const p: string[] = [];
  p.push(
    `Sono state eseguite ${mc.iterations.toLocaleString("it-IT")} simulazioni Monte Carlo (metodo: ${mc.method === "bootstrap" ? "bootstrap con reinserimento" : "permutazione"}), ricampionando i ${n} trade osservati nel backtest. ` +
    `Il rendimento totale simulato varia da un minimo di ${fmtPct(mc.returnStats.min)} a un massimo di ${fmtPct(mc.returnStats.max)}, con mediana ${fmtPct(mc.returnStats.p50)} e un intervallo centrale (25°-75° percentile) tra ${fmtPct(mc.returnStats.p25)} e ${fmtPct(mc.returnStats.p75)}. ` +
    `Il risultato osservato nel backtest reale (${fmtPct(metrics.totalReturnPct)}) si colloca al ${fmtNum(reliability.rank, 0)}° percentile di questa distribuzione${reliability.rank > 85 ? " — quindi nella fascia alta, un possibile segnale di sequenza fortunata" : reliability.rank < 15 ? " — quindi nella fascia bassa rispetto alle alternative plausibili" : " — una posizione centrale, coerente con un esito tipico"}.`
  );
  p.push(
    `Sul fronte del rischio, il drawdown massimo atteso ha una mediana del ${fmtPct(mc.ddStats.p50)} ma può superare il ${fmtPct(mc.ddStats.p95)} nel 5% degli scenari peggiori (contro un drawdown osservato nel backtest reale del ${fmtPct(metrics.maxDDPct)}). ` +
    `Guardando alla dinamica giornaliera, il drawdown giornaliero medio (calcolato su giornate sintetiche di ${mc.bucketSize} trade, coerenti con la frequenza di trading osservata) ha una mediana simulata di ${fmtPct(mc.avgDailyDDStats.p50)} e può scendere fino a ${fmtPct(mc.avgDailyDDStats.p5)} nel 5% degli scenari peggiori. ` +
    `La probabilità stimata di toccare la soglia di rovina (equity scesa al ${100 - mc.ruinThresholdPct}% o meno del capitale iniziale) è del ${fmtPct(mc.riskOfRuin)}, mentre la probabilità di chiudere il periodo con un rendimento positivo è del ${fmtPct(mc.probPositive)}.`
  );
  p.push(
    `Sulla base di questi elementi, il giudizio di affidabilità complessivo è ${reliability.score}/100 (${reliability.verdict}). ` +
    (reliability.score >= 80
      ? "I principali indicatori di rischio (rovina, drawdown worst-case, profit factor nei casi peggiori) restano entro soglie prudenziali, e il risultato storico non appare anomalo rispetto alla distribuzione simulata."
      : reliability.score >= 60
      ? "La strategia mostra fondamentali ragionevoli, ma almeno un'area (rischio di rovina, drawdown estremo, profit factor nei casi peggiori o rappresentatività del campione) merita attenzione prima di un impiego con capitale reale."
      : reliability.score >= 40
      ? "Diversi indicatori di rischio si collocano fuori da soglie prudenziali: la strategia, allo stato attuale, necessita di interventi concreti (si veda l'elenco di miglioramenti) prima di poter essere considerata adatta al trading live."
      : "Gli indicatori di rischio segnalano criticità rilevanti: si sconsiglia l'impiego di questa strategia con capitale reale nella sua forma attuale.")
  );
  return p;
}

export function mcSummaryToCSV(mc: MonteCarloResult, metrics: BacktestMetrics, reliability: ReliabilityScore | null): string {
  const rows: (string | number)[][] = [["metrica", "reale", "p5", "p25", "p50", "p75", "p95", "media"]];
  rows.push(["rendimento_totale", metrics.totalReturnPct, mc.returnStats.p5, mc.returnStats.p25, mc.returnStats.p50, mc.returnStats.p75, mc.returnStats.p95, mc.returnStats.mean]);
  rows.push(["max_drawdown", metrics.maxDDPct, mc.ddStats.p5, mc.ddStats.p25, mc.ddStats.p50, mc.ddStats.p75, mc.ddStats.p95, mc.ddStats.mean]);
  rows.push(["drawdown_giornaliero_medio", metrics.avgDailyDrawdownPct, mc.avgDailyDDStats.p5, mc.avgDailyDDStats.p25, mc.avgDailyDDStats.p50, mc.avgDailyDDStats.p75, mc.avgDailyDDStats.p95, mc.avgDailyDDStats.mean]);
  rows.push(["profit_factor", metrics.profitFactor, mc.pfStats.p5, mc.pfStats.p25, mc.pfStats.p50, mc.pfStats.p75, mc.pfStats.p95, mc.pfStats.mean]);
  rows.push([]);
  rows.push(["rischio_di_rovina", mc.riskOfRuin]);
  rows.push(["probabilita_rendimento_positivo", mc.probPositive]);
  rows.push(["iterazioni", mc.iterations]);
  rows.push(["metodo", mc.method]);
  rows.push(["soglia_rovina_pct", mc.ruinThresholdPct]);
  rows.push(["giorni_sintetici_trade_per_giorno", mc.bucketSize]);
  if (reliability) {
    rows.push([]);
    rows.push(["punteggio_affidabilita", reliability.score, "su 100", reliability.verdict]);
    reliability.breakdown.forEach((b) => rows.push(["  - " + b.label, b.points, "/" + b.max, b.note]));
  }
  return rows.map((r) => r.join(";")).join("\n");
}

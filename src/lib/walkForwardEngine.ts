import { Bar, StrategyRules, MoneyManagement, WalkForwardConfig, WalkForwardResult, WalkForwardWindowResult, TweakableParam, SweepConfigItem, Trade, ChainedOosMetrics, DrawdownBucket } from "../types";
import { runBacktest, computeMetrics } from "./backtestEngine";
import { runParameterSweep, setByPath } from "./scenarioEngine";
import { fmtDT, fmtNum, fmtMoney, fmtPct } from "./csvHelper";

export function computeChainedOosMetrics(
  results: WalkForwardWindowResult[],
  initialCapital: number,
  bars?: Bar[]
): ChainedOosMetrics {
  const allOosTrades: Trade[] = [];
  results.forEach((r) => {
    if (r.oosTrades && r.oosTrades.length > 0) {
      allOosTrades.push(...r.oosTrades);
    }
  });

  allOosTrades.sort((a, b) => a.entryDt - b.entryDt);

  const totalTrades = allOosTrades.length;
  const wins = allOosTrades.filter((t) => t.pnl > 0);
  const losses = allOosTrades.filter((t) => t.pnl <= 0);
  const winCount = wins.length;
  const lossCount = losses.length;
  const winRate = totalTrades > 0 ? winCount / totalTrades : 0;
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
  const avgWin = winCount > 0 ? grossProfit / winCount : 0;
  const avgLoss = lossCount > 0 ? grossLoss / lossCount : 0;
  const netProfit = allOosTrades.reduce((s, t) => s + t.pnl, 0);
  const netProfitPct = initialCapital > 0 ? netProfit / initialCapital : 0;
  const expectancy = totalTrades > 0 ? netProfit / totalTrades : 0;
  const finalEquity = initialCapital + netProfit;

  let startDt = bars && bars.length > 0 && results.length > 0 ? bars[results[0].oosStart]?.dt || bars[0].dt : (allOosTrades[0]?.entryDt || Date.now());
  let endDt = bars && bars.length > 0 && results.length > 0 ? bars[Math.min(bars.length - 1, results[results.length - 1].oosEnd - 1)]?.dt || bars[bars.length - 1].dt : (allOosTrades[totalTrades - 1]?.exitDt || Date.now());
  if (totalTrades > 0) {
    if (allOosTrades[0].entryDt < startDt) startDt = allOosTrades[0].entryDt;
    if (allOosTrades[totalTrades - 1].exitDt > endDt) endDt = allOosTrades[totalTrades - 1].exitDt;
  }
  const totalDays = Math.max(1, (endDt - startDt) / 86400000);
  const totalYears = totalDays / 365.25;

  let cagr: number | null = null;
  if (totalYears >= 0.02 && initialCapital > 0) {
    if (finalEquity > 0) {
      cagr = Math.pow(finalEquity / initialCapital, 1 / totalYears) - 1;
    } else {
      cagr = -1.0;
    }
  } else {
    cagr = netProfitPct;
  }

  const tradeRetPcts = allOosTrades.map((t) => {
    const eqBefore = t.equityAfter - t.pnl;
    return eqBefore > 0 ? t.pnl / eqBefore : 0;
  });
  const meanR = tradeRetPcts.length ? tradeRetPcts.reduce((s, v) => s + v, 0) / tradeRetPcts.length : 0;
  const variance = tradeRetPcts.length > 1
    ? tradeRetPcts.reduce((s, v) => s + Math.pow(v - meanR, 2), 0) / (tradeRetPcts.length - 1)
    : 0;
  const stdR = Math.sqrt(variance);
  const tradesPerYear = totalDays > 0 ? (totalTrades / totalDays) * 365.25 : 0;
  const sharpeAnnual = stdR > 0 ? (meanR / stdR) * Math.sqrt(tradesPerYear) : 0;

  const downsideSqSum = tradeRetPcts.reduce((s, r) => s + (r < 0 ? r * r : 0), 0);
  const downsideDev = Math.sqrt(downsideSqSum / (tradeRetPcts.length || 1));
  const sortinoAnnual = downsideDev > 0 ? (meanR / downsideDev) * Math.sqrt(tradesPerYear) : (meanR > 0 ? 999 : 0);

  let currentEq = initialCapital;
  let peak = initialCapital;
  let maxDD = 0;
  let maxDDPct = 0;
  const underwaterCurve: { dt: number; drawdownPct: number; drawdownAmount: number; equity: number }[] = [
    { dt: startDt, drawdownPct: 0, drawdownAmount: 0, equity: initialCapital }
  ];

  let currentDdStartDt: number | null = null;
  let maxDrawdownDurationDays = 0;

  allOosTrades.forEach((t) => {
    currentEq += t.pnl;
    if (currentEq > peak) {
      peak = currentEq;
      if (currentDdStartDt != null) {
        const ddDurationDays = (t.exitDt - currentDdStartDt) / 86400000;
        if (ddDurationDays > maxDrawdownDurationDays) {
          maxDrawdownDurationDays = ddDurationDays;
        }
        currentDdStartDt = null;
      }
    } else {
      if (currentDdStartDt == null) {
        currentDdStartDt = t.entryDt;
      }
    }

    const ddAmt = Math.max(0, peak - currentEq);
    const ddPct = peak > 0 ? ddAmt / peak : 0;
    if (ddAmt > maxDD) maxDD = ddAmt;
    if (ddPct > maxDDPct) maxDDPct = ddPct;

    underwaterCurve.push({
      dt: t.exitDt,
      drawdownPct: ddPct,
      drawdownAmount: ddAmt,
      equity: currentEq,
    });
  });

  if (currentDdStartDt != null) {
    const ddDurationDays = (endDt - currentDdStartDt) / 86400000;
    if (ddDurationDays > maxDrawdownDurationDays) {
      maxDrawdownDurationDays = ddDurationDays;
    }
  }

  const recoveryFactor = maxDD > 0 ? netProfit / maxDD : netProfit > 0 ? 999 : 0;

  const validWindows = results.filter((r) => r.oos != null);
  const totalWindowsCount = validWindows.length;
  const profitableWindows = validWindows.filter((r) => (r.oos?.totalReturnPct ?? 0) > 0);
  const profitableWindowsCount = profitableWindows.length;
  const pctProfitableWindows = totalWindowsCount > 0 ? (profitableWindowsCount / totalWindowsCount) * 100 : 0;

  const oosReturns = validWindows.map((r) => r.oos!.totalReturnPct).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const medianOosReturnPct = oosReturns.length > 0 ? oosReturns[Math.floor(oosReturns.length / 2)] : null;

  let worstWindow: ChainedOosMetrics["worstWindow"] = null;
  let bestWindow: ChainedOosMetrics["bestWindow"] = null;
  if (validWindows.length > 0) {
    const sortedByRet = [...validWindows].sort((a, b) => (a.oos?.totalReturnPct ?? 0) - (b.oos?.totalReturnPct ?? 0));
    const worst = sortedByRet[0];
    const best = sortedByRet[sortedByRet.length - 1];
    worstWindow = {
      label: worst.label,
      returnPct: worst.oos?.totalReturnPct ?? 0,
      pnl: worst.oosTrades.reduce((s, t) => s + t.pnl, 0),
      period: worst.period,
    };
    bestWindow = {
      label: best.label,
      returnPct: best.oos?.totalReturnPct ?? 0,
      pnl: best.oosTrades.reduce((s, t) => s + t.pnl, 0),
      period: best.period,
    };
  }

  const bucketRanges = [
    { rangeLabel: "0% – 1%", minPct: 0, maxPct: 0.01 },
    { rangeLabel: "1% – 3%", minPct: 0.01, maxPct: 0.03 },
    { rangeLabel: "3% – 6%", minPct: 0.03, maxPct: 0.06 },
    { rangeLabel: "6% – 10%", minPct: 0.06, maxPct: 0.10 },
    { rangeLabel: "10% – 15%", minPct: 0.10, maxPct: 0.15 },
    { rangeLabel: "> 15%", minPct: 0.15, maxPct: Infinity },
  ];

  const totalPoints = underwaterCurve.length;
  const drawdownBuckets: DrawdownBucket[] = bucketRanges.map((b) => {
    const inBucket = underwaterCurve.filter((p) => {
      if (b.maxPct === Infinity) return p.drawdownPct >= b.minPct;
      return p.drawdownPct >= b.minPct && p.drawdownPct < b.maxPct;
    });
    return {
      rangeLabel: b.rangeLabel,
      minPct: b.minPct,
      maxPct: b.maxPct,
      count: inBucket.length,
      pctOfTime: totalPoints > 0 ? (inBucket.length / totalPoints) * 100 : 0,
    };
  });

  const nonZeroDDs = underwaterCurve.map((p) => p.drawdownPct).filter((d) => d > 0.0001);
  const avgDrawdownPct = nonZeroDDs.length > 0 ? nonZeroDDs.reduce((a, b) => a + b, 0) / nonZeroDDs.length : 0;

  return {
    cagr,
    netProfit,
    netProfitPct,
    profitFactor,
    sharpeAnnual,
    sortinoAnnual,
    maxDD,
    maxDDPct,
    recoveryFactor,
    pctProfitableWindows,
    profitableWindowsCount,
    totalWindowsCount,
    medianOosReturnPct,
    worstWindow,
    bestWindow,
    totalTrades,
    winRate,
    winCount,
    lossCount,
    avgWin,
    avgLoss,
    expectancy,
    underwaterCurve,
    drawdownBuckets,
    avgDrawdownPct,
    maxDrawdownDurationDays,
  };
}

export function runWalkForward(
  bars: Bar[],
  rules: StrategyRules,
  mm: MoneyManagement,
  wfConfig: WalkForwardConfig
): WalkForwardResult {
  const { isPct, oosPct, mode, expandingIs } = wfConfig;
  const N = bars.length;
  const windows: { isStart: number; isEnd: number; oosStart: number; oosEnd: number; label: string; period: string }[] = [];

  if (mode === "single") {
    const isEnd = Math.round(N * (isPct / 100));
    const oosEnd = Math.min(N, isEnd + Math.round(N * (oosPct / 100)));
    windows.push({
      isStart: 0,
      isEnd,
      oosStart: isEnd,
      oosEnd,
      label: "Split unico",
      period: `IS: ${fmtDT(bars[0].dt)} – ${fmtDT(bars[isEnd - 1].dt)} · OOS: ${fmtDT(bars[isEnd].dt)} – ${fmtDT(bars[oosEnd - 1].dt)}`,
    });
  } else {
    const oosLen = Math.max(10, Math.round(N * (oosPct / 100)));
    const isLen = Math.max(10, Math.round(N * (isPct / 100)));
    const nFolds = Math.max(1, Math.floor(N / oosLen));
    for (let k = 0; k < nFolds; k++) {
      const oosStart = k * oosLen;
      const oosEnd = Math.min(N, oosStart + oosLen);
      const isStart = expandingIs ? 0 : Math.max(0, oosStart - isLen);
      const isEnd = oosStart;
      if (isEnd <= isStart + 5 || oosEnd <= oosStart + 5) continue;
      windows.push({
        isStart,
        isEnd,
        oosStart,
        oosEnd,
        label: `Fold ${k + 1}`,
        period: `IS: ${fmtDT(bars[isStart].dt)} – ${fmtDT(bars[isEnd - 1].dt)} · OOS: ${fmtDT(bars[oosStart].dt)} – ${fmtDT(bars[oosEnd - 1].dt)}`,
      });
    }
  }

  const runSeg = (start: number, end: number) => {
    if (end <= start + 5) return { metrics: null, trades: [] };
    const segBars = bars.slice(start, end);
    try {
      const { trades, equityCurve } = runBacktest(segBars, rules, mm);
      return { metrics: computeMetrics(trades, equityCurve, mm.initialCapital), trades };
    } catch (_) {
      return { metrics: null, trades: [] };
    }
  };

  const results: WalkForwardWindowResult[] = windows.map((w) => {
    const is = runSeg(w.isStart, w.isEnd);
    const oos = runSeg(w.oosStart, w.oosEnd);
    return { ...w, is: is.metrics, oos: oos.metrics, oosTrades: oos.trades };
  });

  let chainEquity = mm.initialCapital;
  const chainPoints: { dt: number; equity: number; type?: string }[] = [{ dt: bars[0].dt, equity: chainEquity, type: "start" }];
  results.forEach((r) => {
    if (!r.oosTrades.length) return;
    r.oosTrades.forEach((t) => {
      chainEquity += t.pnl;
      chainPoints.push({ dt: t.exitDt, equity: chainEquity });
    });
  });

  const validPairs = results.filter((r) => r.is && r.oos);
  const med = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? null;
  };
  const isRets = validPairs.map((r) => r.is!.totalReturnPct).filter((v): v is number => Number.isFinite(v));
  const oosRets = validPairs.map((r) => r.oos!.totalReturnPct).filter((v): v is number => Number.isFinite(v));
  const mIs = med(isRets), mOos = med(oosRets);
  const efficiencyRatio = mIs != null && Math.abs(mIs) > 1e-9 && mOos != null ? mOos / mIs : null;

  const degradation: Record<string, { is: number | null; oos: number | null; ratio: number | null }> = {};
  const DEGRAD_KEYS = ["totalReturnPct", "profitFactor", "maxDDPct", "winRate", "sharpeAnnual"];
  DEGRAD_KEYS.forEach((k) => {
    const isVals = validPairs.map((r) => (r.is as any)?.[k]).filter((v): v is number => v != null && Number.isFinite(v));
    const oosVals = validPairs.map((r) => (r.oos as any)?.[k]).filter((v): v is number => v != null && Number.isFinite(v));
    const mI = med(isVals), mO = med(oosVals);
    degradation[k] = { is: mI, oos: mO, ratio: mI != null && Math.abs(mI) > 1e-9 && mO != null ? mO / mI : null };
  });

  const chainedMetrics = computeChainedOosMetrics(results, mm.initialCapital, bars);

  return { results, chainPoints, efficiencyRatio, degradation, nFolds: results.length, chainedMetrics };
}

export function runWalkForwardOptimized(
  bars: Bar[],
  baseRules: StrategyRules,
  mm: MoneyManagement,
  wfConfig: WalkForwardConfig,
  sweepParams: { param: TweakableParam; cfg: SweepConfigItem }[],
  objFn: (m: any) => number,
  initialCapital: number
): WalkForwardResult {
  const N = bars.length;
  const windows: { isStart: number; isEnd: number; oosStart: number; oosEnd: number; label: string; period: string }[] = [];

  if (wfConfig.mode === "single") {
    const isEnd = Math.round(N * (wfConfig.isPct / 100));
    const oosEnd = Math.min(N, isEnd + Math.round(N * (wfConfig.oosPct / 100)));
    windows.push({
      isStart: 0,
      isEnd,
      oosStart: isEnd,
      oosEnd,
      label: "Split unico",
      period: `IS: ${fmtDT(bars[0].dt)} – ${fmtDT(bars[isEnd - 1].dt)} · OOS: ${fmtDT(bars[isEnd].dt)} – ${fmtDT(bars[oosEnd - 1].dt)}`,
    });
  } else {
    const oosLen = Math.max(10, Math.round(N * (wfConfig.oosPct / 100)));
    const isLen = Math.max(10, Math.round(N * (wfConfig.isPct / 100)));
    const nFolds = Math.max(1, Math.floor(N / oosLen));
    for (let k = 0; k < nFolds; k++) {
      const oosStart = k * oosLen;
      const oosEnd = Math.min(N, oosStart + oosLen);
      const isStart = wfConfig.expandingIs ? 0 : Math.max(0, oosStart - isLen);
      const isEnd = oosStart;
      if (isEnd <= isStart + 5 || oosEnd <= oosStart + 5) continue;
      windows.push({
        isStart,
        isEnd,
        oosStart,
        oosEnd,
        label: `Fold ${k + 1}`,
        period: `IS: ${fmtDT(bars[isStart].dt)} – ${fmtDT(bars[isEnd - 1].dt)} · OOS: ${fmtDT(bars[oosStart].dt)} – ${fmtDT(bars[oosEnd - 1].dt)}`,
      });
    }
  }

  const runSeg = (segBars: Bar[], rules: StrategyRules, segMm: MoneyManagement) => {
    if (segBars.length < 5) return { metrics: null, trades: [] };
    try {
      const { trades, equityCurve } = runBacktest(segBars, rules, segMm);
      return { metrics: computeMetrics(trades, equityCurve, initialCapital), trades };
    } catch (_) {
      return { metrics: null, trades: [] };
    }
  };

  const results: WalkForwardWindowResult[] = windows.map((w) => {
    const isBars = bars.slice(w.isStart, w.isEnd);
    const oosBars = bars.slice(w.oosStart, w.oosEnd);

    let optRules = JSON.parse(JSON.stringify(baseRules));
    let optMm = JSON.parse(JSON.stringify(mm));
    const foldOptima = sweepParams.map(({ param, cfg }) => {
      const rows = runParameterSweep(isBars, baseRules, mm, param, cfg, initialCapital);
      const validRows = rows.filter((r) => !r.error && r.n > 0);
      let bestRow = rows.find((r) => r.isBase), bestScore = -Infinity;
      for (const row of validRows) {
        const score = objFn({
          n: row.n,
          profitFactor: row.profitFactor,
          winRate: row.winRate,
          maxDDPct: row.maxDDPct,
          totalReturnPct: row.totalReturnPct,
          sharpeAnnual: row.sharpeAnnual,
          expectancy: row.expectancy,
        });
        if (score > bestScore) { bestScore = score; bestRow = row; }
      }
      if (bestRow) {
        if (param.target === "mm") optMm = setByPath(optMm, param.pathParts, bestRow.value);
        else optRules = setByPath(optRules, param.pathParts, bestRow.value);
      }
      return { param, optimalValue: bestRow?.value ?? param.currentValue, baseValue: param.currentValue };
    });

    const is = runSeg(isBars, optRules, optMm);
    const oos = runSeg(oosBars, optRules, optMm);
    return { ...w, is: is.metrics, oos: oos.metrics, oosTrades: oos.trades, foldOptima, optRules, optMm };
  });

  let chainEquity = initialCapital;
  const chainPoints: { dt: number; equity: number }[] = [{ dt: bars[0].dt, equity: chainEquity }];
  results.forEach((r) => {
    r.oosTrades.forEach((t) => {
      chainEquity += t.pnl;
      chainPoints.push({ dt: t.exitDt, equity: chainEquity });
    });
  });

  const med = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? null;
  };
  const validPairs = results.filter((r) => r.is && r.oos);
  const mIs = med(validPairs.map((r) => r.is!.totalReturnPct).filter((v): v is number => Number.isFinite(v)));
  const mOos = med(validPairs.map((r) => r.oos!.totalReturnPct).filter((v): v is number => Number.isFinite(v)));
  const efficiencyRatio = mIs != null && Math.abs(mIs) > 1e-9 && mOos != null ? mOos / mIs : null;
  const degradation: Record<string, { is: number | null; oos: number | null; ratio: number | null }> = {};
  ["totalReturnPct", "profitFactor", "maxDDPct", "winRate", "sharpeAnnual"].forEach((k) => {
    const isVals = validPairs.map((r) => (r.is as any)?.[k]).filter((v): v is number => v != null && Number.isFinite(v));
    const oosVals = validPairs.map((r) => (r.oos as any)?.[k]).filter((v): v is number => v != null && Number.isFinite(v));
    const mI = med(isVals), mO = med(oosVals);
    degradation[k] = { is: mI, oos: mO, ratio: mI != null && Math.abs(mI) > 1e-9 && mO != null ? mO / mI : null };
  });

  // Compute parameter statistics across all WFO folds
  const wfoParamSummaries = sweepParams.map(({ param }) => {
    const valuesPerFold = results.map((r) => {
      const fo = r.foldOptima?.find((item) => item.param.id === param.id);
      return {
        foldLabel: r.label,
        value: fo?.optimalValue ?? param.currentValue,
      };
    });

    const vals = valuesPerFold.map((v) => v.value);
    const sorted = [...vals].sort((a, b) => a - b);
    const sum = vals.reduce((a, b) => a + b, 0);
    const meanValue = Math.round((sum / (vals.length || 1)) * 10000) / 10000;
    const medianValue = sorted[Math.floor(sorted.length / 2)] ?? param.currentValue;
    const minValue = Math.min(...vals);
    const maxValue = Math.max(...vals);
    const latestValue = vals[vals.length - 1] ?? param.currentValue;

    const variance = vals.reduce((s, v) => s + Math.pow(v - meanValue, 2), 0) / (vals.length || 1);
    const stdDev = Math.sqrt(variance);

    // Relative variation normalized against nominal range or baseline
    const normSpan = Math.max(Math.abs(param.suggestMax - param.suggestMin), Math.abs(param.currentValue) || 1);
    const relDispersion = normSpan > 0 ? (maxValue - minValue) / normSpan : 0;
    const stabilityScore = Math.max(0, Math.min(100, Math.round((1 - Math.min(1, relDispersion)) * 100)));
    const stabilityLabel: "Alta" | "Media" | "Bassa" =
      stabilityScore >= 75 ? "Alta" : stabilityScore >= 45 ? "Media" : "Bassa";

    return {
      param,
      baseValue: param.currentValue,
      medianValue,
      meanValue,
      minValue,
      maxValue,
      latestValue,
      stabilityScore,
      stabilityLabel,
      valuesPerFold,
    };
  });

  const chainedMetrics = computeChainedOosMetrics(results, initialCapital, bars);

  return {
    results,
    chainPoints,
    efficiencyRatio,
    degradation,
    nFolds: results.length,
    mode: "wfo",
    objKey: "wfo",
    wfoParamSummaries,
    chainedMetrics,
  };
}

export interface RobustnessSubScore {
  id: string;
  title: string;
  score: number;
  maxScore: number;
  valueFormatted: string;
  targetText: string;
  status: "optimal" | "acceptable" | "warning";
  hint: string;
}

export interface RobustnessAssessment {
  totalScore: number;
  grade: {
    label: string;
    verdict: string;
    color: string;
    bgColor: string;
    borderColor: string;
    description: string;
    recommendation: string;
  };
  subScores: RobustnessSubScore[];
}

export function calculateWalkForwardRobustnessAssessment(
  wfResult: WalkForwardResult,
  chainedMetrics: ChainedOosMetrics | null
): RobustnessAssessment | null {
  if (!wfResult || !chainedMetrics) return null;

  const effRatio = wfResult.efficiencyRatio ?? 0;
  const oosPf = chainedMetrics.profitFactor;
  const pctProfitable = chainedMetrics.pctProfitableWindows;
  const maxDdPct = chainedMetrics.maxDDPct;
  const recFactor = chainedMetrics.recoveryFactor;
  const oosSharpe = chainedMetrics.sharpeAnnual;

  // Component 1: Efficiency Ratio (Max 25 pts)
  let scoreEff = 0;
  if (effRatio >= 0.85) scoreEff = 25;
  else if (effRatio >= 0.70) scoreEff = 21;
  else if (effRatio >= 0.55) scoreEff = 17;
  else if (effRatio >= 0.40) scoreEff = 12;
  else if (effRatio >= 0.25) scoreEff = 6;
  else scoreEff = Math.max(0, Math.round(effRatio * 20));

  // Component 2: OOS Profit Factor & Expectancy (Max 20 pts)
  let scorePf = 0;
  if (oosPf >= 2.0) scorePf = 20;
  else if (oosPf >= 1.6) scorePf = 17;
  else if (oosPf >= 1.3) scorePf = 14;
  else if (oosPf >= 1.1) scorePf = 10;
  else if (oosPf >= 1.0) scorePf = 6;
  else if (oosPf >= 0.8) scorePf = 2;
  else scorePf = 0;

  // Component 3: Consistency of Windows / Profitable Folds (Max 20 pts)
  let scoreConsistency = 0;
  if (pctProfitable >= 85) scoreConsistency = 20;
  else if (pctProfitable >= 70) scoreConsistency = 16;
  else if (pctProfitable >= 55) scoreConsistency = 12;
  else if (pctProfitable >= 40) scoreConsistency = 7;
  else scoreConsistency = 2;

  // Component 4: Drawdown & Recovery (Max 20 pts)
  let scoreRisk = 0;
  let ddSubScore = 0;
  if (maxDdPct <= 0.08) ddSubScore = 10;
  else if (maxDdPct <= 0.15) ddSubScore = 8;
  else if (maxDdPct <= 0.25) ddSubScore = 5;
  else if (maxDdPct <= 0.35) ddSubScore = 2;
  else ddSubScore = 0;

  let recSubScore = 0;
  if (recFactor >= 3.0) recSubScore = 10;
  else if (recFactor >= 2.0) recSubScore = 8;
  else if (recFactor >= 1.2) recSubScore = 5;
  else if (recFactor >= 0.8) recSubScore = 3;
  else recSubScore = 0;
  scoreRisk = ddSubScore + recSubScore;

  // Component 5: Risk-Adjusted Quality / Sharpe & Sortino (Max 15 pts)
  let scoreQuality = 0;
  if (oosSharpe >= 1.5) scoreQuality = 15;
  else if (oosSharpe >= 1.1) scoreQuality = 12;
  else if (oosSharpe >= 0.7) scoreQuality = 9;
  else if (oosSharpe >= 0.4) scoreQuality = 5;
  else if (oosSharpe > 0) scoreQuality = 2;
  else scoreQuality = 0;

  const totalScore = Math.min(100, Math.max(0, scoreEff + scorePf + scoreConsistency + scoreRisk + scoreQuality));

  let grade: RobustnessAssessment["grade"];
  if (totalScore >= 85) {
    grade = {
      label: "ROBUSTEZZA ECCELLENTE (GRADE A+)",
      verdict: "Strategia Estremamente Solida e Resiliente",
      color: "#1E4620",
      bgColor: "#E8F5E9",
      borderColor: "#81C784",
      description: "La strategia dimostra un'elevata persistenza del vantaggio competitivo fuori campione (OOS), con un'eccellente tenuta dell'Efficiency Ratio, drawdown controllati e una distribuzione omogenea dei profitti tra i vari cicli temporali.",
      recommendation: "Idonea all'impiego operativo a mercato con gestione del rischio standard. I parametri hanno mostrato stabilità e bassa sensibilità all'overfitting.",
    };
  } else if (totalScore >= 70) {
    grade = {
      label: "ROBUSTEZZA BUONA / CONFERMATA (GRADE B)",
      verdict: "Strategia Solida con Vantaggio OOS Confermato",
      color: "#2E7D32",
      bgColor: "#F1F8E9",
      borderColor: "#AED581",
      description: "Buona conservazione delle performance sui dati Out-Of-Sample. La maggioranza delle finestre temporali si chiude in utile e il profilo di drawdown si mantiene entro livelli gestibili.",
      recommendation: "Pronta per il live trading o per una fase di paper trading di validazione. Monitorare periodicamente l'Efficiency Ratio se il mercato entra in regimi di eccezionale volatilità.",
    };
  } else if (totalScore >= 50) {
    grade = {
      label: "ROBUSTEZZA MODERATA / CONDIZIONATA (GRADE C)",
      verdict: "Vantaggio OOS Marginale con Segnali di Degrado",
      color: "#E65100",
      bgColor: "#FFF3E0",
      borderColor: "#FFB74D",
      description: "Si osserva un degrado non trascurabile delle metriche nel passaggio da In-Sample a Out-Of-Sample. Alcuni fold presentano oscillazioni ampie o rendimenti sotto le attese.",
      recommendation: "Si raccomanda cautela prima del trading reale. Considerare una semplificazione delle regole di ingresso/uscita, l'allargamento della finestra IS di training o la riduzione del numero di parametri liberi.",
    };
  } else {
    grade = {
      label: "ROBUSTEZZA INSUFFICIENTE / OVERFITTING (GRADE D)",
      verdict: "Rischio Elevato di Sovra-Ottimizzazione (Curve-Fitting)",
      color: "#C62828",
      bgColor: "#FFEBEE",
      borderColor: "#EF9A9A",
      description: "Il modello fallisce nel generalizzare sui dati mai visti: le performance OOS crollano drasticamente rispetto a quelle IS (Efficiency Ratio basso o negativo), con drawdown elevati e scarsa regolarità tra i fold.",
      recommendation: "Non idonea al live trading nella configurazione attuale. La strategia soffre verosimilmente di data-mining bias o eccessiva complessità dei parametri.",
    };
  }

  const subScores: RobustnessSubScore[] = [
    {
      id: "eff",
      title: "Efficienza OOS / IS (WFE)",
      score: scoreEff,
      maxScore: 25,
      valueFormatted: fmtNum(effRatio, 2),
      targetText: "Target ≥ 0.65",
      status: scoreEff >= 17 ? "optimal" : scoreEff >= 12 ? "acceptable" : "warning",
      hint: "Rapporto tra rendimento OOS e rendimento IS: misura la resistenza all'overfitting.",
    },
    {
      id: "pf",
      title: "Redditività OOS (Profit Factor & PnL)",
      score: scorePf,
      maxScore: 20,
      valueFormatted: `PF ${fmtNum(oosPf, 2)} (${fmtMoney(chainedMetrics.netProfit)})`,
      targetText: "Target PF ≥ 1.30",
      status: scorePf >= 14 ? "optimal" : scorePf >= 10 ? "acceptable" : "warning",
      hint: "Capacità di generare guadagni netti sui dati futuri concatenati.",
    },
    {
      id: "consistency",
      title: "Consistenza Finestre (% Profittevoli)",
      score: scoreConsistency,
      maxScore: 20,
      valueFormatted: `${chainedMetrics.profitableWindowsCount}/${chainedMetrics.totalWindowsCount} (${fmtPct(pctProfitable / 100)})`,
      targetText: "Target ≥ 70%",
      status: scoreConsistency >= 16 ? "optimal" : scoreConsistency >= 12 ? "acceptable" : "warning",
      hint: "Frazione di cicli OOS indipendenti chiusi con rendimento positivo.",
    },
    {
      id: "risk",
      title: "Controllo Rischio (Max DD & Recovery)",
      score: scoreRisk,
      maxScore: 20,
      valueFormatted: `DD ${fmtPct(maxDdPct)} · Rec. Factor ${fmtNum(recFactor, 2)}`,
      targetText: "DD ≤ 15% · Rec ≥ 1.5",
      status: scoreRisk >= 15 ? "optimal" : scoreRisk >= 10 ? "acceptable" : "warning",
      hint: "Contenimento del drawdown massimo e rapidità di recupero del capitale.",
    },
    {
      id: "quality",
      title: "Qualità Risk-Adjusted (Sharpe & Sortino)",
      score: scoreQuality,
      maxScore: 15,
      valueFormatted: `Sharpe ${fmtNum(oosSharpe, 2)} · Sortino ${fmtNum(chainedMetrics.sortinoAnnual, 2)}`,
      targetText: "Sharpe ≥ 1.0",
      status: scoreQuality >= 12 ? "optimal" : scoreQuality >= 7 ? "acceptable" : "warning",
      hint: "Rendimento normalizzato per la volatilità e il downside risk dei trade.",
    },
  ];

  return {
    totalScore,
    grade,
    subScores,
  };
}

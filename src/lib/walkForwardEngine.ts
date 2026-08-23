import { Bar, StrategyRules, MoneyManagement, WalkForwardConfig, WalkForwardResult, WalkForwardWindowResult, TweakableParam, SweepConfigItem } from "../types";
import { runBacktest, computeMetrics } from "./backtestEngine";
import { runParameterSweep, setByPath } from "./scenarioEngine";
import { fmtDT } from "./csvHelper";

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

  return { results, chainPoints, efficiencyRatio, degradation, nFolds: results.length };
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

  return {
    results,
    chainPoints,
    efficiencyRatio,
    degradation,
    nFolds: results.length,
    mode: "wfo",
    objKey: "wfo",
    wfoParamSummaries,
  };
}

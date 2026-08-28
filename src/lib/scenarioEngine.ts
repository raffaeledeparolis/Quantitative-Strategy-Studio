import {
  Bar,
  StrategyRules,
  MoneyManagement,
  TweakableParam,
  SweepConfigItem,
  SweepRow,
  BacktestMetrics,
  BacktestResult,
  ScenarioOptResult,
} from "../types";
import { runBacktest, computeMetrics } from "./backtestEngine";
import { normalizeExitRules } from "./ruleParser";
import { fmtPct, fmtNum, fmtMoney } from "./csvHelper";

export const METRIC_META: Record<
  string,
  { label: string; format: (v: number | null | undefined) => string; higherIsBetter?: boolean }
> = {
  profitFactor: { label: "Profit Factor", format: (v) => (v != null && isFinite(v) ? fmtNum(v, 2) : "—"), higherIsBetter: true },
  totalReturnPct: { label: "Rendimento Totale", format: (v) => fmtPct(v), higherIsBetter: true },
  winRate: { label: "Win Rate", format: (v) => fmtPct(v), higherIsBetter: true },
  maxDDPct: { label: "Max Drawdown", format: (v) => fmtPct(v), higherIsBetter: false },
  sharpeAnnual: { label: "Sharpe Annualizzato", format: (v) => (v != null && isFinite(v) ? fmtNum(v, 2) : "—"), higherIsBetter: true },
  expectancy: { label: "Expectancy ($)", format: (v) => fmtMoney(v), higherIsBetter: true },
  n: { label: "Numero Trade", format: (v) => (v != null ? String(v) : "—"), higherIsBetter: true },
};

export function formatMetricVal(key: string, val: number | null | undefined): string {
  const meta = METRIC_META[key];
  if (meta) return meta.format(val);
  return val != null ? fmtNum(val, 2) : "—";
}

export function computeImpact(rows: SweepRow[], metricKey: string, baseVal?: number): { delta: number; pctChange: number } {
  if (!rows || rows.length < 2) return { delta: 0, pctChange: 0 };
  const vals = rows
    .map((r: any) => r[metricKey])
    .filter((v): v is number => typeof v === "number" && isFinite(v));
  if (vals.length < 2) return { delta: 0, pctChange: 0 };
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const delta = max - min;
  const ref = baseVal != null && Math.abs(baseVal) > 1e-6 ? Math.abs(baseVal) : Math.abs(min) || 1;
  return { delta, pctChange: (delta / ref) * 100 };
}

export const OPTIM_OBJECTIVES: {
  key: string;
  label: string;
  description: string;
  maximize: boolean;
  fn: (m: Partial<BacktestMetrics> | null) => number;
}[] = [
  {
    key: "composite",
    label: "Score composito (bilanciato)",
    description: "Massimizza (Profit Factor × Win Rate × Rendimento) penalizzando il Drawdown",
    maximize: true,
    fn: (m) => {
      if (!m || !m.n || m.n === 0) return -Infinity;
      const pf = Math.min(m.profitFactor || 0, 10);
      const wr = m.winRate || 0;
      const dd = Math.max(m.maxDDPct || 0.01, 0.03);
      const ret = 1 + Math.max(0, m.totalReturnPct || 0);
      return (pf * wr * ret) / dd;
    },
  },
  {
    key: "profitFactor",
    label: "Profit Factor",
    description: "Rapporto tra profitto lordo e perdita lorda",
    maximize: true,
    fn: (m) => (m && m.n && m.n > 0 && isFinite(m.profitFactor || 0) ? m.profitFactor ?? -Infinity : -Infinity),
  },
  {
    key: "totalReturnPct",
    label: "Rendimento Totale (%)",
    description: "Massimizza il guadagno percentuale complessivo",
    maximize: true,
    fn: (m) => (m && m.n && m.n > 0 ? m.totalReturnPct ?? -Infinity : -Infinity),
  },
  {
    key: "sharpeAnnual",
    label: "Sharpe Annualizzato",
    description: "Rapporto rendimento/rischio annualizzato",
    maximize: true,
    fn: (m) => (m && m.n && m.n > 0 && isFinite(m.sharpeAnnual || 0) ? m.sharpeAnnual ?? -Infinity : -Infinity),
  },
  {
    key: "winRate",
    label: "Win Rate (%)",
    description: "Percentuale di trade in profitto",
    maximize: true,
    fn: (m) => (m && m.n && m.n > 0 ? m.winRate ?? -Infinity : -Infinity),
  },
  {
    key: "expectancy",
    label: "Expectancy per Trade ($)",
    description: "Valore monetario atteso medio per ciascuna operazione",
    maximize: true,
    fn: (m) => (m && m.n && m.n > 0 ? m.expectancy ?? -Infinity : -Infinity),
  },
  {
    key: "recoveryFactor",
    label: "Recovery Factor",
    description: "Rendimento totale diviso per il Max Drawdown",
    maximize: true,
    fn: (m) => (m && m.n && m.n > 0 && isFinite(m.recoveryFactor || 0) ? m.recoveryFactor ?? -Infinity : -Infinity),
  },
  {
    key: "minMaxDD",
    label: "Minimizza Max Drawdown",
    description: "Cerca la combinazione che riduce al minimo il Max Drawdown",
    maximize: true,
    fn: (m) => (m && m.n && m.n > 0 ? -(m.maxDDPct ?? Infinity) : -Infinity),
  },
];

export function scanTweakableParams(
  rules: StrategyRules,
  mmOrAvgDailyDrawdownPct?: MoneyManagement | number | null
): TweakableParam[] {
  const params: TweakableParam[] = [];

  const mm: MoneyManagement | null =
    typeof mmOrAvgDailyDrawdownPct === "object" && mmOrAvgDailyDrawdownPct !== null
      ? (mmOrAvgDailyDrawdownPct as MoneyManagement)
      : null;

  const avgDailyDrawdownPct: number | null =
    typeof mmOrAvgDailyDrawdownPct === "number"
      ? mmOrAvgDailyDrawdownPct
      : mm?.dailyDDLimitPct != null
      ? mm.dailyDDLimitPct
      : null;

  function walkNode(node: any, pathParts: string[], groupLabel: string) {
    if (!node) return;
    if (node.type === "condition" && typeof node.right === "number") {
      const v = node.right;
      const rightPath = [...pathParts, "right"];
      params.push({
        id: rightPath.join("|"),
        label: `${node.left} ${node.op} ${v}`,
        group: groupLabel,
        pathParts: rightPath,
        currentValue: v,
        kind: "threshold",
        suggestMin: parseFloat((v > 0 ? v * 0.3 : v * 1.7).toFixed(4)),
        suggestMax: parseFloat((v > 0 ? v * 1.7 : v * 0.3).toFixed(4)),
      });
    } else if (node.type === "group") {
      (node.conditions || []).forEach((c: any, i: number) => walkNode(c, [...pathParts, "conditions", String(i)], groupLabel));
    }
  }

  if (rules.entry_long) walkNode(rules.entry_long, ["entry_long"], "Long — soglie ingresso");
  if (rules.entry_short) walkNode(rules.entry_short, ["entry_short"], "Short — soglie ingresso");

  if (rules.exit_long) {
    const norm = normalizeExitRules(rules.exit_long);
    norm.forEach((n, idx) => {
      const path = Array.isArray(rules.exit_long)
        ? ["exit_long", String(idx), "condition"]
        : (rules.exit_long as any)?.condition
        ? ["exit_long", "condition"]
        : ["exit_long"];
      walkNode(n.condition, path, "Long — soglie uscita");
    });
  }

  if (rules.exit_short) {
    const norm = normalizeExitRules(rules.exit_short);
    norm.forEach((n, idx) => {
      const path = Array.isArray(rules.exit_short)
        ? ["exit_short", String(idx), "condition"]
        : (rules.exit_short as any)?.condition
        ? ["exit_short", "condition"]
        : ["exit_short"];
      walkNode(n.condition, path, "Short — soglie uscita");
    });
  }

  const sl: any = rules.stop_loss || {};
  if (sl.type === "atr_mult" && sl.mult && sl.mult > 0) {
    params.push({
      id: "stop_loss|mult",
      label: `SL — moltiplicatore ATR (base: ×${sl.mult})`,
      group: "Moltiplicatori ATR / R",
      pathParts: ["stop_loss", "mult"],
      currentValue: sl.mult,
      kind: "mult",
      suggestMin: parseFloat((sl.mult * 0.3).toFixed(3)),
      suggestMax: parseFloat((sl.mult * 2.5).toFixed(3)),
    });
  } else if (sl.type === "fixed_points" && sl.value && sl.value > 0) {
    params.push({
      id: "stop_loss|value",
      label: `SL — punti fissi (base: ${sl.value} pt)`,
      group: "Moltiplicatori ATR / R",
      pathParts: ["stop_loss", "value"],
      currentValue: sl.value,
      kind: "offset",
      suggestMin: Math.max(1, Math.round(sl.value * 0.3)),
      suggestMax: Math.round(sl.value * 2.5),
    });
  } else if (sl.type === "monetary" && sl.value && sl.value > 0) {
    params.push({
      id: "stop_loss|value",
      label: `SL — valore monetario (base: $${sl.value})`,
      group: "Moltiplicatori ATR / R",
      pathParts: ["stop_loss", "value"],
      currentValue: sl.value,
      kind: "offset",
      suggestMin: Math.max(10, Math.round(sl.value * 0.3)),
      suggestMax: Math.round(sl.value * 2.5),
    });
  }

  const CANDLE_SL_TYPES_FOR_SWEEP = [
    "prev_candle_low", "prev_candle_high", "prev_candle_extreme",
    "before_signal_low", "before_signal_high", "before_signal_extreme",
  ];
  if (CANDLE_SL_TYPES_FOR_SWEEP.includes(sl.type) && sl.offset != null) {
    const isBeforeSignal = sl.type.startsWith("before_signal");
    const slabel = sl.type.endsWith("extreme") ? "min/max" : sl.type.endsWith("low") ? "minimo" : "massimo";
    const candleLabel = isBeforeSignal ? "candela prima del segnale" : "candela segnale";
    params.push({
      id: "stop_loss|offset",
      label: `SL — buffer oltre ${slabel} ${candleLabel} (base: ${sl.offset} pt)`,
      group: "Moltiplicatori ATR / R",
      pathParts: ["stop_loss", "offset"],
      currentValue: sl.offset,
      kind: "offset",
      suggestMin: 0,
      suggestMax: Math.max((sl.offset || 0) * 5, 10),
    });
  }

  (rules.take_profits || []).forEach((tp: any, i: number) => {
    if (tp.monetary != null && tp.monetary > 0) {
      params.push({
        id: `take_profits|${i}|monetary`,
        label: `TP${i + 1} — target monetario (base: $${tp.monetary})`,
        group: "Moltiplicatori ATR / R",
        pathParts: ["take_profits", String(i), "monetary"],
        currentValue: tp.monetary,
        kind: "offset",
        suggestMin: Math.max(10, Math.round(tp.monetary * 0.3)),
        suggestMax: Math.round(tp.monetary * 2.5),
      });
    } else if (tp.r_mult != null && tp.r_mult > 0) {
      params.push({
        id: `take_profits|${i}|r_mult`,
        label: `TP${i + 1} — multiplo R (base: ${tp.r_mult}R)`,
        group: "Moltiplicatori ATR / R",
        pathParts: ["take_profits", String(i), "r_mult"],
        currentValue: tp.r_mult,
        kind: "r_mult",
        suggestMin: parseFloat((tp.r_mult * 0.3).toFixed(2)),
        suggestMax: parseFloat((tp.r_mult * 3).toFixed(2)),
      });
    } else if (tp.mult != null && tp.mult > 0) {
      params.push({
        id: `take_profits|${i}|mult`,
        label: `TP${i + 1} — moltiplicatore ATR (base: ×${tp.mult})`,
        group: "Moltiplicatori ATR / R",
        pathParts: ["take_profits", String(i), "mult"],
        currentValue: tp.mult,
        kind: "mult",
        suggestMin: parseFloat((tp.mult * 0.3).toFixed(3)),
        suggestMax: parseFloat((tp.mult * 2.5).toFixed(3)),
      });
    }
    if (tp.close_pct != null && tp.close_pct > 0) {
      params.push({
        id: `take_profits|${i}|close_pct`,
        label: `TP${i + 1} — % chiusura parziale (base: ${tp.close_pct}%)`,
        group: "Chiusure parziali (%)",
        pathParts: ["take_profits", String(i), "close_pct"],
        currentValue: tp.close_pct,
        kind: "close_pct",
        suggestMin: parseFloat(Math.max(5, tp.close_pct * 0.4).toFixed(1)),
        suggestMax: parseFloat(Math.min(100, tp.close_pct * 1.8).toFixed(1)),
      });
    }
  });

  const atp: any = rules.after_tp1_sl;
  if (atp && typeof atp === "object" && atp.type === "trail_atr_mult" && atp.mult > 0) {
    params.push({
      id: "after_tp1_sl|mult",
      label: `Trailing SL (dopo TP1) — moltiplicatore ATR (base: ×${atp.mult})`,
      group: "Moltiplicatori ATR / R",
      pathParts: ["after_tp1_sl", "mult"],
      currentValue: atp.mult,
      kind: "mult",
      suggestMin: parseFloat((atp.mult * 0.3).toFixed(3)),
      suggestMax: parseFloat((atp.mult * 2.5).toFixed(3)),
    });
  }

  const tfs: any = rules.trailing_stop;
  if (tfs && tfs.type === "trail_atr_mult" && tfs.mult > 0) {
    params.push({
      id: "trailing_stop|mult",
      label: `Trailing SL (da ingresso) — moltiplicatore ATR (base: ×${tfs.mult})`,
      group: "Moltiplicatori ATR / R",
      pathParts: ["trailing_stop", "mult"],
      currentValue: tfs.mult,
      kind: "mult",
      suggestMin: parseFloat((tfs.mult * 0.3).toFixed(3)),
      suggestMax: parseFloat((tfs.mult * 2.5).toFixed(3)),
    });
  }

  if (avgDailyDrawdownPct != null) {
    const baseMagnitude = Math.abs(avgDailyDrawdownPct) > 1e-6 ? Math.abs(avgDailyDrawdownPct) : 0.01;
    params.push({
      id: "daily_dd_limit_pct",
      label: `Drawdown giornaliero — limite operativo (base: ${(baseMagnitude * 100).toFixed(2)}%)`,
      group: "Rischio giornaliero",
      target: "mm",
      pathParts: ["dailyDDLimitPct"],
      currentValue: baseMagnitude,
      kind: "daily_dd_pct",
      suggestMin: parseFloat(Math.max(0.001, baseMagnitude * 0.3).toFixed(4)),
      suggestMax: parseFloat(Math.min(0.5, baseMagnitude * 3).toFixed(4)),
    });
  }

  // Se presenti nel Money Management globale, esporta anche i parametri monetari per lo sweep
  if (mm) {
    if (mm.monetarySLEnabled && mm.monetarySLValue && mm.monetarySLValue > 0) {
      params.push({
        id: "mm|monetarySLValue",
        label: `MM: Stop Loss Monetario (base: $${mm.monetarySLValue})`,
        group: "Gestione Monetaria (MM)",
        target: "mm",
        pathParts: ["monetarySLValue"],
        currentValue: mm.monetarySLValue,
        kind: "offset",
        unit: "$",
        suggestMin: Math.max(10, Math.round(mm.monetarySLValue * 0.3)),
        suggestMax: Math.round(mm.monetarySLValue * 2.5),
      });
    }

    if (mm.monetaryTPEnabled && mm.monetaryTpValue && mm.monetaryTpValue > 0) {
      params.push({
        id: "mm|monetaryTpValue",
        label: `MM: Take Profit Monetario (base: $${mm.monetaryTpValue})`,
        group: "Gestione Monetaria (MM)",
        target: "mm",
        pathParts: ["monetaryTpValue"],
        currentValue: mm.monetaryTpValue,
        kind: "offset",
        unit: "$",
        suggestMin: Math.max(10, Math.round(mm.monetaryTpValue * 0.3)),
        suggestMax: Math.round(mm.monetaryTpValue * 2.5),
      });

      if (mm.monetaryTpClosePct != null && mm.monetaryTpClosePct > 0) {
        params.push({
          id: "mm|monetaryTpClosePct",
          label: `MM: TP Chiusura Parziale (base: ${mm.monetaryTpClosePct}%)`,
          group: "Gestione Monetaria (MM)",
          target: "mm",
          pathParts: ["monetaryTpClosePct"],
          currentValue: mm.monetaryTpClosePct,
          kind: "close_pct",
          unit: "%",
          suggestMin: 10,
          suggestMax: 100,
        });
      }
    }
  }

  return params;
}

export function setByPath(obj: any, parts: string[], value: any): any {
  const cloned = JSON.parse(JSON.stringify(obj));
  let cur = cloned;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  cur[parts[parts.length - 1]] = value;
  return cloned;
}

export function runParameterSweep(
  bars: Bar[],
  baseRules: StrategyRules,
  mm: MoneyManagement,
  param: TweakableParam,
  sweepCfg: SweepConfigItem,
  initialCapital: number
): SweepRow[] {
  const min = sweepCfg.min ?? param.suggestMin;
  const max = sweepCfg.max ?? param.suggestMax;
  const steps = sweepCfg.steps ?? 10;
  const n = Math.max(2, Math.min(steps, 30));

  const gridVals = Array.from({ length: n }, (_, i) => {
    const raw = min + (max - min) * (i / (n - 1));
    return Math.round(raw * 10000) / 10000;
  });
  const base = param.currentValue;
  const TOL = 1e-6;
  const alreadyHasBase = gridVals.some((v) => Math.abs(v - base) < TOL);
  const vals = alreadyHasBase ? gridVals : [...gridVals, base].sort((a, b) => a - b);

  return vals.map((v) => {
    const testRules = param.target === "mm" ? baseRules : setByPath(baseRules, param.pathParts, v);
    const testMm = param.target === "mm" ? setByPath(mm, param.pathParts, v) : mm;
    try {
      const { trades: tr, equityCurve: ec } = runBacktest(bars, testRules, testMm);
      const m = computeMetrics(tr, ec, initialCapital);
      return {
        value: v,
        isBase: Math.abs(v - base) < TOL,
        n: m ? m.n : 0,
        winRate: m ? m.winRate : null,
        profitFactor: m && isFinite(m.profitFactor) ? m.profitFactor : null,
        totalReturnPct: m ? m.totalReturnPct : null,
        maxDDPct: m ? m.maxDDPct : null,
        sharpeAnnual: m && isFinite(m.sharpeAnnual) ? m.sharpeAnnual : null,
        expectancy: m ? m.expectancy : null,
      };
    } catch (_) {
      return { value: v, isBase: Math.abs(v - base) < TOL, n: 0, error: true };
    }
  });
}

export function computeSensitivity(sweepRows: SweepRow[], metricKey: keyof SweepRow, baseValue: number): number {
  const vals = sweepRows.map((r) => r[metricKey]).filter((v): v is number => typeof v === "number" && isFinite(v));
  if (vals.length < 2) return 0;
  const range = Math.max(...vals) - Math.min(...vals);
  const ref = Math.abs(baseValue) || 1;
  return range / ref;
}

export function getParamGridValues(param: TweakableParam, sweepCfg?: SweepConfigItem): number[] {
  const min = sweepCfg?.min ?? param.suggestMin;
  const max = sweepCfg?.max ?? param.suggestMax;
  const steps = sweepCfg?.steps ?? 7;
  const n = Math.max(2, Math.min(steps, 30));

  const gridVals = Array.from({ length: n }, (_, i) => {
    const raw = min + (max - min) * (i / (n - 1));
    return Math.round(raw * 10000) / 10000;
  });
  const base = param.currentValue;
  const TOL = 1e-6;
  const alreadyHasBase = gridVals.some((v) => Math.abs(v - base) < TOL);
  const vals = alreadyHasBase ? gridVals : [...gridVals, base].sort((a, b) => a - b);
  return vals;
}

export interface MultiParamOptOptions {
  selectedParamIds?: string[];
  objectiveKey?: string;
  method?: "grid" | "coordinate";
  maxCombinations?: number;
}

export function optimizeMultiParam(
  bars: Bar[],
  baseRules: StrategyRules,
  baseMm: MoneyManagement,
  paramSweeps: { param: TweakableParam; cfg: SweepConfigItem }[],
  objectiveFn: (metrics: BacktestMetrics | null) => number,
  initialCapital: number,
  options?: MultiParamOptOptions
): ScenarioOptResult {
  const startTime = Date.now();
  const selectedIds = options?.selectedParamIds ?? paramSweeps.map((ps) => ps.param.id);
  const objectiveKey = options?.objectiveKey ?? "composite";
  const preferredMethod = options?.method ?? "grid";
  const maxCombos = options?.maxCombinations ?? 2500;

  // Split into active (to optimize) and inactive (kept fixed at current value)
  const activeItems = paramSweeps.filter((ps) => selectedIds.includes(ps.param.id));
  const inactiveItems = paramSweeps.filter((ps) => !selectedIds.includes(ps.param.id));

  // Determine actual method and calculate total combinations
  const paramGridMap = new Map<string, number[]>();
  activeItems.forEach((it) => {
    paramGridMap.set(it.param.id, getParamGridValues(it.param, it.cfg));
  });

  const totalGridCombos = activeItems.reduce((prod, it) => prod * (paramGridMap.get(it.param.id)?.length || 1), 1);
  const canUseGrid = preferredMethod === "grid" && totalGridCombos <= maxCombos && activeItems.length <= 4;
  const method: "grid" | "coordinate" = canUseGrid ? "grid" : "coordinate";

  let bestRules = JSON.parse(JSON.stringify(baseRules));
  let bestMm = JSON.parse(JSON.stringify(baseMm));
  let bestScore = -Infinity;
  let combinationsTested = 0;
  let bestParamVals: Record<string, number> = {};

  // Initialize best values with current baseline
  paramSweeps.forEach((ps) => {
    bestParamVals[ps.param.id] = ps.param.currentValue;
  });

  // Base evaluation
  const baseSim = runBacktest(bars, baseRules, baseMm);
  const baseMetrics = computeMetrics(baseSim.trades, baseSim.equityCurve, initialCapital)!;
  const baseResult: BacktestResult = {
    trades: baseSim.trades,
    equityCurve: baseSim.equityCurve,
    finalEquity: baseSim.finalEquity,
    metrics: baseMetrics,
  };
  bestScore = objectiveFn(baseMetrics);

  let heatmap2D: ScenarioOptResult["heatmap2D"] = null;

  if (activeItems.length === 0) {
    // No params selected to optimize
    const optResult: BacktestResult = {
      trades: baseSim.trades,
      equityCurve: baseSim.equityCurve,
      finalEquity: baseSim.finalEquity,
      metrics: baseMetrics,
    };
    return {
      optimalValues: paramSweeps.map((ps) => ({
        param: ps.param,
        optimalValue: ps.param.currentValue,
        baseValue: ps.param.currentValue,
        isOptimized: false,
      })),
      optRules: baseRules,
      optMm: baseMm,
      baseResult,
      optResult,
      baseMetrics,
      optMetrics: baseMetrics,
      bestScore,
      combinationsTested: 1,
      durationMs: Date.now() - startTime,
      method,
      objectiveKey,
      heatmap2D: null,
    };
  }

  if (method === "grid") {
    // Cartesian Grid Search
    if (activeItems.length === 1) {
      const it = activeItems[0];
      const vals = paramGridMap.get(it.param.id) || [it.param.currentValue];
      for (const v of vals) {
        combinationsTested++;
        const testRules = it.param.target === "mm" ? baseRules : setByPath(baseRules, it.param.pathParts, v);
        const testMm = it.param.target === "mm" ? setByPath(baseMm, it.param.pathParts, v) : baseMm;
        try {
          const { trades, equityCurve } = runBacktest(bars, testRules, testMm);
          const m = computeMetrics(trades, equityCurve, initialCapital);
          const score = objectiveFn(m);
          if (score > bestScore) {
            bestScore = score;
            bestRules = testRules;
            bestMm = testMm;
            bestParamVals[it.param.id] = v;
          }
        } catch (_) {}
      }
    } else if (activeItems.length === 2) {
      // 2D Grid Search with Full Heatmap Construction
      const itX = activeItems[0];
      const itY = activeItems[1];
      const xVals = paramGridMap.get(itX.param.id) || [itX.param.currentValue];
      const yVals = paramGridMap.get(itY.param.id) || [itY.param.currentValue];

      const matrix: { xVal: number; yVal: number; score: number; metrics: BacktestMetrics | null }[][] = [];
      let minScore = Infinity;
      let maxScore = -Infinity;
      let bestX = itX.param.currentValue;
      let bestY = itY.param.currentValue;

      for (let yi = 0; yi < yVals.length; yi++) {
        const row: { xVal: number; yVal: number; score: number; metrics: BacktestMetrics | null }[] = [];
        const yVal = yVals[yi];

        for (let xi = 0; xi < xVals.length; xi++) {
          const xVal = xVals[xi];
          combinationsTested++;

          let testRules = JSON.parse(JSON.stringify(baseRules));
          let testMm = JSON.parse(JSON.stringify(baseMm));

          if (itX.param.target === "mm") testMm = setByPath(testMm, itX.param.pathParts, xVal);
          else testRules = setByPath(testRules, itX.param.pathParts, xVal);

          if (itY.param.target === "mm") testMm = setByPath(testMm, itY.param.pathParts, yVal);
          else testRules = setByPath(testRules, itY.param.pathParts, yVal);

          try {
            const { trades, equityCurve } = runBacktest(bars, testRules, testMm);
            const m = computeMetrics(trades, equityCurve, initialCapital);
            const score = objectiveFn(m);

            if (Number.isFinite(score)) {
              if (score < minScore) minScore = score;
              if (score > maxScore) maxScore = score;
            }

            if (score > bestScore) {
              bestScore = score;
              bestRules = testRules;
              bestMm = testMm;
              bestX = xVal;
              bestY = yVal;
              bestParamVals[itX.param.id] = xVal;
              bestParamVals[itY.param.id] = yVal;
            }

            row.push({ xVal, yVal, score: Number.isFinite(score) ? score : -999, metrics: m });
          } catch (_) {
            row.push({ xVal, yVal, score: -999, metrics: null });
          }
        }
        matrix.push(row);
      }

      heatmap2D = {
        paramX: itX.param,
        paramY: itY.param,
        xValues: xVals,
        yValues: yVals,
        matrix,
        bestX,
        bestY,
        minScore: Number.isFinite(minScore) ? minScore : 0,
        maxScore: Number.isFinite(maxScore) ? maxScore : 1,
      };
    } else {
      // 3 or 4 parameters Grid Search
      const grids = activeItems.map((it) => paramGridMap.get(it.param.id) || [it.param.currentValue]);

      function explore(depth: number, currentCombo: number[]) {
        if (depth === activeItems.length) {
          combinationsTested++;
          let testRules = JSON.parse(JSON.stringify(baseRules));
          let testMm = JSON.parse(JSON.stringify(baseMm));

          for (let i = 0; i < activeItems.length; i++) {
            const it = activeItems[i];
            const v = currentCombo[i];
            if (it.param.target === "mm") testMm = setByPath(testMm, it.param.pathParts, v);
            else testRules = setByPath(testRules, it.param.pathParts, v);
          }

          try {
            const { trades, equityCurve } = runBacktest(bars, testRules, testMm);
            const m = computeMetrics(trades, equityCurve, initialCapital);
            const score = objectiveFn(m);
            if (score > bestScore) {
              bestScore = score;
              bestRules = testRules;
              bestMm = testMm;
              for (let i = 0; i < activeItems.length; i++) {
                bestParamVals[activeItems[i].param.id] = currentCombo[i];
              }
            }
          } catch (_) {}
          return;
        }

        const vals = grids[depth];
        for (const v of vals) {
          explore(depth + 1, [...currentCombo, v]);
        }
      }

      explore(0, []);
    }
  } else {
    // Coordinate Descent (2 sequential passes over selected active params)
    let currentRules = JSON.parse(JSON.stringify(baseRules));
    let currentMm = JSON.parse(JSON.stringify(baseMm));

    for (let pass = 0; pass < 2; pass++) {
      for (const item of activeItems) {
        const p = item.param;
        const vals = paramGridMap.get(p.id) || [p.currentValue];

        let bestValForParam = bestParamVals[p.id] ?? p.currentValue;

        for (const v of vals) {
          combinationsTested++;
          const testRules = p.target === "mm" ? currentRules : setByPath(currentRules, p.pathParts, v);
          const testMm = p.target === "mm" ? setByPath(currentMm, p.pathParts, v) : currentMm;
          try {
            const { trades, equityCurve } = runBacktest(bars, testRules, testMm);
            const m = computeMetrics(trades, equityCurve, initialCapital);
            const score = objectiveFn(m);
            if (score > bestScore) {
              bestScore = score;
              bestValForParam = v;
              bestRules = testRules;
              bestMm = testMm;
            }
          } catch (_) {}
        }

        bestParamVals[p.id] = bestValForParam;
        if (p.target === "mm") {
          currentMm = setByPath(currentMm, p.pathParts, bestValForParam);
        } else {
          currentRules = setByPath(currentRules, p.pathParts, bestValForParam);
        }
      }
    }
  }

  // Final simulation of optimized parameters
  const optSim = runBacktest(bars, bestRules, bestMm);
  const optMetrics = computeMetrics(optSim.trades, optSim.equityCurve, initialCapital)!;
  const optResult: BacktestResult = {
    trades: optSim.trades,
    equityCurve: optSim.equityCurve,
    finalEquity: optSim.finalEquity,
    metrics: optMetrics,
  };

  const optimalValues = paramSweeps.map((ps) => {
    const isSelected = selectedIds.includes(ps.param.id);
    return {
      param: ps.param,
      optimalValue: isSelected ? (bestParamVals[ps.param.id] ?? ps.param.currentValue) : ps.param.currentValue,
      baseValue: ps.param.currentValue,
      isOptimized: isSelected,
    };
  });

  return {
    optimalValues,
    optRules: bestRules,
    optMm: bestMm,
    baseResult,
    optResult,
    baseMetrics,
    optMetrics,
    bestScore: objectiveFn(optMetrics),
    combinationsTested,
    durationMs: Date.now() - startTime,
    method,
    objectiveKey,
    heatmap2D,
  };
}

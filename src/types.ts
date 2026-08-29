export interface ConditionNode {
  type: "condition" | "group";
  left?: string | number;
  op?: ">" | "<" | ">=" | "<=" | "==" | "!=";
  right?: string | number;
  operator?: "AND" | "OR";
  conditions?: ConditionNode[];
  close_pct?: number;
}

export interface SignalExitRule {
  condition: ConditionNode;
  close_pct?: number;
}

export type ExitRuleNode =
  | ConditionNode
  | SignalExitRule
  | (ConditionNode | SignalExitRule)[]
  | null;

export interface StopLossNode {
  type:
    | "atr_mult"
    | "none"
    | "fixed_points"
    | "monetary"
    | "prev_candle_low"
    | "prev_candle_high"
    | "prev_candle_extreme"
    | "before_signal_low"
    | "before_signal_high"
    | "before_signal_extreme";
  mult?: number;
  value?: number;
  offset?: number;
}

export interface TakeProfitLeg {
  r_mult?: number;
  mult?: number;
  monetary?: number;
  close_pct: number;
}

export interface StrategyRules {
  entry_long: ConditionNode | null;
  entry_short: ConditionNode | null;
  exit_long: ExitRuleNode;
  exit_short: ExitRuleNode;
  atr_column: string | null;
  stop_loss: StopLossNode;
  take_profits: TakeProfitLeg[];
  after_tp1_sl?: "original" | "breakeven" | { type: "trail_atr_mult"; mult: number };
  trailing_stop?: { type: "trail_atr_mult"; mult: number } | null;
  timeout_bars: number;
  entry_timing?: "next_open" | "same_close" | "intrabar";
  exit_timing?: "next_open" | "same_close" | "intrabar";
  notes?: string;
}

export interface Bar {
  dt: number;
  open: number;
  high: number;
  low: number;
  close: number;
  [key: string]: number | null;
}

export interface ColumnStat {
  min: number;
  max: number;
  mean: number;
}

export interface CsvParsedFile {
  id: string;
  name: string;
  header: string[];
  rows: string[][];
  ncols: number;
  extraCols: { idx: number; name: string }[];
  nRows: number;
  error: string | null;
}

export interface MoneyManagement {
  initialCapital: number;
  sizingMode: "risk" | "fixed";
  riskPct: number;
  fixedQty: number;
  linearGrowthEnabled?: boolean;
  linearGrowthMode?: "proportional" | "step";
  linearGrowthStepCapital?: number;
  linearGrowthStepQty?: number;
  linearGrowthRounding?: "integer" | "decimal" | "none";
  linearGrowthMinQty?: number;
  linearGrowthMaxQty?: number | null;
  linearGrowthAllowDeleveraging?: boolean;
  linearGrowthScaleMonetarySLTP?: boolean;
  spread: number;
  pointValue?: number;
  monetarySLEnabled?: boolean;
  monetarySLValue?: number | null;
  monetaryTPEnabled?: boolean;
  monetaryTpValue?: number | null;
  monetaryTpClosePct?: number;
  entryTiming: "next_open" | "same_close" | "intrabar";
  exitTiming?: "next_open" | "same_close" | "intrabar";
  dailyDDLimitPct: number | null;
  intrabarFraction: number;
  intrabarExitFraction?: number;
  tradingHoursEnabled: boolean;
  tradingHoursStart: string;
  tradingHoursEnd: string;
  fridayCloseEnabled: boolean;
  fridayCloseTime: string;
}

export interface TradeLeg {
  reason: string;
  dt: number;
  price: number;
  qty: number;
  pctOfPosition: number;
  pnl: number;
}

export interface Trade {
  direction: "long" | "short";
  entryDt: number;
  entryPrice: number;
  exitDt: number;
  exitReason: string;
  exitPrice: number | null;
  atrAtEntry: number | null;
  slLevel: number | null;
  qtyTotal: number;
  pnl: number;
  barsHeld: number;
  tp1Hit: boolean;
  equityAfter: number;
  afterTp1SlMode: string;
  legs: TradeLeg[];
}

export interface EquityPoint {
  dt: number;
  equity: number;
  ddPct?: number;
  [key: string]: any;
}

export interface DailyDrawdownPoint {
  day: string;
  dt: number;
  ddPct: number;
  ddPctOfInitial: number;
}

export interface BacktestMetrics {
  n: number;
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  ratioWinLoss: number;
  sharpeAnnual: number;
  recoveryFactor: number;
  expectancy: number;
  finalEquity: number;
  totalReturnPct: number;
  maxDD: number;
  maxDDPct: number;
  maxConsWin: number;
  maxConsLoss: number;
  avgDailyDrawdownPct: number;
  dailyDrawdownSeries: DailyDrawdownPoint[];
  avgBarsHeld: number;
  byDirection: {
    long: { n: number; winRate: number; pnl: number };
    short: { n: number; winRate: number; pnl: number };
  };
  byReason: Record<string, { n: number; pnl: number }>;
  byLegReason: Record<string, { n: number; pnl: number; qtyPctSum: number; avgPctOfPosition: number }>;
  monthly: { month: string; pnl: number }[];
  weekly: { week: string; pnl: number }[];
  monthlyByDirection: {
    month: string;
    longWinRate: number | null;
    shortWinRate: number | null;
    longN: number;
    shortN: number;
  }[];
}

export interface BacktestResult {
  trades: Trade[];
  equityCurve: EquityPoint[];
  finalEquity?: number;
  metrics: BacktestMetrics;
  rules?: StrategyRules;
  mm?: MoneyManagement;
}

export interface MonteCarloConfig {
  iterations: number;
  method: "bootstrap" | "permutation";
  ruinThresholdPct: number;
}

export interface MonteCarloStats {
  mean: number;
  std: number;
  min: number;
  max: number;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
}

export interface HistogramBin {
  x0: number;
  x1: number;
  count: number;
  label: number;
}

export interface MonteCarloResult {
  iterations: number;
  method: "bootstrap" | "permutation";
  ruinThresholdPct: number;
  avgTradesPerDay: number;
  bucketSize: number;
  riskOfRuin: number;
  probPositive: number;
  returnStats: MonteCarloStats;
  ddStats: MonteCarloStats;
  pfStats: MonteCarloStats;
  avgDailyDDStats: MonteCarloStats;
  histReturns: HistogramBin[];
  histDD: HistogramBin[];
  histPF: HistogramBin[];
  histAvgDailyDD: HistogramBin[];
  samplePaths: number[][];
  bands: { step: number; p5: number; p25: number; p50: number; p75: number; p95: number }[];
  sortedReturns: number[];
  sortedDD: number[];
  sortedPF: number[];
  sortedAvgDailyDD: number[];
}

export interface ReliabilityBreakdownItem {
  label: string;
  points: number;
  max: number;
  note: string;
}

export interface ReliabilityImprovement {
  sev: "alta" | "media" | "bassa";
  text: string;
}

export interface ReliabilityScore {
  score: number;
  verdict: string;
  verdictColor: string;
  breakdown: ReliabilityBreakdownItem[];
  improvements: ReliabilityImprovement[];
  rank: number;
}

export interface TweakableParam {
  id: string;
  label: string;
  group: string;
  pathParts: string[];
  currentValue: number;
  kind: "threshold" | "mult" | "offset" | "r_mult" | "close_pct" | "daily_dd_pct";
  suggestMin: number;
  suggestMax: number;
  target?: "rules" | "mm";
  unit?: string;
}

export interface SweepConfigItem {
  enabled?: boolean;
  min?: number;
  max?: number;
  steps?: number;
}

export interface SweepRow {
  value: number;
  isBase: boolean;
  n: number;
  winRate?: number | null;
  profitFactor?: number | null;
  totalReturnPct?: number | null;
  maxDDPct?: number | null;
  sharpeAnnual?: number | null;
  expectancy?: number | null;
  error?: boolean;
}

export interface ScenarioResult {
  sweeps: Record<
    string,
    {
      param: TweakableParam;
      cfg: SweepConfigItem;
      rows: SweepRow[];
      baseValue: number;
    }
  >;
  baseRules: StrategyRules;
  baseMm: MoneyManagement;
}

export interface Heatmap2DData {
  paramX: TweakableParam;
  paramY: TweakableParam;
  xValues: number[];
  yValues: number[];
  matrix: {
    xVal: number;
    yVal: number;
    score: number;
    metrics: BacktestMetrics | null;
  }[][];
  bestX: number;
  bestY: number;
  minScore: number;
  maxScore: number;
}

export interface ScenarioOptResult {
  optimalValues: { param: TweakableParam; optimalValue: number; baseValue: number; isOptimized?: boolean }[];
  optRules: StrategyRules;
  optMm: MoneyManagement;
  baseResult: BacktestResult;
  optResult: BacktestResult;
  baseMetrics: BacktestMetrics;
  optMetrics: BacktestMetrics;
  bestScore: number;
  combinationsTested?: number;
  durationMs?: number;
  method?: "grid" | "coordinate";
  objectiveKey?: string;
  heatmap2D?: Heatmap2DData | null;
}

export interface WalkForwardConfig {
  isPct: number;
  oosPct: number;
  mode: "single" | "rolling";
  expandingIs: boolean;
}

export interface WalkForwardWindowResult {
  isStart: number;
  isEnd: number;
  oosStart: number;
  oosEnd: number;
  label: string;
  period: string;
  is: BacktestMetrics | null;
  oos: BacktestMetrics | null;
  oosTrades: Trade[];
  foldOptima?: { param: TweakableParam; optimalValue: number; baseValue: number }[];
  optRules?: StrategyRules;
  optMm?: MoneyManagement;
}

export interface WfoParamSummary {
  param: TweakableParam;
  baseValue: number;
  medianValue: number;
  meanValue: number;
  minValue: number;
  maxValue: number;
  latestValue: number;
  stabilityScore: number; // 0 - 100%
  stabilityLabel: "Alta" | "Media" | "Bassa";
  valuesPerFold: { foldLabel: string; value: number }[];
}

export interface DrawdownBucket {
  rangeLabel: string;
  minPct: number;
  maxPct: number;
  count: number;
  pctOfTime: number;
}

export interface ChainedOosMetrics {
  cagr: number | null;
  netProfit: number;
  netProfitPct: number;
  profitFactor: number;
  sharpeAnnual: number;
  sortinoAnnual: number;
  maxDD: number;
  maxDDPct: number;
  recoveryFactor: number;
  pctProfitableWindows: number;
  profitableWindowsCount: number;
  totalWindowsCount: number;
  medianOosReturnPct: number | null;
  worstWindow: {
    label: string;
    returnPct: number;
    pnl: number;
    period: string;
  } | null;
  bestWindow: {
    label: string;
    returnPct: number;
    pnl: number;
    period: string;
  } | null;
  totalTrades: number;
  winRate: number;
  winCount: number;
  lossCount: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  underwaterCurve: { dt: number; drawdownPct: number; drawdownAmount: number; equity: number }[];
  drawdownBuckets: DrawdownBucket[];
  avgDrawdownPct: number;
  maxDrawdownDurationDays: number;
}

export interface WalkForwardResult {
  results: WalkForwardWindowResult[];
  chainPoints: { dt: number; equity: number; type?: string }[];
  efficiencyRatio: number | null;
  degradation: Record<string, { is: number | null; oos: number | null; ratio: number | null }>;
  nFolds: number;
  mode?: "base" | "optimized" | "wfo";
  objKey?: string;
  wfoParamSummaries?: WfoParamSummary[];
  chainedMetrics?: ChainedOosMetrics;
}

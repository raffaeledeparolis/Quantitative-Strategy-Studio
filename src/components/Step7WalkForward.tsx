import React, { useState, useMemo } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, ComposedChart, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  FastForward, PlayCircle, Loader2, RotateCcw, ChevronLeft, Info, CheckCircle2,
  AlertTriangle, Sparkles, Sliders, ShieldCheck, ChevronDown, ChevronUp, Layers, TrendingUp,
  TrendingDown, CheckSquare, Square, Activity, Target, Award, PieChart, BarChart2,
  ShieldAlert, ArrowUpRight, ArrowDownRight, Scale, Clock, Compass, Shuffle, Dice5,
  FileSpreadsheet, BarChart3, RefreshCw
} from "lucide-react";
import { C, FONT_SERIF, FONT_SANS, FONT_MONO, Card, Button, Field, KPI, inputStyle } from "./CommonUI";
import {
  Bar as BarData, StrategyRules, MoneyManagement, WalkForwardConfig, WalkForwardResult, TweakableParam, SweepConfigItem, WfoParamSummary,
  Trade, MonteCarloResult, MonteCarloConfig, HistogramBin
} from "../types";
import { fmtPct, fmtNum, fmtMoney, fmtDT } from "../lib/csvHelper";
import { downsample } from "../lib/backtestEngine";
import { OPTIM_OBJECTIVES, getParamGridValues } from "../lib/scenarioEngine";
import { computeChainedOosMetrics } from "../lib/walkForwardEngine";
import { runMonteCarlo, rankPercentile, percentile } from "../lib/monteCarloEngine";

interface Step7WalkForwardProps {
  bars: BarData[];
  rules: StrategyRules;
  mm: MoneyManagement;
  params: TweakableParam[];
  sweepConfigs: Record<string, SweepConfigItem>;
  setSweepConfigs?: React.Dispatch<React.SetStateAction<Record<string, SweepConfigItem>>>;
  optRules: StrategyRules | null;
  optMm: MoneyManagement | null;
  wfConfig: WalkForwardConfig;
  setWfConfig: React.Dispatch<React.SetStateAction<WalkForwardConfig>>;
  wfResult: WalkForwardResult | null;
  running: boolean;
  onRunWalkForward: (mode: "base" | "opt" | "wfo", objFnKey?: string, selectedParamIds?: string[]) => void;
  onBack: () => void;
  onReset: () => void;
}

export function Step7WalkForward({
  bars,
  rules,
  mm,
  params,
  sweepConfigs,
  setSweepConfigs,
  optRules,
  optMm,
  wfConfig,
  setWfConfig,
  wfResult,
  running,
  onRunWalkForward,
  onBack,
  onReset,
}: Step7WalkForwardProps) {
  const [activeTab, setActiveTab] = useState<"base" | "opt" | "wfo">("wfo");
  const [selectedObjFn, setSelectedObjFn] = useState<string>("composite");
  const [selectedParamIds, setSelectedParamIds] = useState<string[]>(() => params.map((p) => p.id));
  const [showParamConfig, setShowParamConfig] = useState<boolean>(false);
  const [selectedParamForTrajectory, setSelectedParamForTrajectory] = useState<string>("");
  const [expandedFoldIndex, setExpandedFoldIndex] = useState<number | null>(null);
  const [showFoldMatrix, setShowFoldMatrix] = useState<boolean>(true);
  const [chainedChartView, setChainedChartView] = useState<"equity" | "underwater" | "distribution" | "windows">("equity");

  const totalBars = bars.length;

  // Sync selected params when params array length or contents change
  React.useEffect(() => {
    if (params.length > 0) {
      setSelectedParamIds((prev) => {
        const validExisting = prev.filter((id) => params.some((p) => p.id === id));
        if (validExisting.length === 0) return params.map((p) => p.id);
        return validExisting;
      });
    }
  }, [params]);

  const toggleParam = (id: string) => {
    setSelectedParamIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAllParams = () => setSelectedParamIds(params.map((p) => p.id));
  const deselectAllParams = () => setSelectedParamIds([]);
  const selectThresholdsOnly = () =>
    setSelectedParamIds(params.filter((p) => p.kind === "threshold").map((p) => p.id));
  const selectRiskOnly = () =>
    setSelectedParamIds(
      params.filter((p) => ["mult", "offset", "r_mult", "close_pct", "daily_dd_pct"].includes(p.kind)).map((p) => p.id)
    );

  const updateParamSweep = (id: string, partial: Partial<SweepConfigItem>) => {
    if (!setSweepConfigs) return;
    setSweepConfigs((prev) => {
      const p = params.find((x) => x.id === id);
      const existing = prev[id] || { min: p?.suggestMin ?? 0, max: p?.suggestMax ?? 10, steps: 5 };
      return {
        ...prev,
        [id]: { ...existing, ...partial },
      };
    });
  };

  const chainChartData = useMemo(() => {
    if (!wfResult?.chainPoints) return [];
    return downsample(wfResult.chainPoints, 500);
  }, [wfResult]);

  const chainedMetrics = useMemo(() => {
    if (wfResult?.chainedMetrics) return wfResult.chainedMetrics;
    if (wfResult?.results) {
      return computeChainedOosMetrics(wfResult.results, mm.initialCapital, bars);
    }
    return null;
  }, [wfResult, mm.initialCapital, bars]);

  // Robustness Score & Composite Grading Model
  const robustnessAssessment = useMemo(() => {
    if (!wfResult || !chainedMetrics) return null;

    const effRatio = wfResult.efficiencyRatio ?? 0;
    const oosPf = chainedMetrics.profitFactor;
    const pctProfitable = chainedMetrics.pctProfitableWindows;
    const maxDdPct = chainedMetrics.maxDDPct;
    const recFactor = chainedMetrics.recoveryFactor;
    const oosSharpe = chainedMetrics.sharpeAnnual;

    // Component 1: Efficiency Ratio (Max 25 pts)
    // Measures preservation of IS performance in OOS
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

    let grade: { label: string; verdict: string; color: string; bgColor: string; borderColor: string; description: string; recommendation: string };
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

    const subScores = [
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
  }, [wfResult, chainedMetrics]);

  const underwaterChartData = useMemo(() => {
    if (!chainedMetrics?.underwaterCurve) return [];
    return downsample(chainedMetrics.underwaterCurve, 500);
  }, [chainedMetrics]);

  const oosWindowReturnsChartData = useMemo(() => {
    if (!wfResult?.results) return [];
    return wfResult.results.map((r) => {
      const ret = (r.oos?.totalReturnPct ?? 0) * 100;
      return {
        label: r.label,
        period: r.period,
        returnPct: parseFloat(ret.toFixed(2)),
        pnl: r.oosTrades.reduce((s, t) => s + t.pnl, 0),
        isProfitable: ret > 0,
        n: r.oos?.n ?? 0,
        pf: r.oos?.profitFactor ?? 0,
      };
    });
  }, [wfResult]);

  // Sync selected param for stability trajectory chart
  React.useEffect(() => {
    if (wfResult?.wfoParamSummaries && wfResult.wfoParamSummaries.length > 0) {
      if (!selectedParamForTrajectory || !wfResult.wfoParamSummaries.some((s) => s.param.id === selectedParamForTrajectory)) {
        setSelectedParamForTrajectory(wfResult.wfoParamSummaries[0].param.id);
      }
    }
  }, [wfResult, selectedParamForTrajectory]);

  const activeTrajectoryParam = useMemo(() => {
    if (!wfResult?.wfoParamSummaries) return null;
    return wfResult.wfoParamSummaries.find((s) => s.param.id === selectedParamForTrajectory) || wfResult.wfoParamSummaries[0] || null;
  }, [wfResult, selectedParamForTrajectory]);

  const trajectoryChartData = useMemo(() => {
    if (!activeTrajectoryParam || !wfResult?.results) return [];
    return wfResult.results.map((r, i) => {
      const fo = r.foldOptima?.find((item) => item.param.id === activeTrajectoryParam.param.id);
      return {
        fold: r.label,
        optimalValue: fo?.optimalValue ?? activeTrajectoryParam.param.currentValue,
        baseValue: activeTrajectoryParam.param.currentValue,
        medianValue: activeTrajectoryParam.medianValue,
      };
    });
  }, [activeTrajectoryParam, wfResult]);

  // --- CHAINED OOS MONTE CARLO ANALYSIS STATE & COMPUTATIONS ---
  const [oosMcConfig, setOosMcConfig] = useState<MonteCarloConfig>({
    iterations: 2000,
    method: "bootstrap",
    ruinThresholdPct: 50,
  });
  const [oosMcView, setOosMcView] = useState<"fanchart" | "returns" | "dd" | "stats">("fanchart");
  const [oosMcRunning, setOosMcRunning] = useState<boolean>(false);
  const [oosMcTrigger, setOosMcTrigger] = useState<number>(0);

  const allOosTrades = useMemo(() => {
    if (!wfResult?.results) return [];
    const list: Trade[] = [];
    wfResult.results.forEach((r) => {
      if (r.oosTrades && r.oosTrades.length > 0) {
        list.push(...r.oosTrades);
      }
    });
    return list.sort((a, b) => a.entryDt - b.entryDt);
  }, [wfResult]);

  const oosMcResult = useMemo(() => {
    if (!allOosTrades || allOosTrades.length === 0) return null;
    return runMonteCarlo(allOosTrades, mm.initialCapital, oosMcConfig);
  }, [allOosTrades, mm.initialCapital, oosMcConfig, oosMcTrigger]);

  const actualOosEquitySeries = useMemo(() => {
    if (!allOosTrades || allOosTrades.length === 0) return [mm.initialCapital];
    let eq = mm.initialCapital;
    const arr = [eq];
    for (const t of allOosTrades) {
      eq += t.pnl;
      arr.push(eq);
    }
    return arr;
  }, [allOosTrades, mm.initialCapital]);

  const oosFanChartData = useMemo(() => {
    if (!oosMcResult) return [];
    return oosMcResult.bands.map((b, i) => {
      const actual = actualOosEquitySeries[i];
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
  }, [oosMcResult, actualOosEquitySeries]);

  const oosOutOfBandCount = useMemo(() => oosFanChartData.filter((d) => d.outOfBand).length, [oosFanChartData]);
  const oosOutOfBandPct = oosFanChartData.length ? oosOutOfBandCount / oosFanChartData.length : 0;

  const oosMcRank = useMemo(() => {
    if (!oosMcResult || !chainedMetrics) return 50;
    return rankPercentile(oosMcResult.sortedReturns, chainedMetrics.netProfitPct);
  }, [oosMcResult, chainedMetrics]);

  const handleRunOosMonteCarlo = () => {
    setOosMcRunning(true);
    setTimeout(() => {
      setOosMcTrigger((prev) => prev + 1);
      setOosMcRunning(false);
    }, 150);
  };

  const isWfoResult = wfResult?.mode === "wfo" || (wfResult?.wfoParamSummaries && wfResult.wfoParamSummaries.length > 0);

  return (
    <div id="step-7-container">
      {/* Top Banner */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 style={{ fontFamily: FONT_SERIF, fontSize: 19, color: C.primaryDark, margin: 0, display: "flex", alignItems: "center", gap: 9 }}>
              <FastForward size={19} /> 7. Walk-Forward Validation &amp; Optimization (WFO)
            </h2>
            <p style={{ fontSize: 13.5, color: C.muted, marginTop: 4, marginBottom: 0 }}>
              Testa e ottimizza la strategia su finestre temporali scorrevoli Out-Of-Sample (OOS), identificando i valori ottimali per ciascun parametro e verificandone la stabilità.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button id="btn-wf-reset" onClick={onReset} variant="ghost" icon={RotateCcw}>
              Nuova simulazione
            </Button>
          </div>
        </div>

        {/* Walk-Forward Segmentation Config */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 18 }}>
          <Field label="Metodo di segmentazione">
            <select
              id="select-wf-mode"
              value={wfConfig.mode}
              onChange={(e) => setWfConfig({ ...wfConfig, mode: e.target.value as "single" | "rolling" })}
              style={inputStyle}
            >
              <option value="rolling">Rolling Windows (Fold multipli sequenziali)</option>
              <option value="single">Split singolo (es. 70% In-Sample / 30% Out-Of-Sample)</option>
            </select>
          </Field>
          <Field label="Finestra In-Sample (% del dataset)" hint={`~${Math.round(totalBars * (wfConfig.isPct / 100))} barre`}>
            <input
              id="input-wf-is-pct"
              type="number"
              min="20"
              max="80"
              value={wfConfig.isPct}
              onChange={(e) => setWfConfig({ ...wfConfig, isPct: parseInt(e.target.value, 10) })}
              style={inputStyle}
            />
          </Field>
          <Field label="Finestra Out-Of-Sample (% del dataset)" hint={`~${Math.round(totalBars * (wfConfig.oosPct / 100))} barre`}>
            <input
              id="input-wf-oos-pct"
              type="number"
              min="10"
              max="50"
              value={wfConfig.oosPct}
              onChange={(e) => setWfConfig({ ...wfConfig, oosPct: parseInt(e.target.value, 10) })}
              style={inputStyle}
            />
          </Field>
        </div>

        {wfConfig.mode === "rolling" && (
          <div style={{ marginTop: 10, marginBottom: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                id="checkbox-wf-expanding"
                type="checkbox"
                checked={wfConfig.expandingIs}
                onChange={(e) => setWfConfig({ ...wfConfig, expandingIs: e.target.checked })}
                style={{ width: 15, height: 15, accentColor: C.primary }}
              />
              <span style={{ fontFamily: FONT_SANS, fontSize: 13, color: C.text }}>
                <b>Finestra IS ad espansione progressiva</b> (ogni fold include tutto lo storico cumulato fino all'inizio dell'OOS)
              </span>
            </label>
          </div>
        )}

        {/* Execution Mode Tabs */}
        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 14, paddingTop: 16 }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            {[
              { id: "wfo", label: "★ 3. Walk-Forward Optimization (WFO - Consigliato)", hint: "Ri-ottimizza i parametri in ciascun ciclo IS e testa su OOS" },
              { id: "opt", label: "2. Walk-Forward con Parametri Ottimizzati (Step 6)", disabled: !optRules, hint: "Testa la configurazione statica dello Step 6 su finestre OOS" },
              { id: "base", label: "1. Walk-Forward Strategia Base", hint: "Testa la configurazione originale senza ottimizzazione" },
            ].map((tab) => (
              <button
                key={tab.id}
                id={`tab-wf-${tab.id}`}
                type="button"
                disabled={tab.disabled}
                onClick={() => setActiveTab(tab.id as any)}
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 13,
                  fontWeight: activeTab === tab.id ? 700 : 600,
                  padding: "8px 14px",
                  borderRadius: 7,
                  cursor: tab.disabled ? "not-allowed" : "pointer",
                  border: `1.5px solid ${activeTab === tab.id ? C.primary : C.border}`,
                  background: activeTab === tab.id ? C.primary : tab.disabled ? "#f4f3ee" : "#fff",
                  color: activeTab === tab.id ? "#fff" : tab.disabled ? C.muted : C.text,
                  opacity: tab.disabled ? 0.6 : 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "wfo" && (
            <>
              {/* Parameter Selection for WFO Scan */}
              <div
                id="box-wfo-param-selection"
                style={{
                  background: "#FBFBFA",
                  border: `1.5px solid ${selectedParamIds.length > 0 ? C.primary + "44" : C.amber}`,
                  borderRadius: 8,
                  padding: "16px 18px",
                  marginBottom: 16,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Sliders size={17} color={C.primaryDark} />
                      <span style={{ fontFamily: FONT_SANS, fontSize: 13.5, fontWeight: 700, color: C.primaryDark }}>
                        Parametri da Scansionare per la Walk-Forward Optimization (WFO)
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                      Scegli quali parametri scansionare e ri-ottimizzare su ciascun ciclo In-Sample (IS). I parametri deselezionati manterranno il loro valore base.
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span
                      id="badge-wfo-active-params-count"
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        fontFamily: FONT_MONO,
                        background: selectedParamIds.length > 0 ? C.primaryLight : C.amberLight,
                        color: selectedParamIds.length > 0 ? C.primaryDark : C.amber,
                        padding: "3px 10px",
                        borderRadius: 6,
                        border: `1px solid ${selectedParamIds.length > 0 ? C.primary + "44" : C.amber + "66"}`,
                      }}
                    >
                      {selectedParamIds.length} / {params.length} parametri attivi
                    </span>
                    <button
                      id="btn-wfo-toggle-param-config"
                      type="button"
                      onClick={() => setShowParamConfig((p) => !p)}
                      style={{
                        fontFamily: FONT_SANS,
                        fontSize: 12,
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: `1px solid ${C.border}`,
                        background: "#fff",
                        color: C.text,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontWeight: 600,
                      }}
                    >
                      {showParamConfig ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      {showParamConfig ? "Nascondi range" : "Modifica intervalli (Min/Max/Step)"}
                    </button>
                  </div>
                </div>

                {/* Quick selection buttons */}
                <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                  <button
                    id="btn-wfo-select-all"
                    type="button"
                    onClick={selectAllParams}
                    style={{
                      fontFamily: FONT_SANS,
                      fontSize: 11.5,
                      padding: "3px 8px",
                      borderRadius: 5,
                      border: `1px solid ${C.border}`,
                      background: "#fff",
                      color: C.text,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontWeight: 600,
                    }}
                  >
                    <CheckSquare size={13} color={C.primary} /> Tutti ({params.length})
                  </button>
                  <button
                    id="btn-wfo-deselect-all"
                    type="button"
                    onClick={deselectAllParams}
                    style={{
                      fontFamily: FONT_SANS,
                      fontSize: 11.5,
                      padding: "3px 8px",
                      borderRadius: 5,
                      border: `1px solid ${C.border}`,
                      background: "#fff",
                      color: C.muted,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontWeight: 600,
                    }}
                  >
                    <Square size={13} /> Nessuno (0)
                  </button>
                  <button
                    id="btn-wfo-select-thresholds"
                    type="button"
                    onClick={selectThresholdsOnly}
                    style={{
                      fontFamily: FONT_SANS,
                      fontSize: 11.5,
                      padding: "3px 8px",
                      borderRadius: 5,
                      border: `1px solid ${C.border}`,
                      background: "#fff",
                      color: C.text,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Solo Soglie Segnale
                  </button>
                  <button
                    id="btn-wfo-select-risk"
                    type="button"
                    onClick={selectRiskOnly}
                    style={{
                      fontFamily: FONT_SANS,
                      fontSize: 11.5,
                      padding: "3px 8px",
                      borderRadius: 5,
                      border: `1px solid ${C.border}`,
                      background: "#fff",
                      color: C.text,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Solo Money Mgmt / SL / TP
                  </button>
                </div>

                {/* Grid of parameters */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
                  {params.map((p) => {
                    const isSelected = selectedParamIds.includes(p.id);
                    const cfg = sweepConfigs[p.id] || { min: p.suggestMin, max: p.suggestMax, steps: 5 };
                    const gridVals = getParamGridValues(p, cfg);

                    return (
                      <div
                        key={p.id}
                        id={`wfo-param-card-${p.id}`}
                        style={{
                          background: isSelected ? "#FFFFFF" : "#F4F3EE",
                          border: `1.5px solid ${isSelected ? C.primary : C.border}`,
                          borderRadius: 7,
                          padding: "10px 12px",
                          transition: "all 0.15s ease",
                          opacity: isSelected ? 1 : 0.65,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", flex: 1 }}>
                            <input
                              id={`checkbox-wfo-param-${p.id}`}
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleParam(p.id)}
                              style={{ marginTop: 3, width: 16, height: 16, accentColor: C.primary, cursor: "pointer" }}
                            />
                            <div>
                              <div style={{ fontFamily: FONT_SANS, fontSize: 13, fontWeight: 700, color: isSelected ? C.primaryDark : C.text }}>
                                {p.label}
                              </div>
                              <div style={{ fontSize: 11, color: C.muted }}>
                                <span style={{ background: "#EEEEEE", padding: "1px 5px", borderRadius: 3, fontSize: 10, fontWeight: 600, marginRight: 4 }}>
                                  {p.group}
                                </span>
                                Base: <b>{p.currentValue} {p.unit || ""}</b>
                              </div>
                            </div>
                          </label>

                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: 4,
                              fontFamily: FONT_MONO,
                              background: isSelected ? C.primaryLight : "#E2E0D8",
                              color: isSelected ? C.primaryDark : C.muted,
                            }}
                          >
                            {isSelected ? `${cfg.steps || 5} step` : "Fisso"}
                          </span>
                        </div>

                        {/* Range & Step configuration */}
                        {showParamConfig && (
                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}`, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                            <div>
                              <label style={{ fontSize: 10, color: C.muted, display: "block", marginBottom: 2 }}>Min</label>
                              <input
                                id={`input-wfo-min-${p.id}`}
                                type="number"
                                step="any"
                                value={cfg.min}
                                onChange={(e) => updateParamSweep(p.id, { min: parseFloat(e.target.value) || 0 })}
                                style={{ ...inputStyle, padding: "3px 6px", fontSize: 11.5 }}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: 10, color: C.muted, display: "block", marginBottom: 2 }}>Max</label>
                              <input
                                id={`input-wfo-max-${p.id}`}
                                type="number"
                                step="any"
                                value={cfg.max}
                                onChange={(e) => updateParamSweep(p.id, { max: parseFloat(e.target.value) || 0 })}
                                style={{ ...inputStyle, padding: "3px 6px", fontSize: 11.5 }}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: 10, color: C.muted, display: "block", marginBottom: 2 }}>Passi</label>
                              <input
                                id={`input-wfo-steps-${p.id}`}
                                type="number"
                                min="2"
                                max="20"
                                value={cfg.steps || 5}
                                onChange={(e) => updateParamSweep(p.id, { steps: parseInt(e.target.value, 10) || 5 })}
                                style={{ ...inputStyle, padding: "3px 6px", fontSize: 11.5 }}
                              />
                            </div>
                          </div>
                        )}

                        {isSelected && (
                          <div style={{ marginTop: 6, fontSize: 10.5, color: C.muted, fontFamily: FONT_MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            Valori test: [{gridVals.slice(0, 5).join(", ")}{gridVals.length > 5 ? ", …" : ""}]
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {selectedParamIds.length === 0 && (
                  <div style={{ marginTop: 12, background: C.amberLight, border: `1px solid ${C.amber}66`, borderRadius: 6, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.amber }}>
                    <AlertTriangle size={15} />
                    Seleziona almeno un parametro da includere nell'analisi Walk-Forward Optimization.
                  </div>
                )}
              </div>

              {/* Optimization Objective Selector */}
              <div style={{ background: "#F9FBF8", border: `1px solid ${C.primary}33`, borderRadius: 8, padding: "14px 16px", marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontFamily: FONT_SANS, fontSize: 13, fontWeight: 700, color: C.primaryDark }}>
                    Funzione Obiettivo di Ottimizzazione IS (per ciascun Fold)
                  </span>
                  <span style={{ fontSize: 11.5, color: C.muted, background: C.primaryLight, padding: "2px 8px", borderRadius: 4 }}>
                    {selectedParamIds.length} parametri scansionati per ogni finestra
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8 }}>
                  {OPTIM_OBJECTIVES.map((obj) => (
                    <label
                      key={obj.key}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 8,
                        background: selectedObjFn === obj.key ? "#FFFFFF" : "#FAF9F5",
                        border: `1.5px solid ${selectedObjFn === obj.key ? C.primary : C.border}`,
                        padding: "8px 12px",
                        borderRadius: 6,
                        cursor: "pointer",
                        transition: "border 0.15s ease",
                      }}
                    >
                      <input
                        type="radio"
                        name="wfoObj"
                        checked={selectedObjFn === obj.key}
                        onChange={() => setSelectedObjFn(obj.key)}
                        style={{ marginTop: 2, accentColor: C.primary }}
                      />
                      <div>
                        <div style={{ fontFamily: FONT_SANS, fontSize: 12.5, fontWeight: 700, color: C.primaryDark }}>{obj.label}</div>
                        <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.3 }}>{obj.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          <Button
            id="btn-run-wf-execution"
            onClick={() => onRunWalkForward(activeTab, selectedObjFn, selectedParamIds)}
            disabled={running || (activeTab === "wfo" && selectedParamIds.length === 0)}
            icon={running ? Loader2 : PlayCircle}
          >
            {running
              ? "Esecuzione Walk-Forward in corso..."
              : activeTab === "wfo"
              ? `Esegui Walk-Forward Optimization (${selectedParamIds.length} parametr${selectedParamIds.length === 1 ? "o" : "i"})`
              : `Esegui Walk-Forward (${activeTab === "opt" ? "Ottimizzato Step 6" : "Base"})`}
          </Button>
        </div>
      </Card>

      {/* Results Section */}
      {wfResult && (
        <>
          {/* COMPREHENSIVE ROBUSTNESS SCORECARD & VERDICT */}
          {robustnessAssessment && (
            <Card
              style={{
                marginBottom: 20,
                border: `1.5px solid ${robustnessAssessment.grade.borderColor}`,
                background: "#FFFFFF",
                boxShadow: "0 4px 16px rgba(0,0,0,0.04)",
                overflow: "hidden",
                padding: 0,
              }}
            >
              {/* Header Banner */}
              <div
                style={{
                  background: robustnessAssessment.grade.bgColor,
                  borderBottom: `1px solid ${robustnessAssessment.grade.borderColor}`,
                  padding: "16px 20px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 12,
                      background: "#FFFFFF",
                      border: `2px solid ${robustnessAssessment.grade.borderColor}`,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
                    }}
                  >
                    <Award size={22} color={robustnessAssessment.grade.color} />
                    <span style={{ fontSize: 9.5, fontWeight: 800, fontFamily: FONT_MONO, color: robustnessAssessment.grade.color }}>
                      {robustnessAssessment.totalScore}/100
                    </span>
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: "0.04em",
                          fontFamily: FONT_SANS,
                          color: "#FFFFFF",
                          background: robustnessAssessment.grade.color,
                          padding: "2px 8px",
                          borderRadius: 4,
                          textTransform: "uppercase",
                        }}
                      >
                        {robustnessAssessment.grade.label}
                      </span>
                      <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 600 }}>
                        Score Complessivo di Robustezza Walk-Forward
                      </span>
                    </div>
                    <h3
                      style={{
                        fontFamily: FONT_SERIF,
                        fontSize: 19,
                        color: robustnessAssessment.grade.color,
                        margin: "4px 0 0",
                        fontWeight: 700,
                      }}
                    >
                      {robustnessAssessment.grade.verdict}
                    </h3>
                  </div>
                </div>

                {/* Main Score Gauge */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    background: "#FFFFFF",
                    padding: "8px 16px",
                    borderRadius: 10,
                    border: `1px solid ${robustnessAssessment.grade.borderColor}`,
                    boxShadow: "0 2px 5px rgba(0,0,0,0.03)",
                  }}
                >
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 700, textTransform: "uppercase" }}>Punteggio Finale</div>
                    <div style={{ fontSize: 11, color: robustnessAssessment.grade.color, fontWeight: 600 }}>
                      {robustnessAssessment.totalScore >= 70 ? "Validazione Superata ✓" : "Rischio Overfit ⚠️"}
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 32,
                      fontWeight: 900,
                      color: robustnessAssessment.grade.color,
                      lineHeight: 1,
                    }}
                  >
                    {robustnessAssessment.totalScore}
                    <span style={{ fontSize: 16, fontWeight: 600, color: C.muted }}>/100</span>
                  </div>
                </div>
              </div>

              {/* Textual Narrative & Operational Advice */}
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
                  <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.primaryDark, textTransform: "uppercase", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                      <Activity size={14} /> Giudizio Diagnostico Out-Of-Sample
                    </div>
                    <p style={{ fontSize: 12.5, color: C.text, lineHeight: 1.45, margin: 0 }}>
                      {robustnessAssessment.grade.description}
                    </p>
                  </div>
                  <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: C.primaryDark, textTransform: "uppercase", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                      <Compass size={14} /> Raccomandazione Operativa
                    </div>
                    <p style={{ fontSize: 12.5, color: C.text, lineHeight: 1.45, margin: 0 }}>
                      {robustnessAssessment.grade.recommendation}
                    </p>
                  </div>
                </div>
              </div>

              {/* Detailed Breakdown of Component Sub-Scores */}
              <div style={{ padding: "16px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
                  <h4 style={{ fontFamily: FONT_SERIF, fontSize: 15, color: C.primaryDark, margin: 0, display: "flex", alignItems: "center", gap: 7 }}>
                    <Target size={16} color={C.primaryDark} /> Dettaglio dei Punteggi per Categoria Analitica
                  </h4>
                  <span style={{ fontSize: 11, color: C.muted }}>
                    Somma ponderata su 5 dimensioni critiche di validazione statistica
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
                  {robustnessAssessment.subScores.map((item) => {
                    const pct = (item.score / item.maxScore) * 100;
                    const statusColor = item.status === "optimal" ? C.primary : item.status === "acceptable" ? C.amber : C.red;
                    const statusBg = item.status === "optimal" ? C.primaryLight : item.status === "acceptable" ? C.amberLight : C.redLight;

                    return (
                      <div
                        key={item.id}
                        style={{
                          background: "#FAF9F5",
                          border: `1px solid ${C.border}`,
                          borderRadius: 8,
                          padding: "12px 14px",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6, marginBottom: 4 }}>
                            <span style={{ fontFamily: FONT_SANS, fontSize: 12, fontWeight: 700, color: C.text }}>
                              {item.title}
                            </span>
                            <span
                              style={{
                                fontFamily: FONT_MONO,
                                fontSize: 12,
                                fontWeight: 800,
                                color: statusColor,
                                background: statusBg,
                                padding: "1px 6px",
                                borderRadius: 4,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {item.score} / {item.maxScore} pt
                            </span>
                          </div>

                          {/* Progress Bar */}
                          <div style={{ width: "100%", height: 6, background: "#EAE8E0", borderRadius: 3, overflow: "hidden", margin: "6px 0" }}>
                            <div
                              style={{
                                width: `${Math.min(100, Math.max(0, pct))}%`,
                                height: "100%",
                                background: statusColor,
                                borderRadius: 3,
                              }}
                            />
                          </div>

                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: C.muted, marginTop: 2 }}>
                            <span style={{ fontFamily: FONT_MONO, fontWeight: 700, color: C.primaryDark }}>{item.valueFormatted}</span>
                            <span style={{ fontSize: 10, color: C.muted }}>{item.targetText}</span>
                          </div>
                        </div>

                        <div style={{ fontSize: 10.5, color: C.muted, marginTop: 8, borderTop: `1px solid ${C.border}88`, paddingTop: 6, lineHeight: 1.3 }}>
                          {item.hint}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          )}

          {/* Executive KPI Summary */}
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 8 }}>
              <KPI
                label="Efficiency Ratio (OOS / IS)"
                value={wfResult.efficiencyRatio != null ? fmtNum(wfResult.efficiencyRatio, 2) : "n/d"}
                negative={wfResult.efficiencyRatio != null && wfResult.efficiencyRatio < 0.5}
              />
              <KPI label="Numero di Fold / Finestre" value={wfResult.nFolds} />
              <KPI
                label="Rendimento IS Mediano"
                value={wfResult.degradation.totalReturnPct?.is != null ? fmtPct(wfResult.degradation.totalReturnPct.is) : "n/d"}
              />
              <KPI
                label="Rendimento OOS Mediano"
                value={wfResult.degradation.totalReturnPct?.oos != null ? fmtPct(wfResult.degradation.totalReturnPct.oos) : "n/d"}
                negative={wfResult.degradation.totalReturnPct?.oos != null && wfResult.degradation.totalReturnPct.oos < 0}
              />
            </div>
            <div style={{ fontSize: 11.5, color: C.muted }}>
              Un Efficiency Ratio vicino a 1.0 (o &gt; 0.6) indica che la strategia mantiene le sue prestazioni sui dati fuori campione.
            </div>
          </Card>

          {/* DEDICATED WFO OPTIMAL PARAMETERS SECTION */}
          {isWfoResult && wfResult.wfoParamSummaries && wfResult.wfoParamSummaries.length > 0 && (
            <Card style={{ marginBottom: 20, border: `1.5px solid ${C.primary}`, background: "#FFFFFF", boxShadow: "0 4px 12px rgba(0,0,0,0.03)" }}>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Sparkles size={20} color={C.primary} />
                    <h3 style={{ fontFamily: FONT_SERIF, fontSize: 18, color: C.primaryDark, margin: 0 }}>
                      Valori Ottimali WFO per Ciascun Parametro Analizzato
                    </h3>
                  </div>
                  <p style={{ fontSize: 12.5, color: C.muted, margin: "4px 0 0" }}>
                    Riepilogo dei valori ottimali identificati dal motore Walk-Forward Optimization attraverso tutti i {wfResult.nFolds} cicli di ri-ottimizzazione Out-Of-Sample.
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11.5, fontFamily: FONT_MONO, background: C.primaryLight, color: C.primaryDark, padding: "4px 10px", borderRadius: 6, fontWeight: 700 }}>
                    {wfResult.wfoParamSummaries.length} parametri analizzati
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowFoldMatrix((prev) => !prev)}
                    style={{
                      fontFamily: FONT_SANS,
                      fontSize: 12,
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: `1px solid ${C.border}`,
                      background: "#fff",
                      color: C.text,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      fontWeight: 600,
                    }}
                  >
                    <Layers size={13} />
                    {showFoldMatrix ? "Nascondi matrice fold" : "Mostra matrice per fold"}
                  </button>
                </div>
              </div>

              {/* Table of Parameter Summaries */}
              <div style={{ overflowX: "auto", marginBottom: 20 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ background: "#F6F5F0" }}>
                      <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Parametro</th>
                      <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Gruppo</th>
                      <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Valore Base</th>
                      <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.primaryDark, fontSize: 11 }}>Valore Mediano (Consigliato WFO)</th>
                      <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Media Folds</th>
                      <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Range (Min – Max)</th>
                      <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Ultimo Fold</th>
                      <th style={{ textAlign: "right", padding: "8px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Variazione vs Base</th>
                      <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Stabilità Parametrica</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wfResult.wfoParamSummaries.map((ps: WfoParamSummary) => {
                      const diff = ps.medianValue - ps.baseValue;
                      const pctDiff = ps.baseValue !== 0 ? (diff / Math.abs(ps.baseValue)) * 100 : 0;
                      const isSelectedForChart = selectedParamForTrajectory === ps.param.id;

                      const stabBg = ps.stabilityLabel === "Alta" ? C.primaryLight : ps.stabilityLabel === "Media" ? C.amberLight : C.redLight;
                      const stabFg = ps.stabilityLabel === "Alta" ? C.primaryDark : ps.stabilityLabel === "Media" ? C.amber : C.red;

                      return (
                        <tr
                          key={ps.param.id}
                          onClick={() => setSelectedParamForTrajectory(ps.param.id)}
                          style={{
                            borderBottom: `1px solid ${C.border}`,
                            background: isSelectedForChart ? "#F3F8F2" : "transparent",
                            cursor: "pointer",
                            transition: "background 0.1s",
                          }}
                        >
                          <td style={{ padding: "8px 10px", fontWeight: 700, color: C.primaryDark }}>
                            {ps.param.label}
                          </td>
                          <td style={{ padding: "8px 10px" }}>
                            <span style={{ background: "#EEEEEA", color: C.muted, padding: "2px 6px", borderRadius: 4, fontSize: 10.5, fontWeight: 600 }}>
                              {ps.param.group}
                            </span>
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: FONT_MONO, color: C.muted }}>
                            {ps.baseValue}
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: FONT_MONO, fontWeight: 800, color: C.primaryDark, background: "rgba(46, 125, 50, 0.06)" }}>
                            {ps.medianValue} {ps.param.unit || ""}
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: FONT_MONO, color: C.text }}>
                            {ps.meanValue}
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: FONT_MONO, color: C.muted, fontSize: 11.5 }}>
                            [{ps.minValue}, {ps.maxValue}]
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: FONT_MONO, fontWeight: 600, color: C.text }}>
                            {ps.latestValue}
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: FONT_MONO, fontSize: 11.5 }}>
                            {diff === 0 ? (
                              <span style={{ color: C.muted }}>0.0%</span>
                            ) : (
                              <span style={{ color: diff > 0 ? C.primaryDark : C.amber, fontWeight: 700 }}>
                                {diff > 0 ? "+" : ""}{pctDiff.toFixed(1)}%
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "center" }}>
                            <span style={{ background: stabBg, color: stabFg, padding: "2px 8px", borderRadius: 4, fontWeight: 700, fontSize: 11, fontFamily: FONT_MONO }}>
                              {ps.stabilityLabel} ({ps.stabilityScore}%)
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Fold-by-Fold Parameter Matrix */}
              {showFoldMatrix && (
                <div style={{ marginBottom: 22, background: "#FBFBFA", border: `1px solid ${C.border}`, borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
                    <h4 style={{ fontFamily: FONT_SANS, fontSize: 13, textTransform: "uppercase", letterSpacing: ".03em", color: C.primaryDark, margin: 0 }}>
                      Matrice dei Valori Ottimali per Singolo Fold
                    </h4>
                    <span style={{ fontSize: 11.5, color: C.muted }}>
                      Mostra il valore ottimale selezionato dall'analisi In-Sample in ciascuna specifica finestra
                    </span>
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#F0EFEB" }}>
                          <th style={{ textAlign: "left", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Parametro</th>
                          <th style={{ textAlign: "right", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Base</th>
                          {wfResult.results.map((r, idx) => (
                            <th key={idx} style={{ textAlign: "right", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.primaryDark, fontSize: 11 }}>
                              {r.label}
                            </th>
                          ))}
                          <th style={{ textAlign: "right", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.primaryDark, fontSize: 11, background: C.primaryLight }}>
                            Mediana WFO
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {wfResult.wfoParamSummaries.map((ps) => (
                          <tr key={ps.param.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                            <td style={{ padding: "7px 10px", fontWeight: 600, color: C.text }}>
                              {ps.param.label}
                            </td>
                            <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: FONT_MONO, color: C.muted }}>
                              {ps.baseValue}
                            </td>
                            {wfResult.results.map((r, idx) => {
                              const fo = r.foldOptima?.find((item) => item.param.id === ps.param.id);
                              const val = fo?.optimalValue ?? ps.param.currentValue;
                              const isDifferent = val !== ps.baseValue;
                              return (
                                <td key={idx} style={{ padding: "7px 10px", textAlign: "right", fontFamily: FONT_MONO, fontWeight: isDifferent ? 700 : 500, color: isDifferent ? C.primaryDark : C.muted }}>
                                  {val}
                                </td>
                              );
                            })}
                            <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: FONT_MONO, fontWeight: 800, color: C.primaryDark, background: "rgba(46, 125, 50, 0.07)" }}>
                              {ps.medianValue}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Parameter Stability Trajectory Chart */}
              {activeTrajectoryParam && (
                <div style={{ marginTop: 14, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <h4 style={{ fontFamily: FONT_SERIF, fontSize: 15, color: C.primaryDark, margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
                        <TrendingUp size={16} /> Traiettoria Parametrica nel Tempo: <b>{activeTrajectoryParam.param.label}</b>
                      </h4>
                      <span style={{ fontSize: 11.5, color: C.muted }}>
                        Evoluzione del valore ottimale riscontrato fold per fold rispetto al valore base ({activeTrajectoryParam.param.currentValue}) e alla mediana ({activeTrajectoryParam.medianValue})
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11.5, color: C.muted }}>Seleziona parametro:</span>
                      <select
                        id="select-trajectory-param"
                        value={activeTrajectoryParam.param.id}
                        onChange={(e) => setSelectedParamForTrajectory(e.target.value)}
                        style={{ ...inputStyle, padding: "3px 8px", fontSize: 12, fontWeight: 600 }}
                      >
                        {wfResult.wfoParamSummaries.map((ps) => (
                          <option key={ps.param.id} value={ps.param.id}>
                            {ps.param.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={trajectoryChartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="fold" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 10.5 }} width={45} domain={['auto', 'auto']} />
                      <Tooltip formatter={(v: any, name: any) => [v, name === "optimalValue" ? "Ottimo Fold" : name === "baseValue" ? "Valore Base" : "Mediana WFO"]} />
                      <ReferenceLine y={activeTrajectoryParam.baseValue} stroke="#999" strokeDasharray="3 3" label={{ value: "Base", fontSize: 10, fill: "#888", position: "right" }} />
                      <ReferenceLine y={activeTrajectoryParam.medianValue} stroke={C.primary} strokeDasharray="4 4" label={{ value: "Mediana", fontSize: 10, fill: C.primary, position: "right" }} />
                      <Line type="monotone" dataKey="optimalValue" stroke={C.primaryDark} strokeWidth={2.5} dot={{ r: 5, fill: C.primaryDark }} activeDot={{ r: 7 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Robustness Recommendation Box */}
              <div style={{ background: "#EEF4EC", border: `1px solid ${C.primary}44`, borderRadius: 8, padding: "12px 16px", marginTop: 18, display: "flex", gap: 12, alignItems: "flex-start" }}>
                <ShieldCheck size={20} color={C.primaryDark} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 12.5, color: C.text, lineHeight: 1.45 }}>
                  <b>Interpretazione dei Parametri WFO per il Trading Live:</b> I parametri con <b>Alta stabilità</b> mostrano una forte coerenza strutturale nel tempo e rappresentano la scelta più robusta per l'operatività reale. Il valore <b>Mediano WFO</b> filtra le anomalie temporanee e protegge contro l'overfitting.
                </div>
              </div>
            </Card>
          )}

          {/* Comprehensive Chained OOS Metrics & Performance Suite */}
          <Card style={{ marginBottom: 20, border: `1.5px solid ${C.primaryDark}33`, background: "#FFFFFF", boxShadow: "0 4px 14px rgba(0,0,0,0.03)" }}>
            {/* Section Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h3 style={{ fontFamily: FONT_SERIF, fontSize: 17, color: C.primaryDark, margin: 0, display: "flex", alignItems: "center", gap: 7 }}>
                    <Layers size={18} color={C.primaryDark} /> Metriche &amp; Performance Chained Out-Of-Sample (OOS)
                  </h3>
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: C.primaryLight, color: C.primaryDark }}>
                    Dati Fuori Campione
                  </span>
                </div>
                <p style={{ fontSize: 12.5, color: C.muted, marginTop: 4, marginBottom: 0 }}>
                  Valutazione complessiva delle prestazioni e del profilo di rischio concatenando esclusivamente tutti i periodi Out-Of-Sample (dati mai visti dalla strategia né in training né durante l'ottimizzazione).
                </p>
              </div>

              {/* Chart Switcher Buttons */}
              <div style={{ display: "flex", background: "#F4F3EE", padding: 3, borderRadius: 6, gap: 2, flexWrap: "wrap" }}>
                <button
                  id="btn-view-chained-equity"
                  type="button"
                  onClick={() => setChainedChartView("equity")}
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 11.5,
                    fontWeight: chainedChartView === "equity" ? 700 : 500,
                    padding: "4px 10px",
                    borderRadius: 5,
                    border: "none",
                    background: chainedChartView === "equity" ? "#FFFFFF" : "transparent",
                    color: chainedChartView === "equity" ? C.primaryDark : C.muted,
                    boxShadow: chainedChartView === "equity" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <TrendingUp size={13} /> Curva Equity OOS
                </button>
                <button
                  id="btn-view-chained-underwater"
                  type="button"
                  onClick={() => setChainedChartView("underwater")}
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 11.5,
                    fontWeight: chainedChartView === "underwater" ? 700 : 500,
                    padding: "4px 10px",
                    borderRadius: 5,
                    border: "none",
                    background: chainedChartView === "underwater" ? "#FFFFFF" : "transparent",
                    color: chainedChartView === "underwater" ? C.primaryDark : C.muted,
                    boxShadow: chainedChartView === "underwater" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <TrendingDown size={13} /> Curva Underwater (DD %)
                </button>
                <button
                  id="btn-view-chained-distribution"
                  type="button"
                  onClick={() => setChainedChartView("distribution")}
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 11.5,
                    fontWeight: chainedChartView === "distribution" ? 700 : 500,
                    padding: "4px 10px",
                    borderRadius: 5,
                    border: "none",
                    background: chainedChartView === "distribution" ? "#FFFFFF" : "transparent",
                    color: chainedChartView === "distribution" ? C.primaryDark : C.muted,
                    boxShadow: chainedChartView === "distribution" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <BarChart2 size={13} /> Distribuzione Drawdown
                </button>
                <button
                  id="btn-view-chained-windows"
                  type="button"
                  onClick={() => setChainedChartView("windows")}
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 11.5,
                    fontWeight: chainedChartView === "windows" ? 700 : 500,
                    padding: "4px 10px",
                    borderRadius: 5,
                    border: "none",
                    background: chainedChartView === "windows" ? "#FFFFFF" : "transparent",
                    color: chainedChartView === "windows" ? C.primaryDark : C.muted,
                    boxShadow: chainedChartView === "windows" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <Layers size={13} /> Rendimento Finestre OOS
                </button>
              </div>
            </div>

            {/* 12 Key Chained OOS Metrics Grid */}
            {chainedMetrics && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10, marginBottom: 18 }}>
                {/* 1. OOS CAGR */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>OOS CAGR</span>
                    <span style={{ fontSize: 10, color: C.primaryDark, background: C.primaryLight, padding: "1px 5px", borderRadius: 3 }}>Annuo</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: (chainedMetrics.cagr ?? 0) >= 0 ? C.primaryDark : C.red, marginTop: 4 }}>
                    {chainedMetrics.cagr != null ? fmtPct(chainedMetrics.cagr) : "—"}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>Tasso di crescita composto OOS</div>
                </div>

                {/* 2. OOS Net Profit */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>OOS Net Profit</span>
                    <span style={{ fontSize: 10, color: chainedMetrics.netProfit >= 0 ? C.primaryDark : C.red }}>{fmtPct(chainedMetrics.netProfitPct)}</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: chainedMetrics.netProfit >= 0 ? C.primaryDark : C.red, marginTop: 4 }}>
                    {fmtMoney(chainedMetrics.netProfit)}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>Profitto netto cumulato OOS</div>
                </div>

                {/* 3. OOS Profit Factor */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>OOS Profit Factor</span>
                    <span style={{ fontSize: 10, color: C.muted }}>Target &gt; 1.3</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: chainedMetrics.profitFactor >= 1.3 ? C.primaryDark : chainedMetrics.profitFactor >= 1.0 ? C.amber : C.red, marginTop: 4 }}>
                    {fmtNum(chainedMetrics.profitFactor, 2)}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>Profitti lordi / Perdite lorde</div>
                </div>

                {/* 4. OOS Sharpe */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>OOS Sharpe</span>
                    <span style={{ fontSize: 10, color: C.muted }}>Annualizzato</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: chainedMetrics.sharpeAnnual >= 1.0 ? C.primaryDark : chainedMetrics.sharpeAnnual >= 0.5 ? C.amber : C.red, marginTop: 4 }}>
                    {fmtNum(chainedMetrics.sharpeAnnual, 2)}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>Rendimento / Volatilità OOS</div>
                </div>

                {/* 5. OOS Sortino */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>OOS Sortino</span>
                    <span style={{ fontSize: 10, color: C.muted }}>Downside Risk</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: chainedMetrics.sortinoAnnual >= 1.5 ? C.primaryDark : chainedMetrics.sortinoAnnual >= 0.8 ? C.amber : C.red, marginTop: 4 }}>
                    {fmtNum(chainedMetrics.sortinoAnnual, 2)}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>Rapporto rischio asimmetrico</div>
                </div>

                {/* 6. Maximum Drawdown */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>Maximum Drawdown</span>
                    <span style={{ fontSize: 10, color: C.red }}>{fmtMoney(chainedMetrics.maxDD)}</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: C.red, marginTop: 4 }}>
                    {fmtPct(chainedMetrics.maxDDPct)}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>Picco-valle massimo Chained OOS</div>
                </div>

                {/* 7. Recovery Factor */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>Recovery Factor</span>
                    <span style={{ fontSize: 10, color: C.muted }}>Net Profit / MaxDD</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: chainedMetrics.recoveryFactor >= 2.0 ? C.primaryDark : chainedMetrics.recoveryFactor >= 1.0 ? C.amber : C.red, marginTop: 4 }}>
                    {fmtNum(chainedMetrics.recoveryFactor, 2)}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>Capacità di recupero dai drawdown</div>
                </div>

                {/* 8. % Finestre OOS Profittevoli */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>% Finestre Profittevoli</span>
                    <span style={{ fontSize: 10, color: C.muted }}>{chainedMetrics.profitableWindowsCount}/{chainedMetrics.totalWindowsCount} fold</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: chainedMetrics.pctProfitableWindows >= 70 ? C.primaryDark : chainedMetrics.pctProfitableWindows >= 50 ? C.amber : C.red, marginTop: 4 }}>
                    {fmtPct(chainedMetrics.pctProfitableWindows / 100)}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>Frazione finestre OOS in utile</div>
                </div>

                {/* 9. Median OOS Return */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>Median OOS Return</span>
                    <span style={{ fontSize: 10, color: C.muted }}>Per Finestra</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: (chainedMetrics.medianOosReturnPct ?? 0) >= 0 ? C.primaryDark : C.red, marginTop: 4 }}>
                    {chainedMetrics.medianOosReturnPct != null ? fmtPct(chainedMetrics.medianOosReturnPct) : "—"}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>Rendimento OOS tipico per fold</div>
                </div>

                {/* 10. Worst OOS Window */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>Worst OOS Window</span>
                    <span style={{ fontSize: 10, color: C.muted }}>{chainedMetrics.worstWindow?.label || "—"}</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: (chainedMetrics.worstWindow?.returnPct ?? 0) >= 0 ? C.primaryDark : C.red, marginTop: 4 }}>
                    {chainedMetrics.worstWindow ? fmtPct(chainedMetrics.worstWindow.returnPct) : "—"}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                    {chainedMetrics.worstWindow ? fmtMoney(chainedMetrics.worstWindow.pnl) : "Nessun dato"}
                  </div>
                </div>

                {/* 11. Numero di Trade OOS */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>Numero di Trade OOS</span>
                    <span style={{ fontSize: 10, color: C.primaryDark, fontWeight: 700 }}>WR: {fmtPct(chainedMetrics.winRate)}</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: C.text, marginTop: 4 }}>
                    {chainedMetrics.totalTrades}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                    {chainedMetrics.winCount}V · {chainedMetrics.lossCount}P (Attesa: {fmtMoney(chainedMetrics.expectancy)})
                  </div>
                </div>

                {/* 12. Drawdown Medio & Max Durata */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>Drawdown Medio &amp; Durata</span>
                    <span style={{ fontSize: 10, color: C.muted }}>Recupero</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: C.text, marginTop: 4 }}>
                    {fmtPct(chainedMetrics.avgDrawdownPct)}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                    Max durata DD: {Math.round(chainedMetrics.maxDrawdownDurationDays)} giorni
                  </div>
                </div>
              </div>
            )}

            {/* Dynamic Active Chart Area */}
            <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
              {/* View 1: Chained OOS Equity Curve */}
              {chainedChartView === "equity" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: FONT_SANS, color: C.primaryDark }}>
                      Evoluzione del Capitale Concatenato Out-Of-Sample (Chained Equity Curve)
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>
                      Capitale Iniziale: {fmtMoney(mm.initialCapital)} · Finale: <b>{fmtMoney(mm.initialCapital + (chainedMetrics?.netProfit ?? 0))}</b>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chainChartData} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="dt" tickFormatter={fmtDT} tick={{ fontSize: 9.5 }} minTickGap={60} />
                      <YAxis tickFormatter={(v) => (v / 1000).toFixed(0) + "k €"} tick={{ fontSize: 10 }} width={48} domain={['auto', 'auto']} />
                      <Tooltip labelFormatter={fmtDT} formatter={(v: any) => [fmtMoney(v), "Equity OOS"]} />
                      <ReferenceLine y={mm.initialCapital} stroke="#999" strokeDasharray="4 4" label={{ value: "Iniziale", fontSize: 9.5, fill: "#888", position: "right" }} />
                      <Line type="monotone" dataKey="equity" stroke={C.primary} dot={false} strokeWidth={2.2} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* View 2: Underwater Drawdown Curve */}
              {chainedChartView === "underwater" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: FONT_SANS, color: C.red }}>
                      Curva Underwater (% Drawdown dal Massimo nel Tempo su Dati OOS)
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>
                      Max Drawdown OOS: <b>{fmtPct(chainedMetrics?.maxDDPct ?? 0)}</b> ({fmtMoney(chainedMetrics?.maxDD ?? 0)})
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={underwaterChartData} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="dt" tickFormatter={fmtDT} tick={{ fontSize: 9.5 }} minTickGap={60} />
                      <YAxis tickFormatter={(v) => (-v * 100).toFixed(0) + "%"} tick={{ fontSize: 10 }} width={45} domain={[0, 'auto']} />
                      <Tooltip labelFormatter={fmtDT} formatter={(v: any) => [`-${(Number(v) * 100).toFixed(2)}%`, "Drawdown OOS"]} />
                      <ReferenceLine y={0} stroke="#999" />
                      <ReferenceLine y={chainedMetrics?.maxDDPct ?? 0} stroke={C.red} strokeDasharray="3 3" label={{ value: `Max: -${((chainedMetrics?.maxDDPct ?? 0) * 100).toFixed(1)}%`, fontSize: 9.5, fill: C.red, position: "right" }} />
                      <Area type="monotone" dataKey="drawdownPct" stroke={C.red} fill="rgba(198, 40, 40, 0.22)" strokeWidth={1.8} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* View 3: Drawdown Distribution Histogram */}
              {chainedChartView === "distribution" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: FONT_SANS, color: C.primaryDark }}>
                      Distribuzione dei Drawdown per Fascia di Profondità (% di Tempo in DD)
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>
                      Indica per quanto tempo il conto è rimasto in ciascun intervallo di drawdown
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chainedMetrics?.drawdownBuckets || []} margin={{ top: 15, right: 15, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="rangeLabel" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={(v) => v.toFixed(0) + "%"} tick={{ fontSize: 10 }} width={42} />
                      <Tooltip formatter={(v: any, name: any, item: any) => [`${Number(v).toFixed(1)}% del tempo (${item.payload.count} campioni)`, "Tempo trascorso"]} />
                      <Bar dataKey="pctOfTime" name="% Tempo Trascorso" radius={[4, 4, 0, 0]}>
                        {(chainedMetrics?.drawdownBuckets || []).map((entry, index) => {
                          const color = index === 0 ? C.primary : index === 1 ? "#558B2F" : index === 2 ? C.amber : index === 3 ? "#E65100" : C.red;
                          return <Cell key={`cell-${index}`} fill={color} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* View 4: Fold-by-Fold OOS Returns */}
              {chainedChartView === "windows" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: FONT_SANS, color: C.primaryDark }}>
                      Rendimento OOS per Singola Finestra Temporale (Fold)
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>
                      Finestre OOS in Profitto: <b>{chainedMetrics?.profitableWindowsCount} su {chainedMetrics?.totalWindowsCount}</b> ({fmtPct((chainedMetrics?.pctProfitableWindows ?? 0) / 100)})
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={oosWindowReturnsChartData} margin={{ top: 15, right: 15, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={(v) => v.toFixed(1) + "%"} tick={{ fontSize: 10 }} width={45} />
                      <Tooltip formatter={(v: any, name: any, item: any) => [`${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(2)}% (${fmtMoney(item.payload.pnl)}) · ${item.payload.n} trade · PF: ${item.payload.pf ? item.payload.pf.toFixed(2) : "—"}`, "Rendimento OOS"]} labelFormatter={(l: any, p: any) => `${l}: ${p?.[0]?.payload?.period || ""}`} />
                      <ReferenceLine y={0} stroke="#666" />
                      <Bar dataKey="returnPct" name="Rendimento OOS %" radius={[3, 3, 0, 0]}>
                        {oosWindowReturnsChartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.isProfitable ? C.primary : C.red} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Detailed Drawdown Distribution Table */}
            {chainedMetrics && chainedMetrics.drawdownBuckets.length > 0 && (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginTop: 6 }}>
                <h4 style={{ fontFamily: FONT_SERIF, fontSize: 14, color: C.primaryDark, margin: "0 0 10px 0", display: "flex", alignItems: "center", gap: 6 }}>
                  <ShieldAlert size={15} /> Tabella di Distribuzione &amp; Persistenza dei Drawdown OOS
                </h4>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: `1.5px solid ${C.border}` }}>
                        <th style={{ textAlign: "left", padding: "6px 10px", fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Fascia di Profondità Drawdown</th>
                        <th style={{ textAlign: "right", padding: "6px 10px", fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Campioni</th>
                        <th style={{ textAlign: "right", padding: "6px 10px", fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>% di Tempo Trascorso</th>
                        <th style={{ textAlign: "left", padding: "6px 10px", fontFamily: FONT_SANS, color: C.muted, fontSize: 11, width: "35%" }}>Distribuzione Visiva</th>
                        <th style={{ textAlign: "left", padding: "6px 10px", fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Diagnosi Rischio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chainedMetrics.drawdownBuckets.map((bucket, idx) => {
                        const barColor = idx === 0 ? C.primary : idx === 1 ? "#558B2F" : idx === 2 ? C.amber : idx === 3 ? "#E65100" : C.red;
                        const diagText =
                          idx === 0 ? "Ottimale: il conto è vicino ai massimi storici o in nuovo picco." :
                          idx === 1 ? "Correzione lieve fisiologica e di normale gestione." :
                          idx === 2 ? "Drawdown moderato: trade in sequenza negativa controllata." :
                          idx === 3 ? "Drawdown significativo: richiede monitoraggio del risk management." :
                          idx === 4 ? "Fase severa: stress test sul capitale operativo." :
                          "Critico: drawdown profondo oltre la soglia prudenziale.";

                        return (
                          <tr key={idx} style={{ borderBottom: `1px solid ${C.border}66`, background: idx % 2 ? "#FAF9F5" : "transparent" }}>
                            <td style={{ padding: "6px 10px", fontWeight: 700, fontFamily: FONT_SANS, color: C.text }}>
                              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: barColor, marginRight: 6 }} />
                              {bucket.rangeLabel}
                            </td>
                            <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: FONT_MONO, color: C.muted }}>
                              {bucket.count}
                            </td>
                            <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: FONT_MONO, fontWeight: 700, color: bucket.pctOfTime > 50 && idx > 1 ? C.red : C.text }}>
                              {bucket.pctOfTime.toFixed(1)}%
                            </td>
                            <td style={{ padding: "6px 10px" }}>
                              <div style={{ width: "100%", height: 7, background: "#EAE8E0", borderRadius: 4, overflow: "hidden" }}>
                                <div style={{ width: `${Math.min(100, Math.max(0, bucket.pctOfTime))}%`, height: "100%", background: barColor, borderRadius: 4 }} />
                              </div>
                            </td>
                            <td style={{ padding: "6px 10px", fontSize: 11, color: C.muted }}>
                              {diagText}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>

          {/* DEDICATED CHAINED OUT-OF-SAMPLE (OOS) MONTE CARLO ANALYSIS CARD */}
          <Card style={{ marginBottom: 20, border: `1.5px solid ${C.primaryDark}33`, background: "#FFFFFF", boxShadow: "0 4px 14px rgba(0,0,0,0.03)" }}>
            {/* Header & Controls */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ background: C.primaryLight, padding: 6, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Shuffle size={19} color={C.primaryDark} />
                  </div>
                  <div>
                    <h3 style={{ fontFamily: FONT_SERIF, fontSize: 18, color: C.primaryDark, margin: 0 }}>
                      Analisi Monte Carlo sulla Chained Out-Of-Sample (OOS)
                    </h3>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                      <span style={{ fontSize: 11, fontFamily: FONT_MONO, background: "#EEEEEA", color: C.primaryDark, padding: "2px 7px", borderRadius: 4, fontWeight: 700 }}>
                        {allOosTrades.length} Trade OOS Concatenati
                      </span>
                      <span style={{ fontSize: 11, fontFamily: FONT_MONO, background: C.primaryLight, color: C.primaryDark, padding: "2px 7px", borderRadius: 4, fontWeight: 700 }}>
                        {oosMcConfig.iterations.toLocaleString("it-IT")} Iterazioni ({oosMcConfig.method})
                      </span>
                    </div>
                  </div>
                </div>
                <p style={{ fontSize: 12.5, color: C.muted, margin: "6px 0 0", maxWidth: 780, lineHeight: 1.4 }}>
                  Stress-test stocastico applicato <b>esclusivamente alla sequenza di trade generati fuori campione</b> ({allOosTrades.length} trade).
                  Valuta l'effetto-ordine (sequencing risk), i corridoi di dispersione dell'equity e la tenuta statistica della strategia in condizioni di mercato mai viste prima dal modello.
                </p>
              </div>

              {/* Action Buttons & Fast Config Controls */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select
                    value={oosMcConfig.iterations}
                    onChange={(e) => setOosMcConfig((prev) => ({ ...prev, iterations: parseInt(e.target.value, 10) }))}
                    style={{ ...inputStyle, padding: "4px 8px", fontSize: 11.5, height: 32, minWidth: 100 }}
                  >
                    <option value={500}>500 iter</option>
                    <option value={1000}>1.000 iter</option>
                    <option value={2000}>2.000 iter</option>
                    <option value={5000}>5.000 iter</option>
                    <option value={10000}>10.000 iter</option>
                  </select>

                  <select
                    value={oosMcConfig.method}
                    onChange={(e) => setOosMcConfig((prev) => ({ ...prev, method: e.target.value as "bootstrap" | "permutation" }))}
                    style={{ ...inputStyle, padding: "4px 8px", fontSize: 11.5, height: 32, minWidth: 120 }}
                  >
                    <option value="bootstrap">Bootstrap</option>
                    <option value="permutation">Permutazione</option>
                  </select>

                  <button
                    type="button"
                    onClick={handleRunOosMonteCarlo}
                    disabled={oosMcRunning || allOosTrades.length === 0}
                    style={{
                      fontFamily: FONT_SANS,
                      fontSize: 12,
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "none",
                      background: C.primary,
                      color: "#fff",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontWeight: 700,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                    }}
                  >
                    {oosMcRunning ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    {oosMcRunning ? "Calcolo..." : "Ricalcola OOS"}
                  </button>
                </div>
              </div>
            </div>

            {/* Small Sample Warning */}
            {allOosTrades.length < 30 && (
              <div style={{ background: C.amberLight, border: `1px solid ${C.amber}55`, borderRadius: 8, padding: "8px 12px", fontSize: 12, marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                <AlertTriangle size={15} color={C.amber} style={{ flexShrink: 0 }} />
                <span>
                  Campione OOS ridotto ({allOosTrades.length} trade): con poche operazioni i corridoi di confidenza Monte Carlo tendono ad allargarsi. I risultati vanno considerati indicativi.
                </span>
              </div>
            )}

            {/* 6 High-Impact Monte Carlo KPI Cards */}
            {oosMcResult && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
                {/* 1. Risk of Ruin */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>Rischio di Rovina OOS</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: oosMcResult.riskOfRuin === 0 ? C.primaryLight : oosMcResult.riskOfRuin <= 0.05 ? C.amberLight : C.redLight,
                        color: oosMcResult.riskOfRuin === 0 ? C.primaryDark : oosMcResult.riskOfRuin <= 0.05 ? C.amber : C.red,
                      }}
                    >
                      {oosMcResult.riskOfRuin === 0 ? "0% Rischio ✓" : oosMcResult.riskOfRuin <= 0.05 ? "Accettabile" : "Critico ⚠️"}
                    </span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: oosMcResult.riskOfRuin > 0.05 ? C.red : C.primaryDark, marginTop: 4 }}>
                    {fmtPct(oosMcResult.riskOfRuin)}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                    Prob. di toccare il -{oosMcConfig.ruinThresholdPct}% del capitale
                  </div>
                </div>

                {/* 2. Prob Positiva */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>Prob. Rendimento &gt; 0</span>
                    <span style={{ fontSize: 10, color: C.muted }}>Successo OOS</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: oosMcResult.probPositive >= 0.85 ? C.primaryDark : oosMcResult.probPositive >= 0.6 ? C.amber : C.red, marginTop: 4 }}>
                    {fmtPct(oosMcResult.probPositive)}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                    Simulazioni chiuse in profitto
                  </div>
                </div>

                {/* 3. Rendimento OOS Mediano */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>Rendimento OOS Mediano</span>
                    <span style={{ fontSize: 10, color: C.muted }}>p50 (Mediana)</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: oosMcResult.returnStats.p50 >= 0 ? C.primaryDark : C.red, marginTop: 4 }}>
                    {fmtPct(oosMcResult.returnStats.p50)}
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                    Banda 90%: {fmtPct(oosMcResult.returnStats.p5)} a {fmtPct(oosMcResult.returnStats.p95)}
                  </div>
                </div>

                {/* 4. Max Drawdown Mediano & Worst-case */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>Max Drawdown OOS</span>
                    <span style={{ fontSize: 10, color: C.red }}>p95 Worst-case</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: C.text, marginTop: 4 }}>
                    {fmtPct(oosMcResult.ddStats.p50)}
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.red, marginLeft: 6 }}>
                      (p95: {fmtPct(oosMcResult.ddStats.p95)})
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                    Mediano vs scenario peggiore 5%
                  </div>
                </div>

                {/* 5. Profit Factor Worst-case */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>OOS Profit Factor (p5)</span>
                    <span style={{ fontSize: 10, color: C.muted }}>Stress 5%</span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: oosMcResult.pfStats.p5 >= 1.2 ? C.primaryDark : oosMcResult.pfStats.p5 >= 1.0 ? C.amber : C.red, marginTop: 4 }}>
                    {fmtNum(oosMcResult.pfStats.p5, 2)}
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, marginLeft: 6 }}>
                      (med: {fmtNum(oosMcResult.pfStats.p50, 2)})
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                    PF minimo nel 95% dei casi
                  </div>
                </div>

                {/* 6. Percentile Sequenza Reale OOS */}
                <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>
                    <span>Collocazione Sequenza Reale</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: oosMcRank >= 25 && oosMcRank <= 75 ? C.primaryLight : oosMcRank > 85 ? C.amberLight : "#EEEEEA",
                        color: oosMcRank >= 25 && oosMcRank <= 75 ? C.primaryDark : oosMcRank > 85 ? C.amber : C.text,
                      }}
                    >
                      {oosMcRank >= 25 && oosMcRank <= 75 ? "Equilibrata ✓" : oosMcRank > 85 ? "Favorita 🍀" : "Prudente"}
                    </span>
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 800, color: C.primaryDark, marginTop: 4 }}>
                    {fmtNum(oosMcRank, 0)}° percentile
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, marginTop: 2 }}>
                    Reale: {chainedMetrics ? fmtPct(chainedMetrics.netProfitPct) : "—"} vs simulazioni
                  </div>
                </div>
              </div>
            )}

            {/* Sub-view Navigation Switcher */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8, borderBottom: `1px solid ${C.border}`, paddingBottom: 10 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", background: "#F1EFE8", padding: 3, borderRadius: 7 }}>
                <button
                  type="button"
                  onClick={() => setOosMcView("fanchart")}
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 12,
                    fontWeight: oosMcView === "fanchart" ? 700 : 500,
                    padding: "4px 10px",
                    borderRadius: 5,
                    border: "none",
                    background: oosMcView === "fanchart" ? "#FFFFFF" : "transparent",
                    color: oosMcView === "fanchart" ? C.primaryDark : C.muted,
                    boxShadow: oosMcView === "fanchart" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <TrendingUp size={13} /> Cono di Confidenza (Fan Chart)
                </button>

                <button
                  type="button"
                  onClick={() => setOosMcView("returns")}
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 12,
                    fontWeight: oosMcView === "returns" ? 700 : 500,
                    padding: "4px 10px",
                    borderRadius: 5,
                    border: "none",
                    background: oosMcView === "returns" ? "#FFFFFF" : "transparent",
                    color: oosMcView === "returns" ? C.primaryDark : C.muted,
                    boxShadow: oosMcView === "returns" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <BarChart2 size={13} /> Distribuzione Rendimenti
                </button>

                <button
                  type="button"
                  onClick={() => setOosMcView("dd")}
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 12,
                    fontWeight: oosMcView === "dd" ? 700 : 500,
                    padding: "4px 10px",
                    borderRadius: 5,
                    border: "none",
                    background: oosMcView === "dd" ? "#FFFFFF" : "transparent",
                    color: oosMcView === "dd" ? C.primaryDark : C.muted,
                    boxShadow: oosMcView === "dd" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <ShieldAlert size={13} /> Distribuzione Max DD
                </button>

                <button
                  type="button"
                  onClick={() => setOosMcView("stats")}
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 12,
                    fontWeight: oosMcView === "stats" ? 700 : 500,
                    padding: "4px 10px",
                    borderRadius: 5,
                    border: "none",
                    background: oosMcView === "stats" ? "#FFFFFF" : "transparent",
                    color: oosMcView === "stats" ? C.primaryDark : C.muted,
                    boxShadow: oosMcView === "stats" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <FileSpreadsheet size={13} /> Tabella Percentili
                </button>
              </div>

              {/* View Status Note */}
              <div style={{ fontSize: 11.5, color: C.muted }}>
                {oosMcView === "fanchart" && "Proiezioni stocastiche dell'equity OOS lungo la sequenza di operazioni"}
                {oosMcView === "returns" && "Istogramma di densità probabilistica dei rendimenti finali OOS"}
                {oosMcView === "dd" && "Istogramma di frequenza della massima perdita picco-valle simulata"}
                {oosMcView === "stats" && "Riepilogo statistico completo dei percentili di rischio e performance"}
              </div>
            </div>

            {/* Dynamic View Content */}
            {oosMcResult && (
              <div style={{ background: "#FAF9F5", border: `1px solid ${C.border}`, borderRadius: 8, padding: "14px 16px", marginBottom: 14 }}>
                {/* View 1: Fan Chart */}
                {oosMcView === "fanchart" && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, fontFamily: FONT_SANS, color: C.primaryDark }}>
                          Cono di Dispersione dell'Equity OOS (Fan Chart)
                        </div>
                        <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>
                          Le fasce colorate evidenziano i corridoi di probabilità dell'equity lungo i {allOosTrades.length} trade OOS; la linea nera è la sequenza reale osservata.
                        </div>
                      </div>

                      {/* Legend */}
                      <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 11, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 12, height: 8, background: C.primary, opacity: 0.16, borderRadius: 2 }} />
                          <span style={{ color: C.muted }}>Banda 5°–95° perc.</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 12, height: 8, background: C.primary, opacity: 0.38, borderRadius: 2 }} />
                          <span style={{ color: C.muted }}>Banda 25°–75° perc.</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 12, height: 2, background: C.amber, borderTop: `2px dashed ${C.amber}` }} />
                          <span style={{ color: C.muted }}>Mediana simulata</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                          <span style={{ width: 12, height: 2.5, background: C.text, borderRadius: 1 }} />
                          <span style={{ color: C.text, fontWeight: 700 }}>Sequenza Reale OOS</span>
                        </div>
                      </div>
                    </div>

                    {oosOutOfBandCount > 0 && (
                      <div style={{ background: C.amberLight, border: `1px solid ${C.amber}55`, borderRadius: 6, padding: "6px 10px", fontSize: 11.5, marginBottom: 10 }}>
                        <AlertTriangle size={12} color={C.amber} style={{ verticalAlign: -1, marginRight: 5 }} />
                        La sequenza reale esce dalla banda di confidenza 5°–95° in {oosOutOfBandCount} trade su {oosFanChartData.length} ({fmtPct(oosOutOfBandPct, 1)}).
                      </div>
                    )}

                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={oosFanChartData} margin={{ top: 10, right: 15, left: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis dataKey="step" tick={{ fontSize: 10 }} label={{ value: "Trade OOS #", position: "insideBottom", offset: -3, fontSize: 10.5, fill: C.muted }} />
                        <YAxis tick={{ fontSize: 10 }} width={54} tickFormatter={(v) => (v / 1000).toFixed(0) + "k €"} domain={['auto', 'auto']} />
                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (!active || !payload || !payload.length) return null;
                            const d = payload[0]?.payload;
                            if (!d) return null;
                            return (
                              <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 12px", fontFamily: FONT_SANS, fontSize: 11.5, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                                <div style={{ fontWeight: 700, color: C.primaryDark, marginBottom: 4 }}>Trade OOS #{label}</div>
                                <div style={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 10, rowGap: 3 }}>
                                  <span style={{ color: C.text, fontWeight: 700 }}>Reale OOS:</span>
                                  <span style={{ fontWeight: 700, color: C.text }}>{d.actual != null ? fmtMoney(d.actual) : "—"}</span>
                                  <span style={{ color: C.amber }}>Mediana simulata:</span>
                                  <span>{fmtMoney(d.p50)}</span>
                                  <span style={{ color: C.muted }}>Banda 25°–75°:</span>
                                  <span>{fmtMoney(d.p25)} – {fmtMoney(d.p75)}</span>
                                  <span style={{ color: C.muted }}>Banda 5°–95°:</span>
                                  <span>{fmtMoney(d.p5)} – {fmtMoney(d.p95)}</span>
                                </div>
                                {d.outOfBand && <div style={{ marginTop: 4, color: C.amber, fontSize: 10.5, fontWeight: 700 }}>⚠️ Fuori dalla banda 5°–95°</div>}
                              </div>
                            );
                          }}
                        />
                        <ReferenceLine y={mm.initialCapital} stroke="#999" strokeDasharray="4 4" label={{ value: "Capitale Iniziale", fontSize: 9.5, fill: "#888", position: "insideBottomLeft" }} />

                        <Area dataKey="baseP5" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />
                        <Area dataKey="bandP5P25" stackId="band" stroke="none" fill={C.primary} fillOpacity={0.16} isAnimationActive={false} />
                        <Area dataKey="bandP25P75" stackId="band" stroke="none" fill={C.primary} fillOpacity={0.38} isAnimationActive={false} />
                        <Area dataKey="bandP75P95" stackId="band" stroke="none" fill={C.primary} fillOpacity={0.16} isAnimationActive={false} />

                        <Line dataKey="p50" stroke={C.amber} strokeDasharray="5 4" dot={false} strokeWidth={1.8} isAnimationActive={false} />
                        <Line dataKey="actual" stroke={C.text} dot={false} strokeWidth={2.4} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* View 2: Returns Distribution Histogram */}
                {oosMcView === "returns" && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, fontFamily: FONT_SANS, color: C.primaryDark }}>
                          Distribuzione di Frequenza dei Rendimenti Totali OOS
                        </div>
                        <div style={{ fontSize: 11.5, color: C.muted }}>
                          Mediana: <b>{fmtPct(oosMcResult.returnStats.p50)}</b> · Min: {fmtPct(oosMcResult.returnStats.min)} · Max: {fmtPct(oosMcResult.returnStats.max)}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: C.muted }}>
                        Rendimento Storico Reale OOS: <b style={{ color: C.primaryDark }}>{chainedMetrics ? fmtPct(chainedMetrics.netProfitPct) : "—"}</b>
                      </div>
                    </div>

                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={oosMcResult.histReturns} margin={{ top: 15, right: 15, left: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis dataKey="label" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 10 }} tickFormatter={(v) => fmtPct(v, 0)} />
                        <YAxis tick={{ fontSize: 10 }} width={38} />
                        <Tooltip formatter={(v: any) => [v, "Simulazioni"]} labelFormatter={(v: any) => `Rendimento OOS: ${fmtPct(v)}`} />
                        {chainedMetrics && (
                          <ReferenceLine x={chainedMetrics.netProfitPct} stroke={C.primaryDark} strokeWidth={2} strokeDasharray="4 2" label={{ value: `Reale OOS (${fmtPct(chainedMetrics.netProfitPct)})`, fontSize: 10, fill: C.primaryDark, position: "top" }} />
                        )}
                        <ReferenceLine x={oosMcResult.returnStats.p50} stroke={C.amber} strokeWidth={1.8} strokeDasharray="3 3" label={{ value: `Mediana MC (${fmtPct(oosMcResult.returnStats.p50)})`, fontSize: 10, fill: C.amber, position: "top" }} />
                        <Bar dataKey="count" fill={C.primary} fillOpacity={0.65} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* View 3: Max Drawdown Distribution Histogram */}
                {oosMcView === "dd" && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, fontFamily: FONT_SANS, color: C.red }}>
                          Distribuzione di Frequenza dei Maximum Drawdown OOS
                        </div>
                        <div style={{ fontSize: 11.5, color: C.muted }}>
                          Mediana: <b>{fmtPct(oosMcResult.ddStats.p50)}</b> · 95° Percentile (Worst-case): <b style={{ color: C.red }}>{fmtPct(oosMcResult.ddStats.p95)}</b>
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: C.muted }}>
                        Max DD Storico Reale OOS: <b style={{ color: C.red }}>{chainedMetrics ? fmtPct(chainedMetrics.maxDDPct) : "—"}</b>
                      </div>
                    </div>

                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={oosMcResult.histDD} margin={{ top: 15, right: 15, left: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                        <XAxis dataKey="label" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 10 }} tickFormatter={(v) => fmtPct(v, 0)} />
                        <YAxis tick={{ fontSize: 10 }} width={38} />
                        <Tooltip formatter={(v: any) => [v, "Simulazioni"]} labelFormatter={(v: any) => `Max Drawdown: ${fmtPct(v)}`} />
                        {chainedMetrics && (
                          <ReferenceLine x={chainedMetrics.maxDDPct} stroke={C.red} strokeWidth={2} strokeDasharray="4 2" label={{ value: `Reale OOS (${fmtPct(chainedMetrics.maxDDPct)})`, fontSize: 10, fill: C.red, position: "top" }} />
                        )}
                        <ReferenceLine x={oosMcResult.ddStats.p95} stroke="#8B0000" strokeWidth={1.8} strokeDasharray="3 3" label={{ value: `p95 Worst (${fmtPct(oosMcResult.ddStats.p95)})`, fontSize: 10, fill: "#8B0000", position: "top" }} />
                        <Bar dataKey="count" fill={C.red} fillOpacity={0.55} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* View 4: Full Percentiles Table */}
                {oosMcView === "stats" && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: FONT_SANS, color: C.primaryDark, marginBottom: 8 }}>
                      Tabella Analitica Completa dei Percentili Monte Carlo su Dati Concatenati OOS
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: FONT_MONO }}>
                        <thead>
                          <tr style={{ background: "#F1EFE8", borderBottom: `2px solid ${C.border}` }}>
                            <th style={{ textAlign: "left", padding: "7px 10px", fontFamily: FONT_SANS, color: C.primaryDark, fontSize: 11.5 }}>Metrica OOS</th>
                            <th style={{ textAlign: "right", padding: "7px 10px", fontFamily: FONT_SANS, color: C.primaryDark, fontSize: 11.5 }}>Reale OOS</th>
                            <th style={{ textAlign: "right", padding: "7px 10px", fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Min</th>
                            <th style={{ textAlign: "right", padding: "7px 10px", fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>p5 (Worst)</th>
                            <th style={{ textAlign: "right", padding: "7px 10px", fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>p25</th>
                            <th style={{ textAlign: "right", padding: "7px 10px", fontFamily: FONT_SANS, color: C.primaryDark, fontSize: 11 }}>p50 (Mediana)</th>
                            <th style={{ textAlign: "right", padding: "7px 10px", fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>p75</th>
                            <th style={{ textAlign: "right", padding: "7px 10px", fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>p95 (Best)</th>
                            <th style={{ textAlign: "right", padding: "7px 10px", fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Max</th>
                            <th style={{ textAlign: "right", padding: "7px 10px", fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Media</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                            <td style={{ padding: "8px 10px", fontFamily: FONT_SANS, fontWeight: 700, color: C.text }}>Rendimento Totale (%)</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 800, color: (chainedMetrics?.netProfitPct ?? 0) >= 0 ? C.primaryDark : C.red }}>
                              {chainedMetrics ? fmtPct(chainedMetrics.netProfitPct) : "—"}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: C.muted }}>{fmtPct(oosMcResult.returnStats.min)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: oosMcResult.returnStats.p5 < 0 ? C.red : C.text }}>{fmtPct(oosMcResult.returnStats.p5)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtPct(oosMcResult.returnStats.p25)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: C.primaryDark }}>{fmtPct(oosMcResult.returnStats.p50)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtPct(oosMcResult.returnStats.p75)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: C.primaryDark }}>{fmtPct(oosMcResult.returnStats.p95)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: C.muted }}>{fmtPct(oosMcResult.returnStats.max)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: C.muted }}>{fmtPct(oosMcResult.returnStats.mean)}</td>
                          </tr>

                          <tr style={{ borderBottom: `1px solid ${C.border}`, background: "#FAF8F2" }}>
                            <td style={{ padding: "8px 10px", fontFamily: FONT_SANS, fontWeight: 700, color: C.text }}>Max Drawdown (%)</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 800, color: C.red }}>
                              {chainedMetrics ? fmtPct(chainedMetrics.maxDDPct) : "—"}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: C.muted }}>{fmtPct(oosMcResult.ddStats.min)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtPct(oosMcResult.ddStats.p5)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtPct(oosMcResult.ddStats.p25)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: C.text }}>{fmtPct(oosMcResult.ddStats.p50)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtPct(oosMcResult.ddStats.p75)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: C.red }}>{fmtPct(oosMcResult.ddStats.p95)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: C.red }}>{fmtPct(oosMcResult.ddStats.max)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: C.muted }}>{fmtPct(oosMcResult.ddStats.mean)}</td>
                          </tr>

                          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                            <td style={{ padding: "8px 10px", fontFamily: FONT_SANS, fontWeight: 700, color: C.text }}>Profit Factor</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 800, color: (chainedMetrics?.profitFactor ?? 0) >= 1.3 ? C.primaryDark : C.text }}>
                              {chainedMetrics ? fmtNum(chainedMetrics.profitFactor, 2) : "—"}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: C.muted }}>{fmtNum(oosMcResult.pfStats.min, 2)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: oosMcResult.pfStats.p5 < 1.0 ? C.red : C.text }}>{fmtNum(oosMcResult.pfStats.p5, 2)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtNum(oosMcResult.pfStats.p25, 2)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: C.primaryDark }}>{fmtNum(oosMcResult.pfStats.p50, 2)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtNum(oosMcResult.pfStats.p75, 2)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: C.primaryDark }}>{fmtNum(oosMcResult.pfStats.p95, 2)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: C.muted }}>{fmtNum(oosMcResult.pfStats.max, 2)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: C.muted }}>{fmtNum(oosMcResult.pfStats.mean, 2)}</td>
                          </tr>

                          <tr style={{ borderBottom: `1px solid ${C.border}`, background: "#FAF8F2" }}>
                            <td style={{ padding: "8px 10px", fontFamily: FONT_SANS, fontWeight: 700, color: C.text }}>Drawdown Giornaliero Medio (%)</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 800, color: C.text }}>
                              {chainedMetrics ? fmtPct(chainedMetrics.avgDrawdownPct) : "—"}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: C.muted }}>{fmtPct(oosMcResult.avgDailyDDStats.min)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: C.red }}>{fmtPct(oosMcResult.avgDailyDDStats.p5)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtPct(oosMcResult.avgDailyDDStats.p25)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>{fmtPct(oosMcResult.avgDailyDDStats.p50)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtPct(oosMcResult.avgDailyDDStats.p75)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtPct(oosMcResult.avgDailyDDStats.p95)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: C.muted }}>{fmtPct(oosMcResult.avgDailyDDStats.max)}</td>
                            <td style={{ padding: "8px 10px", textAlign: "right", color: C.muted }}>{fmtPct(oosMcResult.avgDailyDDStats.mean)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Diagnostic Synthesis Footer */}
            {oosMcResult && (
              <div style={{ background: "#F5F8F4", border: `1px solid ${C.primary}33`, borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
                <CheckCircle2 size={16} color={C.primary} style={{ marginTop: 2, flexShrink: 0 }} />
                <div style={{ fontSize: 12, color: C.primaryDark, lineHeight: 1.45 }}>
                  <b>Diagnosi Monte Carlo OOS:</b> Eseguite {oosMcResult.iterations.toLocaleString("it-IT")} simulazioni stocastiche sui {allOosTrades.length} trade fuori campione.
                  {oosMcResult.riskOfRuin === 0 ? " Il rischio di rovina simulato è nullo (0.0%)." : ` Il rischio di rovina stimato è pari a ${fmtPct(oosMcResult.riskOfRuin)}.`}
                  {oosMcRank >= 25 && oosMcRank <= 75
                    ? ` La sequenza reale (${fmtPct(chainedMetrics?.netProfitPct ?? 0)}) si colloca al ${fmtNum(oosMcRank, 0)}° percentile, confermando che i risultati OOS non dipendono da una sequenza temporale insolitamente fortunata.`
                    : oosMcRank > 85
                    ? ` La sequenza reale si colloca al ${fmtNum(oosMcRank, 0)}° percentile (fascia alta), indicando che l'ordine cronologico storico è stato moderatamente favorevole rispetto alla mediana stocastica.`
                    : ` La sequenza reale si colloca al ${fmtNum(oosMcRank, 0)}° percentile (fascia conservativa), mostrando che il risultato effettivo è stato prudente rispetto a molte combinazioni simulate.`}
                  {oosMcResult.pfStats.p5 >= 1.0
                    ? ` Nello scenario avverso al 95% (p5), il Profit Factor OOS si mantiene sopra 1.0 (${fmtNum(oosMcResult.pfStats.p5, 2)}), a riprova della robustezza intrinseca del vantaggio statistico.`
                    : ` Nello scenario di stress p5 il Profit Factor scende a ${fmtNum(oosMcResult.pfStats.p5, 2)}, evidenziando la necessità di rispettare una corretta diversificazione e gestione del rischio.`}
                </div>
              </div>
            )}
          </Card>

          {/* Degradation Table */}
          <Card style={{ marginBottom: 20 }}>
            <h3 style={{ fontFamily: FONT_SERIF, fontSize: 16, color: C.primaryDark, marginTop: 0 }}>
              Tabella di Degradazione (In-Sample vs Out-Of-Sample)
            </h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Metrica</th>
                  <th style={{ textAlign: "right", padding: "6px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>In-Sample (Mediana)</th>
                  <th style={{ textAlign: "right", padding: "6px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Out-Of-Sample (Mediana)</th>
                  <th style={{ textAlign: "right", padding: "6px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Ratio (OOS/IS)</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { k: "totalReturnPct", l: "Rendimento Totale", fmt: fmtPct },
                  { k: "profitFactor", l: "Profit Factor", fmt: fmtNum },
                  { k: "winRate", l: "Win Rate", fmt: fmtPct },
                  { k: "maxDDPct", l: "Max Drawdown", fmt: fmtPct },
                  { k: "sharpeAnnual", l: "Sharpe Ratio", fmt: fmtNum },
                ].map((row, i) => {
                  const deg = wfResult.degradation[row.k];
                  const ratio = deg?.ratio;
                  return (
                    <tr key={i} style={{ background: i % 2 ? "#f4f3ee" : "transparent" }}>
                      <td style={{ padding: "6px 10px", fontWeight: 600 }}>{row.l}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: FONT_MONO }}>{deg?.is != null ? row.fmt(deg.is) : "—"}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: FONT_MONO }}>{deg?.oos != null ? row.fmt(deg.oos) : "—"}</td>
                      <td style={{ padding: "6px 10px", textAlign: "right", fontFamily: FONT_MONO, fontWeight: 700, color: ratio != null && ratio >= 0.7 ? C.primaryDark : ratio != null && ratio >= 0.4 ? C.amber : C.red }}>
                        {ratio != null ? ratio.toFixed(2) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* Fold-by-Fold Performance and Parameters Details */}
          <Card style={{ marginBottom: 20 }}>
            <h3 style={{ fontFamily: FONT_SERIF, fontSize: 16, color: C.primaryDark, marginTop: 0 }}>
              Dettaglio per Singola Finestra (Fold)
            </h3>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: FONT_MONO }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Finestra</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Periodo</th>
                    <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>IS Trade</th>
                    <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>IS Ret</th>
                    <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>IS PF</th>
                    <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>OOS Trade</th>
                    <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>OOS Ret</th>
                    <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>OOS PF</th>
                    <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>OOS DD</th>
                    {isWfoResult && (
                      <th style={{ textAlign: "center", padding: "6px 8px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.primaryDark, fontSize: 11 }}>Parametri Fold</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {wfResult.results.map((r, i) => {
                    const isExpanded = expandedFoldIndex === i;
                    return (
                      <React.Fragment key={i}>
                        <tr style={{ background: i % 2 ? "#f4f3ee" : "transparent", borderBottom: isExpanded ? "none" : `1px solid ${C.border}` }}>
                          <td style={{ padding: "6px 8px", fontFamily: FONT_SANS, fontWeight: 700 }}>{r.label}</td>
                          <td style={{ padding: "6px 8px", fontSize: 11, color: C.muted }}>{r.period}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.is?.n ?? 0}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right", color: (r.is?.totalReturnPct ?? 0) >= 0 ? C.primaryDark : C.red }}>{r.is ? fmtPct(r.is.totalReturnPct) : "—"}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.is ? fmtNum(r.is.profitFactor) : "—"}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{r.oos?.n ?? 0}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700, color: (r.oos?.totalReturnPct ?? 0) >= 0 ? C.primaryDark : C.red }}>{r.oos ? fmtPct(r.oos.totalReturnPct) : "—"}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: 700 }}>{r.oos ? fmtNum(r.oos.profitFactor) : "—"}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right", color: C.red }}>{r.oos ? fmtPct(r.oos.maxDDPct) : "—"}</td>
                          {isWfoResult && (
                            <td style={{ padding: "6px 8px", textAlign: "center" }}>
                              <button
                                type="button"
                                onClick={() => setExpandedFoldIndex(isExpanded ? null : i)}
                                style={{
                                  fontFamily: FONT_SANS,
                                  fontSize: 11,
                                  padding: "2px 7px",
                                  borderRadius: 4,
                                  border: `1px solid ${C.border}`,
                                  background: isExpanded ? C.primaryLight : "#fff",
                                  color: isExpanded ? C.primaryDark : C.text,
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                }}
                              >
                                {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                                {r.foldOptima ? `${r.foldOptima.length} parametri` : "Dettagli"}
                              </button>
                            </td>
                          )}
                        </tr>
                        {isExpanded && r.foldOptima && (
                          <tr style={{ background: "#F5F8F4", borderBottom: `1px solid ${C.border}` }}>
                            <td colSpan={10} style={{ padding: "10px 14px" }}>
                              <div style={{ fontSize: 12, fontFamily: FONT_SANS, fontWeight: 700, color: C.primaryDark, marginBottom: 6 }}>
                                Parametri Ottimali identificati per {r.label}:
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {r.foldOptima.map((fo) => (
                                  <div
                                    key={fo.param.id}
                                    style={{
                                      background: "#fff",
                                      border: `1px solid ${C.border}`,
                                      borderRadius: 5,
                                      padding: "4px 8px",
                                      fontSize: 11.5,
                                      fontFamily: FONT_MONO,
                                    }}
                                  >
                                    <span style={{ color: C.muted }}>{fo.param.label}: </span>
                                    <b style={{ color: C.primaryDark }}>{fo.optimalValue}</b>
                                    <span style={{ color: C.muted, fontSize: 10.5, marginLeft: 4 }}>(base: {fo.baseValue})</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Footer Navigation */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
        <Button id="btn-back-step-6" onClick={onBack} variant="ghost" icon={ChevronLeft}>
          Torna all'analisi di scenario
        </Button>
      </div>
    </div>
  );
}

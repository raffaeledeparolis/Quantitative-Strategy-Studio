import React, { useState, useMemo } from "react";
import {
  LineChart, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  Sliders, Sparkles, Loader2, RotateCcw, ChevronLeft, ChevronRight, AlertTriangle,
  Grid, Cpu, Layers, Target, Info, CheckCircle2, TrendingUp, TrendingDown,
  BarChart3, ArrowRight, Activity, ArrowUpRight, ArrowDownRight, Compass, ShieldAlert, Award, Eye
} from "lucide-react";
import { C, FONT_SERIF, FONT_SANS, FONT_MONO, Card, Button, Field, inputStyle } from "./CommonUI";
import {
  Bar, StrategyRules, MoneyManagement, TweakableParam, SweepConfigItem, ScenarioResult, ScenarioOptResult, Heatmap2DData,
} from "../types";
import { fmtPct, fmtNum, fmtMoney, fmtDT } from "../lib/csvHelper";
import { METRIC_META, OPTIM_OBJECTIVES, computeImpact, formatMetricVal, getParamGridValues } from "../lib/scenarioEngine";
import { downsample } from "../lib/backtestEngine";

interface Step6ScenarioProps {
  bars: Bar[];
  rules: StrategyRules;
  mm: MoneyManagement;
  params: TweakableParam[];
  sweepConfigs: Record<string, SweepConfigItem>;
  setSweepConfigs: React.Dispatch<React.SetStateAction<Record<string, SweepConfigItem>>>;
  scenarioResult: ScenarioResult | null;
  scenarioOptResult: ScenarioOptResult | null;
  running: boolean;
  optRunning: boolean;
  onRunSweep: () => void;
  onRunOptimization: (selectedParamIds?: string[], objectiveKey?: string, method?: "grid" | "coordinate") => void;
  onBack: () => void;
  onReset: () => void;
  onWalkForward: () => void;
}

export function Step6Scenario({
  bars,
  rules,
  mm,
  params,
  sweepConfigs,
  setSweepConfigs,
  scenarioResult,
  scenarioOptResult,
  running,
  optRunning,
  onRunSweep,
  onRunOptimization,
  onBack,
  onReset,
  onWalkForward,
}: Step6ScenarioProps) {
  // Main view selection: "sensitivity" (1D), "optimization" (multi-param), or "both"
  const [activeTab, setActiveTab] = useState<"sensitivity" | "optimization" | "both">(() => {
    if (scenarioOptResult && !scenarioResult) return "optimization";
    return "sensitivity";
  });

  // Selection state for multi-parametric optimization
  const [selectedParamIds, setSelectedParamIds] = useState<string[]>(() => params.map((p) => p.id));
  const [activeParamId, setActiveParamId] = useState<string>(params[0]?.id || "");
  const [activeMetricKey, setActiveMetricKey] = useState<string>("profitFactor");
  const [objectiveKey, setObjectiveKey] = useState<string>("composite");
  const [optMethod, setOptMethod] = useState<"grid" | "coordinate">("grid");
  const [hoveredHeatmapCell, setHoveredHeatmapCell] = useState<{
    xVal: number;
    yVal: number;
    score: number;
    metrics: any;
  } | null>(null);

  // Sync selected params when params array length or contents change
  React.useEffect(() => {
    if (params.length > 0) {
      setSelectedParamIds((prev) => {
        const validExisting = prev.filter((id) => params.some((p) => p.id === id));
        if (validExisting.length === 0) return params.map((p) => p.id);
        return validExisting;
      });
      if (!params.some((p) => p.id === activeParamId)) {
        setActiveParamId(params[0]?.id || "");
      }
    }
  }, [params]);

  const toggleParam = (id: string) => {
    setSelectedParamIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => setSelectedParamIds(params.map((p) => p.id));
  const deselectAll = () => setSelectedParamIds([]);
  const selectThresholdsOnly = () =>
    setSelectedParamIds(params.filter((p) => p.kind === "threshold").map((p) => p.id));
  const selectRiskOnly = () =>
    setSelectedParamIds(
      params.filter((p) => ["mult", "offset", "r_mult", "close_pct", "daily_dd_pct"].includes(p.kind)).map((p) => p.id)
    );

  // Combinations & computation estimation
  const selectedParams = useMemo(() => params.filter((p) => selectedParamIds.includes(p.id)), [params, selectedParamIds]);

  const totalGridCombos = useMemo(() => {
    if (selectedParams.length === 0) return 0;
    return selectedParams.reduce((prod, p) => {
      const cfg = sweepConfigs[p.id] || { min: p.suggestMin, max: p.suggestMax, steps: 7 };
      const steps = Math.max(2, Math.min(cfg.steps ?? 7, 30));
      return prod * steps;
    }, 1);
  }, [selectedParams, sweepConfigs]);

  const willAutoUseCoordinate = optMethod === "grid" && (totalGridCombos > 2500 || selectedParams.length > 4);

  const activeSweep = scenarioResult?.sweeps[activeParamId];
  const activeMeta = METRIC_META[activeMetricKey] || { label: activeMetricKey, format: (v: any) => String(v), higherIsBetter: true };

  // Detailed per-metric sensitivity ranking and shape diagnostic for all parameters
  const metricDetails = useMemo(() => {
    if (!scenarioResult) return [];
    const meta = METRIC_META[activeMetricKey] || { label: activeMetricKey, format: (v: any) => String(v), higherIsBetter: true };
    const higherIsBetter = meta.higherIsBetter !== false;

    const list = params.map((p) => {
      const sweep = scenarioResult.sweeps[p.id];
      if (!sweep || !sweep.rows || sweep.rows.length === 0) {
        return {
          param: p,
          baseParamVal: p.currentValue,
          baseMetricVal: null as number | null,
          bestParamVal: null as number | null,
          bestMetricVal: null as number | null,
          worstMetricVal: null as number | null,
          minMetricVal: null as number | null,
          maxMetricVal: null as number | null,
          delta: 0,
          pctChange: 0,
          pattern: "stable" as const,
          patternLabel: "N/D",
          patternColor: C.muted,
          rows: [] as typeof sweep.rows,
        };
      }

      const rows = sweep.rows;
      const validRows = rows.filter(
        (r: any) => typeof r[activeMetricKey] === "number" && isFinite(r[activeMetricKey])
      );

      if (validRows.length === 0) {
        return {
          param: p,
          baseParamVal: p.currentValue,
          baseMetricVal: null as number | null,
          bestParamVal: null as number | null,
          bestMetricVal: null as number | null,
          worstMetricVal: null as number | null,
          minMetricVal: null as number | null,
          maxMetricVal: null as number | null,
          delta: 0,
          pctChange: 0,
          pattern: "stable" as const,
          patternLabel: "N/D",
          patternColor: C.muted,
          rows,
        };
      }

      const baseRow = rows.find((r) => r.isBase) || rows.find((r) => Math.abs(r.value - p.currentValue) < 1e-5) || rows[0];
      const baseMetricVal = (baseRow as any)?.[activeMetricKey] ?? null;

      const vals = validRows.map((r: any) => r[activeMetricKey] as number);
      const minVal = Math.min(...vals);
      const maxVal = Math.max(...vals);
      const delta = maxVal - minVal;
      const refVal = baseMetricVal != null && Math.abs(baseMetricVal) > 1e-6 ? Math.abs(baseMetricVal) : Math.abs(minVal) || 1;
      const pctChange = (delta / refVal) * 100;

      // Find best and worst
      let bestRow = validRows[0];
      let worstRow = validRows[0];
      for (const r of validRows) {
        const v = (r as any)[activeMetricKey] as number;
        const bestV = (bestRow as any)[activeMetricKey] as number;
        const worstV = (worstRow as any)[activeMetricKey] as number;
        if (higherIsBetter ? v > bestV : v < bestV) {
          bestRow = r;
        }
        if (higherIsBetter ? v < worstV : v > worstV) {
          worstRow = r;
        }
      }

      const bestMetricVal = (bestRow as any)[activeMetricKey] as number;
      const worstMetricVal = (worstRow as any)[activeMetricKey] as number;
      const bestParamVal = bestRow.value;

      // Determine pattern / behavior shape
      let pattern: "plateau" | "spike" | "ascending" | "descending" | "convex" | "stable" = "stable";
      let patternLabel = "Stabile";
      let patternColor = C.primaryDark;

      if (pctChange < 5 || delta === 0) {
        pattern = "stable";
        patternLabel = "Stabile / Invariante";
        patternColor = C.primary;
      } else {
        let isAsc = true;
        let isDesc = true;
        const eps = delta * 0.05;
        for (let i = 0; i < vals.length - 1; i++) {
          if (vals[i + 1] < vals[i] - eps) isAsc = false;
          if (vals[i + 1] > vals[i] + eps) isDesc = false;
        }

        if (isAsc) {
          pattern = "ascending";
          patternLabel = "Crescente continuo";
          patternColor = "#1565C0";
        } else if (isDesc) {
          pattern = "descending";
          patternLabel = "Decrescente continuo";
          patternColor = "#E65100";
        } else {
          const bestIdx = validRows.findIndex((r) => r === bestRow);
          const bestV = (bestRow as any)[activeMetricKey] as number;
          const leftVal = bestIdx > 0 ? ((validRows[bestIdx - 1] as any)[activeMetricKey] as number) : null;
          const rightVal = bestIdx < validRows.length - 1 ? ((validRows[bestIdx + 1] as any)[activeMetricKey] as number) : null;

          const leftDiff = leftVal != null ? Math.abs(bestV - leftVal) / (Math.abs(bestV) || 1) : 0;
          const rightDiff = rightVal != null ? Math.abs(bestV - rightVal) / (Math.abs(bestV) || 1) : 0;

          const hasCloseNeighbor = (leftVal != null && leftDiff < 0.08) || (rightVal != null && rightDiff < 0.08);
          const hasSharpDrop = (leftVal != null && leftDiff > 0.20) && (rightVal != null && rightDiff > 0.20);

          if (hasCloseNeighbor) {
            pattern = "plateau";
            patternLabel = "Plateau Robusto ✓";
            patternColor = C.primary;
          } else if (hasSharpDrop) {
            pattern = "spike";
            patternLabel = "Picco Isolato ⚠️";
            patternColor = C.red;
          } else {
            pattern = "convex";
            patternLabel = "Curva Graduale";
            patternColor = "#6A1B9A";
          }
        }
      }

      return {
        param: p,
        baseParamVal: p.currentValue,
        baseMetricVal,
        bestParamVal,
        bestMetricVal,
        worstMetricVal,
        minMetricVal: minVal,
        maxMetricVal: maxVal,
        delta,
        pctChange,
        pattern,
        patternLabel,
        patternColor,
        rows,
      };
    });

    return list.sort((a, b) => b.pctChange - a.pctChange);
  }, [scenarioResult, activeMetricKey, params]);

  const activeParamDetail = useMemo(() => {
    return metricDetails.find((d) => d.param.id === activeParamId) || metricDetails[0];
  }, [metricDetails, activeParamId]);

  const maxMetricPctChange = useMemo(() => {
    return metricDetails.length > 0 ? Math.max(...metricDetails.map((d) => d.pctChange), 1) : 100;
  }, [metricDetails]);

  const optChartData = useMemo(() => {
    if (!scenarioOptResult) return [];
    const basePts = scenarioOptResult.baseResult.equityCurve;
    const optPts = scenarioOptResult.optResult.equityCurve;
    const pts = basePts.map((p, i) => ({
      dt: p.dt,
      base: p.equity,
      opt: optPts[i] ? optPts[i].equity : p.equity,
    }));
    return downsample(pts, 400);
  }, [scenarioOptResult]);

  const handleLaunchOptimization = () => {
    onRunOptimization(selectedParamIds, objectiveKey, optMethod);
  };

  const selectedObjectiveObj = OPTIM_OBJECTIVES.find((o) => o.key === objectiveKey) || OPTIM_OBJECTIVES[0];

  return (
    <div id="step-6-container">
      {/* Top Main Card: Overview and Feature Selection */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ fontSize: 24 }}>🔬</span>
            <h2 style={{ fontFamily: FONT_SERIF, fontSize: 22, color: C.primaryDark, margin: 0 }}>
              6. Analisi di Scenario &amp; Ottimizzazione Parametrica
            </h2>
          </div>
          <p style={{ color: C.muted, fontSize: 13.5, margin: "2px 0 0", lineHeight: 1.5 }}>
            Questa sezione offre due metodologie complementari per analizzare la sensibilità dei parametri e calcolare configurazioni migliorative. Seleziona la funzionalità desiderata per configurare i test ed esplorare i risultati:
          </p>
        </div>

        {/* Feature Choice Selection Cards */}
        <div
          id="feature-choice-cards"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 14,
            marginBottom: 16,
          }}
        >
          {/* Card 1: Sensitività 1D */}
          <div
            id="card-choice-sensitivity"
            onClick={() => setActiveTab("sensitivity")}
            style={{
              border: `2px solid ${activeTab === "sensitivity" || activeTab === "both" ? C.primary : C.border}`,
              background: activeTab === "sensitivity" ? "#FAFDF9" : "#FFFFFF",
              borderRadius: 10,
              padding: "16px 18px",
              cursor: "pointer",
              position: "relative",
              transition: "all 0.2s ease",
              boxShadow: activeTab === "sensitivity" ? "0 4px 14px rgba(46, 125, 50, 0.12)" : "none",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: activeTab === "sensitivity" ? C.primary : C.primaryLight,
                    color: activeTab === "sensitivity" ? "#fff" : C.primaryDark,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Sliders size={18} />
                </div>
                <div>
                  <h3 style={{ fontFamily: FONT_SANS, fontSize: 15, fontWeight: 700, color: C.primaryDark, margin: 0 }}>
                    1. Sensitività 1D (Monovariata)
                  </h3>
                  <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>
                    Analisi di Robustezza Parametro per Parametro
                  </span>
                </div>
              </div>

              {scenarioResult && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: FONT_MONO,
                    background: C.primaryLight,
                    color: C.primaryDark,
                    padding: "3px 8px",
                    borderRadius: 5,
                    fontWeight: 700,
                  }}
                >
                  ✓ Calcolata
                </span>
              )}
            </div>

            <p style={{ fontSize: 12.5, color: C.text, margin: "6px 0 10px", lineHeight: 1.45 }}>
              Varia ciascun parametro individualmente mantenendo tutti gli altri fissi (*ceteris paribus*). Permette di verificare la stabilità su un <b>plateau</b> ed evitare <b>picchi isolati fragili</b>.
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 11, background: "#F2F5F1", color: C.primaryDark, padding: "2px 7px", borderRadius: 4, fontWeight: 600 }}>
                • Curve 1D (7 metriche)
              </span>
              <span style={{ fontSize: 11, background: "#F2F5F1", color: C.primaryDark, padding: "2px 7px", borderRadius: 4, fontWeight: 600 }}>
                • Matrice d'Impatto %
              </span>
              <span style={{ fontSize: 11, background: "#F2F5F1", color: C.primaryDark, padding: "2px 7px", borderRadius: 4, fontWeight: 600 }}>
                • Verifica Plateau
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 600 }}>
                {params.length} parametr{params.length === 1 ? "o rilevato" : "i rilevati"}
              </span>
              <span
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 12,
                  fontWeight: 700,
                  color: activeTab === "sensitivity" ? C.primaryDark : C.muted,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {activeTab === "sensitivity" ? "Sezione Attiva ✓" : "Apri Sensitività 1D →"}
              </span>
            </div>
          </div>

          {/* Card 2: Ottimizzazione Multi-parametrica */}
          <div
            id="card-choice-optimization"
            onClick={() => setActiveTab("optimization")}
            style={{
              border: `2px solid ${activeTab === "optimization" || activeTab === "both" ? C.primary : C.border}`,
              background: activeTab === "optimization" ? "#FAFDF9" : "#FFFFFF",
              borderRadius: 10,
              padding: "16px 18px",
              cursor: "pointer",
              position: "relative",
              transition: "all 0.2s ease",
              boxShadow: activeTab === "optimization" ? "0 4px 14px rgba(46, 125, 50, 0.12)" : "none",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    background: activeTab === "optimization" ? C.primary : C.primaryLight,
                    color: activeTab === "optimization" ? "#fff" : C.primaryDark,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Sparkles size={18} />
                </div>
                <div>
                  <h3 style={{ fontFamily: FONT_SANS, fontSize: 15, fontWeight: 700, color: C.primaryDark, margin: 0 }}>
                    2. Ottimizzazione Multi-parametrica
                  </h3>
                  <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>
                    Ricerca Combinatoria Congiunta &amp; Obiettivo
                  </span>
                </div>
              </div>

              {scenarioOptResult && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: FONT_MONO,
                    background: C.primaryLight,
                    color: C.primaryDark,
                    padding: "3px 8px",
                    borderRadius: 5,
                    fontWeight: 700,
                  }}
                >
                  ✓ Ottimizzato
                </span>
              )}
            </div>

            <p style={{ fontSize: 12.5, color: C.text, margin: "6px 0 10px", lineHeight: 1.45 }}>
              Trova la combinazione ottimale di più parametri simultanei mediante <b>Grid Search combinatoria</b> o <b>Coordinate Descent</b> massimizzando la funzione obiettivo selezionata.
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 11, background: "#F2F5F1", color: C.primaryDark, padding: "2px 7px", borderRadius: 4, fontWeight: 600 }}>
                • 8 Funzioni Obiettivo
              </span>
              <span style={{ fontSize: 11, background: "#F2F5F1", color: C.primaryDark, padding: "2px 7px", borderRadius: 4, fontWeight: 600 }}>
                • Heatmap di Superficie 2D
              </span>
              <span style={{ fontSize: 11, background: "#F2F5F1", color: C.primaryDark, padding: "2px 7px", borderRadius: 4, fontWeight: 600 }}>
                • Confronto Base vs Ottimizzato
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 600 }}>
                {selectedParamIds.length} parametr{selectedParamIds.length === 1 ? "o selezionato" : "i selezionati"}
              </span>
              <span
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 12,
                  fontWeight: 700,
                  color: activeTab === "optimization" ? C.primaryDark : C.muted,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {activeTab === "optimization" ? "Sezione Attiva ✓" : "Apri Ottimizzazione →"}
              </span>
            </div>
          </div>
        </div>

        {/* View Switcher Bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              id="tab-btn-sensitivity"
              type="button"
              onClick={() => setActiveTab("sensitivity")}
              style={{
                fontFamily: FONT_SANS,
                fontSize: 12.5,
                fontWeight: 700,
                padding: "6px 14px",
                borderRadius: 6,
                border: `1.5px solid ${activeTab === "sensitivity" ? C.primary : C.border}`,
                background: activeTab === "sensitivity" ? C.primary : "#FFFFFF",
                color: activeTab === "sensitivity" ? "#FFFFFF" : C.text,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.15s ease",
              }}
            >
              <Sliders size={15} />
              Vista 1: Sensitività 1D
              {scenarioResult && <span style={{ fontSize: 10, background: activeTab === "sensitivity" ? "rgba(255,255,255,0.25)" : C.primaryLight, padding: "1px 5px", borderRadius: 4 }}>Pronta</span>}
            </button>

            <button
              id="tab-btn-optimization"
              type="button"
              onClick={() => setActiveTab("optimization")}
              style={{
                fontFamily: FONT_SANS,
                fontSize: 12.5,
                fontWeight: 700,
                padding: "6px 14px",
                borderRadius: 6,
                border: `1.5px solid ${activeTab === "optimization" ? C.primary : C.border}`,
                background: activeTab === "optimization" ? C.primary : "#FFFFFF",
                color: activeTab === "optimization" ? "#FFFFFF" : C.text,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                transition: "all 0.15s ease",
              }}
            >
              <Sparkles size={15} />
              Vista 2: Ottimizzazione Multi-parametrica
              {scenarioOptResult && <span style={{ fontSize: 10, background: activeTab === "optimization" ? "rgba(255,255,255,0.25)" : C.primaryLight, padding: "1px 5px", borderRadius: 4 }}>Pronta</span>}
            </button>

            <button
              id="tab-btn-both"
              type="button"
              onClick={() => setActiveTab("both")}
              style={{
                fontFamily: FONT_SANS,
                fontSize: 12,
                fontWeight: 600,
                padding: "6px 12px",
                borderRadius: 6,
                border: `1px solid ${activeTab === "both" ? C.primary : C.border}`,
                background: activeTab === "both" ? C.primaryLight : "transparent",
                color: activeTab === "both" ? C.primaryDark : C.muted,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Layers size={14} />
              Mostra Entrambe le Viste
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {activeTab === "sensitivity" && (
              <Button
                id="btn-run-scenario-sweep-top"
                onClick={onRunSweep}
                disabled={running || optRunning || params.length === 0}
                variant="primary"
                icon={running ? Loader2 : Sliders}
              >
                {running ? "Sensitività in corso..." : `Esegui Sensitività 1D (${params.length} parametri)`}
              </Button>
            )}

            {activeTab === "optimization" && (
              <Button
                id="btn-run-optimization-top"
                onClick={handleLaunchOptimization}
                disabled={running || optRunning || selectedParamIds.length === 0}
                variant="primary"
                icon={optRunning ? Loader2 : Sparkles}
              >
                {optRunning
                  ? "Ottimizzazione in corso..."
                  : `Avvia Ottimizzazione (${selectedParamIds.length} parametr${selectedParamIds.length === 1 ? "o" : "i"})`}
              </Button>
            )}

            {activeTab === "both" && (
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  id="btn-run-scenario-sweep-dual"
                  onClick={onRunSweep}
                  disabled={running || optRunning || params.length === 0}
                  variant="secondary"
                  icon={running ? Loader2 : Sliders}
                >
                  {running ? "Calcolo 1D..." : "Esegui Sensitività 1D"}
                </Button>
                <Button
                  id="btn-run-optimization-dual"
                  onClick={handleLaunchOptimization}
                  disabled={running || optRunning || selectedParamIds.length === 0}
                  variant="primary"
                  icon={optRunning ? Loader2 : Sparkles}
                >
                  {optRunning ? "Ottimizzazione..." : "Esegui Ottimizzazione"}
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* ========================================================================= */}
      {/* SECTION 1: SENSITIVITY 1D (MONOVARIATA) */}
      {/* ========================================================================= */}
      {(activeTab === "sensitivity" || activeTab === "both") && (
        <div id="section-1d-sensitivity" style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Sliders size={20} color={C.primary} />
            <h3 style={{ fontFamily: FONT_SERIF, fontSize: 18, color: C.primaryDark, margin: 0 }}>
              1. Sensitività 1D (Variazione Monovariata dei Singoli Parametri)
            </h3>
          </div>

          {/* Configuration Card for 1D Sensitivity */}
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
              <div>
                <h4 style={{ fontFamily: FONT_SANS, fontSize: 14, fontWeight: 700, color: C.primaryDark, margin: 0 }}>
                  Parametri e Intervalli di Test per lo Sweep 1D
                </h4>
                <p style={{ fontSize: 12, color: C.muted, margin: "3px 0 0" }}>
                  Verifica o modifica i limiti (Min, Max) e il numero di campionamenti (Passi) per ciascun parametro. Ogni variabile verrà testata mantenendo le altre al valore base.
                </p>
              </div>

              <Button
                id="btn-run-sweep-inline"
                onClick={onRunSweep}
                disabled={running || optRunning || params.length === 0}
                variant="primary"
                icon={running ? Loader2 : Sliders}
              >
                {running ? "Calcolo dello sweep in corso..." : `Calcola Curve di Sensitività 1D`}
              </Button>
            </div>

            {/* List of Params with Min/Max/Steps Inputs */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              {params.map((p) => {
                const cfg = sweepConfigs[p.id] || { min: p.suggestMin, max: p.suggestMax, steps: 7 };
                const stepDelta = cfg.max != null && cfg.min != null && cfg.steps && cfg.steps > 1
                  ? (cfg.max - cfg.min) / (cfg.steps - 1)
                  : null;

                return (
                  <div
                    key={p.id}
                    style={{
                      border: `1px solid ${activeParamId === p.id ? C.primary : C.border}`,
                      borderRadius: 8,
                      padding: "12px 14px",
                      background: activeParamId === p.id ? "#FAFDF9" : "#FFFFFF",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 13.5, color: C.primaryDark }}>
                          {p.label}
                        </span>
                        <span style={{ fontSize: 10.5, padding: "1px 6px", borderRadius: 4, background: C.primaryLight, color: C.primaryDark, fontWeight: 600 }}>
                          {p.group}
                        </span>
                        <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.muted }}>
                          Valore base: <b style={{ color: C.text }}>{p.currentValue}</b> {p.unit || ""}
                        </span>
                      </div>

                      {scenarioResult && (
                        <button
                          type="button"
                          onClick={() => setActiveParamId(p.id)}
                          style={{
                            fontFamily: FONT_SANS,
                            fontSize: 11,
                            fontWeight: activeParamId === p.id ? 700 : 500,
                            padding: "3px 8px",
                            borderRadius: 5,
                            border: `1px solid ${activeParamId === p.id ? C.primary : C.border}`,
                            background: activeParamId === p.id ? C.primaryLight : "transparent",
                            color: activeParamId === p.id ? C.primaryDark : C.muted,
                            cursor: "pointer",
                          }}
                        >
                          {activeParamId === p.id ? "Grafico Attivo ✓" : "Mostra nel grafico 1D"}
                        </button>
                      )}
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
                      <Field label="Valore Minimo">
                        <input
                          type="number"
                          step="any"
                          value={cfg.min ?? ""}
                          onChange={(e) =>
                            setSweepConfigs({ ...sweepConfigs, [p.id]: { ...cfg, min: parseFloat(e.target.value) } })
                          }
                          style={{ ...inputStyle, padding: "5px 8px", fontSize: 12 }}
                        />
                      </Field>
                      <Field label="Valore Massimo">
                        <input
                          type="number"
                          step="any"
                          value={cfg.max ?? ""}
                          onChange={(e) =>
                            setSweepConfigs({ ...sweepConfigs, [p.id]: { ...cfg, max: parseFloat(e.target.value) } })
                          }
                          style={{ ...inputStyle, padding: "5px 8px", fontSize: 12 }}
                        />
                      </Field>
                      <Field label="Passi (Step)">
                        <input
                          type="number"
                          min="2"
                          max="30"
                          value={cfg.steps ?? 7}
                          onChange={(e) =>
                            setSweepConfigs({ ...sweepConfigs, [p.id]: { ...cfg, steps: parseInt(e.target.value, 10) } })
                          }
                          style={{ ...inputStyle, padding: "5px 8px", fontSize: 12 }}
                        />
                      </Field>
                      <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", paddingBottom: 4 }}>
                        {stepDelta !== null && (
                          <span style={{ fontSize: 11, color: C.muted }}>
                            Passo Δ ≈ <b>{stepDelta.toFixed(4)}</b> ({cfg.steps || 7} punti)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Results: 1D Chart & Sensitivity Matrix */}
          {scenarioResult ? (
            <>
              {/* Interactive 1D Sensitivity Chart */}
              <Card style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <h3 style={{ fontFamily: FONT_SERIF, fontSize: 16, color: C.primaryDark, margin: 0 }}>
                      Curva di Sensitività 1D: {params.find((p) => p.id === activeParamId)?.label || activeParamId}
                    </h3>
                    <span style={{ fontSize: 12, color: C.muted }}>
                      Variazione della metrica selezionata lungo il range del parametro (linea arancione = valore base)
                    </span>
                  </div>

                  {/* Param selector quick pills */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {params.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setActiveParamId(p.id)}
                        style={{
                          fontFamily: FONT_SANS,
                          fontSize: 11,
                          fontWeight: activeParamId === p.id ? 700 : 500,
                          padding: "3px 8px",
                          borderRadius: 5,
                          border: `1px solid ${activeParamId === p.id ? C.primary : C.border}`,
                          background: activeParamId === p.id ? C.primary : "#fff",
                          color: activeParamId === p.id ? "#fff" : C.text,
                          cursor: "pointer",
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Metric Selector Buttons */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                  {Object.entries(METRIC_META).map(([key, meta]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setActiveMetricKey(key)}
                      style={{
                        fontFamily: FONT_SANS,
                        fontSize: 11.5,
                        fontWeight: activeMetricKey === key ? 700 : 500,
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: `1px solid ${activeMetricKey === key ? C.primaryDark : C.border}`,
                        background: activeMetricKey === key ? C.primaryDark : "#F6F5F0",
                        color: activeMetricKey === key ? "#fff" : C.text,
                        cursor: "pointer",
                      }}
                    >
                      {meta.label}
                    </button>
                  ))}
                </div>

                {activeSweep && (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={activeSweep.rows} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                      <XAxis dataKey="value" tick={{ fontSize: 10.5 }} label={{ value: "Valore parametro", position: "insideBottom", offset: -3, fontSize: 11, fill: C.muted }} />
                      <YAxis tick={{ fontSize: 10.5 }} width={60} tickFormatter={(v) => activeMeta.format(v)} />
                      <Tooltip
                        labelFormatter={(val) => `Parametro: ${val}`}
                        formatter={(val: any) => [activeMeta.format(val), activeMeta.label]}
                      />
                      <ReferenceLine
                        x={activeSweep.baseValue}
                        stroke={C.amber}
                        strokeDasharray="4 3"
                        label={{ value: `base: ${activeSweep.baseValue}`, fill: C.amber, fontSize: 10, position: "top" }}
                      />
                      <Line type="monotone" dataKey={activeMetricKey} stroke={C.primary} strokeWidth={2.4} dot={{ r: 4, fill: C.primary }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </Card>

              {/* Sensitivity Matrix (Parameters x Metrics) */}
              <Card style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <h3 style={{ fontFamily: FONT_SERIF, fontSize: 16, color: C.primaryDark, marginTop: 0, marginBottom: 4 }}>
                      Mappa di Sensitività Complessiva (Parametri × Metriche)
                    </h3>
                    <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>
                      L'impatto percentuale misura l'escursione massima della metrica nell'intervallo testato rispetto al riferimento (Verde &lt;10%: stabile; Ambra 10–30%: moderato; Rosso &gt;30%: alta sensitività). Clicca su un'intestazione per analizzare la metrica in dettaglio.
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11.5, color: C.muted }}>Metrica attiva:</span>
                    <span style={{ fontSize: 12, fontFamily: FONT_MONO, background: C.primaryLight, color: C.primaryDark, padding: "3px 8px", borderRadius: 5, fontWeight: 700 }}>
                      {activeMeta.label}
                    </span>
                  </div>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: "#F6F5F0" }}>
                        <th style={{ textAlign: "left", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 11 }}>
                          Parametro
                        </th>
                        {Object.entries(METRIC_META).map(([k, m]) => {
                          const isActive = k === activeMetricKey;
                          return (
                            <th
                              key={k}
                              onClick={() => setActiveMetricKey(k)}
                              style={{
                                textAlign: "center",
                                padding: "7px 10px",
                                borderBottom: `2px solid ${isActive ? C.primary : C.border}`,
                                background: isActive ? C.primaryLight : "transparent",
                                fontFamily: FONT_SANS,
                                color: isActive ? C.primaryDark : C.muted,
                                textTransform: "uppercase",
                                fontSize: 11,
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                              }}
                              title="Clicca per visualizzare il dettaglio di questa metrica"
                            >
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                                <span>{m.label}</span>
                                {isActive && <span style={{ fontSize: 9, background: C.primary, color: "#fff", padding: "1px 4px", borderRadius: 3 }}>✓</span>}
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {params.map((p) => {
                        const sweep = scenarioResult.sweeps[p.id];
                        const isParamActive = p.id === activeParamId;
                        return (
                          <tr
                            key={p.id}
                            style={{
                              borderBottom: `1px solid ${C.border}`,
                              background: isParamActive ? "#FAFDF9" : "transparent",
                            }}
                          >
                            <td
                              onClick={() => setActiveParamId(p.id)}
                              style={{
                                padding: "8px 10px",
                                fontFamily: FONT_SANS,
                                fontWeight: isParamActive ? 700 : 600,
                                color: isParamActive ? C.primaryDark : C.text,
                                cursor: "pointer",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span>{p.label}</span>
                                {isParamActive && (
                                  <span style={{ fontSize: 10, background: C.primaryLight, color: C.primaryDark, padding: "1px 5px", borderRadius: 4 }}>
                                    Attivo
                                  </span>
                                )}
                              </div>
                            </td>
                            {Object.keys(METRIC_META).map((k) => {
                              const imp = sweep ? computeImpact(sweep.rows, k, p.currentValue) : { delta: 0, pctChange: 0 };
                              const pct = Math.min(999, Math.abs(imp.pctChange));
                              const isHigh = pct > 30;
                              const isMed = pct >= 10 && pct <= 30;
                              const bg = isHigh ? C.redLight : isMed ? C.amberLight : C.primaryLight;
                              const fg = isHigh ? C.red : isMed ? C.amber : C.primaryDark;
                              const isColActive = k === activeMetricKey;

                              return (
                                <td
                                  key={k}
                                  onClick={() => {
                                    setActiveMetricKey(k);
                                    setActiveParamId(p.id);
                                  }}
                                  style={{
                                    padding: "8px 10px",
                                    textAlign: "center",
                                    background: isColActive ? "rgba(46, 125, 50, 0.05)" : "transparent",
                                    cursor: "pointer",
                                  }}
                                >
                                  <span
                                    style={{
                                      background: bg,
                                      color: fg,
                                      padding: "3px 8px",
                                      borderRadius: 4,
                                      fontWeight: 700,
                                      fontSize: 11,
                                      fontFamily: FONT_MONO,
                                      border: isColActive && isParamActive ? `1.5px solid ${C.primary}` : "none",
                                      display: "inline-block",
                                    }}
                                  >
                                    {pct.toFixed(0)}%
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* ========================================================================= */}
              {/* DETTAGLIO DELLA MAPPA DI SENSITIVITÀ PER LA METRICA OGGETTO DI ANALISI */}
              {/* ========================================================================= */}
              <Card
                id="card-metric-sensitivity-detail"
                style={{
                  marginBottom: 20,
                  border: `1.5px solid ${C.primary}55`,
                  background: "#FCFAF6",
                }}
              >
                {/* Header with Title & Quick Metric Selector */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <Activity size={20} color={C.primary} />
                      <h3 style={{ fontFamily: FONT_SERIF, fontSize: 17, color: C.primaryDark, margin: 0 }}>
                        Dettaglio Sensitività per la Metrica: <span style={{ color: C.primary }}>{activeMeta.label}</span>
                      </h3>
                    </div>
                    <p style={{ fontSize: 12.5, color: C.muted, margin: 0, lineHeight: 1.4 }}>
                      Analisi granulare dell'elasticità parametrica su <b>{activeMeta.label}</b>, graduatoria dell'impatto, identificazione di plateau robusti vs picchi isolati e andamento passo-passo.
                    </p>
                  </div>

                  {/* Metric Switcher Quick Pills */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {Object.entries(METRIC_META).map(([key, meta]) => {
                      const isSel = activeMetricKey === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setActiveMetricKey(key)}
                          style={{
                            fontFamily: FONT_SANS,
                            fontSize: 11,
                            fontWeight: isSel ? 700 : 500,
                            padding: "4px 9px",
                            borderRadius: 6,
                            border: `1.5px solid ${isSel ? C.primary : C.border}`,
                            background: isSel ? C.primary : "#FFFFFF",
                            color: isSel ? "#FFFFFF" : C.text,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                          }}
                        >
                          {meta.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 4 Diagnostic Summary KPI Cards for Active Metric */}
                {metricDetails.length > 0 && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                      gap: 10,
                      marginBottom: 16,
                    }}
                  >
                    {/* KPI 1: Active Metric Target */}
                    <div style={{ background: "#FFFFFF", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
                      <span style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "block", marginBottom: 2 }}>
                        Metrica &amp; Obiettivo
                      </span>
                      <div style={{ fontFamily: FONT_SANS, fontSize: 14, fontWeight: 700, color: C.primaryDark }}>
                        {activeMeta.label}
                      </div>
                      <div style={{ fontSize: 11, color: activeMeta.higherIsBetter !== false ? C.primaryDark : C.amber, marginTop: 2, fontWeight: 600 }}>
                        {activeMeta.higherIsBetter !== false ? "▲ Più alto è meglio" : "▼ Più basso è meglio (Rischio)"}
                      </div>
                    </div>

                    {/* KPI 2: Dominant Parameter */}
                    <div style={{ background: "#FFFFFF", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
                      <span style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "block", marginBottom: 2 }}>
                        Parametro Più Sensibile (Driver)
                      </span>
                      <div style={{ fontFamily: FONT_SANS, fontSize: 14, fontWeight: 700, color: C.primaryDark }}>
                        {metricDetails[0]?.param.label || "—"}
                      </div>
                      <div style={{ fontSize: 11, color: metricDetails[0]?.pctChange > 30 ? C.red : C.amber, marginTop: 2, fontWeight: 600 }}>
                        Escursione Δ {metricDetails[0]?.pctChange.toFixed(1)}% ({metricDetails[0]?.delta.toFixed(2)})
                      </div>
                    </div>

                    {/* KPI 3: Most Stable Parameter */}
                    <div style={{ background: "#FFFFFF", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
                      <span style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "block", marginBottom: 2 }}>
                        Parametro Più Robusto / Invariante
                      </span>
                      <div style={{ fontFamily: FONT_SANS, fontSize: 14, fontWeight: 700, color: C.primaryDark }}>
                        {metricDetails[metricDetails.length - 1]?.param.label || "—"}
                      </div>
                      <div style={{ fontSize: 11, color: C.primary, marginTop: 2, fontWeight: 600 }}>
                        Variazione minima: {metricDetails[metricDetails.length - 1]?.pctChange.toFixed(1)}%
                      </div>
                    </div>

                    {/* KPI 4: Escursione Globale */}
                    <div style={{ background: "#FFFFFF", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
                      <span style={{ fontSize: 11, color: C.muted, fontWeight: 600, display: "block", marginBottom: 2 }}>
                        Range Estremo Globale
                      </span>
                      <div style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 700, color: C.primaryDark }}>
                        {(() => {
                          const allMins = metricDetails.map((d) => d.minMetricVal).filter((v): v is number => v != null);
                          const allMaxs = metricDetails.map((d) => d.maxMetricVal).filter((v): v is number => v != null);
                          if (allMins.length === 0 || allMaxs.length === 0) return "—";
                          const gMin = Math.min(...allMins);
                          const gMax = Math.max(...allMaxs);
                          return `${activeMeta.format(gMin)} → ${activeMeta.format(gMax)}`;
                        })()}
                      </div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                        Su {params.length} parametri testati
                      </div>
                    </div>
                  </div>
                )}

                {/* Table: Parametric Ranking on this specific metric */}
                <div style={{ background: "#FFFFFF", border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: "#FAFDF9" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <TrendingUp size={16} color={C.primary} />
                      <span style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 13, color: C.primaryDark }}>
                        Graduatoria d'Impatto dei Parametri su {activeMeta.label}
                      </span>
                    </div>
                    <span style={{ fontSize: 11.5, color: C.muted }}>
                      Ordinati dal più influente al più invariante
                    </span>
                  </div>

                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                      <thead>
                        <tr style={{ background: "#F6F5F0" }}>
                          <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5 }}>
                            # Parametro &amp; Gruppo
                          </th>
                          <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5 }}>
                            Valore Base
                          </th>
                          <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5 }}>
                            Miglior Valore
                          </th>
                          <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5 }}>
                            Range [Min – Max]
                          </th>
                          <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5 }}>
                            Delta (Δ)
                          </th>
                          <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5, minWidth: 150 }}>
                            Impatto % &amp; Dispersione
                          </th>
                          <th style={{ textAlign: "center", padding: "8px 10px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5 }}>
                            Profilo di Risposta
                          </th>
                          <th style={{ textAlign: "right", padding: "8px 12px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5 }}>
                            Azione
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {metricDetails.map((d, idx) => {
                          const isSelected = d.param.id === activeParamId;
                          const isHigh = d.pctChange > 30;
                          const isMed = d.pctChange >= 10 && d.pctChange <= 30;
                          const badgeBg = isHigh ? C.redLight : isMed ? C.amberLight : C.primaryLight;
                          const badgeFg = isHigh ? C.red : isMed ? C.amber : C.primaryDark;
                          const barWidthPct = Math.min(100, (d.pctChange / maxMetricPctChange) * 100);

                          return (
                            <tr
                              key={d.param.id}
                              style={{
                                borderBottom: `1px solid ${C.border}`,
                                background: isSelected ? "#FAFDF9" : "transparent",
                                transition: "background 0.15s ease",
                              }}
                            >
                              {/* 1. Param Name & Group */}
                              <td style={{ padding: "10px 12px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.muted, fontWeight: 700 }}>
                                    #{idx + 1}
                                  </span>
                                  <div>
                                    <div style={{ fontFamily: FONT_SANS, fontWeight: 700, color: isSelected ? C.primaryDark : C.text, fontSize: 13 }}>
                                      {d.param.label}
                                    </div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                                      <span style={{ fontSize: 10, background: C.primaryLight, color: C.primaryDark, padding: "1px 5px", borderRadius: 3, fontWeight: 600 }}>
                                        {d.param.group}
                                      </span>
                                      <span style={{ fontSize: 10.5, color: C.muted, fontFamily: FONT_MONO }}>
                                        base: {d.param.currentValue} {d.param.unit || ""}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* 2. Base Metric Value */}
                              <td style={{ padding: "10px", textAlign: "center", fontFamily: FONT_MONO, fontSize: 12 }}>
                                <span style={{ fontWeight: 600, color: C.text }}>
                                  {activeMeta.format(d.baseMetricVal)}
                                </span>
                              </td>

                              {/* 3. Best Param & Metric Value */}
                              <td style={{ padding: "10px", textAlign: "center" }}>
                                {d.bestParamVal != null ? (
                                  <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
                                    <span style={{ fontFamily: FONT_MONO, fontWeight: 700, color: C.primaryDark, fontSize: 12 }}>
                                      {activeMeta.format(d.bestMetricVal)}
                                    </span>
                                    <span style={{ fontSize: 10.5, color: C.muted, fontFamily: FONT_MONO }}>
                                      a val = <b>{d.bestParamVal}</b>
                                    </span>
                                  </div>
                                ) : (
                                  <span style={{ color: C.muted }}>—</span>
                                )}
                              </td>

                              {/* 4. Min - Max Range */}
                              <td style={{ padding: "10px", textAlign: "center", fontFamily: FONT_MONO, fontSize: 11.5, color: C.muted }}>
                                {d.minMetricVal != null && d.maxMetricVal != null ? (
                                  <span>
                                    {activeMeta.format(d.minMetricVal)} … {activeMeta.format(d.maxMetricVal)}
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>

                              {/* 5. Absolute Delta */}
                              <td style={{ padding: "10px", textAlign: "center", fontFamily: FONT_MONO, fontSize: 12, fontWeight: 600, color: C.text }}>
                                {d.delta != null ? d.delta.toFixed(3) : "—"}
                              </td>

                              {/* 6. Impact % and Visual Bar */}
                              <td style={{ padding: "10px 12px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span
                                    style={{
                                      background: badgeBg,
                                      color: badgeFg,
                                      padding: "2px 7px",
                                      borderRadius: 4,
                                      fontFamily: FONT_MONO,
                                      fontWeight: 700,
                                      fontSize: 11.5,
                                      minWidth: 46,
                                      textAlign: "center",
                                    }}
                                  >
                                    {d.pctChange.toFixed(0)}%
                                  </span>
                                  <div
                                    style={{
                                      flex: 1,
                                      height: 6,
                                      background: "#ECEFEA",
                                      borderRadius: 3,
                                      overflow: "hidden",
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: `${barWidthPct}%`,
                                        height: "100%",
                                        background: badgeFg,
                                        borderRadius: 3,
                                      }}
                                    />
                                  </div>
                                </div>
                              </td>

                              {/* 7. Response Profile */}
                              <td style={{ padding: "10px", textAlign: "center" }}>
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: d.patternColor,
                                    background: `${d.patternColor}15`,
                                    padding: "2px 8px",
                                    borderRadius: 4,
                                    display: "inline-block",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {d.patternLabel}
                                </span>
                              </td>

                              {/* 8. Action button */}
                              <td style={{ padding: "10px 12px", textAlign: "right" }}>
                                <button
                                  type="button"
                                  onClick={() => setActiveParamId(d.param.id)}
                                  style={{
                                    fontFamily: FONT_SANS,
                                    fontSize: 11,
                                    fontWeight: isSelected ? 700 : 500,
                                    padding: "4px 8px",
                                    borderRadius: 5,
                                    border: `1px solid ${isSelected ? C.primary : C.border}`,
                                    background: isSelected ? C.primary : "#FFFFFF",
                                    color: isSelected ? "#FFFFFF" : C.text,
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    transition: "all 0.15s ease",
                                  }}
                                >
                                  <Eye size={12} />
                                  {isSelected ? "Attivo ✓" : "Curva & Step"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Sub-Card: Step-by-Step Values Table for the Active Param on this Metric */}
                {activeParamDetail && activeParamDetail.rows.length > 0 && (
                  <div
                    style={{
                      background: "#FFFFFF",
                      border: `1.5px solid ${C.primary}33`,
                      borderRadius: 8,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        padding: "10px 14px",
                        background: "#FAFDF9",
                        borderBottom: `1px solid ${C.border}`,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <Sliders size={16} color={C.primary} />
                        <div>
                          <span style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 13, color: C.primaryDark }}>
                            Dettaglio Valori Passo-Passo (Sweep Table): {activeParamDetail.param.label}
                          </span>
                          <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>
                            ({activeParamDetail.rows.length} campionamenti sulla metrica <b>{activeMeta.label}</b>)
                          </span>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: C.muted }}>Profilo:</span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: activeParamDetail.patternColor,
                            background: `${activeParamDetail.patternColor}15`,
                            padding: "2px 8px",
                            borderRadius: 4,
                          }}
                        >
                          {activeParamDetail.patternLabel}
                        </span>
                      </div>
                    </div>

                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: "#F6F5F0" }}>
                            <th style={{ textAlign: "center", padding: "7px 10px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5 }}>
                              Valore Parametro
                            </th>
                            <th style={{ textAlign: "center", padding: "7px 10px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.primaryDark, textTransform: "uppercase", fontSize: 10.5, background: C.primaryLight }}>
                              {activeMeta.label}
                            </th>
                            <th style={{ textAlign: "center", padding: "7px 10px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5 }}>
                              Δ vs Base (Ass.)
                            </th>
                            <th style={{ textAlign: "center", padding: "7px 10px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5 }}>
                              Δ vs Base (%)
                            </th>
                            <th style={{ textAlign: "center", padding: "7px 10px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5 }}>
                              Win Rate
                            </th>
                            <th style={{ textAlign: "center", padding: "7px 10px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5 }}>
                              Max Drawdown
                            </th>
                            <th style={{ textAlign: "center", padding: "7px 10px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5 }}>
                              Rendimento
                            </th>
                            <th style={{ textAlign: "center", padding: "7px 10px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5 }}>
                              N° Trade
                            </th>
                            <th style={{ textAlign: "center", padding: "7px 10px", borderBottom: `1.5px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 10.5 }}>
                              Diagnosi Step
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeParamDetail.rows.map((row: any, rIdx: number) => {
                            const val = row[activeMetricKey];
                            const baseVal = activeParamDetail.baseMetricVal;
                            const isBase = row.isBase || Math.abs(row.value - activeParamDetail.baseParamVal) < 1e-5;
                            const isBest = val != null && activeParamDetail.bestMetricVal != null && Math.abs(val - activeParamDetail.bestMetricVal) < 1e-6;

                            const deltaAbs = val != null && baseVal != null ? val - baseVal : null;
                            const deltaPct = val != null && baseVal != null && Math.abs(baseVal) > 1e-6 ? ((val - baseVal) / Math.abs(baseVal)) * 100 : null;

                            const isBetter = activeMeta.higherIsBetter !== false ? (deltaAbs ?? 0) > 0 : (deltaAbs ?? 0) < 0;
                            const isWorse = activeMeta.higherIsBetter !== false ? (deltaAbs ?? 0) < 0 : (deltaAbs ?? 0) > 0;

                            return (
                              <tr
                                key={rIdx}
                                style={{
                                  borderBottom: `1px solid ${C.border}`,
                                  background: isBest ? "#F2F8F1" : isBase ? "#FCFAF2" : "transparent",
                                  fontWeight: isBest || isBase ? 600 : 400,
                                }}
                              >
                                {/* 1. Param Value */}
                                <td style={{ padding: "8px 10px", textAlign: "center", fontFamily: FONT_MONO }}>
                                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                    <span style={{ fontWeight: isBase || isBest ? 700 : 500 }}>
                                      {row.value}
                                    </span>
                                    {isBase && (
                                      <span style={{ fontSize: 9.5, background: C.amberLight, color: C.amber, padding: "1px 4px", borderRadius: 3, fontWeight: 700 }}>
                                        BASE
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {/* 2. Active Metric Value */}
                                <td
                                  style={{
                                    padding: "8px 10px",
                                    textAlign: "center",
                                    fontFamily: FONT_MONO,
                                    fontWeight: 700,
                                    color: isBest ? C.primaryDark : C.text,
                                    background: isBest ? "rgba(46, 125, 50, 0.12)" : "rgba(46, 125, 50, 0.03)",
                                  }}
                                >
                                  {activeMeta.format(val)}
                                </td>

                                {/* 3. Delta Abs */}
                                <td style={{ padding: "8px 10px", textAlign: "center", fontFamily: FONT_MONO, fontSize: 11.5 }}>
                                  {deltaAbs == null || isBase ? (
                                    <span style={{ color: C.muted }}>—</span>
                                  ) : (
                                    <span style={{ color: isBetter ? C.primaryDark : isWorse ? C.red : C.muted, fontWeight: 600 }}>
                                      {deltaAbs > 0 ? `+${deltaAbs.toFixed(3)}` : deltaAbs.toFixed(3)}
                                    </span>
                                  )}
                                </td>

                                {/* 4. Delta Pct */}
                                <td style={{ padding: "8px 10px", textAlign: "center", fontFamily: FONT_MONO, fontSize: 11.5 }}>
                                  {deltaPct == null || isBase ? (
                                    <span style={{ color: C.muted }}>—</span>
                                  ) : (
                                    <span
                                      style={{
                                        color: isBetter ? C.primaryDark : isWorse ? C.red : C.muted,
                                        fontWeight: 700,
                                        background: isBetter ? C.primaryLight : isWorse ? C.redLight : "transparent",
                                        padding: "1px 5px",
                                        borderRadius: 3,
                                      }}
                                    >
                                      {deltaPct > 0 ? `+${deltaPct.toFixed(1)}%` : `${deltaPct.toFixed(1)}%`}
                                    </span>
                                  )}
                                </td>

                                {/* 5. Win Rate */}
                                <td style={{ padding: "8px 10px", textAlign: "center", fontFamily: FONT_MONO, fontSize: 11.5 }}>
                                  {row.winRate != null ? fmtPct(row.winRate) : "—"}
                                </td>

                                {/* 6. Max Drawdown */}
                                <td style={{ padding: "8px 10px", textAlign: "center", fontFamily: FONT_MONO, fontSize: 11.5 }}>
                                  {row.maxDDPct != null ? fmtPct(row.maxDDPct) : "—"}
                                </td>

                                {/* 7. Return */}
                                <td style={{ padding: "8px 10px", textAlign: "center", fontFamily: FONT_MONO, fontSize: 11.5 }}>
                                  {row.totalReturnPct != null ? fmtPct(row.totalReturnPct) : "—"}
                                </td>

                                {/* 8. Trade count N */}
                                <td style={{ padding: "8px 10px", textAlign: "center", fontFamily: FONT_MONO, fontSize: 11.5 }}>
                                  <span style={{ color: (row.n || 0) < 20 ? C.red : C.text, fontWeight: (row.n || 0) < 20 ? 700 : 400 }}>
                                    {row.n != null ? row.n : "—"}
                                  </span>
                                </td>

                                {/* 9. Step Diagnosis */}
                                <td style={{ padding: "8px 10px", textAlign: "center" }}>
                                  {isBest ? (
                                    <span style={{ fontSize: 10.5, background: C.primary, color: "#fff", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>
                                      ⭐ Ottimo
                                    </span>
                                  ) : isBase ? (
                                    <span style={{ fontSize: 10.5, background: C.amberLight, color: C.amber, padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>
                                      📍 Base
                                    </span>
                                  ) : (row.n || 0) < 15 ? (
                                    <span style={{ fontSize: 10.5, background: C.redLight, color: C.red, padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>
                                      ⚠️ Pochi trade
                                    </span>
                                  ) : isBetter ? (
                                    <span style={{ fontSize: 10.5, background: C.primaryLight, color: C.primaryDark, padding: "2px 6px", borderRadius: 4, fontWeight: 600 }}>
                                      Migliorativo
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: 10.5, color: C.muted }}>
                                      Standard
                                    </span>
                                  )}
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
            </>
          ) : (
            <Card style={{ textAlign: "center", padding: "30px 20px", marginBottom: 20, background: "#FCFCF9", border: `1px dashed ${C.border}` }}>
              <Sliders size={32} color={C.muted} style={{ margin: "0 auto 10px" }} />
              <h4 style={{ fontFamily: FONT_SANS, fontSize: 15, color: C.primaryDark, margin: 0 }}>
                Analisi di Sensitività 1D non ancora eseguita
              </h4>
              <p style={{ fontSize: 12.5, color: C.muted, maxWidth: 460, margin: "6px auto 16px" }}>
                Clicca sul pulsante sottostante per calcolare le curve monovariate per tutti i {params.length} parametri della strategia.
              </p>
              <Button
                id="btn-run-sweep-placeholder"
                onClick={onRunSweep}
                disabled={running || optRunning || params.length === 0}
                variant="primary"
                icon={running ? Loader2 : Sliders}
              >
                {running ? "Calcolo in corso..." : `Avvia Sensitività 1D (${params.length} parametri)`}
              </Button>
            </Card>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* SECTION 2: MULTI-PARAMETRIC OPTIMIZATION */}
      {/* ========================================================================= */}
      {(activeTab === "optimization" || activeTab === "both") && (
        <div id="section-multi-optimization" style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Sparkles size={20} color={C.primary} />
            <h3 style={{ fontFamily: FONT_SERIF, fontSize: 18, color: C.primaryDark, margin: 0 }}>
              2. Ottimizzazione Multi-parametrica (Esplorazione Congiunta)
            </h3>
          </div>

          {/* Configuration Card for Multi-Parametric Optimization */}
          <Card style={{ marginBottom: 20, border: `1.5px solid ${C.primary}55`, background: "#FCFAF6" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
              <div>
                <h4 style={{ fontFamily: FONT_SANS, fontSize: 14, fontWeight: 700, color: C.primaryDark, margin: 0 }}>
                  Impostazioni di Ricerca e Criterio Obiettivo
                </h4>
                <span style={{ fontSize: 12, color: C.muted }}>
                  Definisci cosa massimizzare e l'algoritmo di calcolo combinatorio
                </span>
              </div>
              <span style={{ fontSize: 12, fontFamily: FONT_MONO, color: C.primaryDark, background: C.primaryLight, padding: "3px 10px", borderRadius: 6, fontWeight: 700 }}>
                {selectedParamIds.length} di {params.length} parametri selezionati
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 16 }}>
              {/* Target Objective */}
              <div>
                <label style={{ display: "block", fontFamily: FONT_SANS, fontSize: 12.5, fontWeight: 700, color: C.primaryDark, marginBottom: 6 }}>
                  Funzione Obiettivo (Criterio da Massimizzare)
                </label>
                <select
                  id="select-opt-objective"
                  value={objectiveKey}
                  onChange={(e) => setObjectiveKey(e.target.value)}
                  style={{ ...inputStyle, width: "100%", fontWeight: 600 }}
                >
                  {OPTIM_OBJECTIVES.map((obj) => (
                    <option key={obj.key} value={obj.key}>
                      {obj.label}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>
                  {selectedObjectiveObj.description}
                </div>
              </div>

              {/* Search Method */}
              <div>
                <label style={{ display: "block", fontFamily: FONT_SANS, fontSize: 12.5, fontWeight: 700, color: C.primaryDark, marginBottom: 6 }}>
                  Metodo di Esplorazione Parametrica
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setOptMethod("grid")}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: `1.5px solid ${optMethod === "grid" ? C.primary : C.border}`,
                      background: optMethod === "grid" ? C.primary : "#fff",
                      color: optMethod === "grid" ? "#fff" : C.text,
                      fontFamily: FONT_SANS,
                      fontSize: 12,
                      fontWeight: optMethod === "grid" ? 700 : 500,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      cursor: "pointer",
                    }}
                  >
                    <Grid size={14} />
                    Grid Search (Congiunta)
                  </button>
                  <button
                    type="button"
                    onClick={() => setOptMethod("coordinate")}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: `1.5px solid ${optMethod === "coordinate" ? C.primary : C.border}`,
                      background: optMethod === "coordinate" ? C.primary : "#fff",
                      color: optMethod === "coordinate" ? "#fff" : C.text,
                      fontFamily: FONT_SANS,
                      fontSize: 12,
                      fontWeight: optMethod === "coordinate" ? 700 : 500,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      cursor: "pointer",
                    }}
                  >
                    <Cpu size={14} />
                    Coordinate Descent
                  </button>
                </div>
                <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>
                  {optMethod === "grid"
                    ? "Valuta tutte le combinazioni incrociate (ottimo globale congiunto e heatmap 2D)."
                    : "Esplora i parametri iterativamente uno alla volta (molto rapido anche con molti parametri)."}
                </div>
              </div>
            </div>

            {/* Combinations Info Banner */}
            <div
              style={{
                background: willAutoUseCoordinate ? C.amberLight : "#EEF2ED",
                border: `1px solid ${willAutoUseCoordinate ? C.amber : C.primary}44`,
                borderRadius: 6,
                padding: "10px 14px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
                fontSize: 12.5,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Info size={15} color={willAutoUseCoordinate ? C.amber : C.primary} />
                <span>
                  <b>Combinazioni stimate:</b>{" "}
                  <span style={{ fontFamily: FONT_MONO, fontWeight: 700 }}>
                    {optMethod === "grid" && !willAutoUseCoordinate ? totalGridCombos : selectedParams.reduce((s, p) => s + (sweepConfigs[p.id]?.steps || 7), 0) * 2}
                  </span>{" "}
                  {willAutoUseCoordinate && (
                    <span style={{ color: C.amber, fontWeight: 600 }}>
                      (superata la soglia di 2.500 combinazioni, verrà utilizzato Coordinate Descent per massima velocità)
                    </span>
                  )}
                </span>
              </div>
              <div style={{ color: C.muted, fontSize: 11.5 }}>
                Algoritmo attivo: <b>{optMethod === "grid" && !willAutoUseCoordinate ? "Grid Search Cartesian" : "Coordinate Descent (2-pass)"}</b>
              </div>
            </div>
          </Card>

          {/* Parameter Selection for Optimization */}
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
              <div>
                <h4 style={{ fontFamily: FONT_SANS, fontSize: 14, fontWeight: 700, color: C.primaryDark, margin: 0 }}>
                  Selezione Parametri da Ottimizzare ({selectedParamIds.length}/{params.length})
                </h4>
                <span style={{ fontSize: 12, color: C.muted }}>
                  Spunta i parametri da includere nella ricerca combinatoria. I parametri deselezionati manterranno il valore base.
                </span>
              </div>

              {/* Quick Selection Buttons */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={selectAll}
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 11.5,
                    padding: "4px 8px",
                    borderRadius: 5,
                    border: `1px solid ${C.border}`,
                    background: selectedParamIds.length === params.length ? C.primaryLight : "#fff",
                    color: selectedParamIds.length === params.length ? C.primaryDark : C.text,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Tutti ({params.length})
                </button>
                <button
                  type="button"
                  onClick={deselectAll}
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 11.5,
                    padding: "4px 8px",
                    borderRadius: 5,
                    border: `1px solid ${C.border}`,
                    background: "#fff",
                    color: C.muted,
                    cursor: "pointer",
                  }}
                >
                  Nessuno (0)
                </button>
                <button
                  type="button"
                  onClick={selectThresholdsOnly}
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 11.5,
                    padding: "4px 8px",
                    borderRadius: 5,
                    border: `1px solid ${C.border}`,
                    background: "#fff",
                    color: C.text,
                    cursor: "pointer",
                  }}
                >
                  Solo Soglie
                </button>
                <button
                  type="button"
                  onClick={selectRiskOnly}
                  style={{
                    fontFamily: FONT_SANS,
                    fontSize: 11.5,
                    padding: "4px 8px",
                    borderRadius: 5,
                    border: `1px solid ${C.border}`,
                    background: "#fff",
                    color: C.text,
                    cursor: "pointer",
                  }}
                >
                  Solo SL / TP
                </button>
              </div>
            </div>

            {/* List of Params */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              {params.map((p) => {
                const isSelected = selectedParamIds.includes(p.id);
                const cfg = sweepConfigs[p.id] || { min: p.suggestMin, max: p.suggestMax, steps: 7 };
                const stepDelta = cfg.max != null && cfg.min != null && cfg.steps && cfg.steps > 1
                  ? (cfg.max - cfg.min) / (cfg.steps - 1)
                  : null;

                return (
                  <div
                    key={p.id}
                    style={{
                      border: `1.5px solid ${isSelected ? C.primary : C.border}`,
                      borderRadius: 8,
                      padding: "12px 14px",
                      background: isSelected ? "#FAFDF9" : "#FFFFFF",
                      opacity: isSelected ? 1 : 0.7,
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleParam(p.id)}
                          style={{ width: 17, height: 17, cursor: "pointer", accentColor: C.primary }}
                        />
                        <span style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 13.5, color: isSelected ? C.primaryDark : C.text }}>
                          {p.label}
                        </span>
                        <span style={{ fontSize: 10.5, padding: "1px 6px", borderRadius: 4, background: isSelected ? C.primaryLight : "#F0F0EE", color: isSelected ? C.primaryDark : C.muted, fontWeight: 600 }}>
                          {p.group}
                        </span>
                      </label>

                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: C.muted }}>
                          Base: <b>{p.currentValue}</b> {p.unit || ""}
                        </span>
                        {isSelected ? (
                          <span style={{ background: C.primaryLight, color: C.primaryDark, padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                            ✓ Incluso
                          </span>
                        ) : (
                          <span style={{ background: "#F0F0EE", color: "#888", padding: "2px 7px", borderRadius: 4, fontSize: 11 }}>
                            Fisso al base
                          </span>
                        )}
                      </div>
                    </div>

                    {isSelected && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
                        <Field label="Min">
                          <input
                            type="number"
                            step="any"
                            value={cfg.min ?? ""}
                            onChange={(e) =>
                              setSweepConfigs({ ...sweepConfigs, [p.id]: { ...cfg, min: parseFloat(e.target.value) } })
                            }
                            style={{ ...inputStyle, padding: "5px 8px", fontSize: 12 }}
                          />
                        </Field>
                        <Field label="Max">
                          <input
                            type="number"
                            step="any"
                            value={cfg.max ?? ""}
                            onChange={(e) =>
                              setSweepConfigs({ ...sweepConfigs, [p.id]: { ...cfg, max: parseFloat(e.target.value) } })
                            }
                            style={{ ...inputStyle, padding: "5px 8px", fontSize: 12 }}
                          />
                        </Field>
                        <Field label="Passi">
                          <input
                            type="number"
                            min="2"
                            max="30"
                            value={cfg.steps ?? 7}
                            onChange={(e) =>
                              setSweepConfigs({ ...sweepConfigs, [p.id]: { ...cfg, steps: parseInt(e.target.value, 10) } })
                            }
                            style={{ ...inputStyle, padding: "5px 8px", fontSize: 12 }}
                          />
                        </Field>
                        <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", paddingBottom: 4 }}>
                          {stepDelta !== null && (
                            <span style={{ fontSize: 11, color: C.muted }}>
                              Δ ≈ <b>{stepDelta.toFixed(4)}</b> ({cfg.steps || 7} punti)
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
              <Button
                id="btn-run-optimization-bottom"
                onClick={handleLaunchOptimization}
                disabled={running || optRunning || selectedParamIds.length === 0}
                variant="primary"
                icon={optRunning ? Loader2 : Sparkles}
              >
                {optRunning
                  ? "Ottimizzazione in corso..."
                  : `Avvia Ottimizzazione Multi-parametrica (${selectedParamIds.length} parametri)`}
              </Button>
            </div>
          </Card>

          {/* Multi-parametric Optimization Results Section */}
          {scenarioOptResult && (
            <Card style={{ marginBottom: 20, border: `1.5px solid ${C.primary}`, boxShadow: "0 4px 12px rgba(0,0,0,0.04)" }}>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Sparkles size={20} color={C.primary} />
                    <h3 style={{ fontFamily: FONT_SERIF, fontSize: 18, color: C.primaryDark, margin: 0 }}>
                      Risultati Ottimizzazione Multi-parametrica
                    </h3>
                  </div>
                  <span style={{ fontSize: 12.5, color: C.muted }}>
                    Metodo: <b>{scenarioOptResult.method === "grid" ? "Grid Search Combinatoria" : "Coordinate Descent"}</b> · Obiettivo: <b>{OPTIM_OBJECTIVES.find(o => o.key === scenarioOptResult.objectiveKey)?.label || scenarioOptResult.objectiveKey}</b>
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, background: C.primaryLight, color: C.primaryDark, padding: "4px 10px", borderRadius: 6, fontWeight: 700 }}>
                    {scenarioOptResult.combinationsTested || 1} combinazioni in {(scenarioOptResult.durationMs || 50)}ms
                  </span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 12, background: "#EEF2ED", color: C.primaryDark, padding: "4px 10px", borderRadius: 6, fontWeight: 700 }}>
                    Best Score: {scenarioOptResult.bestScore.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Optimal Values Breakdown Table */}
              <div style={{ marginBottom: 18 }}>
                <h4 style={{ fontFamily: FONT_SANS, fontSize: 13, textTransform: "uppercase", letterSpacing: ".03em", color: C.primaryDark, marginBottom: 8 }}>
                  Parametri Configurazione Ottimizzata
                </h4>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: "#F6F5F0" }}>
                        <th style={{ textAlign: "left", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Parametro</th>
                        <th style={{ textAlign: "left", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Stato Ottimizzazione</th>
                        <th style={{ textAlign: "right", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Valore Base</th>
                        <th style={{ textAlign: "right", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Valore Ottimale</th>
                        <th style={{ textAlign: "right", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Variazione</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarioOptResult.optimalValues.map((ov) => {
                        const isOpt = ov.isOptimized !== false;
                        const diff = ov.optimalValue - ov.baseValue;
                        const pctDiff = ov.baseValue !== 0 ? (diff / Math.abs(ov.baseValue)) * 100 : 0;
                        return (
                          <tr key={ov.param.id} style={{ borderBottom: `1px solid ${C.border}`, background: isOpt ? "#FAFDF9" : "transparent" }}>
                            <td style={{ padding: "8px 10px", fontWeight: 600, color: isOpt ? C.primaryDark : C.text }}>
                              {ov.param.label}
                            </td>
                            <td style={{ padding: "8px 10px" }}>
                              {isOpt ? (
                                <span style={{ background: C.primaryLight, color: C.primaryDark, padding: "2px 7px", borderRadius: 4, fontWeight: 700, fontSize: 11 }}>
                                  ✓ Ottimizzato
                                </span>
                              ) : (
                                <span style={{ background: "#F0F0EE", color: C.muted, padding: "2px 7px", borderRadius: 4, fontWeight: 500, fontSize: 11 }}>
                                  Fisso al valore base
                                </span>
                              )}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: FONT_MONO, color: C.muted }}>
                              {ov.baseValue}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: FONT_MONO, fontWeight: 700, color: isOpt ? C.primaryDark : C.text }}>
                              {ov.optimalValue}
                            </td>
                            <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: FONT_MONO, fontSize: 11.5 }}>
                              {isOpt ? (
                                diff === 0 ? (
                                  <span style={{ color: C.muted }}>0.0% (invariato)</span>
                                ) : (
                                  <span style={{ color: diff > 0 ? C.primaryDark : C.amber, fontWeight: 700 }}>
                                    {diff > 0 ? "+" : ""}{pctDiff.toFixed(1)}% ({diff > 0 ? "+" : ""}{diff.toFixed(2)})
                                  </span>
                                )
                              ) : (
                                <span style={{ color: C.muted }}>—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Performance Comparison Table */}
              <div style={{ marginBottom: 20 }}>
                <h4 style={{ fontFamily: FONT_SANS, fontSize: 13, textTransform: "uppercase", letterSpacing: ".03em", color: C.primaryDark, marginBottom: 8 }}>
                  Confronto Prestazionale: Strategia Base vs Ottimizzata
                </h4>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#F6F5F0" }}>
                        <th style={{ textAlign: "left", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Metrica</th>
                        <th style={{ textAlign: "right", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Configurazione Base</th>
                        <th style={{ textAlign: "right", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Configurazione Ottimizzata</th>
                        <th style={{ textAlign: "right", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, fontSize: 11 }}>Delta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "Rendimento Totale", base: scenarioOptResult.baseMetrics.totalReturnPct, opt: scenarioOptResult.optMetrics.totalReturnPct, fmt: fmtPct },
                        { label: "Profit Factor", base: scenarioOptResult.baseMetrics.profitFactor, opt: scenarioOptResult.optMetrics.profitFactor, fmt: fmtNum },
                        { label: "Win Rate", base: scenarioOptResult.baseMetrics.winRate, opt: scenarioOptResult.optMetrics.winRate, fmt: fmtPct },
                        { label: "Max Drawdown", base: scenarioOptResult.baseMetrics.maxDDPct, opt: scenarioOptResult.optMetrics.maxDDPct, fmt: fmtPct, inv: true },
                        { label: "Sharpe Ratio", base: scenarioOptResult.baseMetrics.sharpeAnnual, opt: scenarioOptResult.optMetrics.sharpeAnnual, fmt: fmtNum },
                        { label: "Expectancy", base: scenarioOptResult.baseMetrics.expectancy, opt: scenarioOptResult.optMetrics.expectancy, fmt: fmtMoney },
                        { label: "Recovery Factor", base: scenarioOptResult.baseMetrics.recoveryFactor, opt: scenarioOptResult.optMetrics.recoveryFactor, fmt: fmtNum },
                        { label: "N. Trade", base: scenarioOptResult.baseMetrics.n, opt: scenarioOptResult.optMetrics.n, fmt: (v: number) => String(v) },
                      ].map((row, i) => {
                        const diff = row.opt - row.base;
                        const isBetter = row.inv ? diff < 0 : diff > 0;
                        return (
                          <tr key={i} style={{ background: i % 2 ? "#FAFAF7" : "transparent", borderBottom: `1px solid ${C.border}` }}>
                            <td style={{ padding: "7px 10px", fontWeight: 600 }}>{row.label}</td>
                            <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: FONT_MONO }}>{row.fmt(row.base)}</td>
                            <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: FONT_MONO, fontWeight: 700, color: C.primaryDark }}>{row.fmt(row.opt)}</td>
                            <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: FONT_MONO, color: isBetter ? C.primaryDark : Math.abs(diff) < 1e-6 ? C.muted : C.red, fontWeight: 700 }}>
                              {diff >= 0 ? "+" : ""}{row.fmt(diff)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Comparative Equity Curve */}
              <div style={{ marginBottom: 20 }}>
                <h4 style={{ fontFamily: FONT_SANS, fontSize: 13, textTransform: "uppercase", letterSpacing: ".03em", color: C.primaryDark, marginBottom: 8 }}>
                  Curva di Equity Comparativa: Base vs Ottimizzato
                </h4>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={optChartData} margin={{ top: 10, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                    <XAxis dataKey="dt" tickFormatter={fmtDT} tick={{ fontSize: 9.5 }} minTickGap={60} />
                    <YAxis tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 10 }} width={48} />
                    <Tooltip labelFormatter={fmtDT} formatter={(v: any, name: any) => [fmtMoney(v), name === "opt" ? "Ottimizzato" : "Base"]} />
                    <ReferenceLine y={mm.initialCapital} stroke="#999" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="base" stroke={C.muted} dot={false} strokeWidth={1.5} isAnimationActive={false} />
                    <Line type="monotone" dataKey="opt" stroke={C.primary} dot={false} strokeWidth={2.2} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 20, marginTop: 8, fontSize: 12, color: C.muted, justifyContent: "center" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span style={{ display: "inline-block", width: 14, height: 3, background: C.muted, borderRadius: 2 }} />
                    Strategia Base (Rendimento: {fmtPct(scenarioOptResult.baseMetrics.totalReturnPct)})
                  </span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, color: C.primaryDark }}>
                    <span style={{ display: "inline-block", width: 14, height: 3, background: C.primary, borderRadius: 2 }} />
                    Strategia Ottimizzata (Rendimento: {fmtPct(scenarioOptResult.optMetrics.totalReturnPct)})
                  </span>
                </div>
              </div>

              {/* 2D Parametric Surface Heatmap (Available if 2 params were optimized with Grid Search) */}
              {scenarioOptResult.heatmap2D && (
                <div style={{ marginTop: 24, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <h4 style={{ fontFamily: FONT_SERIF, fontSize: 16, color: C.primaryDark, margin: 0 }}>
                        Mappa di Superficie Parametrica 2D ({scenarioOptResult.heatmap2D.paramX.label} × {scenarioOptResult.heatmap2D.paramY.label})
                      </h4>
                      <p style={{ fontSize: 12, color: C.muted, margin: "3px 0 0" }}>
                        Distribuzione dello score obiettivo ({OPTIM_OBJECTIVES.find(o => o.key === scenarioOptResult.objectiveKey)?.label}) nello spazio combinatorio 2D. La stella ★ indica l'ottimo globale.
                      </p>
                    </div>
                    {hoveredHeatmapCell && (
                      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 12px", fontSize: 11.5, fontFamily: FONT_MONO }}>
                        <span>X: <b>{hoveredHeatmapCell.xVal}</b> | Y: <b>{hoveredHeatmapCell.yVal}</b></span>
                        <span style={{ marginLeft: 10, color: C.primaryDark, fontWeight: 700 }}>
                          Score: {hoveredHeatmapCell.score > -900 ? hoveredHeatmapCell.score.toFixed(2) : "N/A"}
                        </span>
                        {hoveredHeatmapCell.metrics && (
                          <span style={{ marginLeft: 10, color: C.muted }}>
                            PF: {fmtNum(hoveredHeatmapCell.metrics.profitFactor)} · WR: {fmtPct(hoveredHeatmapCell.metrics.winRate)} · DD: {fmtPct(hoveredHeatmapCell.metrics.maxDDPct)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Heatmap Grid Matrix */}
                  <div style={{ overflowX: "auto", padding: "10px 0" }}>
                    <div style={{ display: "inline-block", minWidth: 420 }}>
                      <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
                        <div style={{ width: 80, fontSize: 11, color: C.muted, textAlign: "right", paddingRight: 8 }}>
                          {scenarioOptResult.heatmap2D.paramY.label} ↓ / {scenarioOptResult.heatmap2D.paramX.label} →
                        </div>
                        <div style={{ display: "flex", flex: 1, gap: 3 }}>
                          {scenarioOptResult.heatmap2D.xValues.map((xVal, xi) => (
                            <div key={xi} style={{ flex: 1, textAlign: "center", fontSize: 10.5, fontFamily: FONT_MONO, color: C.muted }}>
                              {xVal}
                            </div>
                          ))}
                        </div>
                      </div>

                      {scenarioOptResult.heatmap2D.matrix.map((row, yi) => {
                        const yVal = scenarioOptResult.heatmap2D!.yValues[yi];
                        return (
                          <div key={yi} style={{ display: "flex", alignItems: "center", marginBottom: 3 }}>
                            <div style={{ width: 80, fontSize: 10.5, fontFamily: FONT_MONO, color: C.muted, textAlign: "right", paddingRight: 8 }}>
                              {yVal}
                            </div>
                            <div style={{ display: "flex", flex: 1, gap: 3 }}>
                              {row.map((cell, xi) => {
                                const isBest = cell.xVal === scenarioOptResult.heatmap2D!.bestX && cell.yVal === scenarioOptResult.heatmap2D!.bestY;
                                const range = scenarioOptResult.heatmap2D!.maxScore - scenarioOptResult.heatmap2D!.minScore;
                                const normalized = range > 1e-6 ? (cell.score - scenarioOptResult.heatmap2D!.minScore) / range : 0.5;

                                // Color interpolation: red/amber to teal
                                const bg = cell.score <= -900
                                  ? "#eee"
                                  : normalized > 0.7
                                  ? `rgba(46, 125, 50, ${0.35 + normalized * 0.55})`
                                  : normalized > 0.35
                                  ? `rgba(230, 160, 40, ${0.3 + (normalized - 0.35) * 0.8})`
                                  : `rgba(211, 47, 47, ${0.2 + (0.35 - normalized) * 0.6})`;

                                return (
                                  <div
                                    key={xi}
                                    onMouseEnter={() => setHoveredHeatmapCell(cell)}
                                    style={{
                                      flex: 1,
                                      height: 38,
                                      background: bg,
                                      borderRadius: 4,
                                      border: isBest ? `2px solid ${C.amber}` : `1px solid ${C.border}`,
                                      display: "flex",
                                      flexDirection: "column",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      cursor: "pointer",
                                      position: "relative",
                                      transition: "transform 0.1s",
                                    }}
                                  >
                                    {isBest && (
                                      <span style={{ position: "absolute", top: 1, right: 2, fontSize: 9, color: C.amber, fontWeight: 900 }}>
                                        ★
                                      </span>
                                    )}
                                    <span style={{ fontSize: 10.5, fontFamily: FONT_MONO, fontWeight: isBest ? 800 : 600, color: cell.score <= -900 ? "#999" : "#111" }}>
                                      {cell.score > -900 ? cell.score.toFixed(1) : "—"}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Overfitting Caution */}
              <div style={{ background: C.amberLight, border: `1px solid ${C.amber}55`, borderRadius: 8, padding: 12, fontSize: 12.5, marginTop: 16 }}>
                <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} color={C.amber} />
                <b>Avviso Metodologico (Rischio Overfitting):</b> L'ottimizzazione mostrata è calcolata In-Sample sull'intero dataset storico. Per validare l'effettiva robustezza dei parametri ottimali ed escludere il curve-fitting, procedi allo <b>Step 7: Walk-Forward Validation</b>.
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Navigation Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
        <Button id="btn-back-step-5" onClick={onBack} variant="ghost" icon={ChevronLeft}>
          Torna al Monte Carlo
        </Button>
        <div style={{ display: "flex", gap: 10 }}>
          <Button id="btn-scenario-reset" onClick={onReset} variant="ghost" icon={RotateCcw}>
            Nuova simulazione
          </Button>
          <Button id="btn-next-step-7" onClick={onWalkForward} icon={ChevronRight} style={{ flexDirection: "row-reverse" }}>
            Avanti: Walk-Forward Validation
          </Button>
        </div>
      </div>
    </div>
  );
}

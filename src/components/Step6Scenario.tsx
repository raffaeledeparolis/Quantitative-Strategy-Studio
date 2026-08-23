import React, { useState, useMemo } from "react";
import {
  LineChart, Line, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  Sliders, Sparkles, Loader2, RotateCcw, ChevronLeft, ChevronRight, AlertTriangle,
  CheckSquare, Square, Grid, Cpu, Layers, Target, Info, CheckCircle2, TrendingUp
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
  const activeMeta = METRIC_META[activeMetricKey] || { label: activeMetricKey, format: (v: any) => String(v) };

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
      {/* Top Banner */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
          <div>
            <h2 style={{ fontFamily: FONT_SERIF, fontSize: 20, color: C.primaryDark, margin: 0 }}>
              6. Scenario &amp; Ottimizzazione Multi-parametrica
            </h2>
            <p style={{ color: C.muted, fontSize: 13, margin: "4px 0 0" }}>
              Seleziona quali parametri includere, definisci gli intervalli e trova la combinazione ottimale mediante Grid Search combinatoria o Coordinate Descent.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button
              id="btn-run-scenario-sweep"
              onClick={onRunSweep}
              disabled={running || optRunning || params.length === 0}
              variant="secondary"
              icon={running ? Loader2 : Sliders}
            >
              {running ? "Sensitività in corso..." : "Esegui Sensitività 1D"}
            </Button>
            <Button
              id="btn-run-optimization"
              onClick={handleLaunchOptimization}
              disabled={running || optRunning || selectedParamIds.length === 0}
              variant="primary"
              icon={optRunning ? Loader2 : Sparkles}
            >
              {optRunning
                ? "Ottimizzazione in corso..."
                : `Ottimizza (${selectedParamIds.length} ${selectedParamIds.length === 1 ? "parametro" : "parametri"})`}
            </Button>
          </div>
        </div>
      </Card>

      {/* Multi-parametric Configuration Panel */}
      <Card style={{ marginBottom: 20, border: `1px solid ${C.primary}44`, background: "#FCFAF6" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Target size={18} color={C.primary} />
            <h3 style={{ fontFamily: FONT_SERIF, fontSize: 16, color: C.primaryDark, margin: 0 }}>
              Configurazione Ottimizzazione Multi-parametrica
            </h3>
          </div>
          <span style={{ fontSize: 12, fontFamily: FONT_MONO, color: C.primaryDark, background: C.primaryLight, padding: "3px 10px", borderRadius: 6, fontWeight: 700 }}>
            {selectedParamIds.length} di {params.length} parametri selezionati
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 16 }}>
          {/* Target Objective */}
          <div>
            <label style={{ display: "block", fontFamily: FONT_SANS, fontSize: 12.5, fontWeight: 700, color: C.primaryDark, marginBottom: 6 }}>
              Funzione Obiettivo (Criterio di Ottimizzazione)
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
                  border: `1px solid ${optMethod === "grid" ? C.primary : C.border}`,
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
                  border: `1px solid ${optMethod === "coordinate" ? C.primary : C.border}`,
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

      {/* Parameter Selection and Range Setup */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div>
            <h3 style={{ fontFamily: FONT_SERIF, fontSize: 16, color: C.primaryDark, margin: 0 }}>
              Selezione &amp; Intervalli Parametri ({params.length})
            </h3>
            <span style={{ fontSize: 12, color: C.muted }}>
              Spunta i parametri che desideri ottimizzare. I parametri esclusi manterranno fisso il loro valore base.
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
              Seleziona Tutti ({params.length})
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
              Deseleziona Tutti
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

        {/* Parameter Cards List */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
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
                  border: `1.5px solid ${isSelected ? C.primary : activeParamId === p.id ? C.primary + "66" : C.border}`,
                  borderRadius: 8,
                  padding: "14px 16px",
                  background: isSelected ? "#FAFDF9" : "#FFFFFF",
                  transition: "all 0.15s ease",
                }}
              >
                {/* Header of Param Card */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        cursor: "pointer",
                        margin: 0,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleParam(p.id)}
                        style={{
                          width: 17,
                          height: 17,
                          cursor: "pointer",
                          accentColor: C.primary,
                        }}
                      />
                      <span style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 14, color: isSelected ? C.primaryDark : C.text }}>
                        {p.label}
                      </span>
                    </label>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 7px",
                        borderRadius: 4,
                        background: isSelected ? C.primaryLight : "#F0F0EE",
                        color: isSelected ? C.primaryDark : C.muted,
                        fontWeight: 600,
                      }}
                    >
                      {p.group}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.muted }}>
                      valore base: <b style={{ color: C.text }}>{p.currentValue}</b> {p.unit || ""}
                    </span>
                    {isSelected ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: C.primaryLight, color: C.primaryDark, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                        <CheckCircle2 size={12} />
                        Incluso nell'ottimizzazione
                      </span>
                    ) : (
                      <span style={{ background: "#f0f0ee", color: "#888", padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 500 }}>
                        Escluso (fisso a {p.currentValue})
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveParamId(p.id)}
                      style={{
                        fontFamily: FONT_SANS,
                        fontSize: 11,
                        padding: "3px 8px",
                        borderRadius: 5,
                        border: `1px solid ${activeParamId === p.id ? C.primary : C.border}`,
                        background: activeParamId === p.id ? C.primaryLight : "transparent",
                        color: activeParamId === p.id ? C.primaryDark : C.muted,
                        cursor: "pointer",
                      }}
                    >
                      {activeParamId === p.id ? "Grafico 1D attivo" : "Mostra grafico 1D"}
                    </button>
                  </div>
                </div>

                {/* Range and Step Inputs */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                  <Field label="Valore Minimo">
                    <input
                      type="number"
                      step="any"
                      value={cfg.min ?? ""}
                      onChange={(e) =>
                        setSweepConfigs({ ...sweepConfigs, [p.id]: { ...cfg, min: parseFloat(e.target.value) } })
                      }
                      style={{ ...inputStyle, opacity: isSelected ? 1 : 0.75 }}
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
                      style={{ ...inputStyle, opacity: isSelected ? 1 : 0.75 }}
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
                      style={{ ...inputStyle, opacity: isSelected ? 1 : 0.75 }}
                    />
                  </Field>
                </div>

                {stepDelta !== null && (
                  <div style={{ marginTop: 6, fontSize: 11, color: C.muted, display: "flex", justifyContent: "space-between" }}>
                    <span>
                      Risoluzione passo: Δ ≈ <b style={{ color: C.text }}>{stepDelta.toFixed(4)}</b>
                    </span>
                    <span>
                      Valori generati: {cfg.steps || 7} punti nell'intervallo [{cfg.min}, {cfg.max}]
                    </span>
                  </div>
                )}
              </div>
            );
          })}
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
                {scenarioOptResult.combinationsTested || 1} combinazioni testate in {(scenarioOptResult.durationMs || 50)}ms
              </span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 12, background: "#EEF2ED", color: C.primaryDark, padding: "4px 10px", borderRadius: 6, fontWeight: 700 }}>
                Score: {scenarioOptResult.bestScore.toFixed(2)}
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

      {/* 1D Single Parameter Sensitivity Sweep Section */}
      {scenarioResult && (
        <>
          <Card style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
              <div>
                <h3 style={{ fontFamily: FONT_SERIF, fontSize: 16, color: C.primaryDark, margin: 0 }}>
                  Curva di Sensitività 1D: {params.find((p) => p.id === activeParamId)?.label || activeParamId}
                </h3>
                <span style={{ fontSize: 12, color: C.muted }}>Variazione della metrica al variare del singolo parametro</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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
                      border: `1px solid ${activeMetricKey === key ? C.primary : C.border}`,
                      background: activeMetricKey === key ? C.primary : "#fff",
                      color: activeMetricKey === key ? "#fff" : C.text,
                      cursor: "pointer",
                    }}
                  >
                    {meta.label}
                  </button>
                ))}
              </div>
            </div>

            {activeSweep && (
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={activeSweep.rows} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="value" tick={{ fontSize: 10.5 }} label={{ value: "Valore parametro", position: "insideBottom", offset: -3, fontSize: 11, fill: C.muted }} />
                  <YAxis tick={{ fontSize: 10.5 }} width={55} tickFormatter={(v) => activeMeta.format(v)} />
                  <Tooltip
                    labelFormatter={(val) => `Parametro: ${val}`}
                    formatter={(val: any) => [activeMeta.format(val), activeMeta.label]}
                  />
                  <ReferenceLine
                    x={activeSweep.baseValue}
                    stroke={C.amber}
                    strokeDasharray="4 3"
                    label={{ value: "base", fill: C.amber, fontSize: 10, position: "top" }}
                  />
                  <Line type="monotone" dataKey={activeMetricKey} stroke={C.primary} strokeWidth={2.2} dot={{ r: 4, fill: C.primary }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* Sensitivity Matrix (Parameters x Metrics) */}
          <Card style={{ marginBottom: 20 }}>
            <h3 style={{ fontFamily: FONT_SERIF, fontSize: 16, color: C.primaryDark, marginTop: 0, marginBottom: 4 }}>
              Mappa di Sensitività (Parametri × Metriche)
            </h3>
            <p style={{ fontSize: 12, color: C.muted, marginTop: 0, marginBottom: 12 }}>
              L'impatto percentuale misura l'escursione della metrica nell'intervallo testato rispetto al riferimento.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: "#F6F5F0" }}>
                    <th style={{ textAlign: "left", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 11 }}>Parametro</th>
                    {Object.values(METRIC_META).map((m: { label: string }) => (
                      <th key={m.label} style={{ textAlign: "center", padding: "7px 10px", borderBottom: `2px solid ${C.border}`, fontFamily: FONT_SANS, color: C.muted, textTransform: "uppercase", fontSize: 11 }}>{m.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {params.map((p) => {
                    const sweep = scenarioResult.sweeps[p.id];
                    return (
                      <tr key={p.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: "8px 10px", fontFamily: FONT_SANS, fontWeight: 600 }}>{p.label}</td>
                        {Object.keys(METRIC_META).map((k) => {
                          const imp = sweep ? computeImpact(sweep.rows, k, p.currentValue) : { delta: 0, pctChange: 0 };
                          const pct = Math.min(999, Math.abs(imp.pctChange));
                          const isHigh = pct > 30;
                          const isMed = pct >= 10 && pct <= 30;
                          const bg = isHigh ? C.redLight : isMed ? C.amberLight : C.primaryLight;
                          const fg = isHigh ? C.red : isMed ? C.amber : C.primaryDark;
                          return (
                            <td key={k} style={{ padding: "8px 10px", textAlign: "center" }}>
                              <span style={{ background: bg, color: fg, padding: "3px 8px", borderRadius: 4, fontWeight: 700, fontSize: 11, fontFamily: FONT_MONO }}>
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
        </>
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

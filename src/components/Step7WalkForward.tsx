import React, { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  FastForward, PlayCircle, Loader2, RotateCcw, ChevronLeft, Info, CheckCircle2,
  AlertTriangle, Sparkles, Sliders, ShieldCheck, ChevronDown, ChevronUp, Layers, TrendingUp,
  CheckSquare, Square
} from "lucide-react";
import { C, FONT_SERIF, FONT_SANS, FONT_MONO, Card, Button, Field, KPI, inputStyle } from "./CommonUI";
import {
  Bar, StrategyRules, MoneyManagement, WalkForwardConfig, WalkForwardResult, TweakableParam, SweepConfigItem, WfoParamSummary
} from "../types";
import { fmtPct, fmtNum, fmtMoney, fmtDT } from "../lib/csvHelper";
import { downsample } from "../lib/backtestEngine";
import { OPTIM_OBJECTIVES, getParamGridValues } from "../lib/scenarioEngine";

interface Step7WalkForwardProps {
  bars: Bar[];
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

          {/* Chained OOS Equity Curve */}
          <Card style={{ marginBottom: 20 }}>
            <h3 style={{ fontFamily: FONT_SERIF, fontSize: 16, color: C.primaryDark, marginTop: 0 }}>
              Curva di Equity Concatenata Out-Of-Sample (Chained OOS)
            </h3>
            <p style={{ fontSize: 12, color: C.muted, marginTop: -4 }}>
              Questa curva rappresenta l'esperienza reale di trading: ogni segmento è stato generato esclusivamente su dati futuri mai visti dall'ottimizzazione o dalla strategia.
            </p>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chainChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                <XAxis dataKey="dt" tickFormatter={fmtDT} tick={{ fontSize: 9.5 }} minTickGap={60} />
                <YAxis tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} tick={{ fontSize: 10 }} width={44} />
                <Tooltip labelFormatter={fmtDT} formatter={(v: any) => [fmtMoney(v), "Equity OOS"]} />
                <ReferenceLine y={mm.initialCapital} stroke="#999" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="equity" stroke={C.primary} dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
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

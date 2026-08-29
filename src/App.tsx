import { useState, useMemo, useCallback } from "react";
import { HelpCircle, Code2, Sparkles } from "lucide-react";
import { C, FONT_SERIF, FONT_SANS, Stepper } from "./components/CommonUI";
import { HelpModal, JsonRulesHelpModal } from "./components/HelpModals";
import { Step1Data } from "./components/Step1Data";
import { Step2Strategy } from "./components/Step2Strategy";
import { Step3MoneyMgmt } from "./components/Step3MoneyMgmt";
import { Step4Report } from "./components/Step4Report";
import { Step5MonteCarlo } from "./components/Step5MonteCarlo";
import { Step6Scenario } from "./components/Step6Scenario";
import { Step7WalkForward } from "./components/Step7WalkForward";

import {
  CsvParsedFile, Bar, ColumnStat, StrategyRules, MoneyManagement, BacktestResult,
  MonteCarloConfig, MonteCarloResult, SweepConfigItem, ScenarioResult, ScenarioOptResult,
  WalkForwardConfig, WalkForwardResult,
} from "./types";
import { mergeCsvFiles, computeColumnStats, parseCsvFile } from "./lib/csvHelper";
import { validateRules, buildDefaultTemplate, extractTweakableParams, parseStrategyHeuristically } from "./lib/ruleParser";
import { runBacktest, computeMetrics } from "./lib/backtestEngine";
import { runMonteCarlo } from "./lib/monteCarloEngine";
import { runParameterSweep, optimizeMultiParam, OPTIM_OBJECTIVES } from "./lib/scenarioEngine";
import { runWalkForward, runWalkForwardOptimized } from "./lib/walkForwardEngine";
import { generateSampleCsv } from "./sampleData";

export default function App() {
  const [step, setStep] = useState<number>(1);
  const [maxStep, setMaxStep] = useState<number>(1);

  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [showJsonHelpModal, setShowJsonHelpModal] = useState<boolean>(false);

  // Step 1: Files & Merged Data
  const [files, setFiles] = useState<CsvParsedFile[]>([]);
  const [priceFileId, setPriceFileId] = useState<string | null>(null);
  const [merged, setMerged] = useState<{
    bars: Bar[];
    dropped: number;
    columns: string[];
    perFileDiag: any[];
  } | null>(null);

  const stats = useMemo<Record<string, ColumnStat>>(() => {
    if (!merged || !merged.bars.length) return {};
    return computeColumnStats(merged.bars, merged.columns);
  }, [merged]);

  const allColumns = useMemo<string[]>(() => {
    return merged ? merged.columns : [];
  }, [merged]);

  // Step 2: Strategy Rules
  const [strategyText, setStrategyText] = useState<string>("");
  const [rulesJson, setRulesJson] = useState<string>("");
  const [rulesNotes, setRulesNotes] = useState<string>("");
  const [rulesSource, setRulesSource] = useState<string>("template");
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const rulesParsed = useMemo<StrategyRules | null>(() => {
    if (!rulesJson.trim()) return null;
    try {
      return JSON.parse(rulesJson);
    } catch {
      return null;
    }
  }, [rulesJson]);

  const rulesValidation = useMemo(() => {
    return validateRules(rulesParsed, allColumns);
  }, [rulesParsed, allColumns]);

  // Step 3: Money Management
  const [mm, setMm] = useState<MoneyManagement>({
    initialCapital: 100000,
    sizingMode: "risk",
    riskPct: 1,
    fixedQty: 1,
    linearGrowthEnabled: false,
    linearGrowthMode: "proportional",
    linearGrowthStepCapital: 10000,
    linearGrowthStepQty: 1,
    linearGrowthRounding: "decimal",
    linearGrowthMinQty: 0.01,
    linearGrowthMaxQty: null,
    linearGrowthAllowDeleveraging: true,
    linearGrowthScaleMonetarySLTP: true,
    spread: 0,
    pointValue: 1,
    monetarySLEnabled: false,
    monetarySLValue: 500,
    monetaryTPEnabled: false,
    monetaryTpValue: 1000,
    monetaryTpClosePct: 50,
    entryTiming: "next_open",
    exitTiming: "next_open",
    intrabarFraction: 0.5,
    intrabarExitFraction: 0.5,
    dailyDDLimitPct: null,
    tradingHoursEnabled: false,
    tradingHoursStart: "08:00",
    tradingHoursEnd: "20:00",
    fridayCloseEnabled: false,
    fridayCloseTime: "21:00",
  });

  // Step 4: Backtest Result
  const [backtestRunning, setBacktestRunning] = useState<boolean>(false);
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);

  // Step 5: Monte Carlo
  const [mcConfig, setMcConfig] = useState<MonteCarloConfig>({
    iterations: 2000,
    method: "bootstrap",
    ruinThresholdPct: 50,
  });
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [mcRunning, setMcRunning] = useState<boolean>(false);
  const [mcError, setMcError] = useState<string | null>(null);

  // Step 6: Scenario & Sensitivity
  const scenarioParams = useMemo(() => {
    if (!rulesParsed) return [];
    return extractTweakableParams(rulesParsed, mm);
  }, [rulesParsed, mm]);

  const [sweepConfigs, setSweepConfigs] = useState<Record<string, SweepConfigItem>>({});
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null);
  const [scenarioOptResult, setScenarioOptResult] = useState<ScenarioOptResult | null>(null);
  const [scenarioRunning, setScenarioRunning] = useState<boolean>(false);
  const [scenarioOptRunning, setScenarioOptRunning] = useState<boolean>(false);

  // Step 7: Walk-Forward
  const [wfConfig, setWfConfig] = useState<WalkForwardConfig>({
    mode: "rolling",
    isPct: 60,
    oosPct: 20,
    expandingIs: false,
  });
  const [wfResult, setWfResult] = useState<WalkForwardResult | null>(null);
  const [wfRunning, setWfRunning] = useState<boolean>(false);

  // Merge Handler
  const handleMerge = useCallback(() => {
    if (!files.length) return;
    const res = mergeCsvFiles(files, priceFileId);
    setMerged(res);

    if (res.bars.length > 0) {
      const template = buildDefaultTemplate(res.columns);
      setRulesJson(JSON.stringify(template, null, 2));
      setRulesNotes("");
      setRulesSource("template");

      // Auto-populate default sweep configs
      const defaultParams = extractTweakableParams(template);
      const initialSweeps: Record<string, SweepConfigItem> = {};
      defaultParams.forEach((p) => {
        const val = p.currentValue;
        let min = val * 0.5;
        let max = val * 1.5;
        if (min === max) {
          min = val - 1;
          max = val + 1;
        }
        initialSweeps[p.id] = {
          min: Number(min.toFixed(2)),
          max: Number(max.toFixed(2)),
          steps: 7,
        };
      });
      setSweepConfigs(initialSweeps);
    }
  }, [files, priceFileId, mm]);

  // AI Rule Generation
  const handleGenerateRules = async (customText?: string) => {
    const textToUse = (typeof customText === "string" ? customText : strategyText).trim();
    if (!textToUse) return;
    setAiLoading(true);
    setAiError(null);

    const columnsToSend =
      merged?.columns && merged.columns.length > 0
        ? merged.columns
        : allColumns.length > 0
        ? allColumns
        : ["open", "high", "low", "close"];

    const sampleBarsToSend = merged?.bars?.slice(0, 10) || [];

    try {
      const response = await fetch("/api/generate-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyText: textToUse,
          columns: columnsToSend,
          sampleBars: sampleBarsToSend,
          stats: stats || {},
        }),
      });

      const contentType = response.headers.get("content-type") || "";
      if (response.ok && contentType.includes("application/json")) {
        const data = await response.json();
        const rules = data.rules;
        if (rules && typeof rules === "object") {
          setRulesJson(JSON.stringify(rules, null, 2));
          setRulesNotes(data.warning ? `${data.warning} ${data.notes || ""}`.trim() : (data.notes || rules.notes || ""));
          setRulesSource(data.fallbackUsed ? "heuristic" : "ai");
          setAiError(null);
          return;
        }
      }

      // If server returned non-JSON (like Vite fallback HTML) or error status, use local heuristic parser
      console.warn("Risposta server non valida o non-JSON. Applicazione del parser euristico locale.");
      const heuristicRules = parseStrategyHeuristically(textToUse, columnsToSend, stats || {});
      setRulesJson(JSON.stringify(heuristicRules, null, 2));
      setRulesNotes(heuristicRules.notes || "Regole generate tramite interprete logico della strategia.");
      setRulesSource("heuristic");
      setAiError(null);
    } catch (err: any) {
      console.warn("Errore durante la chiamata API di generazione regole, applicazione del parser locale:", err);
      const heuristicRules = parseStrategyHeuristically(textToUse, columnsToSend, stats || {});
      setRulesJson(JSON.stringify(heuristicRules, null, 2));
      setRulesNotes(heuristicRules.notes || "Regole generate tramite interprete logico della strategia.");
      setRulesSource("heuristic");
      setAiError(null);
    } finally {
      setAiLoading(false);
    }
  };

  // Run Backtest Simulation (Step 3 -> 4)
  const handleRunSimulation = () => {
    if (!merged || !merged.bars.length || !rulesParsed) return;
    setBacktestRunning(true);

    setTimeout(() => {
      try {
        const { trades, equityCurve } = runBacktest(merged.bars, rulesParsed, mm);
        const calculatedMetrics = computeMetrics(trades, equityCurve, mm.initialCapital);
        setBacktestResult({
          trades,
          equityCurve,
          metrics: calculatedMetrics,
          rules: rulesParsed,
          mm,
        });

        // Initialize Monte Carlo auto-run or prepare
        setMcResult(null);
        setScenarioResult(null);
        setScenarioOptResult(null);
        setWfResult(null);

        setStep(4);
        setMaxStep((prev) => Math.max(prev, 4));
      } catch (err: any) {
        console.error("Backtest error:", err);
      } finally {
        setBacktestRunning(false);
      }
    }, 50);
  };

  // Run Monte Carlo (Step 5)
  const handleRunMonteCarlo = () => {
    if (!backtestResult || !backtestResult.trades.length) return;
    setMcRunning(true);
    setMcError(null);

    setTimeout(() => {
      try {
        const res = runMonteCarlo(backtestResult.trades, mm, mcConfig);
        setMcResult(res);
      } catch (err: any) {
        setMcError(`Errore durante Monte Carlo: ${err.message}`);
      } finally {
        setMcRunning(false);
      }
    }, 40);
  };

  // Run Parameter Sweep (Step 6)
  const handleRunScenarioSweep = () => {
    if (!merged || !rulesParsed) return;
    setScenarioRunning(true);

    setTimeout(() => {
      try {
        const sweeps: Record<string, any> = {};
        scenarioParams.forEach((param) => {
          const cfg = sweepConfigs[param.id] || {
            min: param.currentValue * 0.5,
            max: param.currentValue * 1.5,
            steps: 7,
          };
          const rows = runParameterSweep(merged.bars, rulesParsed, mm, param, cfg, mm.initialCapital);
          sweeps[param.id] = {
            param,
            cfg,
            rows,
            baseValue: param.currentValue,
          };
        });

        setScenarioResult({ sweeps, baseRules: rulesParsed, baseMm: mm });
      } catch (err) {
        console.error("Scenario sweep error:", err);
      } finally {
        setScenarioRunning(false);
      }
    }, 50);
  };

  // Run Optimization (Step 6)
  const handleRunOptimization = (
    selectedParamIds?: string[],
    objectiveKey: string = "composite",
    method: "grid" | "coordinate" = "grid"
  ) => {
    if (!merged || !rulesParsed) return;
    setScenarioOptRunning(true);

    setTimeout(() => {
      try {
        const sweepList = scenarioParams.map((p) => ({
          param: p,
          cfg: sweepConfigs[p.id] || { min: p.suggestMin, max: p.suggestMax, steps: 7 },
        }));

        const targetObj = OPTIM_OBJECTIVES.find((o) => o.key === objectiveKey) || OPTIM_OBJECTIVES[0];

        const optRes = optimizeMultiParam(
          merged.bars,
          rulesParsed,
          mm,
          sweepList,
          targetObj.fn,
          mm.initialCapital,
          {
            selectedParamIds: selectedParamIds || scenarioParams.map((p) => p.id),
            objectiveKey: targetObj.key,
            method,
          }
        );

        setScenarioOptResult(optRes);
      } catch (err) {
        console.error("Optimization error:", err);
      } finally {
        setScenarioOptRunning(false);
      }
    }, 60);
  };

  // Run Walk-Forward (Step 7)
  const handleRunWalkForward = (
    mode: "base" | "opt" | "wfo",
    objFnKey: string = "composite",
    selectedParamIds?: string[]
  ) => {
    if (!merged || !rulesParsed) return;
    setWfRunning(true);

    setTimeout(() => {
      try {
        if (mode === "wfo") {
          const chosenIds =
            selectedParamIds && selectedParamIds.length > 0
              ? selectedParamIds
              : scenarioParams.map((p) => p.id);

          const sweepList = scenarioParams
            .filter((p) => chosenIds.includes(p.id))
            .map((p) => ({
              param: p,
              cfg: sweepConfigs[p.id] || { min: p.suggestMin, max: p.suggestMax, steps: 5 },
            }));

          const targetObj = OPTIM_OBJECTIVES.find((o) => o.key === objFnKey) || OPTIM_OBJECTIVES[0];

          const res = runWalkForwardOptimized(
            merged.bars,
            rulesParsed,
            mm,
            wfConfig,
            sweepList,
            targetObj.fn,
            mm.initialCapital
          );
          res.objKey = targetObj.key;
          setWfResult(res);
        } else {
          const rulesToUse = mode === "opt" && scenarioOptResult ? scenarioOptResult.optRules : rulesParsed;
          const mmToUse = mode === "opt" && scenarioOptResult ? scenarioOptResult.optMm : mm;

          const res = runWalkForward(merged.bars, rulesToUse, mmToUse, wfConfig);
          res.mode = mode === "opt" ? "optimized" : "base";
          setWfResult(res);
        }
      } catch (err) {
        console.error("Walk forward error:", err);
      } finally {
        setWfRunning(false);
      }
    }, 60);
  };

  const handleReset = () => {
    setStep(1);
    setMaxStep(1);
    setFiles([]);
    setPriceFileId(null);
    setMerged(null);
    setStrategyText("");
    setRulesJson("");
    setRulesNotes("");
    setBacktestResult(null);
    setMcResult(null);
    setScenarioResult(null);
    setScenarioOptResult(null);
    setWfResult(null);
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: FONT_SANS, paddingBottom: 60 }}>
      {/* Header */}
      <header
        id="app-header"
        style={{
          background: "#FFFFFF",
          borderBottom: `1px solid ${C.border}`,
          padding: "16px 32px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: C.primary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 800,
              fontSize: 16,
            }}
          >
            SL
          </div>
          <div>
            <h1 style={{ fontFamily: FONT_SERIF, fontSize: 18, color: C.primaryDark, margin: 0, fontWeight: 700 }}>
              Strategy Lab
            </h1>
            <div style={{ fontSize: 11.5, color: C.muted, letterSpacing: ".02em" }}>
              Motore di Backtest &amp; Analisi Quantitativa
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            id="btn-open-help"
            onClick={() => setShowHelpModal(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "7px 12px",
              fontFamily: FONT_SANS,
              fontSize: 12.5,
              fontWeight: 600,
              color: C.primaryDark,
              cursor: "pointer",
            }}
          >
            <HelpCircle size={15} color={C.primary} />
            Guida all'uso
          </button>
          <button
            id="btn-open-json-help"
            onClick={() => setShowJsonHelpModal(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "7px 12px",
              fontFamily: FONT_SANS,
              fontSize: 12.5,
              fontWeight: 600,
              color: C.primaryDark,
              cursor: "pointer",
            }}
          >
            <Code2 size={15} color={C.primary} />
            Guida regole JSON
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ maxWidth: 1100, margin: "24px auto 0", padding: "0 20px" }}>
        <Stepper step={step} maxStep={maxStep} onJump={(n) => setStep(n)} />

        {step === 1 && (
          <Step1Data
            files={files}
            setFiles={setFiles}
            priceFileId={priceFileId}
            setPriceFileId={setPriceFileId}
            merged={merged}
            setMerged={setMerged}
            onMerge={handleMerge}
            onNext={() => {
              setStep(2);
              setMaxStep((p) => Math.max(p, 2));
            }}
            stats={stats}
          />
        )}

        {step === 2 && (
          <Step2Strategy
            allColumns={allColumns}
            stats={stats}
            strategyText={strategyText}
            setStrategyText={setStrategyText}
            rulesJson={rulesJson}
            rulesNotes={rulesNotes}
            rulesParsed={rulesParsed}
            rulesValidation={rulesValidation}
            rulesSource={rulesSource}
            aiLoading={aiLoading}
            aiError={aiError}
            onGenerateRules={handleGenerateRules}
            onJsonChange={(val) => setRulesJson(val)}
            onBack={() => setStep(1)}
            onNext={() => {
              setStep(3);
              setMaxStep((p) => Math.max(p, 3));
            }}
          />
        )}

        {step === 3 && (
          <Step3MoneyMgmt
            mm={mm}
            setMm={setMm}
            rulesParsed={rulesParsed}
            running={backtestRunning}
            onRunSimulation={handleRunSimulation}
            onBack={() => setStep(2)}
          />
        )}

        {step === 4 && backtestResult && (
          <Step4Report
            result={backtestResult}
            mm={mm}
            onBack={() => setStep(3)}
            onReset={handleReset}
            onMonteCarlo={() => {
              setStep(5);
              setMaxStep((p) => Math.max(p, 5));
              if (!mcResult) handleRunMonteCarlo();
            }}
          />
        )}

        {step === 5 && backtestResult && (
          <Step5MonteCarlo
            result={backtestResult}
            mm={mm}
            config={mcConfig}
            setConfig={setMcConfig}
            mcResult={mcResult}
            running={mcRunning}
            error={mcError}
            onRun={handleRunMonteCarlo}
            onBack={() => setStep(4)}
            onReset={handleReset}
            onScenario={() => {
              setStep(6);
              setMaxStep((p) => Math.max(p, 6));
            }}
          />
        )}

        {step === 6 && (
          <Step6Scenario
            bars={merged?.bars || []}
            rules={rulesParsed!}
            mm={mm}
            params={scenarioParams}
            sweepConfigs={sweepConfigs}
            setSweepConfigs={setSweepConfigs}
            scenarioResult={scenarioResult}
            scenarioOptResult={scenarioOptResult}
            running={scenarioRunning}
            optRunning={scenarioOptRunning}
            onRunSweep={handleRunScenarioSweep}
            onRunOptimization={handleRunOptimization}
            onBack={() => setStep(5)}
            onReset={handleReset}
            onWalkForward={() => {
              setStep(7);
              setMaxStep((p) => Math.max(p, 7));
            }}
          />
        )}

        {step === 7 && (
          <Step7WalkForward
            bars={merged?.bars || []}
            rules={rulesParsed!}
            mm={mm}
            params={scenarioParams}
            sweepConfigs={sweepConfigs}
            setSweepConfigs={setSweepConfigs}
            optRules={scenarioOptResult?.optRules || null}
            optMm={scenarioOptResult?.optMm || null}
            wfConfig={wfConfig}
            setWfConfig={setWfConfig}
            wfResult={wfResult}
            running={wfRunning}
            onRunWalkForward={handleRunWalkForward}
            onBack={() => setStep(6)}
            onReset={handleReset}
            backtestResult={backtestResult}
            baseMcResult={mcResult}
            strategyTitle={strategyText ? strategyText.slice(0, 50) : "Strategia Quantitativa"}
          />
        )}
      </main>

      {/* Modals */}
      {showHelpModal && <HelpModal onClose={() => setShowHelpModal(false)} />}
      {showJsonHelpModal && <JsonRulesHelpModal onClose={() => setShowJsonHelpModal(false)} />}
    </div>
  );
}

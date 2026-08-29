import React from "react";
import { PlayCircle, Loader2, ChevronLeft, TrendingUp, Sliders } from "lucide-react";
import { C, FONT_SERIF, FONT_SANS, Card, Button, Field, inputStyle } from "./CommonUI";
import { MoneyManagement, StrategyRules } from "../types";
import { parseHHMM, computeFixedPositionQty } from "../lib/backtestEngine";

interface Step3MoneyMgmtProps {
  mm: MoneyManagement;
  setMm: React.Dispatch<React.SetStateAction<MoneyManagement>>;
  rulesParsed: StrategyRules | null;
  running: boolean;
  onRunSimulation: () => void;
  onBack: () => void;
}

export function Step3MoneyMgmt({
  mm,
  setMm,
  rulesParsed,
  running,
  onRunSimulation,
  onBack,
}: Step3MoneyMgmtProps) {
  const hasStrategySl = Boolean(rulesParsed && rulesParsed.stop_loss && rulesParsed.stop_loss.type !== "none");
  const hasMonetarySl = Boolean(mm.monetarySLEnabled && mm.monetarySLValue && mm.monetarySLValue > 0);
  const sizingBlockedByNoSL = mm.sizingMode === "risk" && !hasStrategySl && !hasMonetarySl;

  const currentPointVal = mm.pointValue && mm.pointValue > 0 ? mm.pointValue : 1;
  const currentFixedQty = mm.fixedQty && mm.fixedQty > 0 ? mm.fixedQty : 1;

  const calculatedSlPoints = mm.monetarySLValue && mm.monetarySLValue > 0
    ? (mm.monetarySLValue / (currentFixedQty * currentPointVal)).toFixed(2)
    : null;

  const calculatedTpPoints = mm.monetaryTpValue && mm.monetaryTpValue > 0
    ? (mm.monetaryTpValue / (currentFixedQty * currentPointVal)).toFixed(2)
    : null;

  const tpClosePct = mm.monetaryTpClosePct && mm.monetaryTpClosePct > 0 ? mm.monetaryTpClosePct : 50;
  const closedQty = ((currentFixedQty * tpClosePct) / 100).toFixed(2);
  const remainingQty = (currentFixedQty - (currentFixedQty * tpClosePct) / 100).toFixed(2);
  const partialCashGain = mm.monetaryTpValue && mm.monetaryTpValue > 0
    ? ((mm.monetaryTpValue * tpClosePct) / 100).toFixed(2)
    : null;

  const initCap = mm.initialCapital > 0 ? mm.initialCapital : 100000;
  const previewEquityPoints = [
    { label: "-20% Drawdown", eq: initCap * 0.8 },
    { label: "Capitale Base (0%)", eq: initCap },
    { label: "+20% Profit", eq: initCap * 1.2 },
    { label: "+50% Profit", eq: initCap * 1.5 },
    { label: "+100% (Raddoppio)", eq: initCap * 2.0 },
  ];

  return (
    <Card id="step-3-card">
      <h2 style={{ fontFamily: FONT_SERIF, fontSize: 19, color: C.primaryDark, marginTop: 0 }}>3. Money management</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <Field label="Capitale iniziale ($)">
          <input
            id="input-initial-capital"
            type="number"
            value={Number.isFinite(mm.initialCapital) ? mm.initialCapital : ""}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setMm({ ...mm, initialCapital: Number.isNaN(v) ? 0 : v });
            }}
            style={inputStyle}
          />
        </Field>
        <Field label="Modalità di sizing">
          <select
            id="select-sizing-mode"
            value={mm.sizingMode}
            onChange={(e) => setMm({ ...mm, sizingMode: e.target.value as "risk" | "fixed" })}
            style={inputStyle}
          >
            <option value="risk">Rischio % su equity (richiede Stop Loss)</option>
            <option value="fixed">Quantità fissa</option>
          </select>
        </Field>
        {mm.sizingMode === "risk" ? (
          <Field label="Rischio per trade (% equity)" hint={sizingBlockedByNoSL ? "⚠ La strategia non ha uno Stop Loss: imposta uno Stop Loss monetario qui sotto oppure passa a 'quantità fissa'." : undefined}>
            <input
              id="input-risk-pct"
              type="number"
              step="0.1"
              value={Number.isFinite(mm.riskPct) ? mm.riskPct : ""}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setMm({ ...mm, riskPct: Number.isNaN(v) ? 0 : v });
              }}
              style={inputStyle}
            />
          </Field>
        ) : (
          <Field label="Quantità fissa base per trade (lotti/contratti)">
            <input
              id="input-fixed-qty"
              type="number"
              step="0.01"
              value={Number.isFinite(mm.fixedQty) ? mm.fixedQty : ""}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setMm({ ...mm, fixedQty: Number.isNaN(v) ? 0 : v });
              }}
              style={inputStyle}
            />
          </Field>
        )}
        <Field label="Valore di 1 punto ($ / € per contratto)" hint="Default 1.0 (es. 1 pt = $1 per azioni/forex, $20 per NQ mini, $50 per ES)">
          <input
            id="input-point-value"
            type="number"
            step="0.01"
            min="0.0001"
            value={Number.isFinite(mm.pointValue) ? mm.pointValue : 1}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setMm({ ...mm, pointValue: Number.isNaN(v) || v <= 0 ? 1 : v });
            }}
            style={inputStyle}
          />
        </Field>
        <Field label="Spread (punti prezzo, round-turn)" hint="0 = simulazione lorda senza costi">
          <input
            id="input-spread"
            type="number"
            step="0.01"
            value={Number.isFinite(mm.spread) ? mm.spread : ""}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setMm({ ...mm, spread: Number.isNaN(v) ? 0 : v });
            }}
            style={inputStyle}
          />
        </Field>
        <Field label="Timing di ingresso">
          <select
            id="select-entry-timing"
            value={mm.entryTiming}
            onChange={(e) => setMm({ ...mm, entryTiming: e.target.value as "next_open" | "same_close" | "intrabar" })}
            style={inputStyle}
          >
            <option value="next_open">Apertura candela successiva (consigliato)</option>
            <option value="same_close">Chiusura candela del segnale</option>
            <option value="intrabar">Apertura intra-candela con frazioni fisse</option>
          </select>
        </Field>
        <Field label="Timing di uscita (da segnale)">
          <select
            id="select-exit-timing"
            value={mm.exitTiming || "next_open"}
            onChange={(e) => setMm({ ...mm, exitTiming: e.target.value as "next_open" | "same_close" | "intrabar" })}
            style={inputStyle}
          >
            <option value="next_open">Candela seguente al segnale di uscita (default)</option>
            <option value="intrabar">Chiusura intra-candela con frazioni fisse</option>
            <option value="same_close">Chiusura candela del segnale</option>
          </select>
        </Field>
      </div>

      {/* Sezione Crescita Lineare della Dimensione della Posizione (visibile per Quantità Fissa) */}
      {mm.sizingMode === "fixed" && (
        <div
          id="box-linear-growth-sizing"
          style={{
            marginTop: 18,
            marginBottom: 16,
            background: mm.linearGrowthEnabled ? "#f0fdf4" : "#f8fafc",
            border: `1.5px solid ${mm.linearGrowthEnabled ? "#86efac" : C.border}`,
            borderRadius: 10,
            padding: 16,
            transition: "all 0.2s ease",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TrendingUp size={18} color={mm.linearGrowthEnabled ? "#16a34a" : C.primary} />
              <span style={{ fontFamily: FONT_SANS, fontSize: 13.5, fontWeight: 700, color: C.primaryDark }}>
                Crescita Lineare della Dimensione della Posizione (Equity Scaling)
              </span>
            </div>
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                background: mm.linearGrowthEnabled ? "#dcfce7" : "#e2e8f0",
                color: mm.linearGrowthEnabled ? "#15803d" : "#475569",
                borderRadius: 12,
                fontWeight: 600,
              }}
            >
              {mm.linearGrowthEnabled ? "Attivo" : "Opzionale"}
            </span>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 12 }}>
            <input
              id="checkbox-linear-growth"
              type="checkbox"
              checked={Boolean(mm.linearGrowthEnabled)}
              onChange={(e) => setMm({ ...mm, linearGrowthEnabled: e.target.checked })}
              style={{ width: 16, height: 16, accentColor: "#16a34a", cursor: "pointer" }}
            />
            <span style={{ fontFamily: FONT_SANS, fontSize: 13, fontWeight: 600, color: C.primaryDark }}>
              Abilita crescita lineare della taglia basata sull'Equity dinamica del backtest
            </span>
          </label>

          {mm.linearGrowthEnabled && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.5, background: "#ffffff", padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}` }}>
                La taglia di ciascun trade viene calcolata dinamicamente prima dell'ingresso in base all'equity corrente aggiornata.
                {mm.linearGrowthMode === "step"
                  ? ` Per ogni variazione di $${(mm.linearGrowthStepCapital || 10000).toLocaleString()} di equity rispetto al capitale iniziale ($${(mm.initialCapital || 100000).toLocaleString()}), la posizione viene incrementata di ${mm.linearGrowthStepQty || mm.fixedQty || 1} lotto/i.`
                  : ` La taglia scala proporzionalmente all'equity: Qty = ${mm.fixedQty || 1} × (Equity / $${(mm.initialCapital || 100000).toLocaleString()}).`}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                <Field label="Modalità di scala lineare">
                  <select
                    id="select-linear-growth-mode"
                    value={mm.linearGrowthMode || "proportional"}
                    onChange={(e) => setMm({ ...mm, linearGrowthMode: e.target.value as "proportional" | "step" })}
                    style={inputStyle}
                  >
                    <option value="proportional">Proporzionale continua all'Equity</option>
                    <option value="step">A scaglioni di Equity ($ step)</option>
                  </select>
                </Field>

                {mm.linearGrowthMode === "step" ? (
                  <>
                    <Field label="Scaglione di Equity ($)">
                      <input
                        id="input-linear-step-capital"
                        type="number"
                        step="1000"
                        min="100"
                        value={mm.linearGrowthStepCapital != null ? mm.linearGrowthStepCapital : 10000}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setMm({ ...mm, linearGrowthStepCapital: Number.isNaN(v) ? 10000 : v });
                        }}
                        style={inputStyle}
                        placeholder="es. 10000"
                      />
                    </Field>
                    <Field label="Incremento taglia per scaglione">
                      <input
                        id="input-linear-step-qty"
                        type="number"
                        step="0.1"
                        min="0.01"
                        value={mm.linearGrowthStepQty != null ? mm.linearGrowthStepQty : (mm.fixedQty || 1)}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setMm({ ...mm, linearGrowthStepQty: Number.isNaN(v) ? 1 : v });
                        }}
                        style={inputStyle}
                        placeholder="es. 1"
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field label="Arrotondamento contratti">
                      <select
                        id="select-linear-rounding"
                        value={mm.linearGrowthRounding || "decimal"}
                        onChange={(e) => setMm({ ...mm, linearGrowthRounding: e.target.value as "decimal" | "integer" | "none" })}
                        style={inputStyle}
                      >
                        <option value="decimal">Decimale (2 decimali - Forex/Crypto)</option>
                        <option value="integer">Interi (Lotti interi - Futures/Indici)</option>
                        <option value="none">Continuo / Non arrotondato</option>
                      </select>
                    </Field>

                    <Field label="Taglia Minima consentita">
                      <input
                        id="input-linear-min-qty"
                        type="number"
                        step="0.01"
                        min="0.0001"
                        value={mm.linearGrowthMinQty != null ? mm.linearGrowthMinQty : (mm.linearGrowthRounding === "integer" ? 1 : 0.01)}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          setMm({ ...mm, linearGrowthMinQty: Number.isNaN(v) ? 0.01 : v });
                        }}
                        style={inputStyle}
                      />
                    </Field>
                  </>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: mm.linearGrowthMode === "step" ? "1fr 1fr 1fr" : "1fr 1fr", gap: 14 }}>
                {mm.linearGrowthMode === "step" && (
                  <Field label="Arrotondamento contratti">
                    <select
                      id="select-linear-rounding-step"
                      value={mm.linearGrowthRounding || "integer"}
                      onChange={(e) => setMm({ ...mm, linearGrowthRounding: e.target.value as "decimal" | "integer" | "none" })}
                      style={inputStyle}
                    >
                      <option value="integer">Interi (Lotti interi - Futures/Indici)</option>
                      <option value="decimal">Decimale (2 decimali)</option>
                      <option value="none">Continuo</option>
                    </select>
                  </Field>
                )}

                <Field label="Taglia Massima (Cap di sicurezza)" hint="Lascia vuoto per nessun limite superiore">
                  <input
                    id="input-linear-max-qty"
                    type="number"
                    step="1"
                    min="1"
                    value={mm.linearGrowthMaxQty != null ? mm.linearGrowthMaxQty : ""}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setMm({ ...mm, linearGrowthMaxQty: Number.isNaN(v) ? null : v });
                    }}
                    placeholder="Nessun limite massimo"
                    style={inputStyle}
                  />
                </Field>

                <div style={{ display: "flex", alignItems: "center", paddingTop: 18 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      id="checkbox-linear-deleveraging"
                      type="checkbox"
                      checked={mm.linearGrowthAllowDeleveraging ?? true}
                      onChange={(e) => setMm({ ...mm, linearGrowthAllowDeleveraging: e.target.checked })}
                      style={{ width: 15, height: 15, accentColor: "#16a34a", cursor: "pointer" }}
                    />
                    <span style={{ fontSize: 12.5, color: C.text, lineHeight: 1.35 }}>
                      <b>Scala simmetricamente in Drawdown:</b> riduci la taglia sotto la base se l'Equity scende sotto il capitale iniziale
                    </span>
                  </label>
                </div>
              </div>

              {/* Selettore Modalità di Scaling per SL & TP Monetari */}
              <div
                id="box-linear-growth-sltp-scale"
                style={{
                  background: "#ffffff",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "12px 14px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Sliders size={16} color={C.primary} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.primaryDark }}>
                    Comportamento SL & TP Monetari durante la Crescita della Taglia
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      padding: 10,
                      borderRadius: 6,
                      background: (mm.linearGrowthScaleMonetarySLTP ?? true) ? "#f0fdf4" : "#f8fafc",
                      border: `1.5px solid ${(mm.linearGrowthScaleMonetarySLTP ?? true) ? "#86efac" : C.border}`,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="linearGrowthScaleMonetarySLTP"
                      checked={mm.linearGrowthScaleMonetarySLTP ?? true}
                      onChange={() => setMm({ ...mm, linearGrowthScaleMonetarySLTP: true })}
                      style={{ marginTop: 2, accentColor: "#16a34a" }}
                    />
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: (mm.linearGrowthScaleMonetarySLTP ?? true) ? "#15803d" : C.text }}>
                        Scala gli Importi Monetari ($) con la Taglia
                      </div>
                      <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2, lineHeight: 1.35 }}>
                        <b>Mantiene fissa la distanza di prezzo in punti</b>. Se la taglia raddoppia (es. 2 lotti), il potenziale guadagno/perdita monetario raddoppia proporzionalmente all'equity.
                      </div>
                    </div>
                  </label>

                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      padding: 10,
                      borderRadius: 6,
                      background: !(mm.linearGrowthScaleMonetarySLTP ?? true) ? "#eff6ff" : "#f8fafc",
                      border: `1.5px solid ${!(mm.linearGrowthScaleMonetarySLTP ?? true) ? "#93c5fd" : C.border}`,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="linearGrowthScaleMonetarySLTP"
                      checked={!(mm.linearGrowthScaleMonetarySLTP ?? true)}
                      onChange={() => setMm({ ...mm, linearGrowthScaleMonetarySLTP: false })}
                      style={{ marginTop: 2, accentColor: "#2563eb" }}
                    />
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: !(mm.linearGrowthScaleMonetarySLTP ?? true) ? "#1d4ed8" : C.text }}>
                        Tetto Monetario Assoluto Fisso ($)
                      </div>
                      <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2, lineHeight: 1.35 }}>
                        <b>Il vincolo monetario totale per trade rimane rigido</b> (es. max $500 SL). All'aumentare dei contratti, la distanza di prezzo in punti si stringe.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Box Anteprima Simulazione Sizing */}
              <div
                style={{
                  background: "#ffffff",
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "10px 14px",
                }}
              >
                <div style={{ fontSize: 11.5, fontWeight: 700, color: C.primaryDark, marginBottom: 6 }}>
                  📊 Anteprima Sizing Dinamico alle Varie Fasi di Equity:
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
                  {previewEquityPoints.map((pt, idx) => {
                    const previewQty = computeFixedPositionQty(mm, pt.eq);
                    return (
                      <div
                        key={idx}
                        style={{
                          background: pt.eq === initCap ? "#f1f5f9" : pt.eq > initCap ? "#ecfdf5" : "#fef2f2",
                          border: `1px solid ${pt.eq === initCap ? "#cbd5e1" : pt.eq > initCap ? "#a7f3d0" : "#fecaca"}`,
                          borderRadius: 6,
                          padding: "6px 8px",
                          textAlign: "center",
                        }}
                      >
                        <div style={{ fontSize: 10.5, color: "#64748b", fontWeight: 600 }}>{pt.label}</div>
                        <div style={{ fontSize: 11, color: "#334155", marginTop: 2 }}>${Math.round(pt.eq).toLocaleString()}</div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 800,
                            color: pt.eq > initCap ? "#15803d" : pt.eq < initCap ? "#b91c1c" : C.primaryDark,
                            marginTop: 3,
                          }}
                        >
                          {previewQty.toFixed(mm.linearGrowthRounding === "integer" ? 0 : 2)} <span style={{ fontSize: 10, fontWeight: 500 }}>lotti</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sezione Stop Loss & Take Profit Monetario con Chiusura Parziale */}
      <div
        id="box-monetary-sl-tp"
        style={{
          marginTop: 18,
          marginBottom: 16,
          background: "#f8fafc",
          border: `1.5px solid ${C.border}`,
          borderRadius: 10,
          padding: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontFamily: FONT_SANS, fontSize: 13.5, fontWeight: 700, color: C.primaryDark }}>
            Gestione Monetaria di Rischio e Profitto (SL / TP in $ con Chiusura Parziale)
          </div>
          <span style={{ fontSize: 11, padding: "2px 8px", background: "#e2e8f0", borderRadius: 12, color: "#475569", fontWeight: 600 }}>
            Opzioni Avanzate MM
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Stop Loss Monetario */}
          <div style={{ background: "#ffffff", border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 8 }}>
              <input
                id="checkbox-monetary-sl"
                type="checkbox"
                checked={Boolean(mm.monetarySLEnabled)}
                onChange={(e) => setMm({ ...mm, monetarySLEnabled: e.target.checked })}
                style={{ width: 15, height: 15, accentColor: C.primary, cursor: "pointer" }}
              />
              <span style={{ fontFamily: FONT_SANS, fontSize: 13, fontWeight: 600, color: C.primaryDark }}>
                Stop Loss Monetario ($)
              </span>
            </label>
            {mm.monetarySLEnabled && (
              <div>
                <Field label="Massima perdita per trade ($)" hint="Interviene se il trade perde questo importo monetario complessivo">
                  <input
                    id="input-monetary-sl-val"
                    type="number"
                    step="10"
                    min="1"
                    value={mm.monetarySLValue != null ? mm.monetarySLValue : ""}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setMm({ ...mm, monetarySLValue: Number.isNaN(v) ? null : v });
                    }}
                    placeholder="es. 500"
                    style={inputStyle}
                  />
                </Field>
                {calculatedSlPoints && (
                  <div style={{ fontSize: 11.5, color: "#475569", background: "#f1f5f9", padding: "6px 8px", borderRadius: 6, marginTop: 6 }}>
                    Distanza equivalente: <b>{calculatedSlPoints} punti</b> di prezzo (calcolata su {currentFixedQty} lotti × {currentPointVal}$/pt).
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Take Profit Monetario con Chiusura Parziale */}
          <div style={{ background: "#ffffff", border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 8 }}>
              <input
                id="checkbox-monetary-tp"
                type="checkbox"
                checked={Boolean(mm.monetaryTPEnabled)}
                onChange={(e) => setMm({ ...mm, monetaryTPEnabled: e.target.checked })}
                style={{ width: 15, height: 15, accentColor: C.primary, cursor: "pointer" }}
              />
              <span style={{ fontFamily: FONT_SANS, fontSize: 13, fontWeight: 600, color: C.primaryDark }}>
                Take Profit Monetario ($) + Chiusura Parziale
              </span>
            </label>
            {mm.monetaryTPEnabled && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field label="Target di profitto ($)">
                    <input
                      id="input-monetary-tp-val"
                      type="number"
                      step="10"
                      min="1"
                      value={mm.monetaryTpValue != null ? mm.monetaryTpValue : ""}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setMm({ ...mm, monetaryTpValue: Number.isNaN(v) ? null : v });
                      }}
                      placeholder="es. 1000"
                      style={inputStyle}
                    />
                  </Field>
                  <Field label="Chiusura parziale (%)">
                    <select
                      id="select-monetary-tp-close-pct"
                      value={mm.monetaryTpClosePct || 50}
                      onChange={(e) => setMm({ ...mm, monetaryTpClosePct: parseFloat(e.target.value) })}
                      style={inputStyle}
                    >
                      <option value={25}>25% della posizione</option>
                      <option value={33.33}>33% (1/3 posizione)</option>
                      <option value={50}>50% (metà posizione)</option>
                      <option value={66.67}>67% (2/3 posizione)</option>
                      <option value={75}>75% della posizione</option>
                      <option value={100}>100% (chiusura totale)</option>
                    </select>
                  </Field>
                </div>
                {calculatedTpPoints && (
                  <div style={{ fontSize: 11.5, color: "#475569", background: "#f1f5f9", padding: "6px 8px", borderRadius: 6, marginTop: 6, lineHeight: 1.45 }}>
                    Distanza Target: <b>+{calculatedTpPoints} punti</b>.
                    <br />
                    Al raggiungimento: liquida il <b>{tpClosePct}%</b> ({closedQty} lotti) incassando <b>+${partialCashGain}</b>, lasciando <b>{remainingQty} lotti</b> a mercato.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {mm.entryTiming === "intrabar" && (
        <div id="box-intrabar-fractions" style={{ marginTop: 6, marginBottom: 16, background: C.primaryLight, border: `1px solid ${C.primary}33`, borderRadius: 8, padding: 14 }}>
          <div style={{ fontFamily: FONT_SANS, fontSize: 13, fontWeight: 700, color: C.primaryDark, marginBottom: 4 }}>
            Frazione di sviluppo candela di ingresso (Range High-Low)
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.45 }}>
            I livelli di apertura corrispondono esattamente a <b>1/4</b>, <b>1/2</b> o <b>3/4</b> dello sviluppo della candela (range <i>High − Low</i>) che ha generato il segnale:
            <br />
            • <b>Long:</b> <i>Minimo + frazione × (Massimo − Minimo)</i>
            <br />
            • <b>Short:</b> <i>Massimo − frazione × (Massimo − Minimo)</i>
          </div>
          <div style={{ display: "flex", gap: 10, maxWidth: 440 }}>
            {[
              { v: 0.25, l: "1/4", desc: "25% del range" },
              { v: 0.5, l: "1/2", desc: "50% (punto medio)" },
              { v: 0.75, l: "3/4", desc: "75% del range" },
            ].map((opt) => (
              <button
                id={`btn-intrabar-frac-${opt.l.replace("/", "-")}`}
                key={opt.v}
                type="button"
                onClick={() => setMm({ ...mm, intrabarFraction: opt.v })}
                style={{
                  flex: 1,
                  fontFamily: FONT_SANS,
                  padding: "8px 6px",
                  borderRadius: 7,
                  cursor: "pointer",
                  border: `1.5px solid ${mm.intrabarFraction === opt.v ? C.primary : C.border}`,
                  background: mm.intrabarFraction === opt.v ? C.primary : "#fff",
                  color: mm.intrabarFraction === opt.v ? "#fff" : C.text,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                  transition: "all 0.15s ease",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 800 }}>{opt.l}</span>
                <span style={{ fontSize: 10.5, opacity: mm.intrabarFraction === opt.v ? 0.9 : 0.65 }}>
                  {opt.desc}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(mm.exitTiming || "next_open") === "intrabar" && (
        <div id="box-intrabar-exit-fractions" style={{ marginTop: 6, marginBottom: 16, background: C.primaryLight, border: `1px solid ${C.primary}33`, borderRadius: 8, padding: 14 }}>
          <div style={{ fontFamily: FONT_SANS, fontSize: 13, fontWeight: 700, color: C.primaryDark, marginBottom: 4 }}>
            Frazione di sviluppo candela di uscita (Range High-Low)
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.45 }}>
            La chiusura della posizione avviene nella <b>stessa candela</b> in cui scatta il segnale di uscita, esattamente a <b>1/4</b>, <b>1/2</b> o <b>3/4</b> del suo sviluppo (range <i>High − Low</i>):
            <br />
            • <b>Uscita Long (vendita):</b> <i>Massimo − frazione × (Massimo − Minimo)</i>
            <br />
            • <b>Uscita Short (riacquisto):</b> <i>Minimo + frazione × (Massimo − Minimo)</i>
          </div>
          <div style={{ display: "flex", gap: 10, maxWidth: 440 }}>
            {[
              { v: 0.25, l: "1/4", desc: "25% del range" },
              { v: 0.5, l: "1/2", desc: "50% (punto medio)" },
              { v: 0.75, l: "3/4", desc: "75% del range" },
            ].map((opt) => (
              <button
                id={`btn-intrabar-exit-frac-${opt.l.replace("/", "-")}`}
                key={opt.v}
                type="button"
                onClick={() => setMm({ ...mm, intrabarExitFraction: opt.v })}
                style={{
                  flex: 1,
                  fontFamily: FONT_SANS,
                  padding: "8px 6px",
                  borderRadius: 7,
                  cursor: "pointer",
                  border: `1.5px solid ${(mm.intrabarExitFraction ?? 0.5) === opt.v ? C.primary : C.border}`,
                  background: (mm.intrabarExitFraction ?? 0.5) === opt.v ? C.primary : "#fff",
                  color: (mm.intrabarExitFraction ?? 0.5) === opt.v ? "#fff" : C.text,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 2,
                  transition: "all 0.15s ease",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 800 }}>{opt.l}</span>
                <span style={{ fontSize: 10.5, opacity: (mm.intrabarExitFraction ?? 0.5) === opt.v ? 0.9 : 0.65 }}>
                  {opt.desc}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 4, marginBottom: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 8 }}>
          <input
            id="checkbox-daily-dd"
            type="checkbox"
            checked={mm.dailyDDLimitPct != null}
            onChange={(e) => setMm({ ...mm, dailyDDLimitPct: e.target.checked ? 0.02 : null })}
            style={{ width: 15, height: 15, accentColor: C.primary, cursor: "pointer" }}
          />
          <span style={{ fontFamily: FONT_SANS, fontSize: 13, fontWeight: 600, color: C.primaryDark }}>
            Attiva massimo drawdown giornaliero (circuit breaker)
          </span>
        </label>
        {mm.dailyDDLimitPct != null && (
          <div style={{ maxWidth: 260 }}>
            <Field label="Limite (% del capitale iniziale)" hint="Superato questo limite in una giornata, non si aprono nuove posizioni per il resto del giorno (UTC).">
              <input
                id="input-daily-dd-limit"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={Number.isFinite(mm.dailyDDLimitPct) ? (mm.dailyDDLimitPct! * 100) : ""}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setMm({ ...mm, dailyDDLimitPct: Number.isNaN(v) ? 0 : Math.max(0, v) / 100 });
                }}
                style={inputStyle}
              />
            </Field>
          </div>
        )}
      </div>

      <div style={{ marginTop: 4, marginBottom: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 8 }}>
          <input
            id="checkbox-trading-hours"
            type="checkbox"
            checked={mm.tradingHoursEnabled}
            onChange={(e) => setMm({ ...mm, tradingHoursEnabled: e.target.checked })}
            style={{ width: 15, height: 15, accentColor: C.primary, cursor: "pointer" }}
          />
          <span style={{ fontFamily: FONT_SANS, fontSize: 13, fontWeight: 600, color: C.primaryDark }}>
            Attiva finestra oraria di trading
          </span>
        </label>
        {mm.tradingHoursEnabled && (() => {
          const startValid = parseHHMM(mm.tradingHoursStart) != null;
          const endValid = parseHHMM(mm.tradingHoursEnd) != null;
          const wraps = startValid && endValid && mm.tradingHoursStart > mm.tradingHoursEnd;
          return (
            <div style={{ maxWidth: 420 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Apertura consentita da (UTC)">
                  <input
                    id="input-trading-hours-start"
                    type="time"
                    value={mm.tradingHoursStart}
                    onChange={(e) => setMm({ ...mm, tradingHoursStart: e.target.value })}
                    style={{ ...inputStyle, borderColor: startValid ? undefined : C.red }}
                  />
                </Field>
                <Field label="a (UTC, escluso)">
                  <input
                    id="input-trading-hours-end"
                    type="time"
                    value={mm.tradingHoursEnd}
                    onChange={(e) => setMm({ ...mm, tradingHoursEnd: e.target.value })}
                    style={{ ...inputStyle, borderColor: endValid ? undefined : C.red }}
                  />
                </Field>
              </div>
              <div style={{ fontSize: 11.5, color: C.muted, marginTop: 4 }}>
                Nessuna nuova posizione viene aperta fuori da questa fascia oraria.
                {wraps && <span> Fascia notturna (wrap): attiva da {mm.tradingHoursStart} a mezzanotte e fino alle {mm.tradingHoursEnd}.</span>}
              </div>
            </div>
          );
        })()}
      </div>

      <div style={{ marginTop: 4, marginBottom: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 8 }}>
          <input
            id="checkbox-friday-close"
            type="checkbox"
            checked={mm.fridayCloseEnabled}
            onChange={(e) => setMm({ ...mm, fridayCloseEnabled: e.target.checked })}
            style={{ width: 15, height: 15, accentColor: C.primary, cursor: "pointer" }}
          />
          <span style={{ fontFamily: FONT_SANS, fontSize: 13, fontWeight: 600, color: C.primaryDark }}>
            Attiva chiusura il venerdì (Weekend close)
          </span>
        </label>
        {mm.fridayCloseEnabled && (
          <div style={{ maxWidth: 260 }}>
            <Field label="Orario di chiusura (UTC, venerdì)">
              <input
                id="input-friday-close-time"
                type="time"
                value={mm.fridayCloseTime}
                onChange={(e) => setMm({ ...mm, fridayCloseTime: e.target.value })}
                style={inputStyle}
              />
            </Field>
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
        Una sola posizione alla volta (nessun pyramiding): nuovi segnali durante un trade aperto vengono ignorati.
      </div>

      {sizingBlockedByNoSL && (
        <div style={{ marginTop: 16, background: C.redLight, border: `1px solid ${C.red}33`, borderRadius: 8, padding: 12, fontSize: 12.5, color: C.red }}>
          Sizing a rischio richiede uno Stop Loss definito. Cambia modalità o torna allo Step 2 per aggiungerne uno.
        </div>
      )}

      <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between" }}>
        <Button id="btn-back-step-2" onClick={onBack} variant="ghost" icon={ChevronLeft}>
          Indietro
        </Button>
        <Button
          id="btn-run-simulation"
          onClick={onRunSimulation}
          disabled={Boolean(sizingBlockedByNoSL) || running}
          icon={running ? Loader2 : PlayCircle}
        >
          {running ? "Simulazione in corso..." : "Esegui simulazione"}
        </Button>
      </div>
    </Card>
  );
}

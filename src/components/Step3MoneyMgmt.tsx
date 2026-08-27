import React from "react";
import { PlayCircle, Loader2, ChevronLeft } from "lucide-react";
import { C, FONT_SERIF, FONT_SANS, Card, Button, Field, inputStyle } from "./CommonUI";
import { MoneyManagement, StrategyRules } from "../types";
import { parseHHMM } from "../lib/backtestEngine";

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
          <Field label="Quantità fissa per trade (lotti/contratti)">
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

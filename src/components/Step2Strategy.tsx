import React, { useState, useMemo } from "react";
import {
  Sparkles, Loader2, Info, CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight,
  Code2, Copy, Check, RefreshCw, Wand2, Eye
} from "lucide-react";
import { C, FONT_SERIF, FONT_SANS, FONT_MONO, Card, Button, Field, inputStyle } from "./CommonUI";
import { StrategyRules, ColumnStat } from "../types";
import { renderNode, renderExitRule, buildDefaultRulesTemplate } from "../lib/ruleParser";

interface Step2StrategyProps {
  allColumns: string[];
  stats: Record<string, ColumnStat>;
  strategyText: string;
  setStrategyText: (t: string) => void;
  rulesJson: string;
  rulesNotes: string;
  rulesParsed: StrategyRules | null;
  rulesValidation: { valid: boolean; errors: string[] };
  rulesSource: string;
  aiLoading: boolean;
  aiError: string | null;
  onGenerateRules: () => void;
  onJsonChange: (text: string) => void;
  onBack: () => void;
  onNext: () => void;
}

const PLACEHOLDER_STRATEGY = `Esempio:
Entra long quando trend_prob > 0.65 E daily_return > avg_daily_return E price_regime > avg_price_regime E lma > avg_lma.
Entra short quando trend_prob < 0.35 E daily_return < avg_daily_return E price_regime > avg_price_regime E lma > avg_lma.
Stop Loss fisso a 0.5x ATR. Take profit 1 a 0.75x ATR, chiudi il 50% della posizione. Take profit 2 a 3x ATR, chiudi il restante 50%. Timeout dopo 20 candele.`;

const DEFAULT_SAMPLE_PROMPT = `Entra long quando trend_prob > 0.65 E daily_return > avg_daily_return E price_regime > avg_price_regime E lma > avg_lma.
Entra short quando trend_prob < 0.35 E daily_return < avg_daily_return E price_regime > avg_price_regime E lma > avg_lma.
Stop Loss fisso a 0.5x ATR. Take profit 1 a 0.75x ATR, chiudi il 50% della posizione. Take profit 2 a 3x ATR, chiudi il restante 50%. Timeout dopo 20 candele.`;

export function Step2Strategy({
  allColumns,
  strategyText,
  setStrategyText,
  rulesJson,
  rulesNotes,
  rulesParsed,
  rulesValidation,
  rulesSource,
  aiLoading,
  aiError,
  onGenerateRules,
  onJsonChange,
  onBack,
  onNext,
}: Step2StrategyProps) {
  const [copied, setCopied] = useState(false);

  const handleApplySamplePrompt = () => {
    setStrategyText(DEFAULT_SAMPLE_PROMPT);
  };

  const handleAiButtonClick = () => {
    if (!strategyText.trim()) {
      setStrategyText(DEFAULT_SAMPLE_PROMPT);
      // Generate with default sample prompt
      setTimeout(() => {
        onGenerateRules();
      }, 50);
      return;
    }
    onGenerateRules();
  };

  // Check JSON syntax status
  const jsonSyntaxError = useMemo<string | null>(() => {
    if (!rulesJson.trim()) return "Il campo JSON è vuoto.";
    try {
      JSON.parse(rulesJson);
      return null;
    } catch (e: any) {
      return e.message || "Errore di sintassi JSON.";
    }
  }, [rulesJson]);

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(rulesJson);
      onJsonChange(JSON.stringify(parsed, null, 2));
    } catch {
      // ignore if invalid
    }
  };

  const handleResetTemplate = () => {
    const template = buildDefaultRulesTemplate(allColumns);
    onJsonChange(JSON.stringify(template, null, 2));
  };

  const handleCopyJson = () => {
    if (!rulesJson) return;
    navigator.clipboard.writeText(rulesJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isJsonValid = !jsonSyntaxError && rulesValidation.valid;

  return (
    <div id="step-2-container">
      {/* Step Header */}
      <Card id="step-2-card" style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: FONT_SERIF, fontSize: 19, color: C.primaryDark, marginTop: 0 }}>
          2. Descrivi la strategia &amp; Regole JSON
        </h2>
        <div style={{ fontSize: 13, color: C.muted, marginTop: -6, marginBottom: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 600, color: C.primaryDark }}>Colonne prezzo OHLC:</span>
            {["open", "high", "low", "close"].map((c) => (
              <code
                key={c}
                style={{
                  fontFamily: FONT_MONO,
                  background: C.primaryLight,
                  color: C.primaryDark,
                  border: `1px solid ${C.primary}33`,
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                {c}
              </code>
            ))}
            {allColumns.filter((c) => !["open", "high", "low", "close"].includes(c)).length > 0 && (
              <>
                <span style={{ fontWeight: 600, color: C.primaryDark, marginLeft: 8 }}>Indicatori disponibili:</span>
                {allColumns
                  .filter((c) => !["open", "high", "low", "close"].includes(c))
                  .map((c) => (
                    <code
                      key={c}
                      style={{
                        fontFamily: FONT_MONO,
                        background: "#f0efe8",
                        color: C.text,
                        padding: "2px 6px",
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                    >
                      {c}
                    </code>
                  ))}
              </>
            )}
          </div>
        </div>

        {/* Natural Language Generation Section */}
        <div style={{ background: "#FBFBFA", border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginBottom: 20 }}>
          <Field
            label="Descrizione in linguaggio naturale (opzionale con AI)"
            hint="Scrivi la logica in italiano o carica un prompt: l'AI compilerà automaticamente il JSON sottostante."
          >
            <textarea
              id="textarea-strategy-prompt"
              value={strategyText}
              onChange={(e) => setStrategyText(e.target.value)}
              placeholder={PLACEHOLDER_STRATEGY}
              rows={4}
              style={{ ...inputStyle, fontFamily: FONT_SANS, fontSize: 13.5, resize: "vertical" }}
            />
          </Field>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <Button
              id="btn-generate-rules-ai"
              onClick={handleAiButtonClick}
              disabled={aiLoading}
              icon={aiLoading ? Loader2 : Wand2}
            >
              {aiLoading ? "Genero le regole con AI..." : "Genera regole con AI"}
            </Button>

            {!strategyText.trim() && (
              <button
                type="button"
                id="btn-use-sample-prompt"
                onClick={handleApplySamplePrompt}
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 12,
                  padding: "6px 11px",
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: C.primaryDark,
                  cursor: "pointer",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Sparkles size={13} color={C.primary} />
                Carica testo di esempio
              </button>
            )}

            <span style={{ fontSize: 12, color: C.muted }}>
              {strategyText.trim()
                ? "Premi per convertire la strategia in regole JSON eseguibili dal backtester."
                : "Clicca per inserire l'esempio o digita la tua logica in italiano."}
            </span>
          </div>

          {aiError && (
            <div id="box-ai-error" style={{ marginTop: 12, background: C.redLight, border: `1px solid ${C.red}33`, borderRadius: 8, padding: 12, fontSize: 13, color: C.red }}>
              {aiError}
            </div>
          )}
        </div>

        {/* ALWAYS VISIBLE & EDITABLE JSON RULES PANEL */}
        <div
          id="box-always-visible-json-editor"
          style={{
            border: `1.5px solid ${jsonSyntaxError ? C.red : rulesValidation.valid ? C.primary : C.amber}`,
            borderRadius: 8,
            background: "#FFFFFF",
            padding: "16px 18px",
            marginBottom: 20,
            boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
          }}
        >
          {/* Panel Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Code2 size={18} color={C.primaryDark} />
              <span style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 14, color: C.primaryDark }}>
                Pannello Regole JSON (Sempre modificabile)
              </span>
              {/* Status Badge */}
              {jsonSyntaxError ? (
                <span style={{ background: C.redLight, color: C.red, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, fontFamily: FONT_MONO }}>
                  Errore Sintassi JSON
                </span>
              ) : rulesValidation.valid ? (
                <span style={{ background: C.primaryLight, color: C.primaryDark, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, fontFamily: FONT_MONO, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <CheckCircle2 size={11} /> JSON Valido
                </span>
              ) : (
                <span style={{ background: C.amberLight, color: C.amber, padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 700, fontFamily: FONT_MONO }}>
                  Validazione incompleta
                </span>
              )}
            </div>

            {/* Action Buttons for JSON */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button
                type="button"
                id="btn-format-json"
                onClick={handleFormatJson}
                disabled={!!jsonSyntaxError}
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 12,
                  padding: "4px 9px",
                  borderRadius: 5,
                  border: `1px solid ${C.border}`,
                  background: "#fff",
                  color: jsonSyntaxError ? C.muted : C.text,
                  cursor: jsonSyntaxError ? "not-allowed" : "pointer",
                  fontWeight: 600,
                }}
                title="Formatta e indenta il JSON"
              >
                Formatta JSON
              </button>

              <button
                type="button"
                id="btn-reset-template"
                onClick={handleResetTemplate}
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 12,
                  padding: "4px 9px",
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
                title="Carica un modello base valido con le colonne attuali"
              >
                <RefreshCw size={12} /> Ripristina modello
              </button>

              <button
                type="button"
                id="btn-copy-json"
                onClick={handleCopyJson}
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 12,
                  padding: "4px 9px",
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
                title="Copia JSON negli appunti"
              >
                {copied ? <Check size={12} color={C.primary} /> : <Copy size={12} />}
                {copied ? "Copiato!" : "Copia"}
              </button>
            </div>
          </div>

          {/* JSON Textarea */}
          <textarea
            id="textarea-rules-json"
            value={rulesJson}
            onChange={(e) => onJsonChange(e.target.value)}
            rows={15}
            spellCheck={false}
            style={{
              ...inputStyle,
              fontFamily: FONT_MONO,
              fontSize: 12.5,
              lineHeight: 1.45,
              resize: "vertical",
              background: "#FAF9F5",
              border: `1px solid ${jsonSyntaxError ? C.red : C.border}`,
            }}
            placeholder={`{\n  "entry_long": { "type": "condition", "left": "close", "op": ">", "right": "open" },\n  "stop_loss": { "type": "none" },\n  "take_profits": [],\n  "timeout_bars": 200\n}`}
          />

          {/* Real-time Syntax & Validation Messages */}
          <div style={{ marginTop: 10 }}>
            {jsonSyntaxError ? (
              <div id="box-json-syntax-error" style={{ background: C.redLight, border: `1px solid ${C.red}44`, borderRadius: 6, padding: "8px 12px", fontSize: 12.5, color: C.red }}>
                <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
                <b>Errore di sintassi JSON:</b> {jsonSyntaxError}
              </div>
            ) : rulesValidation.errors.length > 0 ? (
              <div id="box-validation-errors" style={{ background: C.redLight, border: `1px solid ${C.red}33`, borderRadius: 6, padding: "8px 12px", fontSize: 12.5, color: C.red }}>
                <b>Errori di validazione semantica:</b>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {rulesValidation.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div id="box-validation-success" style={{ background: C.primaryLight, border: `1px solid ${C.primary}33`, borderRadius: 6, padding: "8px 12px", fontSize: 12.5, color: C.primaryDark, display: "flex", alignItems: "center", gap: 6 }}>
                <CheckCircle2 size={14} color={C.primaryDark} />
                <span><b>Regole convalidate:</b> La sintassi JSON e tutti i parametri di trading sono pronti per il backtest.</span>
              </div>
            )}
          </div>
        </div>

        {/* Visual Interpretation & Strategy Logic Summary */}
        <div style={{ marginTop: 24, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Eye size={17} color={C.primaryDark} />
            <h3 style={{ fontFamily: FONT_SERIF, fontSize: 16, color: C.primaryDark, margin: 0 }}>
              Anteprima &amp; Interpretazione Logica della Strategia
            </h3>
          </div>

          {rulesParsed ? (
            <div>
              {/* Origin Badge */}
              {rulesSource === "template" && (
                <div style={{ background: "#f4f3ee", border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px 12px", fontSize: 12.5, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: FONT_SANS, fontSize: 10.5, fontWeight: 800, background: C.muted, color: "#fff", borderRadius: 4, padding: "2px 7px", flexShrink: 0 }}>MODELLO</span>
                  <span>Modello di partenza predefinito generato sulle colonne del dataset. Modifica direttamente il JSON sopra oppure genera con AI.</span>
                </div>
              )}
              {rulesSource === "heuristic" && (
                <div style={{ background: C.amberLight, border: `1px solid ${C.amber}55`, borderRadius: 7, padding: "8px 12px", fontSize: 12.5, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: FONT_SANS, fontSize: 10.5, fontWeight: 800, background: C.amber, color: "#fff", borderRadius: 4, padding: "2px 7px", flexShrink: 0 }}>EURISTICO</span>
                  <span>Generato con il parser locale di riserva.</span>
                </div>
              )}
              {rulesSource === "ai" && (
                <div style={{ background: C.primaryLight, border: `1px solid ${C.primary}33`, borderRadius: 7, padding: "8px 12px", fontSize: 12.5, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: FONT_SANS, fontSize: 10.5, fontWeight: 800, background: C.primary, color: "#fff", borderRadius: 4, padding: "2px 7px", flexShrink: 0 }}>AI GEMINI</span>
                  <span style={{ color: C.primaryDark }}>Regole sintetizzate con successo dal modello AI.</span>
                </div>
              )}

              {rulesNotes && (
                <div id="box-rules-interpretation" style={{ background: C.amberLight, border: `1px solid ${C.amber}55`, borderRadius: 8, padding: 12, fontSize: 13, marginBottom: 14 }}>
                  <Info size={13} style={{ verticalAlign: -2 }} color={C.amber} /> <b>Come ho interpretato:</b> {rulesNotes}
                </div>
              )}

              {/* Conditions tree */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div id="box-visual-long" style={{ background: "#f4f3ee", borderRadius: 8, padding: 12, fontSize: 12.5, fontFamily: FONT_MONO }}>
                  <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 11, color: C.primaryDark, marginBottom: 6, textTransform: "uppercase" }}>Ingresso Long</div>
                  {renderNode(rulesParsed.entry_long)}
                </div>
                <div id="box-visual-short" style={{ background: "#f4f3ee", borderRadius: 8, padding: 12, fontSize: 12.5, fontFamily: FONT_MONO }}>
                  <div style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 11, color: C.primaryDark, marginBottom: 6, textTransform: "uppercase" }}>Ingresso Short</div>
                  {rulesParsed.entry_short ? renderNode(rulesParsed.entry_short) : <span style={{ color: C.muted }}>(nessuna — solo long)</span>}
                </div>
              </div>

              {/* SL / TP / Timeout */}
              <div style={{ fontSize: 12.5, marginBottom: 14, color: C.text, background: "#FAF9F5", padding: "10px 14px", borderRadius: 7, border: `1px solid ${C.border}` }}>
                <b>Uscita:</b> SL:{" "}
                {(() => {
                  const sl = rulesParsed.stop_loss;
                  if (!sl || sl.type === "none") return "nessuno";
                  if (sl.type === "atr_mult") return `${sl.mult}× ATR (${rulesParsed.atr_column || "non specificato"})`;
                  if (sl.type === "fixed_points") return `${sl.value} punti fissi`;
                  if (sl.type === "monetary") return `$${sl.value} (monetario max)`;
                  if (sl.type === "prev_candle_low") return `min candela segnale${sl.offset ? ` − ${sl.offset} pt` : ""} (solo long)`;
                  if (sl.type === "prev_candle_high") return `max candela segnale${sl.offset ? ` + ${sl.offset} pt` : ""} (solo short)`;
                  if (sl.type === "prev_candle_extreme") return `min/max candela segnale${sl.offset ? ` ± ${sl.offset} pt` : ""} (adattivo long/short)`;
                  if (sl.type === "before_signal_low") return `min candela PRIMA del segnale${sl.offset ? ` − ${sl.offset} pt` : ""} (solo long)`;
                  if (sl.type === "before_signal_high") return `max candela PRIMA del segnale${sl.offset ? ` + ${sl.offset} pt` : ""} (solo short)`;
                  if (sl.type === "before_signal_extreme") return `min/max candela PRIMA del segnale${sl.offset ? ` ± ${sl.offset} pt` : ""} (adattivo long/short)`;
                  return sl.type;
                })()}
                {" · "}TP:{" "}
                {(rulesParsed.take_profits || [])
                  .map((tp) => {
                    const dist = tp.monetary != null ? `$${tp.monetary}` : tp.r_mult != null ? `${tp.r_mult}R` : `${tp.mult}×ATR`;
                    return `${dist}→${tp.close_pct}%`;
                  })
                  .join(", ") || "nessuno"}
                {" · "}Timeout: {rulesParsed.timeout_bars ?? 200} candele
                {" · "}Esecuzione: {rulesParsed.entry_timing === "same_close" ? "chiusura candela segnale" : "apertura candela successiva"}
              </div>

              {/* Signal Exit Rules */}
              {(rulesParsed.exit_long || rulesParsed.exit_short) && (
                <div id="box-signal-exit-rules" style={{ fontSize: 12.5, marginBottom: 12, color: C.text, background: "#f4f3ee", borderRadius: 7, padding: "9px 12px" }}>
                  <div style={{ fontWeight: 700, color: C.primaryDark, marginBottom: 4 }}>Condizioni di uscita da segnale:</div>
                  {rulesParsed.exit_long && (
                    <div style={{ marginTop: 3 }}>
                      <b>Long</b> → <span style={{ fontFamily: FONT_MONO }}>{renderExitRule(rulesParsed.exit_long)}</span>
                    </div>
                  )}
                  {rulesParsed.exit_short && (
                    <div style={{ marginTop: 3 }}>
                      <b>Short</b> → <span style={{ fontFamily: FONT_MONO }}>{renderExitRule(rulesParsed.exit_short)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* SL after TP1 info */}
              {(() => {
                const atp = rulesParsed.after_tp1_sl;
                if (atp === "breakeven")
                  return (
                    <div style={{ background: C.primaryLight, border: `1px solid ${C.primary}33`, borderRadius: 7, padding: "8px 12px", fontSize: 12.5, marginBottom: 10 }}>
                      <b>SL dopo TP1:</b> <span style={{ fontFamily: FONT_MONO }}>breakeven</span> — dopo il primo TP, lo stop si sposta al prezzo di entrata.
                    </div>
                  );
                if (typeof atp === "object" && atp?.type === "trail_atr_mult")
                  return (
                    <div style={{ background: C.amberLight, border: `1px solid ${C.amber}55`, borderRadius: 7, padding: "8px 12px", fontSize: 12.5, marginBottom: 10 }}>
                      <b>SL dopo TP1:</b> <span style={{ fontFamily: FONT_MONO }}>trailing {atp.mult}× ATR</span> — dopo il primo TP, lo stop segue il prezzo al massimo/minimo raggiunto.
                    </div>
                  );
                return null;
              })()}

              {rulesParsed.trailing_stop && (
                <div style={{ background: "#fff3cd", border: `1px solid ${C.amber}88`, borderRadius: 7, padding: "8px 12px", fontSize: 12.5, marginBottom: 10 }}>
                  <b>Trailing stop da ingresso:</b> <span style={{ fontFamily: FONT_MONO }}>{rulesParsed.trailing_stop.mult}× ATR</span> — lo stop segue il prezzo da inizio trade.
                </div>
              )}
            </div>
          ) : (
            <div style={{ background: "#FAF9F5", border: `1px dashed ${C.border}`, borderRadius: 8, padding: 16, textAlign: "center", color: C.muted, fontSize: 13 }}>
              Inserisci o correggi il JSON nel pannello sopra per visualizzare l'anteprima strutturata delle condizioni di ingresso, stop loss e take profit.
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between" }}>
          <Button id="btn-back-step-1" onClick={onBack} variant="ghost" icon={ChevronLeft}>
            Indietro
          </Button>
          <Button
            id="btn-next-step-3"
            onClick={onNext}
            disabled={!rulesValidation.valid}
            icon={ChevronRight}
            style={{ flexDirection: "row-reverse" }}
          >
            Avanti: Money Management
          </Button>
        </div>
      </Card>
    </div>
  );
}

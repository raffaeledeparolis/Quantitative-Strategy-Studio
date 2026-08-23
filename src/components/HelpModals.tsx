import { useState } from "react";
import { X, Info, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { C, FONT_SERIF, FONT_SANS, FONT_MONO, Button } from "./CommonUI";

const HELP_STEPS = [
  {
    n: 1, icon: "📂", title: "Carica i dataset",
    content: [
      "Prepara i tuoi file CSV con la struttura richiesta: la prima riga deve contenere i nomi delle colonne (intestazione obbligatoria). Le prime cinque colonne vengono sempre interpretate come datetime, open, high, low, close — in quest'ordine, qualunque sia il nome che dai loro. Dalla sesta colonna in poi puoi inserire i tuoi indicatori: i nomi che scegli nell'intestazione vengono usati direttamente dall'AI nel passo successivo.",
      "Esempio di intestazione: datetime;open;high;low;close;trend_prob;avg_trend_prob;atr_14",
      "Il separatore può essere ; oppure ,. Puoi caricare più file contemporaneamente (un file per indicatore, tutti allineati sullo stesso timestamp). Il tool verifica automaticamente che i prezzi open/high/low/close siano coerenti tra i file e segnala eventuali righe scartate.",
    ],
    note: "Se i tuoi file non hanno l'intestazione, aggiungila manualmente — è l'unico requisito non negoziabile.",
  },
  {
    n: 2, icon: "💬", title: "Descrivi la strategia in linguaggio naturale",
    content: [
      "Scrivi la tua strategia a parole, come la spiegheresti a un collega. L'AI traduce automaticamente il testo in un JSON eseguibile. Puoi descrivere condizioni di ingresso, stop loss, take profit parziali, e condizioni di uscita basate sugli indicatori.",
      "Esempi di frasi riconosciute: «Entra long quando trend_prob supera 0.65 e daily_return è maggiore della sua media» · «Stop loss al minimo della candela precedente» · «Take profit a 2R, chiudi il 50% a 1.5R e il resto a 3R» · «Esci dal long quando trend_prob scende sotto 0.4»",
      "Il JSON generato viene mostrato e può essere modificato a mano prima di procedere. La validazione è in tempo reale: errori, campi mancanti e colonne inesistenti vengono segnalati immediatamente.",
    ],
    note: "Tipi di stop loss supportati: ATR-multiplo, punti fissi, minimo/massimo della candela segnale (con buffer opzionale). Take profit: multiplo ATR oppure multiplo R (Risk/Reward). È possibile definire quante gambe parziali si vuole.",
  },
  {
    n: 3, icon: "⚙️", title: "Money Management",
    content: [
      "Imposta il capitale iniziale, la modalità di dimensionamento della posizione (rischio fisso % dell'equity corrente oppure quantità fissa), e il costo di transazione (spread, in punti prezzo).",
      "Timing di ingresso: puoi scegliere tra apertura della candela successiva (consigliato, evita look-ahead bias), chiusura della candela del segnale, oppure apertura intra-candela con frazioni fisse (1/4, 1/2, 3/4 dello sviluppo del range High-Low).",
      "Timing di uscita: puoi scegliere se far chiudere la posizione alla candela seguente al segnale di uscita (default) oppure con chiusura intra-candela con frazioni fisse (1/4, 1/2 o 3/4 dello sviluppo High-Low della candela stessa in cui scatta il segnale).",
      "Con il sizing a rischio fisso, la size di ogni trade viene calcolata automaticamente in modo che — se lo stop loss venisse colpito — la perdita corrispondesse esattamente alla percentuale di equity impostata.",
    ],
    note: "Nessun pyramiding: viene aperta una sola posizione alla volta. Nuovi segnali durante un trade aperto vengono ignorati.",
  },
  {
    n: 4, icon: "📊", title: "Report",
    content: [
      "Il backtest viene eseguito sull'intero dataset con la strategia e il money management configurati. Il report mostra: equity curve con drawdown, KPI principali (rendimento, profit factor, win rate, Sharpe, recovery factor, max consecutivi), equity curve separata long/short, P&L mensile/settimanale, distribuzione dei P&L per trade, breakdown per motivo di uscita.",
      "Il trade log completo (con tutte le colonne di dettaglio) è esportabile come CSV con un click.",
    ],
    note: "I grafici dell'equity curve per direzione mostrano cosa avrebbe prodotto la strategia se avessero operato solo il lato long oppure solo il lato short — utile per capire quale contribuisce davvero alla performance.",
  },
  {
    n: 5, icon: "🎲", title: "Monte Carlo",
    content: [
      "Ricampiona i trade del backtest per generare migliaia di sequenze alternative e stimare la distribuzione delle possibili performance. Puoi scegliere tra bootstrap (reinserimento — valuta anche l'incertezza campionaria) e permutazione (solo riordino degli stessi trade — isola il puro effetto-sequenza).",
      "Risultati: rischio di rovina (probabilità di scendere sotto la soglia impostata), profit factor e drawdown nei casi peggiori (5° percentile), fan chart dei percorsi simulati con la curva reale sovrapposta, istogrammi della distribuzione.",
      "Al termine viene generato automaticamente un giudizio di affidabilità su base 100 con dettaglio per criterio e un elenco di miglioramenti suggeriti, ordinati per severità.",
    ],
    note: "Ogni trade viene convertito in rendimento % sull'equity del momento, così il ricampionamento è coerente con il sizing a rischio.",
  },
  {
    n: 6, icon: "🔬", title: "Scenario & Ottimizzazione",
    content: [
      "Lo Step 6 offre due metodologie complementari chiaramente distinte:",
      "1. Sensitività 1D (Monovariata): analizza la stabilità di ogni singolo parametro a parità degli altri (ceteris paribus). Consente di individuare la presenza di plateau stabili ed evitare picchi isolati vulnerabili all'overfitting. Include curve 1D interattive per 7 metriche e la mappa d'impatto complessiva.",
      "2. Ottimizzazione Multi-parametrica: ricerca la migliore combinazione congiunta di parametri tramite Grid Search (congiunta cartesiana con heatmap di superficie 2D) o Coordinate Descent (iterativa veloce). Permette di selezionare liberamente i parametri da ottimizzare, scegliere tra 8 funzioni obiettivo e confrontare la strategia base vs ottimizzata con curva di equity e delta prestazioni.",
    ],
    note: "L'ottimizzazione è calcolata In-Sample: stima i migliori parametri sui dati storici. Per validare l'effettiva robustezza ed evitare il curve-fitting, passa allo Step 7: Walk-Forward Validation.",
  },
  {
    n: 7, icon: "⏩", title: "Walk-Forward",
    content: [
      "Divide il dataset in finestre In-Sample (IS) e Out-Of-Sample (OOS) ed esegue la strategia invariata su entrambi. Tre modalità: Strategia base (nessuna ottimizzazione), Parametri ottimizzati (applica i valori trovati nello Step 6 a tutti i fold), Walk-Forward Optimization — WFO (per ogni finestra IS ri-ottimizza i parametri selezionati, poi valida sull'OOS corrispondente).",
      "Nella modalità WFO puoi selezionare quali parametri scansionare (soglie, moltiplicatori SL/TP, frazioni di chiusura) e personalizzare i rispettivi range (min, max, passi), oltre a scegliere la funzione obiettivo per l'ottimizzazione IS (score composito, rendimento, profit factor, win rate, Sharpe, expectancy, drawdown, recovery factor).",
      "I risultati includono l'efficiency ratio (OOS/IS), la curva di equity concatenata OOS, la tabella di degradazione per metrica, il dettaglio fold per fold e — in WFO — la tabella comparativa dei valori ottimali trovati per ciascun parametro scansionato con grafici di stabilità nel tempo.",
    ],
    note: "Un efficiency ratio vicino a 1 su tutti i fold è il segnale più favorevole di robustezza reale della strategia. Valori molto diversi da fold a fold nella tabella WFO indicano instabilità parametrica.",
  },
];

const CSV_EXAMPLE = `datetime;open;high;low;close;trend_prob;avg_trend_prob;atr_14
2026.01.05 11:00;3200.10;3205.00;3198.00;3202.50;0.55;0.50;12.30
2026.01.06 09:00;3202.50;3210.00;3201.00;3208.00;0.61;0.51;12.10`;

const STRATEGY_EXAMPLES = [
  { label: "Strategia basica ATR", text: "Entra long quando trend_prob è maggiore di 0.65 e daily_return supera avg_daily_return. Entra short quando trend_prob è minore di 0.35 e daily_return è sotto avg_daily_return. Stop loss a 0.5 volte l'ATR. Take profit a 0.75 ATR chiudi il 50%, a 3 ATR chiudi il resto. Timeout 20 candele." },
  { label: "Strategia Risk/Reward", text: "Entra long quando trend_prob supera 0.65. Stop loss al minimo della candela segnale. Take profit a 1.5R chiudi il 50%, a 3R chiudi il resto. Porta lo stop a pareggio dopo il primo TP. Timeout 30 candele." },
  { label: "Uscita da segnale", text: "Entra long quando trend_prob supera 0.65 e price_regime è maggiore di avg_price_regime. Esci dal long quando trend_prob scende sotto 0.4. Stop loss a 0.5 ATR. Take profit a 2 ATR, chiudi tutto. Timeout 25 candele." },
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  const [activeStep, setActiveStep] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 2000); });
  };

  return (
    <div id="modal-help-backdrop" style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "32px 16px", overflowY: "auto",
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div id="modal-help-container" style={{
        background: C.card, borderRadius: 12, width: "100%", maxWidth: 820,
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", maxHeight: "90vh",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 28px 16px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div>
            <h2 style={{ fontFamily: FONT_SERIF, fontSize: 21, color: C.primaryDark, margin: "0 0 3px" }}>Guida all'uso — Strategy Lab</h2>
            <div style={{ fontFamily: FONT_SANS, fontSize: 12.5, color: C.muted }}>Clicca su uno step per leggere le istruzioni dettagliate</div>
          </div>
          <button id="btn-close-help" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: C.muted }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ width: 210, flexShrink: 0, borderRight: `1px solid ${C.border}`, overflowY: "auto", padding: "12px 0" }}>
            {HELP_STEPS.map((s, idx) => (
              <button id={`btn-help-step-${s.n}`} key={s.n} onClick={() => setActiveStep(idx)} style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 18px",
                fontFamily: FONT_SANS, fontSize: 13, textAlign: "left", cursor: "pointer", border: "none",
                background: activeStep === idx ? C.primaryLight : "transparent",
                color: activeStep === idx ? C.primaryDark : C.text,
                fontWeight: activeStep === idx ? 700 : 400,
                borderLeft: `3px solid ${activeStep === idx ? C.primary : "transparent"}`,
              }}>
                <span style={{ fontSize: 16 }}>{s.icon}</span>
                <span>Step {s.n}<br /><span style={{ fontWeight: 400, fontSize: 11.5, color: C.muted }}>{s.title}</span></span>
              </button>
            ))}
            <div style={{ borderTop: `1px solid ${C.border}`, margin: "12px 0" }} />
            <button id="btn-help-examples" onClick={() => setActiveStep(HELP_STEPS.length)} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 18px",
              fontFamily: FONT_SANS, fontSize: 13, textAlign: "left", cursor: "pointer", border: "none",
              background: activeStep === HELP_STEPS.length ? C.primaryLight : "transparent",
              color: activeStep === HELP_STEPS.length ? C.primaryDark : C.text,
              fontWeight: activeStep === HELP_STEPS.length ? 700 : 400,
              borderLeft: `3px solid ${activeStep === HELP_STEPS.length ? C.primary : "transparent"}`,
            }}>
              <span style={{ fontSize: 16 }}>💡</span>
              <span>Esempi<br /><span style={{ fontWeight: 400, fontSize: 11.5, color: C.muted }}>CSV e strategie</span></span>
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
            {activeStep < HELP_STEPS.length ? (() => {
              const s = HELP_STEPS[activeStep];
              return (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: C.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{s.icon}</div>
                    <div>
                      <div style={{ fontFamily: FONT_SANS, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: C.primary, fontWeight: 700 }}>Step {s.n}</div>
                      <h3 style={{ fontFamily: FONT_SERIF, fontSize: 18, color: C.primaryDark, margin: 0 }}>{s.title}</h3>
                    </div>
                  </div>
                  {s.content.map((para, i) => (
                    <p key={i} style={{ fontSize: 14, lineHeight: 1.7, color: C.text, marginTop: 0, marginBottom: 14 }}>{para}</p>
                  ))}
                  {s.note && (
                    <div style={{ background: C.amberLight, border: `1px solid ${C.amber}55`, borderRadius: 8, padding: "10px 14px", fontSize: 13, lineHeight: 1.6, marginTop: 18 }}>
                      <Info size={13} color={C.amber} style={{ verticalAlign: -2, marginRight: 5 }} />
                      {s.note}
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28 }}>
                    <Button variant="ghost" icon={ChevronLeft} disabled={activeStep === 0} onClick={() => setActiveStep((p) => p - 1)}>Precedente</Button>
                    <Button icon={ChevronRight} style={{ flexDirection: "row-reverse" }} disabled={activeStep === HELP_STEPS.length - 1} onClick={() => setActiveStep((p) => p + 1)}>Successivo</Button>
                  </div>
                </div>
              );
            })() : (
              <div>
                <h3 style={{ fontFamily: FONT_SERIF, fontSize: 18, color: C.primaryDark, marginTop: 0 }}>Esempi pratici</h3>
                <h4 style={{ fontFamily: FONT_SANS, fontSize: 13, color: C.primaryDark, marginBottom: 8 }}>Formato CSV</h4>
                <div style={{ position: "relative", marginBottom: 24 }}>
                  <pre style={{ background: "#f4f3ee", borderRadius: 8, padding: "12px 14px", fontSize: 12, fontFamily: FONT_MONO, overflowX: "auto", margin: 0, lineHeight: 1.5 }}>{CSV_EXAMPLE}</pre>
                  <button id="btn-copy-csv-sample" onClick={() => copyToClipboard(CSV_EXAMPLE, "csv")} style={{
                    position: "absolute", top: 8, right: 8, fontFamily: FONT_SANS, fontSize: 11, padding: "4px 10px",
                    border: `1px solid ${C.border}`, borderRadius: 5, background: "#fff", cursor: "pointer", color: C.muted,
                  }}>{copied === "csv" ? "✓ Copiato" : "Copia"}</button>
                </div>
                <h4 style={{ fontFamily: FONT_SANS, fontSize: 13, color: C.primaryDark, marginBottom: 8 }}>Descrizioni di strategia (da incollare nello Step 2)</h4>
                {STRATEGY_EXAMPLES.map((ex, i) => (
                  <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontFamily: FONT_SANS, fontWeight: 700, fontSize: 13, color: C.primaryDark }}>{ex.label}</span>
                      <button id={`btn-copy-strat-${i}`} onClick={() => copyToClipboard(ex.text, `strat-${i}`)} style={{
                        fontFamily: FONT_SANS, fontSize: 11, padding: "4px 10px",
                        border: `1px solid ${C.border}`, borderRadius: 5, background: "#fff", cursor: "pointer", color: C.muted,
                      }}>{copied === `strat-${i}` ? "✓ Copiato" : "Copia"}</button>
                    </div>
                    <p style={{ fontFamily: FONT_SANS, fontSize: 13, color: C.text, margin: 0, lineHeight: 1.6 }}>{ex.text}</p>
                  </div>
                ))}
                <div style={{ background: C.primaryLight, border: `1px solid ${C.primary}33`, borderRadius: 8, padding: "10px 14px", fontSize: 13, marginTop: 8 }}>
                  <CheckCircle2 size={13} color={C.primaryDark} style={{ verticalAlign: -2, marginRight: 5 }} />
                  Incolla una di queste descrizioni nello Step 2, clicca <b>Genera regole con AI</b> e verifica il JSON prodotto prima di procedere.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const JSON_HELP_SECTIONS = [
  {
    id: "overview", icon: "🗂️", title: "Struttura generale",
    content: [
      "Il JSON della strategia è un unico oggetto con campi fissi. Ogni campo controlla un aspetto della strategia: quando entrare, quando uscire, dove piazzare stop loss e take profit, come gestirli nel tempo.",
      "Puoi modificare il JSON direttamente nell'editor dello Step 2 — la validazione si aggiorna in tempo reale e segnala errori (campi mancanti, colonne inesistenti, valori fuori range) man mano che digiti.",
    ],
    code: `{
  "entry_long": <ConditionNode> | null,
  "entry_short": <ConditionNode> | null,
  "exit_long": <ConditionNode> | <SignalExitRule> | [ ... ] | null,
  "exit_short": <ConditionNode> | <SignalExitRule> | [ ... ] | null,
  "atr_column": "<nome colonna>" | null,
  "stop_loss": <StopLossNode>,
  "take_profits": [ <TakeProfitLeg>, ... ],
  "after_tp1_sl": "original" | "breakeven" | {"type":"trail_atr_mult","mult":number},
  "trailing_stop": {"type":"trail_atr_mult","mult":number} | null,
  "timeout_bars": integer,
  "entry_timing": "next_open" | "same_close",
  "notes": "spiegazione testuale, opzionale"
}`,
  },
  {
    id: "conditions", icon: "⚖️", title: "Condizioni (entry / exit)",
    content: [
      "entry_long ed entry_short determinano quando aprire una posizione. exit_long ed exit_short determinano uscite basate su indicatori/segnali, valutate alla chiusura di ogni barra ed eseguite all'apertura della successiva.",
      "Le condizioni di uscita (exit_long / exit_short) supportano sia la chiusura TOTALE (100%) che la CHIUSURA PARZIALE in percentuale (es. chiudi il 50% su segnale di ipercomprato/ipervenduto, lasciando correre il residuo fino a TP o trailing stop).",
    ],
    code: `// Condizione singola (chiusura 100%)
{"type":"condition","left":"trend_prob","op":"<","right":0.4}

// Uscita con chiusura parziale (es. 50% della posizione)
{"condition":{"type":"condition","left":"rsi","op":">","right":70},"close_pct":50}
// oppure sintassi diretta:
{"type":"condition","left":"rsi","op":">","right":70,"close_pct":50}

// Uscite multiple progressive su segnale
[
  {"condition":{"type":"condition","left":"rsi","op":">","right":70},"close_pct":50},
  {"condition":{"type":"condition","left":"close","op":"<","right":"sma_50"},"close_pct":100}
]

// Gruppo AND/OR annidabile
{"type":"group","operator":"AND","conditions":[
  {"type":"condition","left":"trend_prob","op":">","right":0.65},
  {"type":"condition","left":"daily_return","op":">","right":"avg_daily_return"}
]}`,
    note: "Operatori disponibili: > < >= <= == !=. I nomi delle colonne devono corrispondere esattamente (case-sensitive) a quelli caricati nello Step 1.",
  },
  {
    id: "atr", icon: "📏", title: "atr_column",
    content: [
      "Indica quale colonna del dataset rappresenta l'ATR (Average True Range), necessaria ogni volta che stop loss o take profit usano un moltiplicatore ATR.",
      "Se la strategia non usa multipli ATR da nessuna parte (es. stop loss basato solo su candele o punti fissi, take profit solo a multipli R), puoi lasciare atr_column a null.",
    ],
    code: `"atr_column": "atr_14"`,
  },
  {
    id: "stoploss", icon: "🛑", title: "stop_loss — tutti i tipi",
    content: [
      "Il campo stop_loss accetta esattamente uno di questi formati, a seconda di come vuoi ancorare il livello di protezione.",
    ],
    code: `// Multiplo di ATR dall'entry
{"type":"atr_mult","mult":0.5}

// Punti fissi dall'entry
{"type":"fixed_points","value":15}

// Minimo/massimo della CANDELA SEGNALE stessa
{"type":"prev_candle_low","offset":0}      // solo long
{"type":"prev_candle_high","offset":0}     // solo short
{"type":"prev_candle_extreme","offset":0}  // adattivo long/short

// Minimo/massimo della candela PRIMA di quella segnale
{"type":"before_signal_low","offset":0}      // solo long
{"type":"before_signal_high","offset":0}     // solo short
{"type":"before_signal_extreme","offset":0}  // adattivo long/short

// Nessuno stop loss
{"type":"none"}`,
    note: "\"offset\" (opzionale, default 0) aggiunge un buffer in punti oltre l'estremo scelto. Attenzione alla differenza tra prev_candle_* (usa la candela del segnale) e before_signal_* (usa la candela antecedente).",
  },
  {
    id: "takeprofits", icon: "🎯", title: "take_profits — gambe multiple",
    content: [
      "Un array di una o più \"gambe\" di uscita, ciascuna con una distanza dall'entry e una percentuale della size originale da chiudere a quel livello.",
      "Ogni gamba usa ESATTAMENTE UNO tra due modi di esprimere la distanza: r_mult (multiplo del rischio |entry - SL|) oppure mult (multiplo dell'ATR).",
    ],
    code: `"take_profits": [
  {"r_mult": 1.5, "close_pct": 50},
  {"r_mult": 3.0, "close_pct": 50}
]

// oppure, basato su ATR:
"take_profits": [
  {"mult": 0.75, "close_pct": 50},
  {"mult": 3.0,  "close_pct": 50}
]`,
    note: "La somma dei close_pct non può superare 100. Se è inferiore a 100, il residuo resta aperto fino a SL, timeout o uscita da segnale.",
  },
  {
    id: "aftertp1", icon: "🔒", title: "after_tp1_sl — gestione SL dopo il primo TP",
    content: [
      "Controlla cosa succede allo stop loss del residuo DOPO che il primo take profit è stato colpito.",
    ],
    code: `"after_tp1_sl": "original"     // lo stop resta al livello iniziale (default)
"after_tp1_sl": "breakeven"    // lo stop si sposta al prezzo di entrata
"after_tp1_sl": {"type":"trail_atr_mult","mult":0.5}  // trailing stop, parte SOLO dopo il primo TP`,
  },
  {
    id: "trailing", icon: "🐎", title: "trailing_stop — trailing dall'ingresso",
    content: [
      "Attiva un trailing stop FIN DALLA PRIMA BARRA del trade, indipendentemente dai take profit.",
    ],
    code: `"trailing_stop": {"type":"trail_atr_mult","mult":0.5}
"trailing_stop": null   // disattivato (default)`,
    note: "Lo stop, una volta mosso dal trailing, non retrocede mai — si muove solo a favore della posizione.",
  },
  {
    id: "timing", icon: "⏱️", title: "timeout_bars ed entry_timing",
    content: [
      "timeout_bars: numero massimo di candele per cui il trade può restare aperto.",
      "entry_timing: quando eseguire l'ingresso rispetto alla candela segnale: \"next_open\" (apertura successiva) o \"same_close\" (chiusura segnale).",
    ],
    code: `"timeout_bars": 20,
"entry_timing": "next_open"`,
  },
  {
    id: "notes", icon: "📝", title: "notes",
    content: [
      "Campo di testo libero, opzionale per annotazioni e chiarimenti sulla strategia.",
    ],
    code: `"notes": "Strategia trend-following con conferma multi-indicatore."`,
  },
];

export function JsonRulesHelpModal({ onClose }: { onClose: () => void }) {
  const [activeSection, setActiveSection] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 2000); });
  };

  return (
    <div id="modal-json-help-backdrop" style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
      display: "flex", alignItems: "flex-start", justifyContent: "center",
      padding: "32px 16px", overflowY: "auto",
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div id="modal-json-help-container" style={{
        background: C.card, borderRadius: 12, width: "100%", maxWidth: 860,
        boxShadow: "0 20px 60px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", maxHeight: "90vh",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 28px 16px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div>
            <h2 style={{ fontFamily: FONT_SERIF, fontSize: 21, color: C.primaryDark, margin: "0 0 3px" }}>Guida regole JSON</h2>
            <div style={{ fontFamily: FONT_SANS, fontSize: 12.5, color: C.muted }}>Riepilogo di tutti i campi e i valori usabili nel pannello JSON dello Step 2</div>
          </div>
          <button id="btn-close-json-help" onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: C.muted }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ width: 220, flexShrink: 0, borderRight: `1px solid ${C.border}`, overflowY: "auto", padding: "12px 0" }}>
            {JSON_HELP_SECTIONS.map((s, idx) => (
              <button id={`btn-json-sec-${s.id}`} key={s.id} onClick={() => setActiveSection(idx)} style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 18px",
                fontFamily: FONT_SANS, fontSize: 13, textAlign: "left", cursor: "pointer", border: "none",
                background: activeSection === idx ? C.primaryLight : "transparent",
                color: activeSection === idx ? C.primaryDark : C.text,
                fontWeight: activeSection === idx ? 700 : 400,
                borderLeft: `3px solid ${activeSection === idx ? C.primary : "transparent"}`,
              }}>
                <span style={{ fontSize: 16 }}>{s.icon}</span>
                <span>{s.title}</span>
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
            {(() => {
              const s = JSON_HELP_SECTIONS[activeSection];
              return (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: C.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{s.icon}</div>
                    <h3 style={{ fontFamily: FONT_SERIF, fontSize: 18, color: C.primaryDark, margin: 0 }}>{s.title}</h3>
                  </div>
                  {s.content.map((para, i) => (
                    <p key={i} style={{ fontSize: 14, lineHeight: 1.7, color: C.text, marginTop: 0, marginBottom: 14 }}>{para}</p>
                  ))}
                  {s.code && (
                    <div style={{ position: "relative", marginTop: 8, marginBottom: s.note ? 14 : 0 }}>
                      <pre style={{ background: "#f4f3ee", borderRadius: 8, padding: "14px 16px", fontSize: 12.5, fontFamily: FONT_MONO, overflowX: "auto", margin: 0, lineHeight: 1.6, color: C.text }}>{s.code}</pre>
                      <button id={`btn-copy-code-${s.id}`} onClick={() => copyToClipboard(s.code, s.id)} style={{
                        position: "absolute", top: 8, right: 8, fontFamily: FONT_SANS, fontSize: 11, padding: "4px 10px",
                        border: `1px solid ${C.border}`, borderRadius: 5, background: "#fff", cursor: "pointer", color: C.muted,
                      }}>{copied === s.id ? "✓ Copiato" : "Copia"}</button>
                    </div>
                  )}
                  {s.note && (
                    <div style={{ background: C.amberLight, border: `1px solid ${C.amber}55`, borderRadius: 8, padding: "10px 14px", fontSize: 13, lineHeight: 1.6 }}>
                      <Info size={13} color={C.amber} style={{ verticalAlign: -2, marginRight: 5 }} />
                      {s.note}
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28 }}>
                    <Button variant="ghost" icon={ChevronLeft} disabled={activeSection === 0} onClick={() => setActiveSection((p) => p - 1)}>Precedente</Button>
                    <Button icon={ChevronRight} style={{ flexDirection: "row-reverse" }} disabled={activeSection === JSON_HELP_SECTIONS.length - 1} onClick={() => setActiveSection((p) => p + 1)}>Successivo</Button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

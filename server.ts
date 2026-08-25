import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

// Helper for waiting with jitter
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms + Math.random() * 200));

// Candidate models in order of preference for text/rule generation
const CANDIDATE_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.7-flash",
  "gemini-3.1-flash-lite",
];

// Fallback heuristic parser in case of complete AI API unavailability
function parseStrategyHeuristically(
  strategyText: string,
  columns: string[],
  columnStats?: Record<string, any>
): any {
  const text = strategyText.toLowerCase();
  const allCols = Array.from(new Set(["open", "high", "low", "close", ...columns]));

  // Find ATR column if available
  const atrCol = allCols.find((c) => c.toLowerCase().includes("atr")) || null;

  // Detect Stop Loss
  let stopLoss: any = { type: "none" };
  const atrSlMatch = text.match(/([0-9.]+)\s*(?:x|×|\*)\s*atr/i) || text.match(/atr\s*(?:x|×|\*)\s*([0-9.]+)/i);
  const candleSlMatch = text.includes("minimo") || text.includes("massimo") || text.includes("candela");
  const fixedPtsSlMatch = text.match(/([0-9.]+)\s*(?:punti|pt|pips)/i);

  if (atrSlMatch && atrCol) {
    stopLoss = { type: "atr_mult", mult: parseFloat(atrSlMatch[1]) };
  } else if (text.includes("prima del segnale") || text.includes("before_signal")) {
    stopLoss = { type: "before_signal_extreme", offset: 0 };
  } else if (candleSlMatch) {
    stopLoss = { type: "prev_candle_extreme", offset: 0 };
  } else if (fixedPtsSlMatch) {
    stopLoss = { type: "fixed_points", value: parseFloat(fixedPtsSlMatch[1]) };
  }

  // Detect Take Profits
  const takeProfits: any[] = [];
  const rMatches = [...strategyText.matchAll(/([0-9.]+)\s*r\b/gi)];
  const tpAtrMatches = [...strategyText.matchAll(/(?:tp|take\s*profit|profitto)?\s*(?:a|@)?\s*([0-9.]+)\s*(?:x|×|\*)\s*atr/gi)];

  if (rMatches.length > 0) {
    const eachPct = Math.floor(100 / rMatches.length);
    rMatches.forEach((m, idx) => {
      takeProfits.push({
        r_mult: parseFloat(m[1]),
        close_pct: idx === rMatches.length - 1 ? 100 - eachPct * (rMatches.length - 1) : eachPct,
      });
    });
  } else if (tpAtrMatches.length > 0) {
    const eachPct = Math.floor(100 / tpAtrMatches.length);
    tpAtrMatches.forEach((m, idx) => {
      takeProfits.push({
        mult: parseFloat(m[1]),
        close_pct: idx === tpAtrMatches.length - 1 ? 100 - eachPct * (tpAtrMatches.length - 1) : eachPct,
      });
    });
  }

  // Detect Timeout
  const timeoutMatch = text.match(/([0-9]+)\s*(?:candele|barre|bar|candles|timeout)/i);
  const timeoutBars = timeoutMatch ? parseInt(timeoutMatch[1], 10) : 200;

  // Detect Entry Conditions
  const nonPriceCols = allCols.filter((c) => !["open", "high", "low", "close"].includes(c));
  const defaultCol = nonPriceCols[0] || "close";

  // Build basic condition groups
  const longConditions: any[] = [];
  const shortConditions: any[] = [];

  // Parse condition expressions like "col > val" or "col < val"
  for (const col of allCols) {
    const colRegex = new RegExp(`${col}\\s*(>|<|>=|<=|==|!=)\\s*([a-zA-Z0-9_.]+)`, "gi");
    let match;
    while ((match = colRegex.exec(strategyText)) !== null) {
      const op = match[1];
      let rightRaw = match[2];

      // Handle avg_ / media_ references
      if (rightRaw.startsWith("avg_") || rightRaw.startsWith("media_")) {
        const base = rightRaw.replace(/^(avg_|media_)/, "");
        if (columnStats?.[base]?.mean != null) {
          rightRaw = String(columnStats[base].mean);
        } else if (allCols.includes(base)) {
          rightRaw = base;
        }
      }

      const rightNum = parseFloat(rightRaw);
      const rightVal = isNaN(rightNum) ? rightRaw : rightNum;
      
      const cond = { type: "condition", left: col, op, right: rightVal };
      if (text.includes("short") && match.index > text.indexOf("short")) {
        shortConditions.push(cond);
      } else {
        longConditions.push(cond);
      }
    }
  }

  const entryLong = longConditions.length > 0
    ? longConditions.length === 1 ? longConditions[0] : { type: "group", operator: "AND", conditions: longConditions }
    : { type: "condition", left: defaultCol, op: ">", right: columnStats?.[defaultCol]?.mean ?? 0 };

  const entryShort = shortConditions.length > 0
    ? shortConditions.length === 1 ? shortConditions[0] : { type: "group", operator: "AND", conditions: shortConditions }
    : text.includes("short") || text.includes("vend")
    ? { type: "condition", left: defaultCol, op: "<", right: columnStats?.[defaultCol]?.mean ?? 0 }
    : null;

  return {
    entry_long: entryLong,
    entry_short: entryShort,
    exit_long: null,
    exit_short: null,
    atr_column: atrCol,
    stop_loss: stopLoss,
    take_profits: takeProfits,
    after_tp1_sl: text.includes("breakeven") ? "breakeven" : "original",
    trailing_stop: null,
    timeout_bars: timeoutBars,
    entry_timing: text.includes("same_close") || text.includes("alla chiusura") ? "same_close" : "next_open",
    notes: "Regole generate tramite interprete euristico locale (adattate ai dati forniti). Puoi rifinirle nell'editor qui sotto.",
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "10mb" }));

  // Initialize Gemini AI client lazily
  let aiClient: GoogleGenAI | null = null;
  function getAI() {
    if (!aiClient) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY non è configurata nel file di ambiente");
      }
      aiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }
    return aiClient;
  }

  // Health check endpoint
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // AI Rule generation endpoint with retries, exponential backoff, and fallback models
  app.post("/api/generate-rules", async (req, res) => {
    const { strategyText, columns, stats, columnStats } = req.body;
    const statsObj = stats || columnStats || {};

    if (!strategyText || typeof strategyText !== "string") {
      return res.status(400).json({ error: "strategyText è obbligatorio." });
    }

    const allCols = Array.isArray(columns)
      ? Array.from(new Set(["open", "high", "low", "close", ...columns]))
      : ["open", "high", "low", "close"];

    const statsLines = allCols
      .map((c: string) => {
        const s = statsObj?.[c];
        if (s) {
          return `- ${c}: min=${s.min?.toFixed(4) ?? "n/d"}, max=${s.max?.toFixed(4) ?? "n/d"}, media=${s.mean?.toFixed(4) ?? "n/d"}`;
        }
        return `- ${c}`;
      })
      .join("\n");

    const systemPrompt = `Sei un motore di trading quantitativo avanzato che traduce la descrizione in linguaggio naturale di una strategia di trading in una struttura JSON rigorosa, da eseguire automaticamente. Rispondi SOLO con JSON valido, senza testo introduttivo, senza markdown, senza backtick.

Schema atteso (esattamente questi campi):
{
  "entry_long": <ConditionNode> | null,
  "entry_short": <ConditionNode> | null,
  "exit_long": <ExitRuleNode> | null,
  "exit_short": <ExitRuleNode> | null,
  "atr_column": "<nome colonna>" | null,
  "stop_loss": <StopLossNode>,
  "take_profits": [ <TakeProfitLeg>, ... ],
  "after_tp1_sl": "original" | "breakeven" | {"type":"trail_atr_mult","mult":number},
  "trailing_stop": {"type":"trail_atr_mult","mult":number} | null,
  "timeout_bars": integer,
  "entry_timing": "next_open" | "same_close",
  "notes": "breve spiegazione in italiano (max 3 frasi) di come hai interpretato la strategia, comprese eventuali ambiguità o assunzioni"
}

ExitRuleNode (Uscita su segnale con possibilità di chiusura parziale):
  - Uscita totale (100%): <ConditionNode>
  - Uscita con percentuale definita (es. chiudi il 50% della posizione su segnale):
      {"condition": <ConditionNode>, "close_pct": 50}
      oppure: {"type": "condition", "left": "...", "op": "...", "right": "...", "close_pct": 50}
  - Uscite multiple progressive su segnali diversi:
      [
        {"condition": <ConditionNode>, "close_pct": 50},
        {"condition": <ConditionNode>, "close_pct": 100}
      ]

StopLossNode:
  {"type":"atr_mult",             "mult":number}          → SL a N × ATR dall'entry
  {"type":"fixed_points",         "value":number}          → SL a N punti fissi dall'entry
  {"type":"prev_candle_extreme",  "offset":number}         → SL al minimo della CANDELA SEGNALE (long) o al massimo (short), con buffer opzionale. Per strategie bi-direzionali.
  {"type":"prev_candle_low",      "offset":number}         → SL al minimo della CANDELA SEGNALE - offset punti. Solo per strategie SOLO long.
  {"type":"prev_candle_high",     "offset":number}         → SL al massimo della CANDELA SEGNALE + offset punti. Solo per strategie SOLO short.
  {"type":"before_signal_extreme","offset":number}         → SL al minimo (long) o massimo (short) della candela IMMEDIATAMENTE PRIMA di quella segnale, con buffer opzionale. Per strategie bi-direzionali.
  {"type":"before_signal_low",    "offset":number}         → SL al minimo della candela PRIMA di quella segnale - offset punti. Solo per strategie SOLO long.
  {"type":"before_signal_high",   "offset":number}         → SL al massimo della candela PRIMA di quella segnale + offset punti. Solo per strategie SOLO short.
  {"type":"none"}                                          → nessuno stop loss

TakeProfitLeg (ogni leg usa UNO dei due tipi di distanza):
  {"r_mult": number, "close_pct": number}   → TP a N × rischio (dove rischio = |entry - SL|); usa questo quando il TP è espresso come multiplo del rischio (es. "1.5R", "2 volte il rischio")
  {"mult":   number, "close_pct": number}   → TP a N × ATR; usa questo quando è espresso come multiplo dell'ATR
"close_pct" è la percentuale (0-100) della size ORIGINALE da chiudere a quel livello. La somma non può superare 100.

ConditionNode è ricorsivo:
{"type":"condition","left":"<nome colonna ESATTO>","op":">"|"<"|">="|"<="|"=="|"!=","right": number | "<nome colonna ESATTO>"}
oppure
{"type":"group","operator":"AND"|"OR","conditions":[ConditionNode, ...]}

REGOLE CRITICHE:
- Le colonne "open", "high", "low", "close" appartengono sempre al dataset caricato dall'utente e devono essere referenziate direttamente come nomi di colonna nelle condizioni (es. {"left": "close", "op": ">", "right": "open"} o {"left": "close", "op": ">", "right": "sma_50"}).
- "exit_long" e "exit_short" (opzionali): condizioni di uscita basate su indicatori/colonne, supportano sia chiusura totale (100%) che parziale (es. "close_pct": 50). Se non presenti, imposta null.
- "atr_column" è necessario se stop_loss o take_profits usano moltiplicatori ATR.
- Se la strategia è solo long, "entry_short": null. Se solo short, "entry_long": null.
- Se timeout non specificato, usa 200.
- Se stop loss non specificato, usa {"type":"none"}.

Colonne disponibili nel dataset dell'utente (comprese OHLC):
${statsLines}

Rispondi SOLO con il JSON valido.`;

    let lastError: any = null;

    // Try available models in order with retries
    for (const modelName of CANDIDATE_MODELS) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const ai = getAI();
          const response = await ai.models.generateContent({
            model: modelName,
            contents: `Traduci questa strategia in JSON:\n\n${strategyText}`,
            config: {
              systemInstruction: systemPrompt,
              responseMimeType: "application/json",
            },
          });

          const responseText = response.text || "{}";
          const clean = responseText.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
          const parsed = JSON.parse(clean);
          return res.json({ success: true, rules: parsed, notes: parsed.notes, modelUsed: modelName });
        } catch (err: any) {
          lastError = err;
          const errMsg = err?.message || String(err);
          const isRateLimitOr503 =
            errMsg.includes("503") ||
            errMsg.includes("UNAVAILABLE") ||
            errMsg.includes("high demand") ||
            errMsg.includes("429") ||
            errMsg.includes("RESOURCE_EXHAUSTED");

          console.warn(`[Gemini API] Modello ${modelName} tentativo ${attempt} fallito: ${errMsg}`);

          if (isRateLimitOr503 && attempt < 2) {
            // Exponential backoff before retry with jitter
            await wait(1200 * attempt);
            continue;
          }
          // Move to next candidate model
          break;
        }
      }
    }

    // If all Gemini model calls failed due to 503 high demand or network issues,
    // fallback gracefully to our intelligent heuristic strategy builder so the user is never blocked
    console.warn("Utilizzo del fallback euristico per la generazione delle regole.");
    try {
      const fallbackRules = parseStrategyHeuristically(strategyText, columns || [], statsObj);
      return res.json({
        success: true,
        rules: fallbackRules,
        notes: fallbackRules.notes,
        warning:
          "I server di Gemini AI sono temporaneamente sovraccarichi. Le regole sono state generate tramite il motore euristico locale. Puoi verificarle e modificarle nell'editor sottostante.",
        fallbackUsed: true,
      });
    } catch (fallbackErr) {
      console.error("Errore fallback euristico:", fallbackErr);
      return res.status(500).json({
        error:
          lastError?.message ||
          "I server AI sono temporaneamente sovraccarichi. Riprova tra qualche istante o modifica le regole direttamente nell'editor JSON.",
      });
    }
  });

  // Vite middleware in dev mode
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Strategy Lab server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

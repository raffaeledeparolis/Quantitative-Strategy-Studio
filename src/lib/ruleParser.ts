import { ConditionNode, ExitRuleNode, SignalExitRule, StrategyRules } from "../types";

export function evalNode(node: ConditionNode | null | undefined, bar: Record<string, any>): boolean {
  if (!node) return false;
  if (node.type === "condition" || (node.left !== undefined && node.op !== undefined)) {
    const resolveVal = (valOrCol: any) => {
      if (typeof valOrCol === "number") return valOrCol;
      if (typeof valOrCol === "string") {
        if (bar[valOrCol] !== undefined && typeof bar[valOrCol] === "number") return bar[valOrCol];
        const lower = valOrCol.toLowerCase();
        if (bar[lower] !== undefined && typeof bar[lower] === "number") return bar[lower];
        for (const k of Object.keys(bar)) {
          if (k.toLowerCase() === lower && typeof bar[k] === "number") {
            return bar[k];
          }
        }
        const trimmed = valOrCol.trim();
        if (trimmed !== "") {
          const parsed = Number(trimmed);
          if (!isNaN(parsed)) return parsed;
        }
      }
      return undefined;
    };
    const lv = resolveVal(node.left);
    const rv = resolveVal(node.right);
    if (typeof lv !== "number" || typeof rv !== "number") return false;
    switch (node.op) {
      case ">": return lv > rv;
      case "<": return lv < rv;
      case ">=": return lv >= rv;
      case "<=": return lv <= rv;
      case "==": return lv === rv;
      case "!=": return lv !== rv;
      default: return false;
    }
  }
  if (node.type === "group" || (Array.isArray((node as any).conditions) && (node as any).conditions.length > 0)) {
    const fn = node.operator === "OR" ? "some" : "every";
    return (node.conditions || [])[fn]((c) => evalNode(c, bar));
  }
  return false;
}

export function renderNode(node: ConditionNode | null | undefined): string {
  if (!node) return "—";
  if (node.type === "condition" || (node.left !== undefined && node.op !== undefined)) {
    return `${node.left} ${node.op} ${node.right}`;
  }
  if (node.type === "group" || Array.isArray(node.conditions)) {
    return `(${(node.conditions || []).map(renderNode).join(` ${node.operator || "AND"} `)})`;
  }
  return "—";
}

export function normalizeExitRules(exitRule: any): { condition: ConditionNode; close_pct: number; after_tp1?: boolean }[] {
  if (!exitRule) return [];
  const list = Array.isArray(exitRule) ? exitRule : [exitRule];
  const normalized: { condition: ConditionNode; close_pct: number; after_tp1?: boolean }[] = [];
  for (const item of list) {
    if (!item) continue;
    const isAfterTp1 = Boolean(
      item.after_tp1 ||
      item.after_tp ||
      item.requires_tp1 ||
      item.requires_tp ||
      item.condition?.after_tp1 ||
      item.condition?.after_tp
    );
    if (item.condition && typeof item.condition === "object") {
      const closePct = typeof item.close_pct === "number" && item.close_pct > 0 ? item.close_pct : 100;
      const cond = { ...item.condition };
      if (!cond.type && cond.left !== undefined && cond.op !== undefined) cond.type = "condition";
      normalized.push({ condition: cond, close_pct: closePct, after_tp1: isAfterTp1 });
    } else if (item.type === "condition" || item.type === "group" || (item.left !== undefined && item.op !== undefined)) {
      const closePct = typeof item.close_pct === "number" && item.close_pct > 0 ? item.close_pct : 100;
      const cond = { ...item };
      if (!cond.type && cond.left !== undefined && cond.op !== undefined) cond.type = "condition";
      normalized.push({ condition: cond, close_pct: closePct, after_tp1: isAfterTp1 });
    }
  }
  return normalized;
}

export function renderExitRule(rule: ExitRuleNode): string {
  const norm = normalizeExitRules(rule);
  if (norm.length === 0) return "—";
  return norm
    .map((item) => {
      const condStr = renderNode(item.condition);
      let text = item.close_pct < 100 ? `Chiudi ${item.close_pct}% se ${condStr}` : condStr;
      if (item.after_tp1) {
        text += " (solo dopo TP1)";
      }
      return text;
    })
    .join(" | ");
}

export function collectColumnsUsed(node: ConditionNode | null | undefined, set: Set<string>) {
  if (!node) return;
  if (node.type === "condition" || (node.left !== undefined && node.op !== undefined)) {
    if (typeof node.left === "string" && isNaN(Number(node.left))) set.add(node.left);
    if (typeof node.right === "string" && isNaN(Number(node.right))) set.add(node.right);
  } else if (node.type === "group" || Array.isArray(node.conditions)) {
    (node.conditions || []).forEach((c) => collectColumnsUsed(c, set));
  }
}

export function buildDefaultRulesTemplate(columns: string[]): StrategyRules {
  const nonPriceCols = columns.filter((c) => !["open", "high", "low", "close"].includes(c));
  const col1 = nonPriceCols[0] || columns[0] || "close";
  const col2 = nonPriceCols[1] || columns[1] || "open";
  return {
    entry_long: { type: "condition", left: col1, op: ">", right: col2 },
    entry_short: null,
    exit_long: null,
    exit_short: null,
    atr_column: columns.find((c) => c.toLowerCase().includes("atr")) || null,
    stop_loss: { type: "none" },
    take_profits: [],
    after_tp1_sl: "original",
    trailing_stop: null,
    timeout_bars: 200,
    entry_timing: "next_open",
    notes: "Modello di partenza generato automaticamente. Modifica liberamente questo JSON per definire la strategia, oppure descrivila a parole e usa 'Genera regole con AI'.",
  };
}

export function validateRules(rules: any, availableColumns: string[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!rules || typeof rules !== "object") return { valid: false, errors: ["JSON non valido."] };
  if (!rules.entry_long) errors.push("Manca 'entry_long'.");
  const used = new Set<string>();
  collectColumnsUsed(rules.entry_long, used);
  if (rules.entry_short) collectColumnsUsed(rules.entry_short, used);

  if (rules.exit_long) {
    const normLong = normalizeExitRules(rules.exit_long);
    normLong.forEach((n, idx) => {
      collectColumnsUsed(n.condition, used);
      if (!(n.close_pct > 0 && n.close_pct <= 100)) {
        errors.push(`exit_long[${idx}].close_pct deve essere compreso tra 1 e 100.`);
      }
    });
  }

  if (rules.exit_short) {
    const normShort = normalizeExitRules(rules.exit_short);
    normShort.forEach((n, idx) => {
      collectColumnsUsed(n.condition, used);
      if (!(n.close_pct > 0 && n.close_pct <= 100)) {
        errors.push(`exit_short[${idx}].close_pct deve essere compreso tra 1 e 100.`);
      }
    });
  }

  const sl = rules.stop_loss || { type: "none" };
  const VALID_SL_TYPES = [
    "atr_mult",
    "none",
    "fixed_points",
    "monetary",
    "prev_candle_low",
    "prev_candle_high",
    "prev_candle_extreme",
    "before_signal_low",
    "before_signal_high",
    "before_signal_extreme",
  ];
  if (!VALID_SL_TYPES.includes(sl.type)) errors.push(`stop_loss.type non valido (atteso: ${VALID_SL_TYPES.join(" | ")}).`);
  if (sl.type === "atr_mult" && rules.atr_column) used.add(rules.atr_column);
  if (sl.type === "atr_mult" && !(sl.mult > 0)) errors.push("stop_loss.mult deve essere > 0.");
  if (sl.type === "fixed_points" && !(sl.value > 0)) errors.push("stop_loss.value deve essere > 0.");
  if (sl.type === "monetary" && !(sl.value > 0)) errors.push("stop_loss.value deve essere > 0 (valore monetario in $ o €).");
  const CANDLE_SL_TYPES = [
    "prev_candle_low",
    "prev_candle_high",
    "prev_candle_extreme",
    "before_signal_low",
    "before_signal_high",
    "before_signal_extreme",
  ];
  if (CANDLE_SL_TYPES.includes(sl.type) && sl.offset != null && sl.offset < 0) {
    errors.push("stop_loss.offset deve essere ≥ 0 (distanza in punti aggiuntiva oltre il massimo/minimo).");
  }

  const tps = rules.take_profits || [];
  let pctSum = 0;
  tps.forEach((tp: any, i: number) => {
    const hasRMult = tp.r_mult != null;
    const hasMult = tp.mult != null;
    const hasMonetary = tp.monetary != null;
    if (!hasRMult && !hasMult && !hasMonetary) errors.push(`take_profits[${i}]: specificare 'r_mult' (multiplo del rischio), 'mult' (multiplo ATR) oppure 'monetary' (valore monetario).`);
    if (hasRMult && !(tp.r_mult > 0)) errors.push(`take_profits[${i}].r_mult deve essere > 0.`);
    if (hasMult && !(tp.mult > 0)) errors.push(`take_profits[${i}].mult deve essere > 0.`);
    if (hasMonetary && !(tp.monetary > 0)) errors.push(`take_profits[${i}].monetary deve essere > 0.`);
    if (!(tp.close_pct > 0)) errors.push(`take_profits[${i}].close_pct deve essere > 0.`);
    pctSum += tp.close_pct || 0;
    if (hasRMult && sl.type === "none") errors.push(`take_profits[${i}]: r_mult richiede uno stop loss definito (non 'none').`);
  });
  if (pctSum > 100.001) errors.push(`La somma delle chiusure parziali (${pctSum}%) supera il 100%.`);
  if (!rules.timeout_bars || rules.timeout_bars <= 0) errors.push("timeout_bars deve essere un intero positivo.");
  const standardPriceCols = ["open", "high", "low", "close"];
  const availableSetLower = new Set(availableColumns.map((c) => c.toLowerCase()).concat(standardPriceCols));

  const needsAtr = sl.type === "atr_mult" || tps.some((tp: any) => tp.mult != null);
  if (needsAtr && !rules.atr_column) errors.push("Manca 'atr_column': necessaria per SL/TP basati su ATR.");
  if (rules.atr_column && !availableColumns.includes(rules.atr_column) && !availableSetLower.has(rules.atr_column.toLowerCase())) {
    errors.push(`La colonna ATR '${rules.atr_column}' non esiste tra quelle caricate.`);
  }

  const atp = rules.after_tp1_sl;
  if (atp != null) {
    if (typeof atp === "string") {
      if (!["original", "breakeven"].includes(atp)) errors.push("after_tp1_sl stringa non valida: usa 'original' o 'breakeven'.");
    } else if (typeof atp === "object") {
      if (atp.type !== "trail_atr_mult") errors.push("after_tp1_sl.type non valido: usa 'trail_atr_mult'.");
      if (!(atp.mult > 0)) errors.push("after_tp1_sl.mult deve essere > 0.");
      if (!rules.atr_column) errors.push("after_tp1_sl trail_atr_mult richiede atr_column.");
    } else {
      errors.push("after_tp1_sl deve essere 'original', 'breakeven' o {type:'trail_atr_mult', mult: number}.");
    }
  }

  const ts = rules.trailing_stop;
  if (ts != null) {
    if (typeof ts !== "object" || ts.type !== "trail_atr_mult") errors.push("trailing_stop.type non valido: l'unico valore supportato è 'trail_atr_mult'.");
    else if (!(ts.mult > 0)) errors.push("trailing_stop.mult deve essere > 0.");
    else if (!rules.atr_column) errors.push("trailing_stop richiede atr_column.");
  }
  used.forEach((c) => {
    if (c && !availableColumns.includes(c) && !availableSetLower.has(c.toLowerCase())) {
      errors.push(`Colonna referenziata sconosciuta: '${c}'.`);
    }
  });
  return { valid: errors.length === 0, errors };
}

export const buildDefaultTemplate = buildDefaultRulesTemplate;
export { scanTweakableParams as extractTweakableParams } from "./scenarioEngine";

// Intelligent client-side heuristic parser for natural language trading strategies
export function parseStrategyHeuristically(
  strategyText: string,
  columns: string[],
  columnStats?: Record<string, any>
): StrategyRules {
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

  // Build condition groups for entry and exit
  const longConditions: any[] = [];
  const shortConditions: any[] = [];
  const exitLongConditions: any[] = [];
  const exitShortConditions: any[] = [];

  const exitKeywords = ["esci", "exit", "uscita", "chiudi posizione", "chiusura posizione"];
  const firstExitIdx = exitKeywords.map((k) => text.indexOf(k)).filter((idx) => idx !== -1).sort((a, b) => a - b)[0] ?? -1;

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

      const cond = { type: "condition" as const, left: col, op, right: rightVal };

      const isAfterExit = firstExitIdx !== -1 && match.index >= firstExitIdx;
      if (isAfterExit) {
        if (text.includes("short") && match.index > text.lastIndexOf("short")) {
          exitShortConditions.push(cond);
        } else {
          exitLongConditions.push(cond);
        }
      } else {
        if (text.includes("short") && match.index > text.indexOf("short")) {
          shortConditions.push(cond);
        } else {
          longConditions.push(cond);
        }
      }
    }
  }

  const entryLong: any =
    longConditions.length > 0
      ? longConditions.length === 1
        ? longConditions[0]
        : { type: "group", operator: "AND", conditions: longConditions }
      : { type: "condition", left: defaultCol, op: ">", right: columnStats?.[defaultCol]?.mean ?? 0 };

  const entryShort: any =
    shortConditions.length > 0
      ? shortConditions.length === 1
        ? shortConditions[0]
        : { type: "group", operator: "AND", conditions: shortConditions }
      : text.includes("short") || text.includes("vend")
      ? { type: "condition", left: defaultCol, op: "<", right: columnStats?.[defaultCol]?.mean ?? 0 }
      : null;

  const isAfterTp =
    text.includes("dopo tp") ||
    text.includes("dopo il tp") ||
    text.includes("dopo primo tp") ||
    text.includes("dopo il primo tp") ||
    text.includes("after tp") ||
    text.includes("dopo il raggiungimento di un tp") ||
    text.includes("dopo il raggiungimento del tp") ||
    text.includes("dopo aver colpito il tp");

  const buildExitRule = (conds: any[]) => {
    if (conds.length === 0) return null;
    const condNode = conds.length === 1 ? conds[0] : { type: "group", operator: "AND", conditions: conds };
    if (isAfterTp) {
      return { condition: condNode, close_pct: 100, after_tp1: true };
    }
    return condNode;
  };

  const exitLong: any = buildExitRule(exitLongConditions);
  const exitShort: any = buildExitRule(exitShortConditions);

  return {
    entry_long: entryLong,
    entry_short: entryShort,
    exit_long: exitLong,
    exit_short: exitShort,
    atr_column: atrCol,
    stop_loss: stopLoss,
    take_profits: takeProfits,
    after_tp1_sl: text.includes("breakeven") ? "breakeven" : "original",
    trailing_stop: null,
    timeout_bars: timeoutBars,
    entry_timing: text.includes("same_close") || text.includes("alla chiusura") ? "same_close" : "next_open",
    notes: "Regole generate con successo dal motore analitico della strategia (adattate ai dati caricati).",
  };
}


import { Bar, StrategyRules, MoneyManagement, Trade, TradeLeg, EquityPoint, BacktestMetrics, DailyDrawdownPoint } from "../types";
import { evalNode, normalizeExitRules } from "./ruleParser";

export function parseHHMM(str: string | null | undefined): number | null {
  if (typeof str !== "string") return null;
  const m = str.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = +m[1], mm = +m[2];
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

export function isWithinTradingHours(ms: number, startMin: number | null, endMin: number | null): boolean {
  if (startMin == null || endMin == null) return true;
  if (startMin === endMin) return true;
  const d = new Date(ms);
  const minsOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (startMin < endMin) return minsOfDay >= startMin && minsOfDay < endMin;
  return minsOfDay >= startMin || minsOfDay < endMin;
}

export function isFridayCloseWindow(ms: number, cutoffMin: number | null): boolean {
  if (cutoffMin == null) return false;
  const d = new Date(ms);
  const dow = d.getUTCDay();
  if (dow === 6 || dow === 0) return true;
  if (dow === 5) {
    const minsOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
    return minsOfDay >= cutoffMin;
  }
  return false;
}

export function pathSegments(o: number, h: number, l: number, c: number): [number, number][] {
  return c >= o ? [[o, l], [l, h], [h, c]] : [[o, h], [h, l], [l, c]];
}

export function intrabarFixedFractionEntry(
  o: number,
  h: number,
  l: number,
  c: number,
  isLong: boolean,
  frac: number
): { price: number; remaining: [number, number][] } {
  const range = h - l;
  const clampedFrac = Math.max(0, Math.min(1, frac));
  // Exact fraction of candle development (range high-low)
  const price = range > 0 ? (isLong ? l + clampedFrac * range : h - clampedFrac * range) : o;

  const segments = pathSegments(o, h, l, c);
  for (let idx = 0; idx < segments.length; idx++) {
    const [p0, p1] = segments[idx];
    const minP = Math.min(p0, p1);
    const maxP = Math.max(p0, p1);
    if (price >= minP - 1e-9 && price <= maxP + 1e-9) {
      const remaining: [number, number][] = [[price, p1], ...segments.slice(idx + 1)];
      return { price, remaining };
    }
  }
  return { price, remaining: [[price, c]] };
}

export function intrabarFixedFractionExit(
  o: number,
  h: number,
  l: number,
  c: number,
  isLong: boolean,
  frac: number
): number {
  const range = h - l;
  const clampedFrac = Math.max(0, Math.min(1, frac));
  if (range <= 0) return c;
  // Long exit sells from top down, Short exit buys back from bottom up
  return isLong ? h - clampedFrac * range : l + clampedFrac * range;
}

export function priceAndRemainingSegments(o: number, h: number, l: number, c: number, frac: number): {
  price: number;
  remaining: [number, number][];
} {
  const segments = pathSegments(o, h, l, c);
  const lens = segments.map(([a, b]) => Math.abs(b - a));
  const total = lens.reduce((s, x) => s + x, 0);
  if (total === 0) return { price: o, remaining: [[o, c]] };
  const target = Math.max(0, Math.min(1, frac)) * total;
  let acc = 0;
  for (let idx = 0; idx < segments.length; idx++) {
    const segLen = lens[idx];
    if (acc + segLen >= target || idx === segments.length - 1) {
      const within = segLen > 0 ? (target - acc) / segLen : 0;
      const [a, b] = segments[idx];
      const price = a + within * (b - a);
      const remaining: [number, number][] = [[price, b], ...segments.slice(idx + 1)];
      return { price, remaining };
    }
    acc += segLen;
  }
  return { price: c, remaining: [[c, c]] };
}

export function walkBarTouches(
  prevClose: number | null,
  o: number,
  h: number,
  l: number,
  c: number,
  activeLevels: { name: string; level: number; legIdx?: number }[],
  presetSegments?: [number, number][]
): { name: string; level: number; legIdx?: number; gapFill?: boolean }[] {
  const order: { name: string; level: number; legIdx?: number; gapFill?: boolean }[] = [];
  let remaining = activeLevels.slice();

  if (!presetSegments && prevClose != null && prevClose !== o && remaining.length > 0) {
    const glo = Math.min(prevClose, o), ghi = Math.max(prevClose, o);
    const inGap = remaining.filter((a) => a.level >= glo && a.level <= ghi);
    inGap.sort((a, b) => Math.abs(a.level - prevClose) - Math.abs(b.level - prevClose));
    for (const t of inGap) {
      order.push({ ...t, gapFill: true });
      remaining = remaining.filter((r) => r !== t);
      if (t.name === "SL") return order;
    }
  }

  const segments = presetSegments || pathSegments(o, h, l, c);
  for (const [segStart, segEnd] of segments) {
    if (remaining.length === 0) break;
    const lo = Math.min(segStart, segEnd), hi = Math.max(segStart, segEnd);
    const inSeg = remaining.filter((a) => a.level >= lo && a.level <= hi);
    inSeg.sort((a, b) => Math.abs(a.level - segStart) - Math.abs(b.level - segStart));
    for (const t of inSeg) {
      order.push(t);
      remaining = remaining.filter((r) => r !== t);
      if (t.name === "SL") return order;
    }
  }
  return order;
}

export function computeFixedPositionQty(mm: MoneyManagement, currentEquity: number): number {
  const baseQty = mm.fixedQty > 0 ? mm.fixedQty : 1;
  if (!mm.linearGrowthEnabled) {
    return baseQty;
  }

  const initialCap = mm.initialCapital > 0 ? mm.initialCapital : 100000;
  let qty: number;

  if (mm.linearGrowthMode === "step") {
    const stepCapital = mm.linearGrowthStepCapital && mm.linearGrowthStepCapital > 0 ? mm.linearGrowthStepCapital : 10000;
    const stepQty = mm.linearGrowthStepQty && mm.linearGrowthStepQty > 0 ? mm.linearGrowthStepQty : baseQty;
    const deltaEquity = currentEquity - initialCap;

    let steps: number;
    if (mm.linearGrowthAllowDeleveraging) {
      steps = Math.floor(deltaEquity / stepCapital);
    } else {
      steps = Math.max(0, Math.floor(deltaEquity / stepCapital));
    }
    qty = baseQty + steps * stepQty;
  } else {
    // Proporzionale all'equity (default): baseQty * (Equity / Capitale Iniziale)
    let ratio = initialCap > 0 ? currentEquity / initialCap : 1;
    if (!mm.linearGrowthAllowDeleveraging) {
      ratio = Math.max(1, ratio);
    } else {
      ratio = Math.max(0, ratio);
    }
    qty = baseQty * ratio;
  }

  if (mm.linearGrowthRounding === "integer") {
    qty = Math.round(qty);
  } else if (mm.linearGrowthRounding === "decimal") {
    qty = Math.round(qty * 100) / 100;
  }

  const minQty = mm.linearGrowthMinQty != null && mm.linearGrowthMinQty > 0
    ? mm.linearGrowthMinQty
    : (mm.linearGrowthRounding === "integer" ? 1 : 0.01);
  qty = Math.max(minQty, qty);

  if (mm.linearGrowthMaxQty != null && mm.linearGrowthMaxQty > 0) {
    qty = Math.min(mm.linearGrowthMaxQty, qty);
  }

  return qty;
}

export function runBacktest(bars: Bar[], rules: StrategyRules, mm: MoneyManagement): {
  trades: Trade[];
  equityCurve: EquityPoint[];
  finalEquity: number;
} {
  const N = bars.length;
  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];
  let equity = mm.initialCapital;
  const half = (mm.spread || 0) / 2;
  const pointVal = mm.pointValue && mm.pointValue > 0 ? mm.pointValue : 1.0;
  const timing = mm.entryTiming || rules.entry_timing || "next_open";
  const exitTiming = mm.exitTiming || rules.exit_timing || "next_open";
  const exitFrac = mm.intrabarExitFraction != null ? mm.intrabarExitFraction : 0.5;
  const atpConfig = rules.after_tp1_sl || "original";

  const dailyDDLimit = mm.dailyDDLimitPct && mm.dailyDDLimitPct > 0 ? mm.dailyDDLimitPct : null;
  let curDayKey: number | null = null;
  let dayStartEquity = equity;
  const dayKeyOf = (ms: number) => {
    const d = new Date(ms);
    return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  };

  const thStartMin = mm.tradingHoursEnabled ? parseHHMM(mm.tradingHoursStart) : null;
  const thEndMin = mm.tradingHoursEnabled ? parseHHMM(mm.tradingHoursEnd) : null;
  const thActive = mm.tradingHoursEnabled && thStartMin != null && thEndMin != null;

  const fridayCloseCutoffMin = mm.fridayCloseEnabled ? parseHHMM(mm.fridayCloseTime) : null;
  const fridayCloseActive = mm.fridayCloseEnabled && fridayCloseCutoffMin != null;

  let i = 0;
  while (i < N - 1) {
    const b = bars[i];

    let dailyHalted = false;
    if (dailyDDLimit != null) {
      const dk = dayKeyOf(b.dt);
      if (dk !== curDayKey) { curDayKey = dk; dayStartEquity = equity; }
      dailyHalted = mm.initialCapital > 0 && (dayStartEquity - equity) / mm.initialCapital >= dailyDDLimit;
    }

    const outsideTradingHours = thActive && !isWithinTradingHours(b.dt, thStartMin, thEndMin);
    const fridayBlackout = fridayCloseActive && isFridayCloseWindow(b.dt, fridayCloseCutoffMin);

    const isLong = !dailyHalted && !outsideTradingHours && !fridayBlackout && evalNode(rules.entry_long, b);
    const isShort = !dailyHalted && !outsideTradingHours && !fridayBlackout && !!rules.entry_short && evalNode(rules.entry_short, b);
    equityCurve.push({ dt: b.dt, equity });

    if (!isLong && !isShort) { i++; continue; }

    let entryIdx: number;
    let entryPriceRaw: number;
    let entryRemainingSegments: [number, number][] | null = null;

    if (timing === "same_close") {
      entryIdx = i;
      entryPriceRaw = b.close;
    } else if (timing === "intrabar") {
      entryIdx = i;
      const frac = mm.intrabarFraction != null ? mm.intrabarFraction : 0.5;
      const { price, remaining } = intrabarFixedFractionEntry(b.open, b.high, b.low, b.close, isLong, frac);
      entryPriceRaw = price;
      entryRemainingSegments = remaining;
    } else {
      entryIdx = i + 1;
      entryPriceRaw = bars[entryIdx].open;
    }

    const direction: "long" | "short" = isLong ? "long" : "short";
    const atr = rules.atr_column && typeof b[rules.atr_column] === "number" ? (b[rules.atr_column] as number) : null;
    const sl = rules.stop_loss || { type: "none" };

    let initialSlLevel: number | null = null;
    let slDist: number | null = null;

    if (sl.type === "atr_mult" && atr && atr > 0 && sl.mult) {
      slDist = sl.mult * atr;
    } else if (sl.type === "fixed_points" && sl.value && sl.value > 0) {
      slDist = sl.value;
    } else if (sl.type === "monetary" && sl.value && sl.value > 0) {
      const baseFixedQty = mm.fixedQty > 0 ? mm.fixedQty : 1;
      const refQty = mm.sizingMode === "fixed"
        ? (mm.linearGrowthEnabled && !mm.linearGrowthScaleMonetarySLTP
            ? computeFixedPositionQty(mm, equity)
            : baseFixedQty)
        : 1;
      slDist = sl.value / (refQty * pointVal);
    } else if (sl.type === "prev_candle_low" || sl.type === "prev_candle_high" || sl.type === "prev_candle_extreme") {
      const offset = sl.offset || 0;
      let rawLevel: number;
      if (sl.type === "prev_candle_extreme") {
        rawLevel = direction === "long" ? b.low - offset : b.high + offset;
      } else if (sl.type === "prev_candle_low") {
        rawLevel = b.low - offset;
      } else {
        rawLevel = b.high + offset;
      }
      initialSlLevel = rawLevel;
    } else if (sl.type === "before_signal_low" || sl.type === "before_signal_high" || sl.type === "before_signal_extreme") {
      if (i === 0) { i = entryIdx + 1; continue; }
      const beforeBar = bars[i - 1];
      const offset = sl.offset || 0;
      let rawLevel: number;
      if (sl.type === "before_signal_extreme") {
        rawLevel = direction === "long" ? beforeBar.low - offset : beforeBar.high + offset;
      } else if (sl.type === "before_signal_low") {
        rawLevel = beforeBar.low - offset;
      } else {
        rawLevel = beforeBar.high + offset;
      }
      initialSlLevel = rawLevel;
    }

    if (mm.monetarySLEnabled && mm.monetarySLValue && mm.monetarySLValue > 0) {
      const baseFixedQty = mm.fixedQty > 0 ? mm.fixedQty : 1;
      const refQty = mm.sizingMode === "fixed"
        ? (mm.linearGrowthEnabled && !mm.linearGrowthScaleMonetarySLTP
            ? computeFixedPositionQty(mm, equity)
            : baseFixedQty)
        : 1;
      const mmSlDist = mm.monetarySLValue / (refQty * pointVal);
      if (slDist == null || mmSlDist < slDist) {
        slDist = mmSlDist;
        initialSlLevel = null;
      }
    }

    const isPrevCandleSL =
      (sl.type === "prev_candle_low" || sl.type === "prev_candle_high" || sl.type === "prev_candle_extreme" ||
      sl.type === "before_signal_low" || sl.type === "before_signal_high" || sl.type === "before_signal_extreme") &&
      (!mm.monetarySLEnabled || !mm.monetarySLValue);

    if (mm.sizingMode === "risk" && !isPrevCandleSL && !(slDist && slDist > 0)) {
      i = entryIdx + 1; continue;
    }

    const entryPrice = direction === "long" ? entryPriceRaw + half : entryPriceRaw - half;

    if (isPrevCandleSL) {
      const isExtremeVariant = sl.type === "prev_candle_extreme" || sl.type === "before_signal_extreme";
      if (!isExtremeVariant && initialSlLevel != null) {
        const slOk = direction === "long" ? initialSlLevel < entryPrice : initialSlLevel > entryPrice;
        if (!slOk) { i = entryIdx + 1; continue; }
      }
      if (initialSlLevel != null) {
        slDist = Math.abs(entryPrice - initialSlLevel);
      }
      if (mm.sizingMode === "risk" && !(slDist && slDist > 0)) { i = entryIdx + 1; continue; }
    } else if (slDist != null) {
      initialSlLevel = direction === "long" ? entryPrice - slDist : entryPrice + slDist;
    }

    const qtyTotal = mm.sizingMode === "risk" && slDist
      ? (equity * (mm.riskPct / 100)) / (slDist * pointVal)
      : computeFixedPositionQty(mm, equity);
    let qtyRemaining = qtyTotal;

    interface TpItem {
      label: string;
      level: number;
      closePct: number;
      hit: boolean;
    }

    const tpLegs: TpItem[] = (rules.take_profits || []).map((tp, idx) => {
      let dist = 0;
      if (tp.monetary != null && tp.monetary > 0) {
        const baseFixedQty = mm.fixedQty > 0 ? mm.fixedQty : 1;
        const refQty = mm.sizingMode === "fixed"
          ? (mm.linearGrowthEnabled && !mm.linearGrowthScaleMonetarySLTP
              ? qtyTotal
              : baseFixedQty)
          : 1;
        dist = tp.monetary / (refQty * pointVal);
      } else if (tp.r_mult != null && slDist != null) {
        dist = tp.r_mult * slDist;
      } else if (tp.mult != null && atr != null) {
        dist = tp.mult * atr;
      }
      const level = direction === "long" ? entryPrice + dist : entryPrice - dist;
      return { label: `TP${idx + 1}`, level, closePct: tp.close_pct, hit: false };
    });

    if (mm.monetaryTPEnabled && mm.monetaryTpValue && mm.monetaryTpValue > 0) {
      const baseFixedQty = mm.fixedQty > 0 ? mm.fixedQty : 1;
      const refQty = mm.sizingMode === "fixed"
        ? (mm.linearGrowthEnabled && !mm.linearGrowthScaleMonetarySLTP
            ? qtyTotal
            : baseFixedQty)
        : 1;
      const mDist = mm.monetaryTpValue / (refQty * pointVal);
      const mLevel = direction === "long" ? entryPrice + mDist : entryPrice - mDist;
      const mClosePct = mm.monetaryTpClosePct && mm.monetaryTpClosePct > 0 ? Math.min(100, mm.monetaryTpClosePct) : 50;
      const mLabel = mClosePct < 100 ? `TP_Monetario_${mClosePct}%` : "TP_Monetario";
      tpLegs.push({
        label: mLabel,
        level: mLevel,
        closePct: mClosePct,
        hit: false,
      });
    }
    let pnlTrade = 0;
    let exitReason = "Timeout";
    let exitDt = bars[Math.min(entryIdx, N - 1)].dt;
    let barsHeld = 0;
    let tp1Hit = false;
    let closed = false;
    let lastTpHitLabel: string | null = null;
    const legs: TradeLeg[] = [];
    let currentSlLevel = initialSlLevel;
    const trailFromEntry = rules.trailing_stop || null;

    if (trailFromEntry && atr && atr > 0 && currentSlLevel == null) {
      const trailDist = trailFromEntry.mult * atr;
      currentSlLevel = direction === "long" ? entryPrice - trailDist : entryPrice + trailDist;
    }
    let trailBestPrice = entryPrice;
    const signalExitRules = normalizeExitRules(direction === "long" ? rules.exit_long : rules.exit_short).map((r, idx) => ({
      condition: r.condition,
      closePct: r.close_pct,
      hit: false,
      idx,
    }));
    let pendingSignalExits: { ruleIdx: number; closePct: number }[] = [];
    let j = entryIdx;

    while (j < N && barsHeld < rules.timeout_bars) {
      const cb = bars[j];
      barsHeld++;
      const isEntryBarSameClose = timing === "same_close" && j === entryIdx;

      if (fridayCloseActive && isFridayCloseWindow(cb.dt, fridayCloseCutoffMin) && qtyRemaining > 1e-9) {
        const exitPx = j === entryIdx ? entryPriceRaw : cb.open;
        const fill = direction === "long" ? exitPx - half : exitPx + half;
        const legPnl = qtyRemaining * (direction === "long" ? fill - entryPrice : entryPrice - fill) * pointVal;
        pnlTrade += legPnl;
        legs.push({ reason: "FridayClose", dt: cb.dt, price: fill, qty: qtyRemaining, pctOfPosition: (qtyRemaining / qtyTotal) * 100, pnl: legPnl });
        qtyRemaining = 0;
        exitReason = "FridayClose";
        exitDt = cb.dt; closed = true;
        equityCurve.push({ dt: cb.dt, equity: equity + pnlTrade });
        break;
      }

      if (!isEntryBarSameClose && pendingSignalExits.length > 0 && qtyRemaining > 1e-9) {
        const exitPx = j === entryIdx ? entryPriceRaw : cb.open;
        const fill = direction === "long" ? exitPx - half : exitPx + half;
        for (const pending of pendingSignalExits) {
          if (qtyRemaining <= 1e-9) break;
          const q = pending.closePct >= 100 ? qtyRemaining : Math.min(qtyTotal * (pending.closePct / 100), qtyRemaining);
          if (q > 1e-9) {
            const legPnl = q * (direction === "long" ? fill - entryPrice : entryPrice - fill) * pointVal;
            pnlTrade += legPnl;
            qtyRemaining -= q;
            const legLabel = pending.closePct < 100 ? `ExitSignal_${pending.closePct}%` : "ExitSignal";
            legs.push({
              reason: legLabel,
              dt: cb.dt,
              price: fill,
              qty: q,
              pctOfPosition: (q / qtyTotal) * 100,
              pnl: legPnl,
            });
            if (qtyRemaining <= 1e-9) {
              exitReason = legLabel;
              exitDt = cb.dt;
              closed = true;
              break;
            }
          }
        }
        pendingSignalExits = [];
        if (closed) {
          equityCurve.push({ dt: cb.dt, equity: equity + pnlTrade });
          break;
        }
      }

      if (!isEntryBarSameClose) {
        const barOpen = j === entryIdx ? entryPriceRaw : cb.open;
        const prevClose = j === entryIdx ? null : bars[j - 1].close;
        const active: { name: string; level: number; legIdx?: number }[] = [];
        if (currentSlLevel != null) active.push({ name: "SL", level: currentSlLevel });
        tpLegs.forEach((leg, idx) => { if (!leg.hit) active.push({ name: leg.label, level: leg.level, legIdx: idx }); });

        const touched = walkBarTouches(
          prevClose, barOpen, cb.high, cb.low, cb.close, active,
          j === entryIdx && entryRemainingSegments ? entryRemainingSegments : undefined
        );

        for (const t of touched) {
          if (qtyRemaining <= 1e-9) break;
          if (t.name === "SL") {
            const px = t.gapFill ? barOpen : t.level;
            const fill = direction === "long" ? px - half : px + half;
            const qtyAtSL = qtyRemaining;
            const legPnl = qtyAtSL * (direction === "long" ? fill - entryPrice : entryPrice - fill) * pointVal;
            pnlTrade += legPnl;
            qtyRemaining = 0;
            if (!tp1Hit) {
              exitReason = trailFromEntry ? "SL_trail_entry" : "SL";
            } else if (typeof atpConfig === "string" && atpConfig === "breakeven") {
              exitReason = "SL_breakeven";
            } else if (typeof atpConfig === "object" && atpConfig.type === "trail_atr_mult") {
              exitReason = "SL_trail";
            } else if (trailFromEntry) {
              exitReason = "SL_trail_entry";
            } else {
              exitReason = "SL_dopo_" + (lastTpHitLabel || "TP");
            }
            legs.push({ reason: exitReason, dt: cb.dt, price: fill, qty: qtyAtSL, pctOfPosition: (qtyAtSL / qtyTotal) * 100, pnl: legPnl });
            exitDt = cb.dt; closed = true; break;
          } else if (t.legIdx !== undefined) {
            const tpLegObj = tpLegs[t.legIdx];
            const px = t.gapFill ? barOpen : tpLegObj.level;
            const q = tpLegObj.closePct >= 100 ? qtyRemaining : Math.min(qtyTotal * (tpLegObj.closePct / 100), qtyRemaining);
            const fill = direction === "long" ? px - half : px + half;
            const legPnl = q * (direction === "long" ? fill - entryPrice : entryPrice - fill) * pointVal;
            pnlTrade += legPnl;
            qtyRemaining -= q; tpLegObj.hit = true;
            const tpLabel = tpLegObj.label;
            lastTpHitLabel = tpLabel;
            legs.push({ reason: tpLabel, dt: cb.dt, price: fill, qty: q, pctOfPosition: (q / qtyTotal) * 100, pnl: legPnl });

            if (!tp1Hit) {
              tp1Hit = true;
              if (atpConfig === "breakeven") {
                currentSlLevel = direction === "long" ? entryPrice + half : entryPrice - half;
              } else if (typeof atpConfig === "object" && atpConfig.type === "trail_atr_mult" && atr) {
                const trailDist = atpConfig.mult * atr;
                trailBestPrice = px;
                currentSlLevel = direction === "long" ? trailBestPrice - trailDist : trailBestPrice + trailDist;
              }
            }
            if (qtyRemaining <= 1e-9) { exitReason = lastTpHitLabel; exitDt = cb.dt; closed = true; break; }
          }
        }

        if (!closed) {
          const barBest = direction === "long" ? cb.high : cb.low;
          const unhitTpLevels = tpLegs.filter((l) => !l.hit).map((l) => l.level);
          const tpCeiling =
            direction === "long" && unhitTpLevels.length
              ? Math.min(...unhitTpLevels) - 0.00001
              : direction === "short" && unhitTpLevels.length
              ? Math.max(...unhitTpLevels) + 0.00001
              : null;

          const applyTrail = (dist: number) => {
            if (direction === "long" && barBest > trailBestPrice) {
              trailBestPrice = barBest;
              let candidate = trailBestPrice - dist;
              if (tpCeiling != null) candidate = Math.min(candidate, tpCeiling);
              currentSlLevel = currentSlLevel != null ? Math.max(currentSlLevel, candidate) : candidate;
            } else if (direction === "short" && barBest < trailBestPrice) {
              trailBestPrice = barBest;
              let candidate = trailBestPrice + dist;
              if (tpCeiling != null) candidate = Math.max(candidate, tpCeiling);
              currentSlLevel = currentSlLevel != null ? Math.min(currentSlLevel, candidate) : candidate;
            }
          };

          if (trailFromEntry && atr && atr > 0) {
            applyTrail(trailFromEntry.mult * atr);
          } else if (tp1Hit && typeof atpConfig === "object" && atpConfig.type === "trail_atr_mult" && atr) {
            applyTrail(atpConfig.mult * atr);
          }
        }
      }

      const barClose = cb.close;
      const mtmFill = direction === "long" ? barClose - half : barClose + half;
      const unreal = qtyRemaining * (direction === "long" ? mtmFill - entryPrice : entryPrice - mtmFill) * pointVal;
      equityCurve.push({ dt: cb.dt, equity: equity + pnlTrade + unreal });

      if (closed) break;

      if (signalExitRules.length > 0 && qtyRemaining > 1e-9) {
        for (const sig of signalExitRules) {
          if (!sig.hit && evalNode(sig.condition, cb)) {
            sig.hit = true;
            if (exitTiming === "intrabar" || exitTiming === "same_close") {
              const exitPxRaw =
                exitTiming === "same_close"
                  ? cb.close
                  : intrabarFixedFractionExit(cb.open, cb.high, cb.low, cb.close, direction === "long", exitFrac);
              const fill = direction === "long" ? exitPxRaw - half : exitPxRaw + half;
              const q = sig.closePct >= 100 ? qtyRemaining : Math.min(qtyTotal * (sig.closePct / 100), qtyRemaining);
              if (q > 1e-9) {
                const legPnl = q * (direction === "long" ? fill - entryPrice : entryPrice - fill) * pointVal;
                pnlTrade += legPnl;
                qtyRemaining -= q;
                const legLabel = sig.closePct < 100 ? `ExitSignal_${sig.closePct}%` : "ExitSignal";
                legs.push({
                  reason: legLabel,
                  dt: cb.dt,
                  price: fill,
                  qty: q,
                  pctOfPosition: (q / qtyTotal) * 100,
                  pnl: legPnl,
                });
                if (qtyRemaining <= 1e-9) {
                  exitReason = legLabel;
                  exitDt = cb.dt;
                  closed = true;
                  break;
                }
              }
            } else {
              pendingSignalExits.push({ ruleIdx: sig.idx, closePct: sig.closePct });
            }
          }
        }
        if (closed) {
          if (equityCurve.length > 0 && equityCurve[equityCurve.length - 1].dt === cb.dt) {
            equityCurve[equityCurve.length - 1] = { dt: cb.dt, equity: equity + pnlTrade };
          } else {
            equityCurve.push({ dt: cb.dt, equity: equity + pnlTrade });
          }
          break;
        }
      }

      j++;
    }

    if (!closed) {
      const lastBar = bars[Math.min(j, N - 1)];
      const fill = direction === "long" ? lastBar.close - half : lastBar.close + half;
      const qtyAtTimeout = qtyRemaining;
      const legPnl = qtyAtTimeout * (direction === "long" ? fill - entryPrice : entryPrice - fill) * pointVal;
      pnlTrade += legPnl;
      qtyRemaining = 0;
      const hadExitSignal = legs.some((l) => l.reason.startsWith("ExitSignal"));
      exitReason = tp1Hit
        ? "Timeout_dopo_" + (lastTpHitLabel || "TP")
        : hadExitSignal
        ? "Timeout_dopo_ExitSignal"
        : "Timeout";
      legs.push({ reason: exitReason, dt: lastBar.dt, price: fill, qty: qtyAtTimeout, pctOfPosition: (qtyAtTimeout / qtyTotal) * 100, pnl: legPnl });
      exitDt = lastBar.dt;
      j = Math.min(j, N - 1);
    }

    equity += pnlTrade;
    trades.push({
      direction,
      entryDt: bars[entryIdx].dt,
      entryPrice,
      exitDt,
      exitReason,
      exitPrice: legs.length ? legs[legs.length - 1].price : null,
      atrAtEntry: atr,
      slLevel: initialSlLevel,
      qtyTotal,
      pnl: pnlTrade,
      barsHeld,
      tp1Hit,
      equityAfter: equity,
      afterTp1SlMode: typeof atpConfig === "string" ? atpConfig : atpConfig.type,
      legs,
    });
    i = j + 1;
  }
  if (bars[N - 1]) equityCurve.push({ dt: bars[N - 1].dt, equity });
  return { trades, equityCurve, finalEquity: equity };
}

export function computeDailyDrawdown(equityCurve: EquityPoint[], initialCapital: number): {
  avgDailyDrawdownPct: number;
  dailySeries: DailyDrawdownPoint[];
} {
  if (!equityCurve || equityCurve.length < 2) return { avgDailyDrawdownPct: 0, dailySeries: [] };

  const dayMap = new Map<string, { first: number; last: number; dt: number; count: number }>();
  for (const p of equityCurve) {
    const d = new Date(p.dt);
    const dayKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    if (!dayMap.has(dayKey)) dayMap.set(dayKey, { first: p.equity, last: p.equity, dt: p.dt, count: 0 });
    const entry = dayMap.get(dayKey)!;
    entry.last = p.equity;
    entry.count++;
  }

  const dailySeries: DailyDrawdownPoint[] = [];
  let sumNegative = 0, countNegative = 0;
  for (const [dayKey, { first, last, dt }] of dayMap) {
    if (first <= 0) continue;
    const pctChange = (last - first) / first;
    const ddPct = pctChange > 0 ? 0 : pctChange;
    const ddPctOfInitial = initialCapital > 0 && last - first < 0 ? (last - first) / initialCapital : 0;
    dailySeries.push({ day: dayKey, dt, ddPct, ddPctOfInitial });
    if (ddPct < 0) { sumNegative += ddPct; countNegative++; }
  }
  dailySeries.sort((a, b) => a.dt - b.dt);

  const avgDailyDrawdownPct = countNegative > 0 ? sumNegative / countNegative : 0;
  return { avgDailyDrawdownPct, dailySeries };
}

export function mean(arr: number[]): number {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

export function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

export function getWeekKey(ms: number): string {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day);
  monday.setUTCHours(0, 0, 0, 0);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

export function computeMetrics(trades: Trade[], equityCurve: EquityPoint[], initialCapital: number): BacktestMetrics | null {
  const n = trades.length;
  if (n === 0) return null;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = losses.reduce((s, t) => s + t.pnl, 0);
  const finalEquity = trades[n - 1].equityAfter;

  let peak = -Infinity, maxDD = 0, maxDDPct = 0;
  for (const p of equityCurve) {
    peak = Math.max(peak, p.equity);
    const ddPct = peak > 0 ? (peak - p.equity) / peak : 0;
    if (ddPct > maxDDPct) { maxDDPct = ddPct; maxDD = peak - p.equity; }
  }
  let maxConsWin = 0, maxConsLoss = 0, curW = 0, curL = 0;
  trades.forEach((t) => {
    if (t.pnl > 0) { curW++; curL = 0; } else { curL++; curW = 0; }
    maxConsWin = Math.max(maxConsWin, curW); maxConsLoss = Math.max(maxConsLoss, curL);
  });

  const byDir = { long: trades.filter((t) => t.direction === "long"), short: trades.filter((t) => t.direction === "short") };
  const dirStats = (lst: Trade[]) => {
    if (!lst.length) return { n: 0, winRate: 0, pnl: 0 };
    return { n: lst.length, winRate: lst.filter((t) => t.pnl > 0).length / lst.length, pnl: lst.reduce((s, t) => s + t.pnl, 0) };
  };

  const reasonMap: Record<string, { n: number; pnl: number }> = {};
  trades.forEach((t) => {
    reasonMap[t.exitReason] = reasonMap[t.exitReason] || { n: 0, pnl: 0 };
    reasonMap[t.exitReason].n++;
    reasonMap[t.exitReason].pnl += t.pnl;
  });

  const legReasonMap: Record<string, { n: number; pnl: number; qtyPctSum: number; avgPctOfPosition: number }> = {};
  trades.forEach((t) => {
    (t.legs || []).forEach((leg) => {
      legReasonMap[leg.reason] = legReasonMap[leg.reason] || { n: 0, pnl: 0, qtyPctSum: 0, avgPctOfPosition: 0 };
      legReasonMap[leg.reason].n++;
      legReasonMap[leg.reason].pnl += leg.pnl;
      legReasonMap[leg.reason].qtyPctSum += leg.pctOfPosition;
    });
  });
  Object.values(legReasonMap).forEach((v) => { v.avgPctOfPosition = v.n ? v.qtyPctSum / v.n : 0; });

  const monthlyMap: Record<string, number> = {};
  trades.forEach((t) => {
    const d = new Date(t.exitDt);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    monthlyMap[key] = (monthlyMap[key] || 0) + t.pnl;
  });
  const monthly = Object.keys(monthlyMap).sort().map((k) => ({ month: k, pnl: monthlyMap[k] }));

  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const ratioWinLoss = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : avgWin > 0 ? Infinity : 0;

  const tradeRetPcts = trades.map((t) => {
    const eqBefore = t.equityAfter - t.pnl;
    return eqBefore > 0 ? t.pnl / eqBefore : 0;
  });
  const meanR = mean(tradeRetPcts), stdR = stdev(tradeRetPcts);
  const sharpePerTrade = stdR > 0 ? meanR / stdR : 0;
  const periodDays = (trades[n - 1].exitDt - trades[0].entryDt) / 86400000;
  const tradesPerYear = periodDays > 0 ? (n / periodDays) * 365 : 0;
  const sharpeAnnual = sharpePerTrade * Math.sqrt(tradesPerYear);

  const netProfit = finalEquity - initialCapital;
  const recoveryFactor = maxDD > 0 ? netProfit / maxDD : netProfit > 0 ? Infinity : 0;

  const { avgDailyDrawdownPct, dailySeries } = computeDailyDrawdown(equityCurve, initialCapital);

  const weeklyMap: Record<string, number> = {};
  trades.forEach((t) => { const k = getWeekKey(t.exitDt); weeklyMap[k] = (weeklyMap[k] || 0) + t.pnl; });
  const weekly = Object.keys(weeklyMap).sort().map((k) => ({ week: k, pnl: weeklyMap[k] }));

  const monthlyDirMap: Record<string, { long: Trade[]; short: Trade[] }> = {};
  trades.forEach((t) => {
    const d = new Date(t.exitDt);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!monthlyDirMap[key]) monthlyDirMap[key] = { long: [], short: [] };
    monthlyDirMap[key][t.direction].push(t);
  });
  const monthlyByDirection = Object.keys(monthlyDirMap).sort().map((k) => {
    const longT = monthlyDirMap[k].long, shortT = monthlyDirMap[k].short;
    return {
      month: k,
      longWinRate: longT.length ? longT.filter((t) => t.pnl > 0).length / longT.length : null,
      shortWinRate: shortT.length ? shortT.filter((t) => t.pnl > 0).length / shortT.length : null,
      longN: longT.length,
      shortN: shortT.length,
    };
  });

  return {
    n,
    winRate: wins.length / n,
    profitFactor: grossLoss !== 0 ? grossProfit / Math.abs(grossLoss) : Infinity,
    avgWin,
    avgLoss,
    ratioWinLoss,
    sharpeAnnual,
    recoveryFactor,
    expectancy: trades.reduce((s, t) => s + t.pnl, 0) / n,
    finalEquity,
    totalReturnPct: finalEquity / initialCapital - 1,
    maxDD,
    maxDDPct,
    maxConsWin,
    maxConsLoss,
    avgDailyDrawdownPct,
    dailyDrawdownSeries: dailySeries,
    avgBarsHeld: trades.reduce((s, t) => s + t.barsHeld, 0) / n,
    byDirection: { long: dirStats(byDir.long), short: dirStats(byDir.short) },
    byReason: reasonMap,
    byLegReason: legReasonMap,
    monthly,
    weekly,
    monthlyByDirection,
  };
}

export function buildDirectionEquityCurve(trades: Trade[], direction: "long" | "short", initialCapital: number): { dt: number | null; equity: number }[] {
  const subset = trades.filter((t) => t.direction === direction).slice().sort((a, b) => a.exitDt - b.exitDt);
  let equity = initialCapital;
  const curve: { dt: number | null; equity: number }[] = [{ dt: subset.length ? subset[0].entryDt : null, equity }];
  for (const t of subset) { equity += t.pnl; curve.push({ dt: t.exitDt, equity }); }
  return curve;
}

export function mergeStepCurves(
  curveA: { dt: number | null; equity: number }[],
  curveB: { dt: number | null; equity: number }[],
  keyA: string,
  keyB: string
): any[] {
  const allDts = Array.from(
    new Set([...curveA.map((p) => p.dt), ...curveB.map((p) => p.dt)].filter((d): d is number => d != null))
  ).sort((a, b) => a - b);
  let ia = 0, ib = 0, valA = curveA[0] ? curveA[0].equity : null, valB = curveB[0] ? curveB[0].equity : null;
  const out: any[] = [];
  for (const dt of allDts) {
    while (ia < curveA.length && curveA[ia].dt != null && curveA[ia].dt! <= dt) { valA = curveA[ia].equity; ia++; }
    while (ib < curveB.length && curveB[ib].dt != null && curveB[ib].dt! <= dt) { valB = curveB[ib].equity; ib++; }
    out.push({ dt, [keyA]: valA, [keyB]: valB });
  }
  return out;
}

export function downsample<T>(arr: T[], maxPts: number): T[] {
  if (arr.length <= maxPts) return arr;
  const step = Math.ceil(arr.length / maxPts);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  out.push(arr[arr.length - 1]);
  return out;
}

export function formatLegsForExport(legs: TradeLeg[]): string {
  if (!legs || !legs.length) return "";
  return legs.map((l) => `${l.reason}:${fmtNum(l.pctOfPosition, 0)}%@${fmtNum(l.price, 4)}(${l.pnl >= 0 ? "+" : ""}${fmtNum(l.pnl, 2)})`).join(" | ");
}

export function tradesToCSV(trades: Trade[]): string {
  const header = ["#", "Direzione", "Entry Datetime", "Entry Price", "Exit Datetime", "Exit Price", "Motivo Uscita", "ATR Entry", "SL", "Qty", "Candele", "TP Hit", "PnL", "Equity Dopo", "Gambe (motivo:%size@prezzo(pnl))"];
  const rows = trades.map((t, idx) => [
    idx + 1,
    t.direction,
    fmtDT(t.entryDt),
    t.entryPrice.toFixed(4),
    fmtDT(t.exitDt),
    t.exitPrice != null ? t.exitPrice.toFixed(4) : "",
    t.exitReason,
    t.atrAtEntry != null ? t.atrAtEntry.toFixed(4) : "",
    t.slLevel != null ? t.slLevel.toFixed(4) : "",
    t.qtyTotal.toFixed(4),
    t.barsHeld,
    t.tp1Hit ? "SI" : "NO",
    t.pnl.toFixed(2),
    t.equityAfter.toFixed(2),
    formatLegsForExport(t.legs),
  ]);
  return [header, ...rows].map((r) => r.join(";")).join("\n");
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fmtNum(v: number | null | undefined, d = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return Number(v).toFixed(d);
}

function fmtDT(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

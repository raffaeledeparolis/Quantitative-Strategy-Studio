// Generates a realistic sample dataset for demonstration and testing purposes
export function generateSampleCsv(): string {
  const header = "datetime;open;high;low;close;trend_prob;avg_trend_prob;daily_return;avg_daily_return;price_regime;avg_price_regime;lma;avg_lma;atr_14";
  const rows: string[] = [];

  let price = 2400.0;
  let trendProb = 0.5;
  let priceRegime = 1.0;
  let lma = 2400.0;
  let atr = 15.0;

  const startMs = Date.UTC(2025, 0, 5, 8, 0, 0); // 2025-01-05 08:00 UTC
  const stepMs = 3600 * 1000; // 1 hour

  // 1200 bars (~2.5 months of 1H data)
  for (let i = 0; i < 1200; i++) {
    const curMs = startMs + i * stepMs;
    const d = new Date(curMs);
    const dayOfWeek = d.getUTCDay();
    // Skip weekends for market realism
    if (dayOfWeek === 6 || (dayOfWeek === 0 && d.getUTCHours() < 22)) {
      continue;
    }

    // Regime transitions
    const shock = (Math.sin(i / 40) + Math.cos(i / 15) * 0.5 + (Math.random() - 0.49)) * 0.004;
    const open = price;
    const ret = shock + (Math.random() - 0.5) * 0.003;
    const close = open * (1 + ret);
    const high = Math.max(open, close) + Math.random() * 4.5;
    const low = Math.min(open, close) - Math.random() * 4.5;
    price = close;

    trendProb = Math.max(0.05, Math.min(0.95, trendProb * 0.92 + (ret > 0 ? 0.07 : -0.05) + (Math.random() - 0.48) * 0.06));
    const avgTrendProb = 0.50;
    const dailyReturn = ret * 100;
    const avgDailyReturn = 0.02;
    priceRegime = Math.max(0.2, priceRegime * 0.95 + (Math.abs(ret) * 100) * 0.05 + 0.1);
    const avgPriceRegime = 1.1;
    lma = lma * 0.96 + close * 0.04;
    const avgLma = lma * 0.995;
    atr = Math.max(5, atr * 0.95 + (high - low) * 0.05);

    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

    rows.push(
      [
        dateStr,
        open.toFixed(2),
        high.toFixed(2),
        low.toFixed(2),
        close.toFixed(2),
        trendProb.toFixed(4),
        avgTrendProb.toFixed(4),
        dailyReturn.toFixed(4),
        avgDailyReturn.toFixed(4),
        priceRegime.toFixed(4),
        avgPriceRegime.toFixed(4),
        lma.toFixed(2),
        avgLma.toFixed(2),
        atr.toFixed(2),
      ].join(";")
    );
  }

  return [header, ...rows].join("\n");
}

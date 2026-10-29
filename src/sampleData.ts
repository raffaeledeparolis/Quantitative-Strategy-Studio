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

// Generates a higher-frequency (5-minute) dataset with volume matching the 1H sample data
export function generateSampleHfCsv(): string {
  const header = "datetime;open;high;low;close;volume";
  const rows: string[] = [];

  let price = 2400.0;
  const startMs = Date.UTC(2025, 0, 5, 8, 0, 0);
  const step1hMs = 3600 * 1000;
  const step5mMs = 5 * 60 * 1000;

  // Generate 5-min bars for the first 300 1H periods (~3600 5m bars)
  for (let i = 0; i < 300; i++) {
    const hourStartMs = startMs + i * step1hMs;
    const dHour = new Date(hourStartMs);
    const dayOfWeek = dHour.getUTCDay();
    if (dayOfWeek === 6 || (dayOfWeek === 0 && dHour.getUTCHours() < 22)) {
      continue;
    }

    const shock = (Math.sin(i / 40) + Math.cos(i / 15) * 0.5 + (Math.random() - 0.49)) * 0.004;
    const hourRet = shock + (Math.random() - 0.5) * 0.003;
    const hourOpen = price;
    const hourClose = hourOpen * (1 + hourRet);
    price = hourClose;

    let subPrice = hourOpen;
    for (let m = 0; m < 12; m++) {
      const curMs = hourStartMs + m * step5mMs;
      const d = new Date(curMs);
      const pad = (n: number) => String(n).padStart(2, "0");
      const dateStr = `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

      const isLast = m === 11;
      const subOpen = subPrice;
      const targetSubClose = isLast ? hourClose : subOpen + ((hourClose - subOpen) / (12 - m)) + (Math.random() - 0.5) * 1.5;
      const subHigh = Math.max(subOpen, targetSubClose) + Math.random() * 1.8;
      const subLow = Math.min(subOpen, targetSubClose) - Math.random() * 1.8;
      const subClose = targetSubClose;
      subPrice = subClose;

      // Volumetric component
      const volBase = 150 + Math.floor(Math.random() * 300);
      const volSurge = (m === 0 || m === 11 || Math.abs(subHigh - subLow) > 2.0) ? Math.floor(Math.random() * 400 + 200) : 0;
      const volume = volBase + volSurge;

      rows.push(
        [
          dateStr,
          subOpen.toFixed(2),
          subHigh.toFixed(2),
          subLow.toFixed(2),
          subClose.toFixed(2),
          volume.toString(),
        ].join(";")
      );
    }
  }

  return [header, ...rows].join("\n");
}


import { jsPDF } from "jspdf";
import {
  BacktestResult,
  MoneyManagement,
  MonteCarloResult,
  ReliabilityScore,
  EquityPoint,
} from "../types";
import { fmtMoney, fmtPct, fmtNum, fmtDT } from "./csvHelper";
import { runMonteCarlo, computeReliabilityScore, buildNarrative } from "./monteCarloEngine";

/**
 * Render Equity Curve & Drawdown to high-res offscreen canvas
 */
function renderEquityChartCanvas(equityCurve: EquityPoint[], initialCapital: number): string {
  const width = 1400;
  const height = 540;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const padLeft = 80;
  const padRight = 40;
  const padTop = 35;
  const padBottom = 55;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  if (!equityCurve || equityCurve.length === 0) {
    ctx.fillStyle = "#666666";
    ctx.font = "20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Nessun dato di equity disponibile", width / 2, height / 2);
    return canvas.toDataURL("image/png");
  }

  // Find min and max equity
  let minEq = initialCapital;
  let maxEq = initialCapital;
  for (const pt of equityCurve) {
    if (pt.equity < minEq) minEq = pt.equity;
    if (pt.equity > maxEq) maxEq = pt.equity;
  }
  // Add 8% padding
  const span = Math.max(10, maxEq - minEq);
  const yMin = Math.max(0, minEq - span * 0.08);
  const yMax = maxEq + span * 0.08;

  // Grid Lines
  ctx.strokeStyle = "#e8e7e1";
  ctx.lineWidth = 1;
  const numYGrid = 5;
  ctx.font = "18px 'Plus Jakarta Sans', Arial, sans-serif";
  ctx.fillStyle = "#736b63";
  ctx.textAlign = "right";

  for (let i = 0; i <= numYGrid; i++) {
    const val = yMin + (i / numYGrid) * (yMax - yMin);
    const y = padTop + plotH - (i / numYGrid) * plotH;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(width - padRight, y);
    ctx.stroke();

    const label = val >= 1000 ? `${(val / 1000).toFixed(0)}k €` : `${val.toFixed(0)} €`;
    ctx.fillText(label, padLeft - 10, y + 6);
  }

  // Initial Capital reference line
  const initY = padTop + plotH - ((initialCapital - yMin) / (yMax - yMin)) * plotH;
  if (initY >= padTop && initY <= padTop + plotH) {
    ctx.strokeStyle = "#b0aba2";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(padLeft, initY);
    ctx.lineTo(width - padRight, initY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#8a847c";
    ctx.font = "15px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Capitale Iniziale", padLeft + 8, initY - 6);
  }

  // Draw Equity Area & Line
  const n = equityCurve.length;
  const getX = (idx: number) => padLeft + (idx / Math.max(1, n - 1)) * plotW;
  const getY = (val: number) => padTop + plotH - ((val - yMin) / (yMax - yMin)) * plotH;

  // Gradient fill under equity line
  const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
  grad.addColorStop(0, "rgba(31, 111, 80, 0.28)");
  grad.addColorStop(1, "rgba(31, 111, 80, 0.02)");

  ctx.beginPath();
  ctx.moveTo(getX(0), padTop + plotH);
  for (let i = 0; i < n; i++) {
    ctx.lineTo(getX(i), getY(equityCurve[i].equity));
  }
  ctx.lineTo(getX(n - 1), padTop + plotH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Equity Line
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(equityCurve[0].equity));
  for (let i = 1; i < n; i++) {
    ctx.lineTo(getX(i), getY(equityCurve[i].equity));
  }
  ctx.strokeStyle = "#1F6F50";
  ctx.lineWidth = 3;
  ctx.stroke();

  // X Axis labels
  ctx.fillStyle = "#736b63";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "left";
  if (equityCurve[0]?.dt) {
    ctx.fillText(fmtDT(equityCurve[0].dt), padLeft, height - padBottom + 26);
  }
  ctx.textAlign = "right";
  if (equityCurve[n - 1]?.dt) {
    ctx.fillText(fmtDT(equityCurve[n - 1].dt), width - padRight, height - padBottom + 26);
  }
  ctx.textAlign = "center";
  ctx.fillText("Progressione Temporale del Backtest", width / 2, height - 12);

  return canvas.toDataURL("image/png");
}

/**
 * Render Monte Carlo Fan Chart to high-res offscreen canvas
 */
function renderMonteCarloFanChartCanvas(
  bands: MonteCarloResult["bands"],
  actualEquity: number[],
  initialCapital: number
): string {
  const width = 1400;
  const height = 540;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const padLeft = 80;
  const padRight = 40;
  const padTop = 35;
  const padBottom = 55;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  if (!bands || bands.length === 0) {
    ctx.fillStyle = "#666666";
    ctx.font = "20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Nessuna banda Monte Carlo disponibile", width / 2, height / 2);
    return canvas.toDataURL("image/png");
  }

  // Find min and max across all bands and actual
  let minV = initialCapital;
  let maxV = initialCapital;
  for (const b of bands) {
    if (b.p5 < minV) minV = b.p5;
    if (b.p95 > maxV) maxV = b.p95;
  }
  for (const a of actualEquity) {
    if (a < minV) minV = a;
    if (a > maxV) maxV = a;
  }

  const span = Math.max(10, maxV - minV);
  const yMin = Math.max(0, minV - span * 0.08);
  const yMax = maxV + span * 0.08;

  const n = bands.length;
  const getX = (idx: number) => padLeft + (idx / Math.max(1, n - 1)) * plotW;
  const getY = (val: number) => padTop + plotH - ((val - yMin) / (yMax - yMin)) * plotH;

  // Grid Lines
  ctx.strokeStyle = "#e8e7e1";
  ctx.lineWidth = 1;
  const numYGrid = 5;
  ctx.font = "18px 'Plus Jakarta Sans', Arial, sans-serif";
  ctx.fillStyle = "#736b63";
  ctx.textAlign = "right";

  for (let i = 0; i <= numYGrid; i++) {
    const val = yMin + (i / numYGrid) * (yMax - yMin);
    const y = padTop + plotH - (i / numYGrid) * plotH;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(width - padRight, y);
    ctx.stroke();

    const label = val >= 1000 ? `${(val / 1000).toFixed(0)}k €` : `${val.toFixed(0)} €`;
    ctx.fillText(label, padLeft - 10, y + 6);
  }

  // Band 5° - 95°
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(bands[0].p95));
  for (let i = 1; i < n; i++) ctx.lineTo(getX(i), getY(bands[i].p95));
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(getX(i), getY(bands[i].p5));
  ctx.closePath();
  ctx.fillStyle = "rgba(31, 111, 80, 0.15)";
  ctx.fill();

  // Band 25° - 75°
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(bands[0].p75));
  for (let i = 1; i < n; i++) ctx.lineTo(getX(i), getY(bands[i].p75));
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(getX(i), getY(bands[i].p25));
  ctx.closePath();
  ctx.fillStyle = "rgba(31, 111, 80, 0.35)";
  ctx.fill();

  // Median Simulated Line (p50)
  ctx.beginPath();
  ctx.moveTo(getX(0), getY(bands[0].p50));
  for (let i = 1; i < n; i++) ctx.lineTo(getX(i), getY(bands[i].p50));
  ctx.strokeStyle = "#C79A2E";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([6, 5]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Actual Observed Equity Line
  if (actualEquity && actualEquity.length > 0) {
    const actLen = Math.min(n, actualEquity.length);
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(actualEquity[0]));
    for (let i = 1; i < actLen; i++) ctx.lineTo(getX(i), getY(actualEquity[i]));
    ctx.strokeStyle = "#2B2824";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Initial Capital line
  const initY = getY(initialCapital);
  if (initY >= padTop && initY <= padTop + plotH) {
    ctx.strokeStyle = "#999999";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, initY);
    ctx.lineTo(width - padRight, initY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Legend at bottom
  ctx.font = "15px sans-serif";
  ctx.textAlign = "left";
  let legX = padLeft + 20;
  const legY = height - 16;

  // Actual
  ctx.fillStyle = "#2B2824";
  ctx.fillRect(legX, legY - 10, 16, 4);
  ctx.fillText("Reale osservato", legX + 22, legY - 5);
  legX += 170;

  // Median
  ctx.fillStyle = "#C79A2E";
  ctx.fillRect(legX, legY - 9, 16, 3);
  ctx.fillText("Mediana simulata", legX + 22, legY - 5);
  legX += 180;

  // 25-75
  ctx.fillStyle = "rgba(31, 111, 80, 0.5)";
  ctx.fillRect(legX, legY - 12, 16, 10);
  ctx.fillStyle = "#4a453e";
  ctx.fillText("Banda 25°-75°", legX + 22, legY - 5);
  legX += 160;

  // 5-95
  ctx.fillStyle = "rgba(31, 111, 80, 0.2)";
  ctx.fillRect(legX, legY - 12, 16, 10);
  ctx.fillStyle = "#4a453e";
  ctx.fillText("Banda 5°-95°", legX + 22, legY - 5);

  return canvas.toDataURL("image/png");
}

export interface GeneratePdfOptions {
  result: BacktestResult;
  mm: MoneyManagement;
  mcResult?: MonteCarloResult | null;
  strategyTitle?: string;
}

/**
 * Generates and downloads a complete institutional PDF Backtest & Monte Carlo Report
 */
export async function exportBacktestPdfReport({
  result,
  mm,
  mcResult: providedMcResult,
  strategyTitle = "Strategia Quantitativa",
}: GeneratePdfOptions): Promise<void> {
  const { trades, equityCurve, metrics, rules } = result;

  // Ensure Monte Carlo simulation is available
  const mcResult: MonteCarloResult =
    providedMcResult ||
    runMonteCarlo(trades, mm, {
      iterations: 1500,
      method: "bootstrap",
      ruinThresholdPct: 50,
    });

  const reliability: ReliabilityScore = computeReliabilityScore(metrics, mcResult, trades, mm);
  const narrative = buildNarrative(metrics, mcResult, reliability, mm, trades.length);

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  let pageNum = 1;

  // Helper for Header on each page
  const drawPageHeader = (title: string, sub: string) => {
    doc.setFillColor(247, 246, 241);
    doc.rect(0, 0, pageWidth, 20, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(31, 111, 80);
    doc.text("QUANTITATIVE BACKTEST REPORT", margin, 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(115, 107, 99);
    doc.text(title, margin + 78, 12);

    doc.setFontSize(8);
    doc.text(sub, pageWidth - margin, 12, { align: "right" });

    doc.setDrawColor(218, 214, 202);
    doc.setLineWidth(0.3);
    doc.line(margin, 20, pageWidth - margin, 20);
  };

  // Helper for Footer on each page
  const drawPageFooter = (curPage: number, totalPagesPlaceholder = 3) => {
    doc.setDrawColor(218, 214, 202);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(115, 107, 99);
    doc.text("Generato da Quantitative Strategy Studio", margin, pageHeight - 7);
    doc.text(`Pagina ${curPage} di ${totalPagesPlaceholder}`, pageWidth - margin, pageHeight - 7, {
      align: "right",
    });
  };

  // ==========================================
  // PAGE 1: Executive Summary & Key Metrics & Equity Curve
  // ==========================================
  drawPageHeader(strategyTitle, new Date().toLocaleDateString("it-IT"));

  let y = 26;

  // Main Report Title Banner
  doc.setFont("times", "bold");
  doc.setFontSize(18);
  doc.setTextColor(43, 40, 36);
  doc.text("Report di Backtest & Analisi di Rischio", margin, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(115, 107, 99);
  const firstDt = trades[0]?.entryDt ? fmtDT(trades[0].entryDt) : "Inizio";
  const lastDt = trades[trades.length - 1]?.exitDt ? fmtDT(trades[trades.length - 1].exitDt!) : "Fine";
  doc.text(
    `Capitale Iniziale: ${fmtMoney(mm.initialCapital)} | Operazioni: ${trades.length} | Periodo: ${firstDt} → ${lastDt} | Sizing: ${mm.sizingMode === "risk" ? `${mm.riskPct}% Rischio` : `${mm.fixedQty} Qty Fissa`}`,
    margin,
    y
  );
  y += 8;

  // Box 1: KPI Cards Grid
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(218, 214, 202);
  doc.roundedRect(margin, y, contentWidth, 54, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(31, 111, 80);
  doc.text("METRICHE CHIAVE DI PERFORMANCE", margin + 4, y + 6);

  const kpis = [
    { l: "Rendimento Totale", v: fmtPct(metrics.totalReturnPct), hl: metrics.totalReturnPct >= 0 ? "#1F6F50" : "#B5342B" },
    { l: "Capitale Finale", v: fmtMoney(metrics.finalEquity), hl: "#2B2824" },
    { l: "Win Rate", v: fmtPct(metrics.winRate), hl: "#2B2824" },
    { l: "Profit Factor", v: fmtNum(metrics.profitFactor), hl: metrics.profitFactor >= 1.5 ? "#1F6F50" : "#2B2824" },
    { l: "Max Drawdown", v: `-${fmtPct(metrics.maxDDPct)}`, hl: "#B5342B" },
    { l: "DD Giornaliero Medio", v: `-${fmtPct(Math.abs(metrics.avgDailyDrawdownPct))}`, hl: "#B5342B" },
    { l: "Expectancy / Trade", v: fmtMoney(metrics.expectancy), hl: metrics.expectancy >= 0 ? "#1F6F50" : "#B5342B" },
    { l: "Sharpe Annualizzato", v: fmtNum(metrics.sharpeAnnual), hl: "#2B2824" },
    { l: "Average Win", v: fmtMoney(metrics.avgWin), hl: "#1F6F50" },
    { l: "Average Loss", v: fmtMoney(metrics.avgLoss), hl: "#B5342B" },
    { l: "Ratio Win/Loss", v: fmtNum(metrics.ratioWinLoss), hl: "#2B2824" },
    { l: "Recovery Factor", v: fmtNum(metrics.recoveryFactor), hl: "#2B2824" },
  ];

  const cols = 4;
  const colW = contentWidth / cols;
  const rowH = 13;
  const startKpiY = y + 13;

  kpis.forEach((kpi, idx) => {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const kx = margin + c * colW + 4;
    const ky = startKpiY + r * rowH;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(115, 107, 99);
    doc.text(kpi.l, kx, ky);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(kpi.hl);
    doc.text(kpi.v, kx, ky + 5);
  });

  y += 60;

  // Box 2: Equity Curve Chart
  doc.setFont("times", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(43, 40, 36);
  doc.text("Equity Curve & Traiettoria del Capitale", margin, y);
  y += 4;

  const eqImg = renderEquityChartCanvas(equityCurve, mm.initialCapital);
  if (eqImg) {
    const chartHeight = 72;
    doc.addImage(eqImg, "PNG", margin, y, contentWidth, chartHeight);
    y += chartHeight + 6;
  }

  // Box 3: Trade Execution Breakdown
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(31, 111, 80);
  doc.text("DISTRIBUZIONE E DETTAGLIO ESECUZIONE", margin, y);
  y += 4;

  const longTrades = trades.filter((t) => t.direction === "long");
  const shortTrades = trades.filter((t) => t.direction === "short");
  const longPnl = longTrades.reduce((s, t) => s + t.pnl, 0);
  const shortPnl = shortTrades.reduce((s, t) => s + t.pnl, 0);
  const winTrades = trades.filter((t) => t.pnl > 0);
  const lossTrades = trades.filter((t) => t.pnl <= 0);

  doc.setFillColor(247, 246, 241);
  doc.rect(margin, y, contentWidth, 24, "F");
  doc.setDrawColor(218, 214, 202);
  doc.rect(margin, y, contentWidth, 24, "S");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(43, 40, 36);

  const colWidth3 = contentWidth / 3;
  // Col 1: Long vs Short
  doc.text(`Trade Long: ${longTrades.length} (PnL: ${fmtMoney(longPnl)})`, margin + 4, y + 6);
  doc.text(`Trade Short: ${shortTrades.length} (PnL: ${fmtMoney(shortPnl)})`, margin + 4, y + 13);
  doc.text(`Durata media: ${fmtNum(metrics.avgBarsHeld, 1)} candele`, margin + 4, y + 20);

  // Col 2: Win vs Loss streaks
  doc.text(`Trade Vincenti: ${winTrades.length} (${fmtPct(metrics.winRate)})`, margin + colWidth3 + 4, y + 6);
  doc.text(`Trade Perdenti: ${lossTrades.length} (${fmtPct(1 - metrics.winRate)})`, margin + colWidth3 + 4, y + 13);
  doc.text(`Max Win / Loss Consecutivi: ${metrics.maxConsWin} / ${metrics.maxConsLoss}`, margin + colWidth3 + 4, y + 20);

  // Col 3: Money Management setup
  doc.text(`Spread applicato: ${mm.spread || 0} pts`, margin + colWidth3 * 2 + 4, y + 6);
  doc.text(`Timing: in=${mm.entryTiming} / out=${mm.exitTiming || "next_open"}`, margin + colWidth3 * 2 + 4, y + 13);
  doc.text(`Stop Loss configurato: ${rules?.stop_loss?.type || "none"}`, margin + colWidth3 * 2 + 4, y + 20);

  drawPageFooter(pageNum, 3);

  // ==========================================
  // PAGE 2: Monte Carlo Simulation & Fan Chart
  // ==========================================
  doc.addPage();
  pageNum++;
  drawPageHeader("Analisi Monte Carlo & Rischio di Sequenza", `${mcResult.iterations.toLocaleString("it-IT")} iterazioni`);

  y = 26;

  doc.setFont("times", "bold");
  doc.setFontSize(16);
  doc.setTextColor(43, 40, 36);
  doc.text("Simulazione Monte Carlo & Stress Test", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(115, 107, 99);
  doc.text(
    `Metodo: ${mcResult.method === "bootstrap" ? "Bootstrap (con reinserimento)" : "Permutazione (riordino)"} | Soglia Rovina: ${mcResult.ruinThresholdPct}% del capitale | Campione: ${trades.length} trade`,
    margin,
    y
  );
  y += 7;

  // Monte Carlo KPI Highlights
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(218, 214, 202);
  doc.roundedRect(margin, y, contentWidth, 24, 2, 2, "FD");

  const mcKpis = [
    { l: "Rischio di Rovina", v: fmtPct(mcResult.riskOfRuin), hl: mcResult.riskOfRuin > 0.05 ? "#B5342B" : "#1F6F50" },
    { l: "Prob. Guadagno", v: fmtPct(mcResult.probPositive), hl: mcResult.probPositive >= 0.7 ? "#1F6F50" : "#C79A2E" },
    { l: "Drawdown Mediano (p50)", v: fmtPct(mcResult.ddStats.p50), hl: "#2B2824" },
    { l: "Drawdown Worst-Case (p95)", v: fmtPct(mcResult.ddStats.p95), hl: mcResult.ddStats.p95 > 0.3 ? "#B5342B" : "#2B2824" },
    { l: "Profit Factor Worst-Case (p5)", v: fmtNum(mcResult.pfStats.p5), hl: mcResult.pfStats.p5 < 1 ? "#B5342B" : "#1F6F50" },
  ];

  const mcColW = contentWidth / mcKpis.length;
  mcKpis.forEach((kpi, idx) => {
    const kx = margin + idx * mcColW + 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(115, 107, 99);
    doc.text(kpi.l, kx, y + 7);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(kpi.hl);
    doc.text(kpi.v, kx, y + 16);
  });

  y += 30;

  // Percentiles Table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(31, 111, 80);
  doc.text("DISTRIBUZIONE PERCENTILI MONTE CARLO VS REALE", margin, y);
  y += 4;

  const tableHeaders = ["Metrica", "Reale", "5° perc.", "25° perc.", "Mediana (50°)", "75° perc.", "95° perc.", "Media"];
  const colWidths = [42, 20, 20, 20, 24, 20, 20, 16];

  // Table Header Row
  doc.setFillColor(247, 246, 241);
  doc.rect(margin, y, contentWidth, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(115, 107, 99);

  let curX = margin;
  tableHeaders.forEach((th, i) => {
    doc.text(th, curX + 2, y + 5);
    curX += colWidths[i];
  });
  y += 7;

  const tableRows = [
    {
      m: "Rendimento Totale",
      reale: fmtPct(metrics.totalReturnPct),
      p5: fmtPct(mcResult.returnStats.p5),
      p25: fmtPct(mcResult.returnStats.p25),
      p50: fmtPct(mcResult.returnStats.p50),
      p75: fmtPct(mcResult.returnStats.p75),
      p95: fmtPct(mcResult.returnStats.p95),
      avg: fmtPct(mcResult.returnStats.mean),
    },
    {
      m: "Max Drawdown",
      reale: `-${fmtPct(metrics.maxDDPct)}`,
      p5: fmtPct(mcResult.ddStats.p5),
      p25: fmtPct(mcResult.ddStats.p25),
      p50: fmtPct(mcResult.ddStats.p50),
      p75: fmtPct(mcResult.ddStats.p75),
      p95: fmtPct(mcResult.ddStats.p95),
      avg: fmtPct(mcResult.ddStats.mean),
    },
    {
      m: "DD Giornaliero Medio",
      reale: fmtPct(metrics.avgDailyDrawdownPct),
      p5: fmtPct(mcResult.avgDailyDDStats.p5),
      p25: fmtPct(mcResult.avgDailyDDStats.p25),
      p50: fmtPct(mcResult.avgDailyDDStats.p50),
      p75: fmtPct(mcResult.avgDailyDDStats.p75),
      p95: fmtPct(mcResult.avgDailyDDStats.p95),
      avg: fmtPct(mcResult.avgDailyDDStats.mean),
    },
    {
      m: "Profit Factor",
      reale: fmtNum(metrics.profitFactor),
      p5: fmtNum(mcResult.pfStats.p5),
      p25: fmtNum(mcResult.pfStats.p25),
      p50: fmtNum(mcResult.pfStats.p50),
      p75: fmtNum(mcResult.pfStats.p75),
      p95: fmtNum(mcResult.pfStats.p95),
      avg: fmtNum(mcResult.pfStats.mean),
    },
  ];

  tableRows.forEach((row, idx) => {
    if (idx % 2 === 1) {
      doc.setFillColor(252, 251, 248);
      doc.rect(margin, y, contentWidth, 7, "F");
    }
    doc.setFont("helvetica", idx === 0 ? "bold" : "normal");
    doc.setFontSize(8);
    doc.setTextColor(43, 40, 36);

    let rowX = margin;
    doc.text(row.m, rowX + 2, y + 5);
    rowX += colWidths[0];
    doc.setFont("helvetica", "bold");
    doc.text(row.reale, rowX + 2, y + 5);
    rowX += colWidths[1];
    doc.setFont("helvetica", "normal");
    doc.text(row.p5, rowX + 2, y + 5);
    rowX += colWidths[2];
    doc.text(row.p25, rowX + 2, y + 5);
    rowX += colWidths[3];
    doc.text(row.p50, rowX + 2, y + 5);
    rowX += colWidths[4];
    doc.text(row.p75, rowX + 2, y + 5);
    rowX += colWidths[5];
    doc.text(row.p95, rowX + 2, y + 5);
    rowX += colWidths[6];
    doc.text(row.avg, rowX + 2, y + 5);

    y += 7;
  });

  y += 6;

  // Fan Chart
  doc.setFont("times", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(43, 40, 36);
  doc.text("Fan Chart — Fasce di Confidenza Monte Carlo vs Sequenza Reale", margin, y);
  y += 4;

  const actualTradeEquity = [mm.initialCapital, ...trades.map((t) => t.equityAfter)];
  const fanImg = renderMonteCarloFanChartCanvas(mcResult.bands, actualTradeEquity, mm.initialCapital);
  if (fanImg) {
    const chartHeight = 72;
    doc.addImage(fanImg, "PNG", margin, y, contentWidth, chartHeight);
    y += chartHeight + 6;
  }

  // Summary note
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(115, 107, 99);
  doc.text(
    `La sequenza reale osservata si colloca al ${fmtNum(reliability.rank, 0)}° percentile della distribuzione Monte Carlo.`,
    margin,
    y
  );

  drawPageFooter(pageNum, 3);

  // ==========================================
  // PAGE 3: Reliability Score, Detailed Score Breakdown, Narrative & Actionable Steps
  // ==========================================
  doc.addPage();
  pageNum++;
  drawPageHeader("Giudizio di Affidabilità & Dettagli Punteggio", `Punteggio: ${reliability.score}/100`);

  y = 26;

  doc.setFont("times", "bold");
  doc.setFontSize(16);
  doc.setTextColor(43, 40, 36);
  doc.text("Giudizio di Affidabilità Quantitativa", margin, y);
  y += 6;

  // Score Badge Banner
  doc.setFillColor(reliability.score >= 80 ? 238 : reliability.score >= 60 ? 254 : 253, reliability.score >= 80 ? 247 : reliability.score >= 60 ? 249 : 237, reliability.score >= 80 ? 242 : reliability.score >= 60 ? 231 : 236);
  doc.setDrawColor(reliability.verdictColor);
  doc.setLineWidth(0.8);
  doc.roundedRect(margin, y, contentWidth, 22, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(reliability.verdictColor);
  doc.text(`${reliability.score}`, margin + 8, y + 14);

  doc.setFontSize(10);
  doc.text("/ 100", margin + 30, y + 14);

  doc.setFontSize(14);
  doc.text(reliability.verdict.toUpperCase(), margin + 48, y + 13);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(115, 107, 99);
  doc.text("Euristica di robustezza statistica e controllo del rischio basata sui risultati Monte Carlo.", margin + 48, y + 18);

  y += 28;

  // Detailed Score Breakdown Table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(31, 111, 80);
  doc.text("DETTAGLIO DEL PUNTEGGIO DI AFFIDABILITÀ", margin, y);
  y += 4;

  const scoreHeaders = ["Criterio di Valutazione", "Punti", "Spiegazione & Dettaglio Parametrico"];
  const scoreColWidths = [54, 20, contentWidth - 74];

  doc.setFillColor(247, 246, 241);
  doc.rect(margin, y, contentWidth, 6.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(115, 107, 99);

  let scX = margin;
  scoreHeaders.forEach((sh, i) => {
    doc.text(sh, scX + 2, y + 4.5);
    scX += scoreColWidths[i];
  });
  y += 6.5;

  reliability.breakdown.forEach((b, idx) => {
    if (idx % 2 === 1) {
      doc.setFillColor(252, 251, 248);
      doc.rect(margin, y, contentWidth, 7, "F");
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(43, 40, 36);

    let rowX = margin;
    doc.text(b.label, rowX + 2, y + 5);
    rowX += scoreColWidths[0];

    const ratio = b.points / b.max;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(ratio >= 0.66 ? "#1F6F50" : ratio >= 0.33 ? "#C79A2E" : "#B5342B");
    doc.text(`${b.points} / ${b.max}`, rowX + 2, y + 5);
    rowX += scoreColWidths[1];

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(115, 107, 99);
    doc.text(doc.splitTextToSize(b.note, scoreColWidths[2] - 4), rowX + 2, y + 5);

    y += 7;
  });

  // Total line
  doc.setDrawColor(218, 214, 202);
  doc.line(margin, y, margin + contentWidth, y);
  y += 1;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(43, 40, 36);
  doc.text("Punteggio Complessivo Finale", margin + 2, y + 5);
  doc.setTextColor(reliability.verdictColor);
  doc.text(`${reliability.score} / 100`, margin + scoreColWidths[0] + 2, y + 5);
  y += 9;

  // Narrative Paragraphs
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(31, 111, 80);
  doc.text("COMMENTO ANALITICO SUI RISULTATI", margin, y);
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(43, 40, 36);

  narrative.forEach((para) => {
    const lines = doc.splitTextToSize(para, contentWidth);
    doc.text(lines, margin, y);
    y += lines.length * 3.5 + 2.5;
  });

  y += 3;

  // Improvements Section
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(31, 111, 80);
  doc.text("MIGLIORAMENTI E RACCOMANDAZIONI CONSIGLIATE", margin, y);
  y += 4;

  const topImprovements = reliability.improvements.slice(0, 4);
  topImprovements.forEach((imp) => {
    const sevColor = imp.sev === "alta" ? "#B5342B" : imp.sev === "media" ? "#C79A2E" : "#736b63";
    const sevBg = imp.sev === "alta" ? [253, 237, 236] : imp.sev === "media" ? [254, 249, 231] : [247, 246, 241];

    doc.setFillColor(sevBg[0], sevBg[1], sevBg[2]);
    doc.setDrawColor(sevColor);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, contentWidth, 9, 1, 1, "FD");

    // Severity tag
    doc.setFillColor(sevColor);
    doc.rect(margin + 2, y + 2, 14, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(255, 255, 255);
    doc.text(imp.sev.toUpperCase(), margin + 9, y + 5.5, { align: "center" });

    // Text
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(43, 40, 36);
    const impLines = doc.splitTextToSize(imp.text, contentWidth - 22);
    doc.text(impLines[0] || "", margin + 19, y + 5.5);

    y += 11;
  });

  drawPageFooter(pageNum, 3);

  // Save the PDF
  const filename = `Report_Backtest_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}

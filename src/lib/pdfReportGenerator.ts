import { jsPDF } from "jspdf";
import {
  BacktestResult,
  MoneyManagement,
  MonteCarloResult,
  ReliabilityScore,
  EquityPoint,
  WalkForwardResult,
  WalkForwardConfig,
  TweakableParam,
  Trade,
} from "../types";
import { fmtMoney, fmtPct, fmtNum, fmtDT } from "./csvHelper";
import { runMonteCarlo, computeReliabilityScore, buildNarrative } from "./monteCarloEngine";
import {
  calculateWalkForwardRobustnessAssessment,
  RobustnessAssessment,
} from "./walkForwardEngine";

/**
 * Render Equity Curve & Drawdown to high-res offscreen canvas
 */
function renderEquityChartCanvas(
  equityCurve: EquityPoint[] | { dt: number; equity: number }[],
  initialCapital: number,
  lineColor = "#1F6F50",
  chartTitle = "Progressione Temporale del Capitale"
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
  if (lineColor === "#1F6F50") {
    grad.addColorStop(0, "rgba(31, 111, 80, 0.28)");
    grad.addColorStop(1, "rgba(31, 111, 80, 0.02)");
  } else {
    grad.addColorStop(0, "rgba(43, 40, 36, 0.22)");
    grad.addColorStop(1, "rgba(43, 40, 36, 0.02)");
  }

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
  ctx.strokeStyle = lineColor;
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
  ctx.fillText(chartTitle, width / 2, height - 12);

  return canvas.toDataURL("image/png");
}

/**
 * Render Monte Carlo Fan Chart to high-res offscreen canvas
 */
function renderMonteCarloFanChartCanvas(
  bands: MonteCarloResult["bands"],
  actualEquity: number[],
  initialCapital: number,
  chartSubtitle = "Bande di Confidenza Monte Carlo vs Sequenza Reale"
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

export interface ExportWalkForwardSummaryPdfOptions {
  backtestResult: BacktestResult;
  mm: MoneyManagement;
  baseMcResult?: MonteCarloResult | null;
  wfResult: WalkForwardResult;
  wfConfig: WalkForwardConfig;
  oosMcResult?: MonteCarloResult | null;
  robustnessAssessment?: RobustnessAssessment | null;
  params?: TweakableParam[];
  strategyTitle?: string;
}

/**
 * Generates and downloads a complete 4-page Institutional Executive Summary PDF:
 * 1. Base Metrics & Equity Trajectory
 * 2. 1st Monte Carlo Analysis & Initial Reliability Score
 * 3. Walk-Forward Optimization (WFO) with optimized parameters stability & fold-by-fold detail
 * 4. Out-of-Sample (OOS) Monte Carlo & Overall Robustness Assessment with analytical categories score breakdown
 */
export async function exportWalkForwardFullSummaryPdfReport({
  backtestResult,
  mm,
  baseMcResult: providedBaseMc,
  wfResult,
  wfConfig,
  oosMcResult: providedOosMc,
  robustnessAssessment: providedAssessment,
  params = [],
  strategyTitle = "Strategia Quantitativa",
}: ExportWalkForwardSummaryPdfOptions): Promise<void> {
  const { trades: baseTrades, equityCurve: baseEquityCurve, metrics: baseMetrics, rules: baseRules } = backtestResult;

  // 1. Ensure 1st Base Monte Carlo & Reliability
  const baseMc: MonteCarloResult =
    providedBaseMc ||
    runMonteCarlo(baseTrades, mm, {
      iterations: 1500,
      method: "bootstrap",
      ruinThresholdPct: 50,
    });
  const baseReliability: ReliabilityScore = computeReliabilityScore(baseMetrics, baseMc, baseTrades, mm);

  // 2. Chained OOS Metrics & All OOS Trades
  const chainedMetrics = wfResult.chainedMetrics || null;
  const allOosTrades: Trade[] = [];
  if (wfResult.results) {
    wfResult.results.forEach((r) => {
      if (r.oosTrades && r.oosTrades.length > 0) {
        allOosTrades.push(...r.oosTrades);
      }
    });
  }
  allOosTrades.sort((a, b) => a.entryDt - b.entryDt);

  // 3. Ensure OOS Monte Carlo
  const oosMc: MonteCarloResult =
    providedOosMc ||
    (allOosTrades.length > 0
      ? runMonteCarlo(allOosTrades, mm.initialCapital, {
          iterations: 1500,
          method: "bootstrap",
          ruinThresholdPct: 50,
        })
      : baseMc);

  // 4. Robustness Assessment
  const assessment: RobustnessAssessment =
    providedAssessment ||
    calculateWalkForwardRobustnessAssessment(wfResult, chainedMetrics) || {
      totalScore: 50,
      grade: {
        label: "ROBUSTEZZA MODERATA",
        verdict: "Validazione OOS in attesa di completamento",
        color: "#C79A2E",
        bgColor: "#FFF8E1",
        borderColor: "#FFE082",
        description: "Analisi di robustezza statistica preliminare.",
        recommendation: "Completare l'ottimizzazione Walk-Forward per confermare l'efficienza OOS.",
      },
      subScores: [],
    };

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const totalPages = 4;

  const drawPageHeader = (title: string, sub: string) => {
    doc.setFillColor(247, 246, 241);
    doc.rect(0, 0, pageWidth, 20, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(31, 111, 80);
    doc.text("EXECUTIVE REPORT & AUDIT DI ROBUSTEZZA", margin, 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(115, 107, 99);
    doc.text(title, margin + 92, 12);

    doc.setFontSize(8);
    doc.text(sub, pageWidth - margin, 12, { align: "right" });

    doc.setDrawColor(218, 214, 202);
    doc.setLineWidth(0.3);
    doc.line(margin, 20, pageWidth - margin, 20);
  };

  const drawPageFooter = (curPage: number) => {
    doc.setDrawColor(218, 214, 202);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(115, 107, 99);
    doc.text("Generato da Quantitative Strategy Studio · Lifecycle Summary Report", margin, pageHeight - 7);
    doc.text(`Pagina ${curPage} di ${totalPages}`, pageWidth - margin, pageHeight - 7, {
      align: "right",
    });
  };

  // =========================================================================
  // PAGE 1: METRICHE DI BASE & TRAIETTORIA CAPITALE INIZIALE
  // =========================================================================
  let pageNum = 1;
  drawPageHeader(strategyTitle, new Date().toLocaleDateString("it-IT"));

  let y = 25;

  // Title Banner
  doc.setFont("times", "bold");
  doc.setFontSize(17);
  doc.setTextColor(43, 40, 36);
  doc.text("1. Riepilogo Esecutivo & Metriche di Base", margin, y);
  y += 5.5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(115, 107, 99);
  const firstDt = baseTrades[0]?.entryDt ? fmtDT(baseTrades[0].entryDt) : "Inizio";
  const lastDt = baseTrades[baseTrades.length - 1]?.exitDt ? fmtDT(baseTrades[baseTrades.length - 1].exitDt!) : "Fine";
  doc.text(
    `Capitale: ${fmtMoney(mm.initialCapital)} | Periodo: ${firstDt} → ${lastDt} | Campione Base: ${baseTrades.length} trade | Sizing: ${mm.sizingMode === "risk" ? `${mm.riskPct}% Rischio` : `${mm.fixedQty} Qty Fissa`}`,
    margin,
    y
  );
  y += 7.5;

  // Box 1: KPI Cards Grid
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(218, 214, 202);
  doc.roundedRect(margin, y, contentWidth, 54, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(31, 111, 80);
  doc.text("METRICHE CHIAVE DI PERFORMANCE INIZIALE (BASELINE)", margin + 4, y + 6);

  const baseKpis = [
    { l: "Rendimento Totale", v: fmtPct(baseMetrics.totalReturnPct), hl: baseMetrics.totalReturnPct >= 0 ? "#1F6F50" : "#B5342B" },
    { l: "Capitale Finale", v: fmtMoney(baseMetrics.finalEquity), hl: "#2B2824" },
    { l: "Win Rate", v: fmtPct(baseMetrics.winRate), hl: "#2B2824" },
    { l: "Profit Factor", v: fmtNum(baseMetrics.profitFactor), hl: baseMetrics.profitFactor >= 1.5 ? "#1F6F50" : "#2B2824" },
    { l: "Max Drawdown", v: `-${fmtPct(baseMetrics.maxDDPct)}`, hl: "#B5342B" },
    { l: "DD Giornaliero Medio", v: `-${fmtPct(Math.abs(baseMetrics.avgDailyDrawdownPct))}`, hl: "#B5342B" },
    { l: "Expectancy / Trade", v: fmtMoney(baseMetrics.expectancy), hl: baseMetrics.expectancy >= 0 ? "#1F6F50" : "#B5342B" },
    { l: "Sharpe Annualizzato", v: fmtNum(baseMetrics.sharpeAnnual), hl: "#2B2824" },
    { l: "Average Win", v: fmtMoney(baseMetrics.avgWin), hl: "#1F6F50" },
    { l: "Average Loss", v: fmtMoney(baseMetrics.avgLoss), hl: "#B5342B" },
    { l: "Ratio Win/Loss", v: fmtNum(baseMetrics.ratioWinLoss), hl: "#2B2824" },
    { l: "Recovery Factor", v: fmtNum(baseMetrics.recoveryFactor), hl: "#2B2824" },
  ];

  const cols = 4;
  const colW = contentWidth / cols;
  const rowH = 13;
  const startKpiY = y + 13;

  baseKpis.forEach((kpi, idx) => {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const kx = margin + c * colW + 4;
    const ky = startKpiY + r * rowH;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(115, 107, 99);
    doc.text(kpi.l, kx, ky);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(kpi.hl);
    doc.text(kpi.v, kx, ky + 5);
  });

  y += 60;

  // Box 2: Equity Curve Chart
  doc.setFont("times", "bold");
  doc.setFontSize(12);
  doc.setTextColor(43, 40, 36);
  doc.text("Equity Curve di Baseline (Dati Storici Integrali)", margin, y);
  y += 4;

  const baseEqImg = renderEquityChartCanvas(baseEquityCurve, mm.initialCapital, "#1F6F50", "Progressione Storica dell'Equity (Baseline)");
  if (baseEqImg) {
    const chartHeight = 70;
    doc.addImage(baseEqImg, "PNG", margin, y, contentWidth, chartHeight);
    y += chartHeight + 6;
  }

  // Box 3: Execution Distribution & Rules Breakdown
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(31, 111, 80);
  doc.text("DETTAGLIO ESECUZIONE & CONFIGURAZIONE OPERATIVA", margin, y);
  y += 4;

  const longTrades = baseTrades.filter((t) => t.direction === "long");
  const shortTrades = baseTrades.filter((t) => t.direction === "short");
  const winTrades = baseTrades.filter((t) => t.pnl > 0);
  const lossTrades = baseTrades.filter((t) => t.pnl <= 0);

  doc.setFillColor(247, 246, 241);
  doc.rect(margin, y, contentWidth, 24, "F");
  doc.setDrawColor(218, 214, 202);
  doc.rect(margin, y, contentWidth, 24, "S");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(43, 40, 36);

  const colWidth3 = contentWidth / 3;
  // Col 1
  doc.text(`Trade Long: ${longTrades.length} (${fmtMoney(longTrades.reduce((s, t) => s + t.pnl, 0))})`, margin + 4, y + 6);
  doc.text(`Trade Short: ${shortTrades.length} (${fmtMoney(shortTrades.reduce((s, t) => s + t.pnl, 0))})`, margin + 4, y + 13);
  doc.text(`Durata media: ${fmtNum(baseMetrics.avgBarsHeld, 1)} barre`, margin + 4, y + 20);

  // Col 2
  doc.text(`Operazioni Vincenti: ${winTrades.length} (${fmtPct(baseMetrics.winRate)})`, margin + colWidth3 + 4, y + 6);
  doc.text(`Operazioni Perdenti: ${lossTrades.length} (${fmtPct(1 - baseMetrics.winRate)})`, margin + colWidth3 + 4, y + 13);
  doc.text(`Max Win / Loss Consecutivi: ${baseMetrics.maxConsWin} / ${baseMetrics.maxConsLoss}`, margin + colWidth3 + 4, y + 20);

  // Col 3
  doc.text(`Spread applicato: ${mm.spread || 0} pts`, margin + colWidth3 * 2 + 4, y + 6);
  doc.text(`Timing: in=${mm.entryTiming} / out=${mm.exitTiming || "next_open"}`, margin + colWidth3 * 2 + 4, y + 13);
  doc.text(`Stop Loss configurato: ${baseRules?.stop_loss?.type || "none"}`, margin + colWidth3 * 2 + 4, y + 20);

  drawPageFooter(pageNum);

  // =========================================================================
  // PAGE 2: PRIMA ANALISI MONTE CARLO & GIUDIZIO DI AFFIDABILITÀ INIZIALE
  // =========================================================================
  doc.addPage();
  pageNum++;
  drawPageHeader("1ª Analisi Monte Carlo & Giudizio Iniziale", `${baseMc.iterations.toLocaleString("it-IT")} iterazioni`);

  y = 25;

  doc.setFont("times", "bold");
  doc.setFontSize(16);
  doc.setTextColor(43, 40, 36);
  doc.text("2. Prima Simulazione Monte Carlo & Giudizio di Affidabilità", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(115, 107, 99);
  doc.text(
    `Stress test sequenziale (Bootstrap con reinserimento) | Soglia Rovina: ${baseMc.ruinThresholdPct}% del capitale | Campione: ${baseTrades.length} trade`,
    margin,
    y
  );
  y += 7;

  // Monte Carlo KPI Highlights
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(218, 214, 202);
  doc.roundedRect(margin, y, contentWidth, 23, 2, 2, "FD");

  const baseMcKpis = [
    { l: "Rischio di Rovina", v: fmtPct(baseMc.riskOfRuin), hl: baseMc.riskOfRuin > 0.05 ? "#B5342B" : "#1F6F50" },
    { l: "Prob. Guadagno", v: fmtPct(baseMc.probPositive), hl: baseMc.probPositive >= 0.7 ? "#1F6F50" : "#C79A2E" },
    { l: "Drawdown Mediano (p50)", v: fmtPct(baseMc.ddStats.p50), hl: "#2B2824" },
    { l: "Drawdown Worst-Case (p95)", v: fmtPct(baseMc.ddStats.p95), hl: baseMc.ddStats.p95 > 0.3 ? "#B5342B" : "#2B2824" },
    { l: "Profit Factor Worst-Case (p5)", v: fmtNum(baseMc.pfStats.p5), hl: baseMc.pfStats.p5 < 1 ? "#B5342B" : "#1F6F50" },
  ];

  const mcColW = contentWidth / baseMcKpis.length;
  baseMcKpis.forEach((kpi, idx) => {
    const kx = margin + idx * mcColW + 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(115, 107, 99);
    doc.text(kpi.l, kx, y + 6.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(kpi.hl);
    doc.text(kpi.v, kx, y + 15.5);
  });

  y += 28;

  // Percentiles Table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(31, 111, 80);
  doc.text("DISTRIBUZIONE PERCENTILI MONTE CARLO VS SEQUENZA REALE", margin, y);
  y += 4;

  const tableHeaders = ["Metrica", "Reale", "5° perc.", "25° perc.", "Mediana (50°)", "75° perc.", "95° perc.", "Media"];
  const colWidths = [42, 20, 20, 20, 24, 20, 20, 16];

  doc.setFillColor(247, 246, 241);
  doc.rect(margin, y, contentWidth, 6.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(115, 107, 99);

  let curX = margin;
  tableHeaders.forEach((th, i) => {
    doc.text(th, curX + 2, y + 4.5);
    curX += colWidths[i];
  });
  y += 6.5;

  const tableRows = [
    {
      m: "Rendimento Totale",
      reale: fmtPct(baseMetrics.totalReturnPct),
      p5: fmtPct(baseMc.returnStats.p5),
      p25: fmtPct(baseMc.returnStats.p25),
      p50: fmtPct(baseMc.returnStats.p50),
      p75: fmtPct(baseMc.returnStats.p75),
      p95: fmtPct(baseMc.returnStats.p95),
      avg: fmtPct(baseMc.returnStats.mean),
    },
    {
      m: "Max Drawdown",
      reale: `-${fmtPct(baseMetrics.maxDDPct)}`,
      p5: fmtPct(baseMc.ddStats.p5),
      p25: fmtPct(baseMc.ddStats.p25),
      p50: fmtPct(baseMc.ddStats.p50),
      p75: fmtPct(baseMc.ddStats.p75),
      p95: fmtPct(baseMc.ddStats.p95),
      avg: fmtPct(baseMc.ddStats.mean),
    },
    {
      m: "DD Giornaliero Medio",
      reale: fmtPct(baseMetrics.avgDailyDrawdownPct),
      p5: fmtPct(baseMc.avgDailyDDStats.p5),
      p25: fmtPct(baseMc.avgDailyDDStats.p25),
      p50: fmtPct(baseMc.avgDailyDDStats.p50),
      p75: fmtPct(baseMc.avgDailyDDStats.p75),
      p95: fmtPct(baseMc.avgDailyDDStats.p95),
      avg: fmtPct(baseMc.avgDailyDDStats.mean),
    },
    {
      m: "Profit Factor",
      reale: fmtNum(baseMetrics.profitFactor),
      p5: fmtNum(baseMc.pfStats.p5),
      p25: fmtNum(baseMc.pfStats.p25),
      p50: fmtNum(baseMc.pfStats.p50),
      p75: fmtNum(baseMc.pfStats.p75),
      p95: fmtNum(baseMc.pfStats.p95),
      avg: fmtNum(baseMc.pfStats.mean),
    },
  ];

  tableRows.forEach((row, idx) => {
    if (idx % 2 === 1) {
      doc.setFillColor(252, 251, 248);
      doc.rect(margin, y, contentWidth, 6.5, "F");
    }
    doc.setFont("helvetica", idx === 0 ? "bold" : "normal");
    doc.setFontSize(7.8);
    doc.setTextColor(43, 40, 36);

    let rowX = margin;
    doc.text(row.m, rowX + 2, y + 4.5);
    rowX += colWidths[0];
    doc.setFont("helvetica", "bold");
    doc.text(row.reale, rowX + 2, y + 4.5);
    rowX += colWidths[1];
    doc.setFont("helvetica", "normal");
    doc.text(row.p5, rowX + 2, y + 4.5);
    rowX += colWidths[2];
    doc.text(row.p25, rowX + 2, y + 4.5);
    rowX += colWidths[3];
    doc.text(row.p50, rowX + 2, y + 4.5);
    rowX += colWidths[4];
    doc.text(row.p75, rowX + 2, y + 4.5);
    rowX += colWidths[5];
    doc.text(row.p95, rowX + 2, y + 4.5);
    rowX += colWidths[6];
    doc.text(row.avg, rowX + 2, y + 4.5);

    y += 6.5;
  });

  y += 5;

  // Fan Chart
  doc.setFont("times", "bold");
  doc.setFontSize(11.5);
  doc.setTextColor(43, 40, 36);
  doc.text("Fan Chart — Bande di Confidenza 1ª Monte Carlo vs Sequenza Osservata", margin, y);
  y += 3.5;

  const actualTradeEquity = [mm.initialCapital, ...baseTrades.map((t) => t.equityAfter)];
  const baseFanImg = renderMonteCarloFanChartCanvas(baseMc.bands, actualTradeEquity, mm.initialCapital);
  if (baseFanImg) {
    const chartHeight = 60;
    doc.addImage(baseFanImg, "PNG", margin, y, contentWidth, chartHeight);
    y += chartHeight + 5;
  }

  // Giudizio di Affidabilità Iniziale Card
  doc.setFillColor(baseReliability.score >= 80 ? 238 : baseReliability.score >= 60 ? 254 : 253, baseReliability.score >= 80 ? 247 : baseReliability.score >= 60 ? 249 : 237, baseReliability.score >= 80 ? 242 : baseReliability.score >= 60 ? 231 : 236);
  doc.setDrawColor(baseReliability.verdictColor);
  doc.setLineWidth(0.6);
  doc.roundedRect(margin, y, contentWidth, 20, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(baseReliability.verdictColor);
  doc.text(`${baseReliability.score}`, margin + 6, y + 13);

  doc.setFontSize(9);
  doc.text("/ 100", margin + 25, y + 13);

  doc.setFontSize(11.5);
  doc.text(`GIUDIZIO INIZIALE: ${baseReliability.verdict.toUpperCase()}`, margin + 40, y + 9);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(115, 107, 99);
  doc.text(
    `La traiettoria reale si colloca al ${fmtNum(baseReliability.rank, 0)}° percentile della distribuzione. Valutazione basata sulla persistenza statistica di base.`,
    margin + 40,
    y + 15
  );

  y += 24;

  // Base improvements summary
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(31, 111, 80);
  doc.text("PUNTI DI ATTENZIONE RILEVATI DALLA 1ª MONTE CARLO:", margin, y);
  y += 3.5;

  const topBaseImps = baseReliability.improvements.slice(0, 3);
  topBaseImps.forEach((imp) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(43, 40, 36);
    doc.text(`• [${imp.sev.toUpperCase()}] ${imp.text}`, margin + 2, y);
    y += 4;
  });

  drawPageFooter(pageNum);

  // =========================================================================
  // PAGE 3: OTTIMIZZAZIONE WALK-FORWARD (WFO), PARAMETRI & DETTAGLIO FOLD
  // =========================================================================
  doc.addPage();
  pageNum++;
  drawPageHeader("Walk-Forward Optimization (WFO) & Dettaglio Fold", `Folds: ${wfResult.nFolds}`);

  y = 25;

  doc.setFont("times", "bold");
  doc.setFontSize(16);
  doc.setTextColor(43, 40, 36);
  doc.text("3. Ottimizzazione Walk-Forward (WFO) & Stabilità Parametri", margin, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(115, 107, 99);
  doc.text(
    `Metodo: ${wfConfig.mode === "rolling" ? "Rolling Windows" : "Split Singolo"} | In-Sample: ${wfConfig.isPct}% | Out-Of-Sample: ${wfConfig.oosPct}% | Finestre: ${wfResult.nFolds} Folds | Modalità: ${wfResult.mode?.toUpperCase() || "WFO"}`,
    margin,
    y
  );
  y += 7;

  // WFO Chained Key KPIs Box
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(218, 214, 202);
  doc.roundedRect(margin, y, contentWidth, 24, 2, 2, "FD");

  const wfoKpis = [
    {
      l: "Walk-Forward Efficiency (WFE)",
      v: fmtPct(wfResult.efficiencyRatio ?? 0),
      hl: (wfResult.efficiencyRatio ?? 0) >= 0.65 ? "#1F6F50" : (wfResult.efficiencyRatio ?? 0) >= 0.45 ? "#C79A2E" : "#B5342B",
    },
    {
      l: "Profitto Netto OOS",
      v: `${fmtMoney(chainedMetrics?.netProfit ?? 0)} (${fmtPct(chainedMetrics?.netProfitPct ?? 0)})`,
      hl: (chainedMetrics?.netProfit ?? 0) >= 0 ? "#1F6F50" : "#B5342B",
    },
    {
      l: "Profit Factor OOS",
      v: fmtNum(chainedMetrics?.profitFactor ?? 0),
      hl: (chainedMetrics?.profitFactor ?? 0) >= 1.3 ? "#1F6F50" : "#2B2824",
    },
    {
      l: "Max Drawdown OOS",
      v: `-${fmtPct(chainedMetrics?.maxDDPct ?? 0)}`,
      hl: "#B5342B",
    },
    {
      l: "Finestre Profittevoli",
      v: `${chainedMetrics?.profitableWindowsCount ?? 0}/${chainedMetrics?.totalWindowsCount ?? 0} (${fmtPct((chainedMetrics?.pctProfitableWindows ?? 0) / 100)})`,
      hl: (chainedMetrics?.pctProfitableWindows ?? 0) >= 70 ? "#1F6F50" : "#C79A2E",
    },
  ];

  const wfoColW = contentWidth / wfoKpis.length;
  wfoKpis.forEach((kpi, idx) => {
    const kx = margin + idx * wfoColW + 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(115, 107, 99);
    doc.text(kpi.l, kx, y + 7);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(kpi.hl);
    doc.text(kpi.v, kx, y + 16);
  });

  y += 29;

  // Optimized Parameters Stability Table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(31, 111, 80);
  doc.text("SINTESI DEI PARAMETRI OTTIMIZZATI & INDICE DI STABILITÀ", margin, y);
  y += 4;

  const paramHeaders = ["Parametro", "Val. Base", "Mediana WFO", "Range Min - Max", "Ultimo Fold", "Stabilità %", "Giudizio"];
  const paramColW = [50, 20, 24, 28, 20, 20, 20];

  doc.setFillColor(247, 246, 241);
  doc.rect(margin, y, contentWidth, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(115, 107, 99);

  let pX = margin;
  paramHeaders.forEach((ph, i) => {
    doc.text(ph, pX + 2, y + 4.2);
    pX += paramColW[i];
  });
  y += 6;

  const summaries = wfResult.wfoParamSummaries || [];
  if (summaries.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(115, 107, 99);
    doc.text("Nessuna ottimizzazione multi-parametrica WFO eseguita (modalità base/opt fissa).", margin + 4, y + 4.5);
    y += 7;
  } else {
    summaries.forEach((s, idx) => {
      if (idx % 2 === 1) {
        doc.setFillColor(252, 251, 248);
        doc.rect(margin, y, contentWidth, 6, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(43, 40, 36);

      let rowX = margin;
      doc.text(s.param.label || s.param.id, rowX + 2, y + 4.2);
      rowX += paramColW[0];
      doc.text(fmtNum(s.baseValue, 2), rowX + 2, y + 4.2);
      rowX += paramColW[1];
      doc.setFont("helvetica", "bold");
      doc.text(fmtNum(s.medianValue, 2), rowX + 2, y + 4.2);
      rowX += paramColW[2];
      doc.setFont("helvetica", "normal");
      doc.text(`${fmtNum(s.minValue, 2)} - ${fmtNum(s.maxValue, 2)}`, rowX + 2, y + 4.2);
      rowX += paramColW[3];
      doc.text(fmtNum(s.latestValue, 2), rowX + 2, y + 4.2);
      rowX += paramColW[4];
      doc.setFont("helvetica", "bold");
      doc.setTextColor(s.stabilityScore >= 75 ? "#1F6F50" : s.stabilityScore >= 45 ? "#C79A2E" : "#B5342B");
      doc.text(`${s.stabilityScore}%`, rowX + 2, y + 4.2);
      rowX += paramColW[5];
      doc.text(s.stabilityLabel, rowX + 2, y + 4.2);

      y += 6;
    });
  }

  y += 5;

  // Fold-by-Fold Detail Table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(31, 111, 80);
  doc.text("DETTAGLIO FOLD-BY-FOLD (IN-SAMPLE VS OUT-OF-SAMPLE)", margin, y);
  y += 4;

  const foldHeaders = ["Fold / Periodo", "IS Rendimento", "IS PF", "OOS Rendimento", "OOS PF", "OOS PnL", "Parametri Ottimi Fold", "Esito"];
  const foldColW = [38, 20, 16, 22, 16, 20, 36, 14];

  doc.setFillColor(247, 246, 241);
  doc.rect(margin, y, contentWidth, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.2);
  doc.setTextColor(115, 107, 99);

  let fX = margin;
  foldHeaders.forEach((fh, i) => {
    doc.text(fh, fX + 2, y + 4.2);
    fX += foldColW[i];
  });
  y += 6;

  const foldResults = wfResult.results || [];
  foldResults.slice(0, 7).forEach((fold, idx) => {
    if (idx % 2 === 1) {
      doc.setFillColor(252, 251, 248);
      doc.rect(margin, y, contentWidth, 5.8, "F");
    }

    const oosRet = fold.oos?.totalReturnPct ?? 0;
    const isRet = fold.is?.totalReturnPct ?? 0;
    const oosPnl = fold.oosTrades?.reduce((s, t) => s + t.pnl, 0) ?? 0;
    const isProfitable = oosRet > 0;

    const optStr = fold.foldOptima?.map((fo) => `${fo.param.id.slice(0, 6)}:${fo.optimalValue}`).join(", ") || "-";

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.2);
    doc.setTextColor(43, 40, 36);

    let rowX = margin;
    doc.text(`${fold.label} (${fold.period.slice(0, 15)})`, rowX + 2, y + 4);
    rowX += foldColW[0];
    doc.text(fmtPct(isRet), rowX + 2, y + 4);
    rowX += foldColW[1];
    doc.text(fmtNum(fold.is?.profitFactor ?? 0), rowX + 2, y + 4);
    rowX += foldColW[2];
    doc.setFont("helvetica", "bold");
    doc.setTextColor(isProfitable ? "#1F6F50" : "#B5342B");
    doc.text(fmtPct(oosRet), rowX + 2, y + 4);
    rowX += foldColW[3];
    doc.text(fmtNum(fold.oos?.profitFactor ?? 0), rowX + 2, y + 4);
    rowX += foldColW[4];
    doc.text(fmtMoney(oosPnl), rowX + 2, y + 4);
    rowX += foldColW[5];
    doc.setFont("helvetica", "normal");
    doc.setTextColor(115, 107, 99);
    doc.text(optStr.length > 24 ? `${optStr.slice(0, 23)}…` : optStr, rowX + 2, y + 4);
    rowX += foldColW[6];
    doc.setFont("helvetica", "bold");
    doc.setTextColor(isProfitable ? "#1F6F50" : "#B5342B");
    doc.text(isProfitable ? "WIN" : "LOSS", rowX + 2, y + 4);

    y += 5.8;
  });

  y += 5;

  // Chained OOS Equity Curve
  doc.setFont("times", "bold");
  doc.setFontSize(11.5);
  doc.setTextColor(43, 40, 36);
  doc.text("Equity Curve Concatenata Out-Of-Sample (OOS Chained Trajectory)", margin, y);
  y += 3.5;

  const oosEqPoints = wfResult.chainPoints && wfResult.chainPoints.length > 0 ? wfResult.chainPoints : baseEquityCurve;
  const oosEqImg = renderEquityChartCanvas(oosEqPoints, mm.initialCapital, "#2B2824", "Traiettoria Reale Out-Of-Sample Concatenata (Dati Futuri Non Visti)");
  if (oosEqImg) {
    const chartHeight = 58;
    doc.addImage(oosEqImg, "PNG", margin, y, contentWidth, chartHeight);
    y += chartHeight + 4;
  }

  drawPageFooter(pageNum);

  // =========================================================================
  // PAGE 4: MONTE CARLO OOS & GIUDIZIO COMPLESSIVO DI ROBUSTEZZA
  // =========================================================================
  doc.addPage();
  pageNum++;
  drawPageHeader("Monte Carlo OOS & Audit Finale di Robustezza", `Score: ${assessment.totalScore}/100`);

  y = 25;

  doc.setFont("times", "bold");
  doc.setFontSize(16);
  doc.setTextColor(43, 40, 36);
  doc.text("4. Monte Carlo OOS & Score Complessivo di Robustezza", margin, y);
  y += 5;

  // Monte Carlo OOS Summary & KPIs
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(218, 214, 202);
  doc.roundedRect(margin, y, contentWidth, 22, 2, 2, "FD");

  const oosMcKpis = [
    { l: "Rischio Rovina OOS", v: fmtPct(oosMc.riskOfRuin), hl: oosMc.riskOfRuin > 0.05 ? "#B5342B" : "#1F6F50" },
    { l: "Prob. Guadagno OOS", v: fmtPct(oosMc.probPositive), hl: oosMc.probPositive >= 0.7 ? "#1F6F50" : "#C79A2E" },
    { l: "DD Mediano OOS (p50)", v: fmtPct(oosMc.ddStats.p50), hl: "#2B2824" },
    { l: "DD Worst-Case OOS (p95)", v: fmtPct(oosMc.ddStats.p95), hl: oosMc.ddStats.p95 > 0.3 ? "#B5342B" : "#2B2824" },
    { l: "PF Worst-Case OOS (p5)", v: fmtNum(oosMc.pfStats.p5), hl: oosMc.pfStats.p5 < 1 ? "#B5342B" : "#1F6F50" },
  ];

  const oosColW = contentWidth / oosMcKpis.length;
  oosMcKpis.forEach((kpi, idx) => {
    const kx = margin + idx * oosColW + 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(115, 107, 99);
    doc.text(kpi.l, kx, y + 6);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(kpi.hl);
    doc.text(kpi.v, kx, y + 15);
  });

  y += 26;

  // Fan Chart OOS
  doc.setFont("times", "bold");
  doc.setFontSize(11);
  doc.setTextColor(43, 40, 36);
  doc.text("Fan Chart Monte Carlo sui Trade Out-Of-Sample Concatenati", margin, y);
  y += 3;

  const actualOosEquity = [mm.initialCapital];
  let curOosEq = mm.initialCapital;
  allOosTrades.forEach((t) => {
    curOosEq += t.pnl;
    actualOosEquity.push(curOosEq);
  });

  const oosFanImg = renderMonteCarloFanChartCanvas(oosMc.bands, actualOosEquity, mm.initialCapital, "Bande OOS");
  if (oosFanImg) {
    const chartHeight = 52;
    doc.addImage(oosFanImg, "PNG", margin, y, contentWidth, chartHeight);
    y += chartHeight + 5;
  }

  // ROBUSTNESS SCORECARD BANNER
  doc.setFillColor(assessment.totalScore >= 80 ? 238 : assessment.totalScore >= 60 ? 254 : 253, assessment.totalScore >= 80 ? 247 : assessment.totalScore >= 60 ? 249 : 237, assessment.totalScore >= 80 ? 242 : assessment.totalScore >= 60 ? 231 : 236);
  doc.setDrawColor(assessment.grade.color);
  doc.setLineWidth(0.8);
  doc.roundedRect(margin, y, contentWidth, 23, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(assessment.grade.color);
  doc.text(`${assessment.totalScore}`, margin + 8, y + 14.5);

  doc.setFontSize(9.5);
  doc.text("/ 100", margin + 31, y + 14.5);

  doc.setFontSize(12.5);
  doc.text(assessment.grade.label, margin + 46, y + 9.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(43, 40, 36);
  doc.text(assessment.grade.verdict, margin + 46, y + 15);

  y += 27;

  // DETTAGLIO PUNTEGGI PER CATEGORIA ANALITICA TABLE
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(31, 111, 80);
  doc.text("DETTAGLIO PUNTEGGI PER CATEGORIA ANALITICA DI ROBUSTEZZA", margin, y);
  y += 4;

  const catHeaders = ["Categoria Analitica", "Punti", "Valore Osservato & Benchmark", "Note di Valutazione"];
  const catColW = [56, 18, 48, contentWidth - 122];

  doc.setFillColor(247, 246, 241);
  doc.rect(margin, y, contentWidth, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.2);
  doc.setTextColor(115, 107, 99);

  let cX = margin;
  catHeaders.forEach((ch, i) => {
    doc.text(ch, cX + 2, y + 4.2);
    cX += catColW[i];
  });
  y += 6;

  assessment.subScores.forEach((sub, idx) => {
    if (idx % 2 === 1) {
      doc.setFillColor(252, 251, 248);
      doc.rect(margin, y, contentWidth, 7, "F");
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(43, 40, 36);

    let rowX = margin;
    doc.text(sub.title, rowX + 2, y + 4.8);
    rowX += catColW[0];

    const ratio = sub.score / sub.maxScore;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(ratio >= 0.7 ? "#1F6F50" : ratio >= 0.4 ? "#C79A2E" : "#B5342B");
    doc.text(`${sub.score} / ${sub.maxScore}`, rowX + 2, y + 4.8);
    rowX += catColW[1];

    doc.setFont("helvetica", "normal");
    doc.setTextColor(43, 40, 36);
    doc.text(`${sub.valueFormatted} (${sub.targetText})`, rowX + 2, y + 4.8);
    rowX += catColW[2];

    doc.setTextColor(115, 107, 99);
    doc.setFontSize(7);
    doc.text(doc.splitTextToSize(sub.hint, catColW[3] - 4)[0] || "", rowX + 2, y + 4.8);

    y += 7;
  });

  // Total Summary line
  doc.setDrawColor(218, 214, 202);
  doc.line(margin, y, margin + contentWidth, y);
  y += 1.5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(43, 40, 36);
  doc.text("Punteggio Totale di Robustezza Walk-Forward", margin + 2, y + 4.5);
  doc.setTextColor(assessment.grade.color);
  doc.text(`${assessment.totalScore} / 100`, margin + catColW[0] + 2, y + 4.5);
  y += 8.5;

  // Practical Operational Recommendations Box
  doc.setFillColor(247, 246, 241);
  doc.setDrawColor(218, 214, 202);
  doc.roundedRect(margin, y, contentWidth, 28, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(31, 111, 80);
  doc.text("RACCOMANDAZIONI OPERATIVE & CONCLUSIONI DI AUDIT", margin + 4, y + 5.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(43, 40, 36);
  const recLines = doc.splitTextToSize(
    `${assessment.grade.description} Raccomandazione: ${assessment.grade.recommendation}`,
    contentWidth - 8
  );
  doc.text(recLines.slice(0, 3), margin + 4, y + 11.5);

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  doc.setTextColor(115, 107, 99);
  doc.text(
    `Nota: Il report sintetizza i risultati del Backtest Baseline, della 1ª Monte Carlo, della Walk-Forward Optimization (WFO) e della Monte Carlo OOS. Emissione: ${new Date().toLocaleString("it-IT")}.`,
    margin + 4,
    y + 24
  );

  drawPageFooter(pageNum);

  // Save the PDF
  const filename = `Report_Riepilogo_Robustezza_WFO_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}

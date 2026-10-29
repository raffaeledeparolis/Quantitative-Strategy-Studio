import Papa from "papaparse";
import { Bar, ColumnStat, CsvParsedFile, IntrabarInterpolationConfig, MergedDatasetResult } from "../types";
import { pathSegments } from "./backtestEngine";

export function parseDateTime(raw: any): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/^\uFEFF/, "").trim();
  let m: RegExpMatchArray | null;
  m = s.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

export function fmtDT(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function fmtMoney(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v < 0 ? "-" : "";
  return sign + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtPct(v: number | null | undefined, d = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return (v * 100).toFixed(d) + "%";
}

export function fmtNum(v: number | null | undefined, d = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return Number(v).toFixed(d);
}

export function formatParamValue(param: any, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (param && param.kind === "daily_dd_pct") return fmtPct(v);
  return fmtNum(v, 4);
}

export function stripExt(n: string): string {
  return n.replace(/\.[Cc][Ss][Vv]$/, "").replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "file";
}

export function parseCsvFile(text: string, name: string): CsvParsedFile {
  const result = Papa.parse<string[]>(text.trim(), { delimiter: "", skipEmptyLines: true });
  const allRows = result.data || [];
  if (allRows.length < 2) {
    return {
      id: `${name}_${Date.now()}`,
      name,
      header: [],
      rows: [],
      ncols: 0,
      extraCols: [],
      nRows: 0,
      error: "Il file deve avere una riga di intestazione + almeno una riga di dati.",
    };
  }
  const header = allRows[0].map((h) => String(h).trim());
  if (header.length < 5) {
    return {
      id: `${name}_${Date.now()}`,
      name,
      header,
      rows: [],
      ncols: header.length,
      extraCols: [],
      nRows: 0,
      error: `Intestazione incompleta: servono almeno 5 colonne (datetime, open, high, low, close); trovate ${header.length}.`,
    };
  }
  const looksNumeric = (v: string) => v !== "" && !Number.isNaN(parseFloat(v)) && Number.isFinite(parseFloat(v));
  if (looksNumeric(header[1]) && looksNumeric(header[2]) && looksNumeric(header[3]) && looksNumeric(header[4])) {
    return {
      id: `${name}_${Date.now()}`,
      name,
      header,
      rows: [],
      ncols: header.length,
      extraCols: [],
      nRows: 0,
      error: "La prima riga sembra contenere già dei dati numerici: l'intestazione (nomi di colonna) è obbligatoria.",
    };
  }
  const rows = allRows.slice(1).filter((r) => r.length >= 5 && r[0]);
  if (rows.length === 0) {
    return {
      id: `${name}_${Date.now()}`,
      name,
      header,
      rows: [],
      ncols: header.length,
      extraCols: [],
      nRows: 0,
      error: "Nessuna riga di dati valida trovata sotto l'intestazione.",
    };
  }
  const ncols = header.length;
  const extraCount = Math.max(0, ncols - 5);
  const extraCols = Array.from({ length: extraCount }, (_, i) => {
    const idx = 5 + i;
    const raw = (header[idx] || "").trim().replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "");
    return { idx, name: raw || (extraCount === 1 ? `${stripExt(name)}_value` : `${stripExt(name)}_val${i + 1}`) };
  });
  return { id: `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name, header, rows, ncols, extraCols, nRows: rows.length, error: null };
}

export function mergeDatasets(
  files: CsvParsedFile[],
  priceFileId: string | null,
  intrabarConfig?: IntrabarInterpolationConfig
): MergedDatasetResult {
  const validFiles = files.filter((f) => !f.error);
  if (validFiles.length === 0) return { bars: [], dropped: 0, columns: [], perFileDiag: [], intrabarInterpolationApplied: null };

  const perFileMaps = validFiles.map((f) => {
    const map = new Map<number, string[]>();
    for (const r of f.rows) {
      const ts = parseDateTime(r[0]);
      if (ts != null) map.set(ts, r);
    }
    return map;
  });

  const perFileDiag = validFiles.map((f, idx) => ({
    name: f.name,
    total: f.rows.length,
    parsed: perFileMaps[idx].size,
    sampleRaw: f.rows[0] ? f.rows[0][0] : null,
  }));

  const priceFileIdx = Math.max(0, validFiles.findIndex((f) => f.id === priceFileId));

  // Check if intrabar interpolation using higher-frequency data is requested
  const isInterpolationActive = Boolean(intrabarConfig?.enabled);
  let hfFileIdx = -1;

  if (isInterpolationActive && validFiles.length >= 2) {
    if (intrabarConfig?.hfFileId) {
      hfFileIdx = validFiles.findIndex((f) => f.id === intrabarConfig.hfFileId);
    }
    // If not specified or points to priceFileIdx, find file that has significantly more rows or is not priceFile
    if (hfFileIdx < 0 || hfFileIdx === priceFileIdx) {
      let maxRows = -1;
      validFiles.forEach((f, idx) => {
        if (idx !== priceFileIdx && f.rows.length > maxRows) {
          maxRows = f.rows.length;
          hfFileIdx = idx;
        }
      });
    }
  }

  // Base files to align for standard columns (all except the HF file if HF is used for intrabar)
  const baseFilesIndices = isInterpolationActive && hfFileIdx >= 0
    ? validFiles.map((_, idx) => idx).filter((idx) => idx !== hfFileIdx)
    : validFiles.map((_, idx) => idx);

  let common = new Set(perFileMaps[baseFilesIndices[0]].keys());
  for (let i = 1; i < baseFilesIndices.length; i++) {
    const next = new Set<number>();
    const fi = baseFilesIndices[i];
    for (const ts of common) if (perFileMaps[fi].has(ts)) next.add(ts);
    common = next;
  }

  const tsList = Array.from(common).sort((a, b) => a - b);
  const columns: string[] = ["open", "high", "low", "close"];
  baseFilesIndices.forEach((fi) => {
    validFiles[fi].extraCols.forEach((c) => {
      if (!columns.includes(c.name)) {
        columns.push(c.name);
      }
    });
  });

  const bars: Bar[] = [];
  let dropped = 0;
  const TOL = 0.0005;

  for (const ts of tsList) {
    const priceRow = perFileMaps[priceFileIdx].get(ts);
    if (!priceRow) continue;
    const open = parseFloat(priceRow[1]);
    const high = parseFloat(priceRow[2]);
    const low = parseFloat(priceRow[3]);
    const close = parseFloat(priceRow[4]);
    if (![open, high, low, close].every(Number.isFinite)) { dropped++; continue; }
    let consistent = true;
    const bar: Bar = { dt: ts, open, high, low, close };
    for (const fi of baseFilesIndices) {
      const row = perFileMaps[fi].get(ts);
      if (!row) { consistent = false; break; }
      const o = parseFloat(row[1]), h = parseFloat(row[2]), l = parseFloat(row[3]), c = parseFloat(row[4]);
      const check = (v: number, ref: number) => Number.isFinite(v) && Math.abs(v - ref) / Math.max(1e-9, Math.abs(ref)) > TOL;
      if (check(o, open) || check(h, high) || check(l, low) || check(c, close)) consistent = false;
      for (const col of validFiles[fi].extraCols) {
        const v = parseFloat(row[col.idx]);
        bar[col.name] = Number.isFinite(v) ? v : null;
      }
    }
    if (!consistent) { dropped++; continue; }
    const extraColsToCheck = columns.filter((c) => !["open", "high", "low", "close"].includes(c));
    if (extraColsToCheck.some((cn) => bar[cn] == null)) { dropped++; continue; }
    bars.push(bar);
  }

  // Now apply intrabar price interpolation if enabled
  let intrabarInterpolationApplied: MergedDatasetResult["intrabarInterpolationApplied"] = null;

  if (isInterpolationActive && bars.length > 0) {
    const method = intrabarConfig?.method || "linear";
    let totalSubPoints = 0;

    if (hfFileIdx >= 0) {
      const hfFile = validFiles[hfFileIdx];
      // Check for volume column in HF file
      const volIdx = hfFile.header.findIndex((h) =>
        /^(vol|volume|tick_vol|tick_volume|qty|volume_traded|tot_vol)$/i.test(h)
      );

      // Parse and sort all valid sub-bars from HF file
      interface SubBarItem {
        dt: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }
      const hfItems: SubBarItem[] = [];
      for (const r of hfFile.rows) {
        const ts = parseDateTime(r[0]);
        if (ts == null) continue;
        const o = parseFloat(r[1]), h = parseFloat(r[2]), l = parseFloat(r[3]), c = parseFloat(r[4]);
        if (![o, h, l, c].every(Number.isFinite)) continue;
        const rawVol = volIdx >= 0 ? parseFloat(r[volIdx]) : NaN;
        const vol = Number.isFinite(rawVol) && rawVol > 0 ? rawVol : Math.max(1, (h - l) * 100);
        hfItems.push({ dt: ts, open: o, high: h, low: l, close: c, volume: vol });
      }
      hfItems.sort((a, b) => a.dt - b.dt);

      // Compute median delta of base bars
      const deltas: number[] = [];
      for (let i = 1; i < Math.min(bars.length, 100); i++) {
        const d = bars[i].dt - bars[i - 1].dt;
        if (d > 0) deltas.push(d);
      }
      deltas.sort((a, b) => a - b);
      const medianDelta = deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)] : 3600 * 1000;

      // Group sub-bars into each base bar
      let hfCursor = 0;
      for (let bi = 0; bi < bars.length; bi++) {
        const bar = bars[bi];
        const barStart = bar.dt;
        const barEnd = bi < bars.length - 1 ? bars[bi + 1].dt : barStart + medianDelta;

        const subBars: SubBarItem[] = [];
        while (hfCursor < hfItems.length && hfItems[hfCursor].dt < barStart) {
          hfCursor++;
        }
        let tempCursor = hfCursor;
        while (tempCursor < hfItems.length && hfItems[tempCursor].dt < barEnd) {
          subBars.push(hfItems[tempCursor]);
          tempCursor++;
        }

        if (subBars.length > 0) {
          totalSubPoints += subBars.length;
          bar.intrabarPointsCount = subBars.length;

          if (method === "volumetric") {
            // Volumetric interpolation: weight path by volume density and VWAP nodes
            const totalVol = subBars.reduce((s, x) => s + x.volume, 0);
            bar.volume = totalVol;
            const avgVol = totalVol / subBars.length;

            const points: number[] = [bar.open];
            for (const sb of subBars) {
              const vwap = (sb.open + sb.high + sb.low + 2 * sb.close) / 5;
              if (sb.volume >= avgVol * 0.8) {
                // High liquidity: include VWAP intermediate node
                if (sb.close >= sb.open) {
                  points.push(sb.open, sb.low, vwap, sb.high, sb.close);
                } else {
                  points.push(sb.open, sb.high, vwap, sb.low, sb.close);
                }
              } else {
                if (sb.close >= sb.open) {
                  points.push(sb.open, sb.low, sb.high, sb.close);
                } else {
                  points.push(sb.open, sb.high, sb.low, sb.close);
                }
              }
            }
            points.push(bar.close);

            const segs: [number, number][] = [];
            for (let pi = 0; pi < points.length - 1; pi++) {
              const p0 = points[pi], p1 = points[pi + 1];
              if (Math.abs(p1 - p0) > 1e-9) segs.push([p0, p1]);
            }
            bar.intrabarSegments = segs.length > 0 ? segs : pathSegments(bar.open, bar.high, bar.low, bar.close);
          } else {
            // Linear interpolation: chronological trajectory through sub-bar extrema
            const points: number[] = [bar.open];
            for (const sb of subBars) {
              if (sb.close >= sb.open) {
                points.push(sb.open, sb.low, sb.high, sb.close);
              } else {
                points.push(sb.open, sb.high, sb.low, sb.close);
              }
            }
            points.push(bar.close);

            const segs: [number, number][] = [];
            for (let pi = 0; pi < points.length - 1; pi++) {
              const p0 = points[pi], p1 = points[pi + 1];
              if (Math.abs(p1 - p0) > 1e-9) segs.push([p0, p1]);
            }
            bar.intrabarSegments = segs.length > 0 ? segs : pathSegments(bar.open, bar.high, bar.low, bar.close);
          }
        } else {
          bar.intrabarSegments = pathSegments(bar.open, bar.high, bar.low, bar.close);
          bar.intrabarPointsCount = 0;
        }
      }

      intrabarInterpolationApplied = {
        method,
        hfFileName: hfFile.name,
        totalSubPoints,
        avgPointsPerBar: parseFloat((totalSubPoints / Math.max(1, bars.length)).toFixed(1)),
      };
    } else {
      // Single file fallback: generate high-resolution synthetic intrabar segments
      for (const bar of bars) {
        const segs: [number, number][] = [];
        const base = pathSegments(bar.open, bar.high, bar.low, bar.close);
        const stepsPerSeg = method === "volumetric" ? 4 : 3;
        for (const [p0, p1] of base) {
          for (let s = 0; s < stepsPerSeg; s++) {
            const frac0 = s / stepsPerSeg;
            const frac1 = (s + 1) / stepsPerSeg;
            segs.push([p0 + frac0 * (p1 - p0), p0 + frac1 * (p1 - p0)]);
          }
        }
        bar.intrabarSegments = segs;
        bar.intrabarPointsCount = segs.length;
        totalSubPoints += segs.length;
      }
      intrabarInterpolationApplied = {
        method,
        hfFileName: `${validFiles[priceFileIdx].name} (Sintetico ${method === "volumetric" ? "VWAP" : "Lineare"})`,
        totalSubPoints,
        avgPointsPerBar: parseFloat((totalSubPoints / Math.max(1, bars.length)).toFixed(1)),
      };
    }
  }

  return { bars, dropped, columns, perFileDiag, intrabarInterpolationApplied };
}

export function columnStats(bars: Bar[], columns: string[]): Record<string, ColumnStat> {
  const stats: Record<string, ColumnStat> = {};
  const allCols = Array.from(new Set(["open", "high", "low", "close", ...columns]));
  for (const col of allCols) {
    let min = Infinity, max = -Infinity, sum = 0, n = 0;
    for (const b of bars) {
      const v = (b as any)[col];
      if (typeof v === "number" && Number.isFinite(v)) {
        min = Math.min(min, v);
        max = Math.max(max, v);
        sum += v;
        n++;
      }
    }
    stats[col] = n ? { min, max, mean: sum / n } : { min: 0, max: 0, mean: 0 };
  }
  return stats;
}

export const mergeCsvFiles = mergeDatasets;
export const computeColumnStats = columnStats;

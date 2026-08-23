import Papa from "papaparse";
import { Bar, ColumnStat, CsvParsedFile } from "../types";

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

export function mergeDatasets(files: CsvParsedFile[], priceFileId: string | null): {
  bars: Bar[];
  dropped: number;
  columns: string[];
  perFileDiag: { name: string; total: number; parsed: number; sampleRaw: string | null }[];
} {
  const validFiles = files.filter((f) => !f.error);
  if (validFiles.length === 0) return { bars: [], dropped: 0, columns: [], perFileDiag: [] };

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

  let common = new Set(perFileMaps[0].keys());
  for (let i = 1; i < perFileMaps.length; i++) {
    const next = new Set<number>();
    for (const ts of common) if (perFileMaps[i].has(ts)) next.add(ts);
    common = next;
  }

  const tsList = Array.from(common).sort((a, b) => a - b);
  const priceFileIdx = Math.max(0, validFiles.findIndex((f) => f.id === priceFileId));
  const columns: string[] = ["open", "high", "low", "close"];
  validFiles.forEach((f) =>
    f.extraCols.forEach((c) => {
      if (!columns.includes(c.name)) {
        columns.push(c.name);
      }
    })
  );

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
    for (let fi = 0; fi < validFiles.length; fi++) {
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
    // Check extra columns
    const extraColsToCheck = columns.filter((c) => !["open", "high", "low", "close"].includes(c));
    if (extraColsToCheck.some((cn) => bar[cn] == null)) { dropped++; continue; }
    bars.push(bar);
  }
  return { bars, dropped, columns, perFileDiag };
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

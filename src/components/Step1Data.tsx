import React, { useRef } from "react";
import { Upload, FileText, Settings2, Trash2, AlertTriangle, CheckCircle2, ChevronRight, Sparkles } from "lucide-react";
import { C, FONT_SERIF, FONT_SANS, FONT_MONO, Card, Button, inputStyle } from "./CommonUI";
import { CsvParsedFile, Bar, ColumnStat } from "../types";
import { fmtDT, fmtNum, parseCsvFile, mergeCsvFiles } from "../lib/csvHelper";
import { generateSampleCsv } from "../sampleData";

interface Step1DataProps {
  files: CsvParsedFile[];
  setFiles: React.Dispatch<React.SetStateAction<CsvParsedFile[]>>;
  priceFileId: string | null;
  setPriceFileId: (id: string | null) => void;
  merged: { bars: Bar[]; dropped: number; columns: string[]; perFileDiag: any[] } | null;
  setMerged: (m: any) => void;
  onMerge: () => void;
  onNext: () => void;
  stats: Record<string, ColumnStat>;
}

export function Step1Data({
  files,
  setFiles,
  priceFileId,
  setPriceFileId,
  merged,
  setMerged,
  onMerge,
  onNext,
}: Step1DataProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    arr.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const parsed = parseCsvFile(String(e.target?.result || ""), file.name);
        setFiles((prev) => [...prev, parsed]);
        if (!parsed.error) setPriceFileId(priceFileId || parsed.id);
      };
      reader.readAsText(file);
    });
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    if (priceFileId === id) setPriceFileId(null);
    setMerged(null);
  };

  const renameCol = (fileId: string, idx: number, newName: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id !== fileId ? f : { ...f, extraCols: f.extraCols.map((c) => (c.idx === idx ? { ...c, name: newName } : c)) }))
    );
    setMerged(null);
  };

  const loadSampleDataset = () => {
    const text = generateSampleCsv();
    const parsed = parseCsvFile(text, "sample_gold_1h.csv");
    setFiles([parsed]);
    setPriceFileId(parsed.id);
    const m = mergeCsvFiles([parsed], parsed.id);
    setMerged(m);
  };

  const canProceed = merged && merged.bars.length > 0;

  return (
    <Card id="step-1-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ fontFamily: FONT_SERIF, fontSize: 19, color: C.primaryDark, margin: 0 }}>1. Carica i dataset</h2>
          <p style={{ fontSize: 13.5, color: C.muted, marginTop: 4, marginBottom: 0 }}>
            Ogni file CSV: <code style={{ fontFamily: FONT_MONO, background: "#f0efe8", padding: "1px 5px", borderRadius: 3 }}>datetime;open;high;low;close;valore1[;valore2;...]</code>{" "}
            (separatore <code style={{ fontFamily: FONT_MONO }}>;</code> o <code style={{ fontFamily: FONT_MONO }}>,</code>). <b>Riga di intestazione obbligatoria</b> in prima posizione.
          </p>
        </div>
        <Button id="btn-load-sample-data" variant="secondary" onClick={loadSampleDataset} icon={Sparkles} style={{ fontSize: 12.5, padding: "7px 12px" }}>
          Carica dati di esempio (Gold 1H)
        </Button>
      </div>

      <div style={{ background: "#f4f3ee", borderRadius: 8, padding: "10px 14px", fontSize: 12, fontFamily: FONT_MONO, marginBottom: 18, color: C.muted }}>
        esempio: <span style={{ color: C.primaryDark }}>datetime;open;high;low;close;trend_prob;avg_trend_prob;atr_14</span><br />
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;2026.06.17&nbsp;11:00;4324.69;4327.10;4322.80;4326.54;0.4136;0.4980;12.50
      </div>

      <div
        id="dropzone-csv"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current && fileInputRef.current.click()}
        style={{ border: `2px dashed ${C.border}`, borderRadius: 10, padding: "30px 20px", textAlign: "center", cursor: "pointer", marginBottom: 20, background: "#fffdf9" }}
      >
        <Upload size={26} color={C.primary} style={{ marginBottom: 8 }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: C.primaryDark }}>Trascina qui i file CSV o clicca per selezionarli</div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Supporta caricamento multi-file (unione automatica su datetime)</div>
        <input ref={fileInputRef} id="input-file-csv" type="file" accept=".csv" multiple style={{ display: "none" }} onChange={(e) => e.target.files && handleFiles(e.target.files)} />
      </div>

      {files.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 22 }}>
          {files.map((f) => (
            <div id={`card-file-${f.id}`} key={f.id} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "14px 16px", background: "#fff" }}>
              {f.error ? (
                <div style={{ color: C.red, fontSize: 13 }}><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> {f.name}: {f.error}</div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <FileText size={15} color={C.primary} />
                      <b style={{ fontSize: 13.5 }}>{f.name}</b>
                      <span style={{ fontSize: 11.5, color: C.muted }}>{f.nRows} righe · {f.ncols} colonne</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <label style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 5, color: C.muted, cursor: "pointer" }}>
                        <input id={`radio-price-src-${f.id}`} type="radio" name="priceFile" checked={priceFileId === f.id} onChange={() => setPriceFileId(f.id)} />
                        usa come fonte OHLC
                      </label>
                      <Trash2 id={`btn-remove-file-${f.id}`} size={15} color={C.red} style={{ cursor: "pointer" }} onClick={() => removeFile(f.id)} />
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, fontFamily: FONT_MONO, marginBottom: 10 }}>
                    intestazione → datetime: <b style={{ color: C.text }}>{f.header[0]}</b> · open: <b style={{ color: C.text }}>{f.header[1]}</b> · high: <b style={{ color: C.text }}>{f.header[2]}</b> · low: <b style={{ color: C.text }}>{f.header[3]}</b> · close: <b style={{ color: C.text }}>{f.header[4]}</b>
                  </div>
                  {f.extraCols.length === 0 ? (
                    <div style={{ fontSize: 12, color: C.amber }}>Nessuna colonna indicatore oltre OHLC.</div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      {f.extraCols.map((c) => (
                        <div key={c.idx} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 11, color: C.muted }}>col.{c.idx + 1}</span>
                          <input
                            id={`input-col-name-${f.id}-${c.idx}`}
                            value={c.name}
                            onChange={(e) => renameCol(f.id, c.idx, e.target.value.replace(/[^a-zA-Z0-9_]/g, "_"))}
                            style={{ ...inputStyle, width: 160, padding: "5px 8px", fontSize: 12.5 }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {files.filter((f) => !f.error).length > 0 && (
        <Button id="btn-merge-datasets" onClick={onMerge} icon={Settings2} variant="secondary">
          Unisci e allinea dataset
        </Button>
      )}

      {merged && (
        <div style={{ marginTop: 20 }}>
          {merged.bars.length === 0 ? (
            <div style={{ background: C.redLight, border: `1px solid ${C.red}33`, borderRadius: 8, padding: 14, fontSize: 13, color: C.red }}>
              <b>Nessuna candela in comune tra i file caricati.</b> Diagnosi per file:
              <table style={{ width: "100%", marginTop: 8, fontSize: 11.5, fontFamily: FONT_MONO, borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "3px 6px" }}>File</th>
                    <th style={{ textAlign: "right", padding: "3px 6px" }}>Righe dati</th>
                    <th style={{ textAlign: "right", padding: "3px 6px" }}>Date riconosciute</th>
                    <th style={{ textAlign: "left", padding: "3px 6px" }}>1ª data grezza</th>
                  </tr>
                </thead>
                <tbody>
                  {merged.perFileDiag.map((d) => (
                    <tr key={d.name}>
                      <td style={{ padding: "3px 6px" }}>{d.name}</td>
                      <td style={{ padding: "3px 6px", textAlign: "right" }}>{d.total}</td>
                      <td style={{ padding: "3px 6px", textAlign: "right", color: d.parsed === 0 ? C.red : d.parsed === d.total ? C.primaryDark : C.amber, fontWeight: 700 }}>
                        {d.parsed} / {d.total}
                      </td>
                      <td style={{ padding: "3px 6px" }}>{d.sampleRaw}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ background: C.primaryLight, border: `1px solid ${C.primary}33`, borderRadius: 8, padding: 14, fontSize: 13 }}>
              <CheckCircle2 size={14} color={C.primaryDark} style={{ verticalAlign: -2 }} />{" "}
              <b>{merged.bars.length} candele</b> unite correttamente ({fmtDT(merged.bars[0].dt)} → {fmtDT(merged.bars[merged.bars.length - 1].dt)}).
              {merged.dropped > 0 && <span style={{ color: C.muted }}> {merged.dropped} righe scartate per dati mancanti/incoerenti.</span>}
              <div style={{ marginTop: 10, overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", fontSize: 11.5, fontFamily: FONT_MONO, width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "4px 8px", borderBottom: `1px solid ${C.border}`, color: C.muted }}>dt</th>
                      {merged.columns.map((c) => (
                        <th
                          key={c}
                          style={{
                            textAlign: "left",
                            padding: "4px 8px",
                            borderBottom: `1px solid ${C.border}`,
                            color: ["open", "high", "low", "close"].includes(c) ? C.primaryDark : C.muted,
                            fontWeight: ["open", "high", "low", "close"].includes(c) ? 700 : 500,
                          }}
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {merged.bars.slice(0, 4).map((b, i) => (
                      <tr key={i}>
                        <td style={{ padding: "4px 8px" }}>{fmtDT(b.dt)}</td>
                        {merged.columns.map((c) => (
                          <td
                            key={c}
                            style={{
                              padding: "4px 8px",
                              fontWeight: ["open", "high", "low", "close"].includes(c) ? 600 : 400,
                            }}
                          >
                            {fmtNum((b as any)[c], ["open", "high", "low", "close"].includes(c) ? 2 : 4)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end" }}>
        <Button id="btn-next-step-2" onClick={onNext} disabled={!canProceed} icon={ChevronRight} style={{ flexDirection: "row-reverse" }}>
          Avanti: Strategia
        </Button>
      </div>
    </Card>
  );
}

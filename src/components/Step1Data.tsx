import React, { useRef } from "react";
import { Upload, FileText, Settings2, Trash2, AlertTriangle, CheckCircle2, ChevronRight, Sparkles, Activity, Layers } from "lucide-react";
import { C, FONT_SERIF, FONT_SANS, FONT_MONO, Card, Button, inputStyle } from "./CommonUI";
import { CsvParsedFile, Bar, ColumnStat, IntrabarInterpolationConfig, MergedDatasetResult } from "../types";
import { fmtDT, fmtNum, parseCsvFile, mergeCsvFiles } from "../lib/csvHelper";
import { generateSampleCsv, generateSampleHfCsv } from "../sampleData";

interface Step1DataProps {
  files: CsvParsedFile[];
  setFiles: React.Dispatch<React.SetStateAction<CsvParsedFile[]>>;
  priceFileId: string | null;
  setPriceFileId: (id: string | null) => void;
  intrabarConfig: IntrabarInterpolationConfig;
  setIntrabarConfig: React.Dispatch<React.SetStateAction<IntrabarInterpolationConfig>>;
  merged: MergedDatasetResult | null;
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
  intrabarConfig,
  setIntrabarConfig,
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
    if (intrabarConfig.hfFileId === id) {
      setIntrabarConfig((prev) => ({ ...prev, hfFileId: null }));
    }
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
    const m = mergeCsvFiles([parsed], parsed.id, intrabarConfig);
    setMerged(m);
  };

  const loadSampleHfDataset = () => {
    const text1h = generateSampleCsv();
    const text5m = generateSampleHfCsv();
    const parsed1h = parseCsvFile(text1h, "gold_1h_strategy.csv");
    const parsed5m = parseCsvFile(text5m, "gold_5m_high_frequency.csv");
    setFiles([parsed1h, parsed5m]);
    setPriceFileId(parsed1h.id);
    const newCfg: IntrabarInterpolationConfig = {
      enabled: true,
      method: "volumetric",
      hfFileId: parsed5m.id,
    };
    setIntrabarConfig(newCfg);
    const m = mergeCsvFiles([parsed1h, parsed5m], parsed1h.id, newCfg);
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button id="btn-load-sample-data" variant="secondary" onClick={loadSampleDataset} icon={Sparkles} style={{ fontSize: 12.5, padding: "7px 12px" }}>
            Carica dati standard (Gold 1H)
          </Button>
          <Button id="btn-load-sample-hf-data" variant="secondary" onClick={loadSampleHfDataset} icon={Activity} style={{ fontSize: 12.5, padding: "7px 12px", border: "1px solid #86efac", background: "#f0fdf4", color: "#15803d" }}>
            Carica demo 1H + 5M Alta Frequenza
          </Button>
        </div>
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

      {/* Sezione Configurazione Interpolazione Intrabar Prezzi */}
      <div
        id="box-intrabar-interpolation-config"
        style={{
          border: `1.5px solid ${intrabarConfig.enabled ? "#86efac" : C.border}`,
          background: intrabarConfig.enabled ? "#f0fdf4" : "#ffffff",
          borderRadius: 10,
          padding: 16,
          marginBottom: 18,
          transition: "all 0.2s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", margin: 0, flex: 1 }}>
            <input
              id="checkbox-intrabar-interpolation"
              type="checkbox"
              checked={intrabarConfig.enabled}
              onChange={(e) => {
                const nextVal = e.target.checked;
                setIntrabarConfig((prev) => ({ ...prev, enabled: nextVal }));
                setMerged(null);
              }}
              style={{ width: 17, height: 17, accentColor: "#16a34a", cursor: "pointer", marginTop: 2 }}
            />
            <div>
              <div style={{ fontFamily: FONT_SANS, fontSize: 13.5, fontWeight: 700, color: C.primaryDark, display: "flex", alignItems: "center", gap: 7 }}>
                <Activity size={16} color={intrabarConfig.enabled ? "#16a34a" : C.primary} />
                Abilita interpolazione intrabar dei prezzi con file ad alta frequenza
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 3, lineHeight: 1.45 }}>
                Mappa l'effettivo percorso dei prezzi all'interno di ogni candela utilizzando dataset a granularità più fine (es. 1m o 5m). Risolve con assoluta precisione la sequenza temporale di raggiungimento di Stop Loss e Take Profit.
              </div>
            </div>
          </label>
          <span
            style={{
              fontSize: 11,
              padding: "3px 9px",
              background: intrabarConfig.enabled ? "#dcfce7" : "#e2e8f0",
              color: intrabarConfig.enabled ? "#15803d" : "#475569",
              borderRadius: 12,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {intrabarConfig.enabled ? "Attivo" : "Opzionale"}
          </span>
        </div>

        {intrabarConfig.enabled && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${intrabarConfig.enabled ? "#bbf7d0" : C.border}` }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.primaryDark, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <Layers size={14} color={C.primary} />
              Metodo di interpolazione del percorso di prezzo:
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <label
                id="option-interpolation-linear"
                style={{
                  border: `1.5px solid ${intrabarConfig.method === "linear" ? C.primary : C.border}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  background: intrabarConfig.method === "linear" ? "#fffdfa" : "#ffffff",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    id="radio-method-linear"
                    type="radio"
                    name="interpolationMethod"
                    value="linear"
                    checked={intrabarConfig.method === "linear"}
                    onChange={() => {
                      setIntrabarConfig((prev) => ({ ...prev, method: "linear" }));
                      setMerged(null);
                    }}
                    style={{ accentColor: C.primary }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.primaryDark }}>Lineare (Linear)</span>
                </div>
                <div style={{ fontSize: 11.5, color: "#64748b", marginLeft: 22, lineHeight: 1.4 }}>
                  Collega cronologicamente in linea retta i punti di prezzo e gli estremi (High/Low) delle sub-bar ad alta frequenza. Ideale per tracciare la precisa traiettoria temporale di massimi e minimi.
                </div>
              </label>

              <label
                id="option-interpolation-volumetric"
                style={{
                  border: `1.5px solid ${intrabarConfig.method === "volumetric" ? "#16a34a" : C.border}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  background: intrabarConfig.method === "volumetric" ? "#f0fdf4" : "#ffffff",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  transition: "all 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    id="radio-method-volumetric"
                    type="radio"
                    name="interpolationMethod"
                    value="volumetric"
                    checked={intrabarConfig.method === "volumetric"}
                    onChange={() => {
                      setIntrabarConfig((prev) => ({ ...prev, method: "volumetric" }));
                      setMerged(null);
                    }}
                    style={{ accentColor: "#16a34a" }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#15803d" }}>Volumetrica (Volumetric)</span>
                </div>
                <div style={{ fontSize: 11.5, color: "#64748b", marginLeft: 22, lineHeight: 1.4 }}>
                  Pondera la velocità e densità del percorso in base ai volumi/liquidità (VWAP e addensamenti volumetrici). Le zone ad alto volume creano nodi di assorbimento più densi e realistici.
                </div>
              </label>
            </div>

            {files.filter((f) => !f.error).length >= 2 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#f8fafc", padding: "8px 12px", borderRadius: 6, border: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.primaryDark }}>
                  Sorgente dati ad alta frequenza:
                </span>
                <select
                  id="select-hf-file"
                  value={intrabarConfig.hfFileId || ""}
                  onChange={(e) => {
                    setIntrabarConfig((prev) => ({ ...prev, hfFileId: e.target.value || null }));
                    setMerged(null);
                  }}
                  style={{ ...inputStyle, width: "auto", minWidth: 240, padding: "4px 8px", fontSize: 12 }}
                >
                  <option value="">Rilevamento automatico (file con più righe)</option>
                  {files
                    .filter((f) => !f.error && f.id !== priceFileId)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} ({f.nRows.toLocaleString()} righe)
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>

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
              {merged.intrabarInterpolationApplied && (
                <div
                  id="badge-intrabar-interpolation-status"
                  style={{
                    marginTop: 10,
                    padding: "8px 12px",
                    background: "#ecfdf5",
                    border: "1px solid #86efac",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "#065f46",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <Activity size={16} color="#10b981" />
                  <div>
                    <b>Interpolazione Intrabar {merged.intrabarInterpolationApplied.method === "volumetric" ? "Volumetrica (VWAP)" : "Lineare"} Applicata:</b>{" "}
                    Mappati <b>{merged.intrabarInterpolationApplied.totalSubPoints.toLocaleString()} micro-punti</b> da <i>{merged.intrabarInterpolationApplied.hfFileName}</i> (media di {merged.intrabarInterpolationApplied.avgPointsPerBar} punti/candela). L'esecuzione SL/TP nel backtest utilizzerà questo percorso intra-candela ad alta definizione.
                  </div>
                </div>
              )}
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

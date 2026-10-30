"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, btn, input, label } from "@/components/ui";
import type { ColumnInfo, ImportSummary, ColumnTarget } from "@/lib/excel/import";

type Preview = { parsed: { sheets: string[]; sheetName: string; headerRow: number; columns: ColumnInfo[] }; summary: ImportSummary };

export function ImportWizard({ fields }: { fields: { key: string; label: string }[] }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [overrides, setOverrides] = useState<Record<string, ColumnTarget>>({});
  const [sheet, setSheet] = useState<string>("");
  const [headerRow, setHeaderRow] = useState<string>("");
  const [busy, setBusy] = useState<"" | "preview" | "commit">("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [excelMode, setExcelMode] = useState<"respect_sources" | "overwrite">("respect_sources");

  async function send(mode: "preview" | "commit", opts: { sheet?: string; headerRow?: string; overrides?: Record<string, ColumnTarget>; f?: File; excelMode?: string } = {}) {
    const f = opts.f ?? file;
    if (!f) return;
    setBusy(mode);
    setError("");
    const fd = new FormData();
    fd.set("file", f);
    fd.set("mode", mode);
    const sh = opts.sheet ?? sheet;
    const hr = opts.headerRow ?? headerRow;
    if (sh) fd.set("sheet", sh);
    if (hr) fd.set("headerRow", hr);
    fd.set("overrides", JSON.stringify(opts.overrides ?? overrides));
    fd.set("excelMode", opts.excelMode ?? excelMode);
    try {
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      if (mode === "preview") {
        setPreview(json);
        setSheet(json.parsed.sheetName);
        setHeaderRow(String(json.parsed.headerRow));
      } else {
        setResult(json.summary);
        setPreview(null);
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setOverrides({});
    setSheet("");
    setHeaderRow("");
    setResult(null);
    setError("");
  }

  const s = preview?.summary;
  const errors = s?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = s?.issues.filter((i) => i.level === "warning") ?? [];
  const blocking = errors.some((e) => e.row === preview?.parsed.headerRow);

  if (result)
    return (
      <Card title="Import complete">
        <Counts s={result} />
        {result.issues.length > 0 && <IssueList issues={result.issues} all={showAllIssues} onAll={() => setShowAllIssues(true)} />}
        <div className="mt-4 flex gap-2">
          <Link href="/employees" className={btn.primary}>View employees</Link>
          <button onClick={reset} className={btn.secondary}>Import another file</button>
        </div>
      </Card>
    );

  return (
    <Card title={preview ? `Step 2 — Review "${file?.name}"` : "Step 1 — Choose a file"}>
      {!preview && (
        <label
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-line px-6 py-12 text-center hover:border-accent/50 hover:bg-accent/5"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) {
              setFile(f);
              send("preview", { f, overrides: {}, sheet: "", headerRow: "" });
            }
          }}
        >
          <span className="text-3xl">📄</span>
          <span className="mt-2 text-sm font-medium">{busy ? "Reading file…" : "Drop an .xlsx / .csv here, or click to browse"}</span>
          <span className="mt-1 text-xs text-muted">Up to 25 MB. The header row and columns are detected automatically.</span>
          <input
            type="file"
            accept=".xlsx,.xlsm,.csv"
            className="sr-only"
            disabled={!!busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                setOverrides({});
                send("preview", { f, overrides: {}, sheet: "", headerRow: "" });
              }
            }}
          />
        </label>
      )}

      {error && <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}

      {preview && s && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={label}>Sheet</label>
              <select value={sheet} className={input} onChange={(e) => { setSheet(e.target.value); setOverrides({}); send("preview", { sheet: e.target.value, headerRow: "", overrides: {} }); }}>
                {preview.parsed.sheets.map((n) => <option key={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <label className={label}>Header row</label>
              <input type="number" min={1} value={headerRow} className={input} onChange={(e) => setHeaderRow(e.target.value)} onBlur={() => send("preview", { overrides: {} })} />
            </div>
            <div>
              <label className={label}>When the file differs from Leapsome / Timebase</label>
              <select
                value={excelMode}
                className={input}
                onChange={(e) => {
                  const m = e.target.value as typeof excelMode;
                  setExcelMode(m);
                  send("preview", { excelMode: m });
                }}
              >
                <option value="respect_sources">Keep system data (file only fills gaps)</option>
                <option value="overwrite">File wins (overwrite system data)</option>
              </select>
            </div>
          </div>

          <div className="rounded-lg bg-canvas p-4">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">If you import now</div>
            <Counts s={s} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Column mapping</h3>
              <span className="text-xs text-muted">{preview.parsed.columns.length} columns · change any mapping, then refresh the preview</span>
            </div>
            <div className="max-h-[420px] overflow-auto rounded-lg border border-line">
              <table className="data">
                <thead><tr><th>Column in file</th><th>Sample values</th><th>Maps to</th></tr></thead>
                <tbody>
                  {preview.parsed.columns.map((c) => {
                    const val = overrides[String(c.index)] ?? c.target;
                    return (
                      <tr key={c.index}>
                        <td className="font-medium">{c.header}</td>
                        <td className="max-w-xs text-xs text-muted">
                          {c.sample.length ? (
                            <div className="flex flex-col gap-0.5">
                              {c.sample.map((v, i) => (
                                <div key={i} className="truncate">{v}</div>
                              ))}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          <select
                            value={val}
                            className={`${input} py-1 ${val === "ignore" ? "text-muted" : val === "extra" ? "" : "border-accent/40 bg-accent/5"}`}
                            onChange={(e) => setOverrides((o) => ({ ...o, [String(c.index)]: e.target.value as ColumnTarget }))}
                          >
                            <optgroup label="Employee field">
                              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                            </optgroup>
                            <option value="snapshot">Monthly headcount column{c.snapshotMonth ? ` (${c.snapshotMonth})` : ""}</option>
                            <option value="extra">Keep as extra column</option>
                            <option value="ignore">Ignore</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {(errors.length > 0 || warnings.length > 0) && <IssueList issues={s.issues} all={showAllIssues} onAll={() => setShowAllIssues(true)} />}

          {s.sampleChanges.length > 0 && (
            <details className="rounded-lg border border-line">
              <summary className="cursor-pointer px-4 py-2 text-sm font-medium">Sample of changes ({s.sampleChanges.length})</summary>
              <ul className="divide-y divide-line text-sm">
                {s.sampleChanges.map((c) => (
                  <li key={c.row} className="px-4 py-2">
                    <span className="font-medium">Row {c.row}: {c.name}</span> — {c.result === "created" ? <span className="text-emerald-700">new employee</span> : c.changes.map((x) => `${x.field}: ${x.from ?? "∅"} → ${x.to}`).join("; ")}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex flex-wrap gap-2">
            <button className={btn.secondary} disabled={!!busy} onClick={() => send("preview")}>{busy === "preview" ? "Refreshing…" : "↻ Refresh preview"}</button>
            <button className={btn.primary} disabled={!!busy || blocking || s.totalRows === 0} onClick={() => send("commit")}>
              {busy === "commit" ? "Importing…" : `Import ${s.totalRows.toLocaleString()} rows`}
            </button>
            <button className={btn.secondary} onClick={reset} disabled={!!busy}>Cancel</button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Counts({ s }: { s: ImportSummary }) {
  const items: [string, number, string][] = [
    ["Rows", s.totalRows, "text-ink"],
    ["New", s.created, "text-emerald-700"],
    ["Updated", s.updated, "text-sky-700"],
    ["Unchanged", s.unchanged, "text-muted"],
    ["Skipped", s.skipped, "text-rose-700"],
    [`Snapshots (${s.snapshotMonths} months)`, s.snapshots, "text-ink"],
  ];
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
      {items.map(([l, v, c]) => (
        <div key={l}>
          <div className={`text-xl font-semibold tabular-nums ${c}`}>{v.toLocaleString()}</div>
          <div className="text-xs text-muted">{l}</div>
        </div>
      ))}
    </div>
  );
}

function IssueList({ issues, all, onAll }: { issues: ImportSummary["issues"]; all: boolean; onAll: () => void }) {
  const shown = all ? issues : issues.slice(0, 12);
  const e = issues.filter((i) => i.level === "error").length;
  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/50">
      <div className="border-b border-amber-200 px-4 py-2 text-sm font-medium text-amber-900">
        {e} error{e === 1 ? "" : "s"}, {issues.length - e} warning{issues.length - e === 1 ? "" : "s"}
      </div>
      <ul className="max-h-72 divide-y divide-amber-100 overflow-auto text-sm">
        {shown.map((i, k) => (
          <li key={k} className="flex gap-3 px-4 py-1.5">
            <span className={i.level === "error" ? "text-rose-700" : "text-amber-700"}>{i.level === "error" ? "✕" : "!"}</span>
            <span className="text-muted">{i.row ? `Row ${i.row}` : "File"}</span>
            <span>{i.message}</span>
          </li>
        ))}
      </ul>
      {!all && issues.length > 12 && <button onClick={onAll} className="px-4 py-2 text-xs text-accent">Show all {issues.length}</button>}
    </div>
  );
}

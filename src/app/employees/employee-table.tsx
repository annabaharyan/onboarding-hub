"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteEmployees } from "@/app/actions";
import { StatusBadge, fmtDate } from "@/components/ui";
import { FIELD_MAP, type EmployeeField } from "@/lib/fields";

type Row = { id: number; fullName: string; email: string | null; status: string; sources: string[] } & Record<string, unknown>;

export function EmployeeTable({
  rows,
  cols,
  sortHref,
  sort,
  dir,
}: {
  rows: Row[];
  cols: EmployeeField[];
  sortHref: (c: EmployeeField) => string;
  sort?: string;
  dir?: string;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pending, startTransition] = useTransition();
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));
  }
  function toggleOne(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} employee(s)? This permanently removes their records, change history and any survey/probation data. This cannot be undone.`)) return;
    const ids = [...selected];
    startTransition(async () => {
      await deleteEmployees(ids);
      setSelected(new Set());
    });
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="flex items-center justify-between border-b border-line bg-rose-50 px-5 py-2 text-sm text-rose-900">
          <span>{selected.size} selected</span>
          <button onClick={handleDeleteSelected} disabled={pending} className="font-medium text-rose-700 hover:underline disabled:opacity-50">
            {pending ? "Deleting…" : "Delete selected"}
          </button>
        </div>
      )}
      <div className="max-h-[70vh] overflow-auto">
        <table className="data">
          <thead>
            <tr>
              <th className="w-8">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all on this page" className="size-4 rounded border-line" />
              </th>
              {cols.map((c) => (
                <th key={c}>
                  <Link href={sortHref(c)} className="hover:text-ink">
                    {FIELD_MAP[c].label}
                    {sort === c ? (dir === "asc" ? " ↑" : " ↓") : ""}
                  </Link>
                </th>
              ))}
              <th>Sources</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? "bg-rose-50/40" : undefined}>
                <td>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} aria-label={`Select ${r.fullName}`} className="size-4 rounded border-line" />
                </td>
                {cols.map((c) => (
                  <td key={c}>
                    {c === "fullName" ? (
                      <Link href={`/employees/${r.id}`} className="font-medium text-accent hover:underline">
                        {r.fullName}
                        {r.email && <span className="block text-xs font-normal text-muted">{r.email}</span>}
                      </Link>
                    ) : c === "status" ? (
                      <StatusBadge status={r.status} />
                    ) : FIELD_MAP[c].type === "date" ? (
                      <span className="tabular-nums">{fmtDate(r[c] as string | null)}</span>
                    ) : (
                      (r[c] as string | null) ?? <span className="text-muted">—</span>
                    )}
                  </td>
                ))}
                <td className="text-xs text-muted">{r.sources.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

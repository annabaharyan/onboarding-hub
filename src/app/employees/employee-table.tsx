"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteEmployees } from "@/app/actions";
import { StatusBadge, fmtDate } from "@/components/ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FIELD_MAP, type EmployeeField } from "@/lib/fields";

type Row = { id: number; fullName: string; email: string | null; status: string; sources: string[] } & Record<string, unknown>;

export function EmployeeTable({
  rows,
  cols,
  sortHrefs,
  sort,
  dir,
}: {
  rows: Row[];
  cols: EmployeeField[];
  sortHrefs: Record<EmployeeField, string>;
  sort?: string;
  dir?: string;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
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
  function confirmDeleteSelected() {
    const ids = [...selected];
    startTransition(async () => {
      await deleteEmployees(ids);
      setSelected(new Set());
      setConfirmOpen(false);
    });
  }

  // Full name is pinned leftmost (after the checkbox) so it stays visible while scrolling horizontally.
  const CHECKBOX_W = 40;
  const NAME_W = 220;
  const otherCols = cols.filter((c) => c !== "fullName");

  return (
    <>
      {selected.size > 0 && (
        <div className="flex items-center justify-between border-b border-line bg-rose-50 px-5 py-2 text-sm text-rose-900">
          <span>{selected.size} selected</span>
          <button onClick={() => setConfirmOpen(true)} disabled={pending} className="font-medium text-rose-700 hover:underline disabled:opacity-50">
            {pending ? "Deleting…" : "Delete selected"}
          </button>
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title={`Delete ${selected.size} employee${selected.size === 1 ? "" : "s"}?`}
        description="This permanently removes their records, change history and any survey/probation data. This cannot be undone."
        confirmLabel="Delete selected"
        pending={pending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirmDeleteSelected}
      />
      <div className="max-h-[70vh] overflow-auto">
        <table className="data">
          <thead>
            <tr>
              <th className="z-20 bg-canvas" style={{ position: "sticky", left: 0, width: CHECKBOX_W }}>
                <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Select all on this page" className="size-4 rounded border-line" />
              </th>
              <th className="z-20 bg-canvas" style={{ position: "sticky", left: CHECKBOX_W, width: NAME_W }}>
                <Link href={sortHrefs.fullName} className="hover:text-ink">
                  {FIELD_MAP.fullName.label}
                  {sort === "fullName" ? (dir === "asc" ? " ↑" : " ↓") : ""}
                </Link>
              </th>
              {otherCols.map((c) => (
                <th key={c}>
                  <Link href={sortHrefs[c]} className="hover:text-ink">
                    {FIELD_MAP[c].label}
                    {sort === c ? (dir === "asc" ? " ↑" : " ↓") : ""}
                  </Link>
                </th>
              ))}
              <th>Sources</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelected = selected.has(r.id);
              const pinnedBg = isSelected ? "bg-rose-50" : "bg-surface";
              return (
                <tr key={r.id} className={isSelected ? "bg-rose-50/40" : undefined}>
                  <td className={`z-10 ${pinnedBg}`} style={{ position: "sticky", left: 0, width: CHECKBOX_W }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleOne(r.id)} aria-label={`Select ${r.fullName}`} className="size-4 rounded border-line" />
                  </td>
                  <td className={`z-10 ${pinnedBg}`} style={{ position: "sticky", left: CHECKBOX_W, width: NAME_W }}>
                    <Link href={`/employees/${r.id}`} className="font-medium text-accent hover:underline">
                      {r.fullName}
                      {r.email && <span className="block text-xs font-normal text-muted">{r.email}</span>}
                    </Link>
                  </td>
                  {otherCols.map((c) => (
                    <td key={c}>
                      {c === "status" ? (
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
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

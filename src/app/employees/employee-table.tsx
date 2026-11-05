"use client";

import Link from "next/link";
import { StatusBadge, fmtDate } from "@/components/ui";
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
  // Full name is pinned leftmost so it stays visible while scrolling horizontally.
  const NAME_W = 220;
  const otherCols = cols.filter((c) => c !== "fullName");

  return (
    <>
      <div className="max-h-[70vh] overflow-auto">
        <table className="data">
          <thead>
            <tr>
              <th className="z-20 bg-canvas" style={{ position: "sticky", left: 0, width: NAME_W }}>
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
              return (
                <tr key={r.id}>
                  <td className="z-10 bg-surface" style={{ position: "sticky", left: 0, width: NAME_W }}>
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

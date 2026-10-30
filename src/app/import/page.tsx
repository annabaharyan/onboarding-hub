import { Suspense } from "react";
import { connection } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { importBatches } from "@/db/schema";
import { Card, PageHeader, Skeleton, btn, fmtDateTime } from "@/components/ui";
import { ImportWizard } from "./wizard";
import { FIELDS } from "@/lib/fields";

export const metadata = { title: "Import Excel" };

export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="Import Excel"
        description="Upload the headcount file (or any employee list). You'll see a preview of exactly what will change before anything is saved. Blank cells never erase existing data, and the whole import is rolled back if anything fails."
        actions={<a href="/api/template" className={btn.secondary}>⬇ Download template</a>}
      />
      <div className="space-y-6">
        <ImportWizard fields={FIELDS.map((f) => ({ key: f.key, label: f.label }))} />
        <Suspense fallback={<Skeleton rows={4} />}>
          <History />
        </Suspense>
      </div>
    </>
  );
}

async function History() {
  await connection();
  const rows = await getDb().select().from(importBatches).orderBy(desc(importBatches.createdAt)).limit(20);
  return (
    <Card title="Import history" padded={false}>
      {rows.length === 0 ? (
        <p className="p-5 text-sm text-muted">No imports yet.</p>
      ) : (
        <div className="overflow-auto">
          <table className="data">
            <thead><tr><th>When</th><th>File</th><th>Sheet</th><th>Rows</th><th>New</th><th>Updated</th><th>Unchanged</th><th>Skipped</th><th>Snapshots</th><th>Issues</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateTime(r.createdAt)}</td>
                  <td className="font-medium">{r.fileName}</td>
                  <td>{r.sheetName}</td>
                  <td className="tabular-nums">{r.totalRows}</td>
                  <td className="tabular-nums text-emerald-700">{r.created}</td>
                  <td className="tabular-nums text-sky-700">{r.updated}</td>
                  <td className="tabular-nums">{r.unchanged}</td>
                  <td className="tabular-nums text-rose-700">{r.skipped}</td>
                  <td className="tabular-nums">{r.snapshots}</td>
                  <td>
                    {r.issues.length ? (
                      <details>
                        <summary className="cursor-pointer text-accent">{r.issues.length}</summary>
                        <ul className="mt-1 max-h-48 overflow-auto text-xs whitespace-normal">
                          {r.issues.slice(0, 100).map((i, k) => <li key={k}>Row {i.row}: {i.message}</li>)}
                        </ul>
                      </details>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

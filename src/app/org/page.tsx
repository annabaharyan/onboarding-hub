import { Suspense } from "react";
import { connection } from "next/server";
import { asc } from "drizzle-orm";
import { getDb } from "@/db";
import { orgUnits } from "@/db/schema";
import { Card, Empty, PageHeader, Skeleton, input, label } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { upsertOrgUnit, deleteOrgUnit } from "@/app/actions";

export const metadata = { title: "Org hierarchy" };

export default function OrgPage() {
  return (
    <>
      <PageHeader
        title="Org hierarchy"
        description="Cluster → Business Unit → HRBP → Head of Business Ops → Business Controller → Staffing Partner. One row per business unit; shown on each employee's page for their BU."
      />
      <Suspense fallback={<Skeleton rows={8} />}>
        <Body />
      </Suspense>
    </>
  );
}

async function Body() {
  await connection();
  const db = getDb();
  const rows = await db.select().from(orgUnits).orderBy(asc(orgUnits.cluster), asc(orgUnits.businessUnit));

  return (
    <div className="space-y-6">
      <Card title="Add / update a business unit">
        <ActionForm action={upsertOrgUnit} className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={label}>Business unit *</label>
            <input name="businessUnit" required className={input} />
          </div>
          <div><label className={label}>Cluster</label><input name="cluster" className={input} /></div>
          <div><label className={label}>HRBP</label><input name="hrbp" className={input} /></div>
          <div><label className={label}>Head of Business Ops</label><input name="headOfBusinessOps" className={input} /></div>
          <div><label className={label}>Business Controller</label><input name="businessController" className={input} /></div>
          <div><label className={label}>Staffing Partner</label><input name="staffingPartner" className={input} /></div>
          <div className="sm:col-span-3"><label className={label}>Notes</label><input name="notes" className={input} /></div>
          <div className="sm:col-span-3 flex justify-end">
            <SubmitButton pending="Saving…">Save</SubmitButton>
          </div>
        </ActionForm>
        <p className="mt-2 text-xs text-muted">Saving a business unit that already exists here updates that row instead of creating a duplicate.</p>
      </Card>

      <Card title="Business units" padded={false}>
        {rows.length ? (
          <table className="data">
            <thead><tr><th>Cluster</th><th>Business unit</th><th>HRBP</th><th>Head of Business Ops</th><th>Business Controller</th><th>Staffing Partner</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.cluster ?? "—"}</td>
                  <td className="font-medium">{r.businessUnit}</td>
                  <td>{r.hrbp ?? "—"}</td>
                  <td>{r.headOfBusinessOps ?? "—"}</td>
                  <td>{r.businessController ?? "—"}</td>
                  <td>{r.staffingPartner ?? "—"}</td>
                  <td>
                    <form action={deleteOrgUnit}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="text-xs text-rose-600 hover:underline">Remove</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty title="No business units mapped yet">Use the form above to add the first one.</Empty>}
      </Card>
    </div>
  );
}

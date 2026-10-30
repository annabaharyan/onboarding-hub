import { buildExport } from "@/lib/excel/export";
import { parseColumns, parseFilters } from "@/lib/queries";

export const maxDuration = 120;

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const filters = parseFilters(sp);
  const flag = (k: string, def = false) => (sp.has(k) ? sp.getAll(k).includes("1") : def);
  const buf = await buildExport(filters, {
    columns: parseColumns(sp),
    includeExtra: flag("extra"),
    includeSnapshots: flag("snapshots", true),
    includeSummary: flag("summary", true),
    includeOnboarding: flag("onboarding"),
    includeChanges: flag("changes"),
    snapshotFrom: sp.get("snapshotFrom") || undefined,
    snapshotTo: sp.get("snapshotTo") || undefined,
  });
  const name = `headcount_${new Date().toISOString().slice(0, 10)}${filters.status?.length ? "_" + filters.status.join("-") : ""}.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}

import { buildTemplate } from "@/lib/excel/export";

export async function GET() {
  const buf = await buildTemplate();
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="headcount_template.xlsx"`,
    },
  });
}

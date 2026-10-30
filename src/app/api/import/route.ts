import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { runImport, type ColumnTarget } from "@/lib/excel/import";

export const maxDuration = 300;
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (!/\.(xlsx|xlsm|csv)$/i.test(file.name))
      return NextResponse.json({ error: "Unsupported file type. Upload .xlsx, .xlsm or .csv (save .xls files as .xlsx first)." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is larger than 25 MB" }, { status: 400 });

    const mode = form.get("mode") === "commit" ? "commit" : "preview";
    const sheet = (form.get("sheet") as string) || undefined;
    const headerRow = Number(form.get("headerRow")) || undefined;
    let overrides: Record<string, ColumnTarget> | undefined;
    const ov = form.get("overrides");
    if (typeof ov === "string" && ov) overrides = JSON.parse(ov);

    const result = await runImport({ buffer: await file.arrayBuffer(), fileName: file.name, sheet, headerRow, overrides, dryRun: mode === "preview", excelMode: form.get("excelMode") === "overwrite" ? "overwrite" : "respect_sources" });
    if (mode === "commit") revalidatePath("/", "layout");
    return NextResponse.json(result);
  } catch (e) {
    console.error("[import]", e);
    const msg = (e as Error).message;
    const friendly = /zip|central directory|signature/i.test(msg) ? "This file couldn't be read as Excel. Is it password-protected or corrupted?" : msg;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}

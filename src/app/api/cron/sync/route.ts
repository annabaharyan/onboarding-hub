import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { defaultSources, runSync } from "@/lib/sync";

export const maxDuration = 300;

/**
 * Daily sync endpoint. Called by Vercel Cron (vercel.json) or the self-hosted worker
 * (scripts/cron-worker.ts). Requires "Authorization: Bearer $CRON_SECRET".
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const report = await runSync(defaultSources(), "cron");
  if (report.locked) return NextResponse.json({ ok: false, message: "Another sync is already running" }, { status: 409 });
  revalidatePath("/", "layout");
  const failed = report.runs.filter((r) => r.status === "failed");
  return NextResponse.json(
    { ok: failed.length === 0, runs: report.runs.map((r) => ({ source: r.source, status: r.status, fetched: r.fetched, created: r.created, updated: r.updated, message: r.message })) },
    { status: failed.length && failed.length === report.runs.length ? 502 : 200 },
  );
}

export const GET = handle;
export const POST = handle;

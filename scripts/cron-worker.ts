/**
 * Self-hosted daily sync worker (use when not deploying on Vercel).
 * Calls the app's /api/cron/sync endpoint on CRON_SCHEDULE in CRON_TIMEZONE.
 *   npm run cron            → long-running scheduler
 *   npm run sync:once       → run one sync now (e.g. from system cron / k8s CronJob)
 */
import "dotenv/config";
import cron from "node-cron";

const url = `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/api/cron/sync`;
const schedule = process.env.CRON_SCHEDULE || "0 8 * * *";
const timezone = process.env.CRON_TIMEZONE || "Asia/Yerevan";

async function runOnce(): Promise<boolean> {
  const started = Date.now();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
      const body = await res.text();
      console.log(`[cron] ${new Date().toISOString()} status=${res.status} in ${Math.round((Date.now() - started) / 1000)}s ${body.slice(0, 1000)}`);
      if (res.status === 409) return true; // another sync running — fine
      if (res.ok) return true;
      if (res.status === 401) return false; // wrong secret — retrying won't help
    } catch (e) {
      console.error(`[cron] attempt ${attempt} failed:`, (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 60_000 * attempt));
  }
  return false;
}

if (process.argv.includes("--once")) {
  runOnce().then((ok) => process.exit(ok ? 0 : 1));
} else {
  if (!cron.validate(schedule)) throw new Error(`Invalid CRON_SCHEDULE: ${schedule}`);
  console.log(`[cron] scheduled "${schedule}" (${timezone}) → ${url}`);
  cron.schedule(schedule, () => void runOnce(), { timezone });
}

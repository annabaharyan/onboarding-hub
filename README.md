# Onboarding Hub

One place for headcount and onboarding data. It brings together the headcount Excel file, **Leapsome**, **Timebase**, **Jira** and **Claude**, keeps them in sync every morning, and lets HR, Finance, Payroll and HRBPs download exactly what they need as Excel.

Built with Next.js 16 (App Router, Cache Components), TypeScript, Tailwind CSS v4, PostgreSQL and Drizzle ORM.

---

## What it does

| Area | What you get |
|---|---|
| **Excel import** | Upload the existing headcount file. The header row is found automatically (title rows are skipped) and columns are matched to fields using common names (e.g. "Name Surname", "Hire date", "BU"). You see a **preview of every change before saving**. Month-end columns (31.12.2024, Dec 2024…) become **monthly headcount snapshots**. Unknown columns are **kept**, not dropped. The whole import is **all-or-nothing**: if something fails, nothing is saved. |
| **Excel export** | Filter by status, business unit, department, location, country, gender, source, start/end dates, or "headcount as of" a date. Choose the columns and sheets: Employees, Monthly headcount (pivot with totals), Summary by BU, Onboarding requests, Change log. |
| **Leapsome** | Pulls users through the REST API (SCIM response shapes are also understood) and keeps profile data current. |
| **Timebase** | Configurable REST adapter: location, country, rotation, rotation date. It only **enriches** existing people; it never creates them, so differently spelled entries can't create duplicates. |
| **Jira** | Reads onboarding tickets (JQL), takes details from custom fields **and** from "Label: value" lines in the description, checks required fields, adds complete requests as **pre-onboarding** employees, and (optionally) comments on the ticket listing what's missing. |
| **Claude** | Optional. Reads free-text tickets, extracts the new joiner's details, flags implausible values (past start date, weekend start, wrong domain…) and writes the reporter comment. A ticket is re-checked only when its content changes. |
| **Daily sync** | 08:00 Asia/Yerevan. Only one sync can run at a time (Postgres advisory lock). One failing source never stops the others. Every run is logged. |
| **Data quality** | Dashboard checks: missing email, BU, start date or country; end date passed but still active; offboarded without an end date; end date before start date; possible duplicates. Each check links to the matching people. |
| **Audit trail** | Every field change is recorded with old value → new value, source and time. |
| **Reminders** | Upcoming joiners, probation ending within 30 days, leavers within 30 days. |

## Data rules (how conflicts are resolved)

- **Field ownership.** Leapsome owns profile and organisation fields (name, email, title, department, BU, manager, status…). Timebase owns location, country and rotation. Jira only adds onboarding records. A source that doesn't own a field may only fill it when it's empty. See `SOURCE_OWNERSHIP` in `src/lib/fields.ts`.
- **Manual edits lock the field.** Editing a field in the app locks it so syncs won't overwrite it. You can unlock it again from the employee page.
- **Excel imports default to "Keep system data".** Re-uploading an old file can't revert fresher Leapsome/Timebase data; the file only fills gaps for people those systems manage. Choose **"File wins"** in the import screen to override.
- **Blank never erases.** Empty cells or missing API fields never clear existing data.
- **Matching order.** Leapsome ID → Timebase ID → Employee ID → email → name + start date. A match on name alone is only used when it's unique and the emails don't conflict.
- **Status lifecycle.** An HRIS "inactive" doesn't overwrite "offboarded". "Active" doesn't end "onboarding" while the person is still in probation.

## Getting started

```bash
cp .env.example .env            # fill in DATABASE_URL at minimum
docker compose up -d db         # or use your own Postgres 14+
npm install
npm run db:migrate
npm run dev                     # http://localhost:3000
```

Try it with a deliberately messy sample file: `npm run sample:excel`, then upload `samples/sample-headcount.xlsx` on **Import Excel**.

Or run everything (app + database + daily cron worker) in Docker:

```bash
cp .env.example .env && docker compose up --build
```

## Configuration

Everything is set through environment variables. See `.env.example`, where every variable is documented. Credentials stay on the server.

| Integration | Where to get it |
|---|---|
| Leapsome | Settings → Integrations and imports → API token → `LEAPSOME_API_TOKEN` |
| Jira Cloud | id.atlassian.com → Security → API tokens → `JIRA_EMAIL` + `JIRA_API_TOKEN`. Custom field IDs: Jira settings → Issues → Custom fields → `JIRA_FIELD_MAP` |
| Timebase | Base URL, key and response mapping from the Timebase team → `TIMEBASE_*` (use **Test connection**: it prints the keys of the first record so you can write `TIMEBASE_FIELD_MAP`) |
| Claude | console.anthropic.com → `ANTHROPIC_API_KEY` |

On the **Integrations** page, use **Test connection** for each system before the first sync.

## Daily sync (cron)

The sync endpoint is `POST /api/cron/sync` with `Authorization: Bearer $CRON_SECRET`.

- **Vercel:** `vercel.json` already schedules it at `0 4 * * *` UTC (08:00 Yerevan). Set `CRON_SECRET` in the project's environment variables; Vercel sends it automatically.
- **Docker / VM:** the `cron` service in `docker-compose.yml` runs `scripts/cron-worker.ts` on `CRON_SCHEDULE` in `CRON_TIMEZONE`, and retries if a run fails.
- **System cron / Kubernetes CronJob:** `npm run sync:once`.

## Security

- Set `APP_PASSWORD` and `AUTH_SECRET` before deploying. All pages and APIs (except `/api/cron`, which uses `CRON_SECRET`, and `/api/health`) require a signed session cookie. While the password is unset, the sidebar shows a warning.
- Personal data stays in your Postgres. Claude only receives ticket text when Claude validation is enabled.
- For SSO (Google/Microsoft), swap `src/proxy.ts` + `src/lib/auth.ts` for Auth.js. The rest of the app doesn't depend on how users sign in.

## Project layout

```
src/
  app/                    pages, server actions, API routes
    api/import            preview/commit Excel import
    api/export            filtered Excel export
    api/cron/sync         daily sync endpoint
  db/schema.ts            tables: employees, monthly_snapshots, employee_changes,
                          onboarding_requests, sync_runs, import_batches
  lib/
    employee-writer.ts    matching, field ownership, locks, audit trail (core rules)
    excel/import.ts       header detection, mapping, validation, snapshots
    excel/export.ts       workbook builder
    integrations/         leapsome, timebase, jira, claude
    sync.ts               orchestration + advisory lock
    insights.ts           dashboard + data-quality checks
scripts/cron-worker.ts    self-hosted scheduler
drizzle/                  SQL migrations
```

## Open items from the 29 Oct meeting

- **Timebase API** (Mariam / Anna). Once the endpoint is confirmed, set `TIMEBASE_BASE_URL` and `TIMEBASE_FIELD_MAP`. No code changes are needed.
- **Leapsome access** (Iryna → Illia). Needs an API token with user read access.
- **Jira template** (Mariam). Agree the required fields (`JIRA_REQUIRED_FIELDS`) and the onboarding JQL, then turn on `JIRA_COMMENT_ON_MISSING`.
- **Public holidays** are managed in Timebase, not in this app.

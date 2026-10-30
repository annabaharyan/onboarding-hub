import { cleanEmail, cleanText, getPath, parseDate, safeJson } from "../normalize";
import type { EmployeeField } from "../fields";
import type { Incoming } from "../employee-writer";
import { extractList, fetchJson } from "./http";
import { emptyCounts, tally, type Connector } from "./types";

/**
 * Timebase has no public API documentation, so this adapter is configuration-driven:
 * point TIMEBASE_BASE_URL / TIMEBASE_EMPLOYEES_PATH at the endpoint your account exposes
 * and describe the response shape with TIMEBASE_FIELD_MAP.
 */
const DEFAULT_MAP: Partial<Record<EmployeeField, string>> = {
  timebaseId: "id",
  email: "email",
  fullName: "name",
  location: "location",
  country: "country",
  rotation: "rotation",
  rotationDate: "rotationDate",
  startDate: "startDate",
  endDate: "endDate",
};

const env = () => ({
  base: (process.env.TIMEBASE_BASE_URL || "").replace(/\/$/, ""),
  key: process.env.TIMEBASE_API_KEY,
  style: process.env.TIMEBASE_AUTH_STYLE || "bearer",
  path: process.env.TIMEBASE_EMPLOYEES_PATH || "/employees",
  map: { ...DEFAULT_MAP, ...safeJson<Partial<Record<EmployeeField, string>>>(process.env.TIMEBASE_FIELD_MAP, {}) },
});

function headers(): Record<string, string> {
  const { key, style } = env();
  const h: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (key) {
    if (style === "x-api-key") h["X-API-Key"] = key;
    else h.Authorization = `Bearer ${key}`;
  }
  return h;
}

export function mapTimebaseRecord(r: unknown): Incoming {
  const { map } = env();
  const inc: Incoming = {};
  for (const [field, path] of Object.entries(map) as [EmployeeField, string][]) {
    const v = getPath(r, path);
    if (v === undefined || v === null) continue;
    if (/Date$/.test(field)) inc[field] = parseDate(v);
    else if (field === "email") inc.email = cleanEmail(v);
    else inc[field] = cleanText(v);
  }
  return inc;
}

export const timebase: Connector = {
  id: "timebase",
  label: "Timebase",
  description: "Working-time data: location, country, rotation and rotation dates. Enriches existing employees only.",
  envVars: ["TIMEBASE_BASE_URL", "TIMEBASE_API_KEY", "TIMEBASE_EMPLOYEES_PATH", "TIMEBASE_FIELD_MAP"],
  missingConfig() {
    const e = env();
    return [!e.base && "TIMEBASE_BASE_URL", !e.key && "TIMEBASE_API_KEY"].filter(Boolean) as string[];
  },
  async test() {
    const { base, path } = env();
    const json = await fetchJson(`${base}${path}`, { headers: headers(), retries: 0 });
    const list = extractList(json);
    return `Connected — ${list.length} record(s) returned. Keys of first record: ${list[0] ? Object.keys(list[0] as object).slice(0, 12).join(", ") : "n/a"}`;
  },
  async sync({ writer, runId }) {
    const { base, path } = env();
    const c = emptyCounts();
    let url: string | null = `${base}${path}`;
    let guard = 0;
    const unmatched: string[] = [];
    while (url && guard++ < 500) {
      const json: unknown = await fetchJson(url, { headers: headers() });
      const list = extractList(json);
      for (const r of list) {
        c.fetched++;
        const inc = mapTimebaseRecord(r);
        if (!inc.email && !inc.timebaseId && !inc.fullName) {
          c.skipped++;
          continue;
        }
        // Timebase enriches; it never creates employees (prevents duplicates from spelling differences)
        const res = await writer.apply(inc, { source: "timebase", syncRunId: runId, createIfMissing: false });
        if (res.result === "skipped") {
          c.skipped++;
          unmatched.push(inc.email ?? inc.fullName ?? inc.timebaseId ?? "?");
        } else tally(c, res, inc.email ?? inc.fullName ?? "record");
      }
      const next = getPath(json, "next") ?? getPath(json, "links.next") ?? getPath(json, "meta.next");
      url = typeof next === "string" && next ? (next.startsWith("http") ? next : `${base}${next}`) : null;
    }
    if (unmatched.length)
      c.message = `${unmatched.length} Timebase record(s) not in the headcount: ${unmatched.slice(0, 10).join(", ")}${unmatched.length > 10 ? "…" : ""}`;
    return c;
  },
};

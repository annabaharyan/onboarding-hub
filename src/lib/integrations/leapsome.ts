import { cleanEmail, cleanText, getPath, parseDate, parseGender, parseStatus } from "../normalize";
import type { Incoming } from "../employee-writer";
import { extractList, fetchJson } from "./http";
import { emptyCounts, tally, type Connector } from "./types";

const env = () => ({
  token: process.env.LEAPSOME_API_TOKEN,
  base: (process.env.LEAPSOME_BASE_URL || "https://api.leapsome.com/v1").replace(/\/$/, ""),
  path: process.env.LEAPSOME_USERS_PATH || "/users",
  pageSize: Number(process.env.LEAPSOME_PAGE_SIZE || 100),
});

const first = (o: unknown, ...paths: string[]) => {
  for (const p of paths) {
    const v = getPath(o, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
};

/** Maps a Leapsome user (REST or SCIM shape) to our normalised record. */
export function mapLeapsomeUser(u: unknown): Incoming {
  const emails = getPath(u, "emails");
  const scimEmail = Array.isArray(emails) ? (emails.find((e) => e?.primary) ?? emails[0])?.value : null;
  const activeFlag = first(u, "active", "isActive");
  const statusRaw = first(u, "status", "employmentStatus", "state");
  let status = parseStatus(statusRaw);
  if (!status && typeof activeFlag === "boolean") status = activeFlag ? "active" : "inactive";
  const ent = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
  const customs = (first(u, "customAttributes", "custom_attributes", "attributes") ?? {}) as Record<string, unknown>;
  const extra: Record<string, unknown> = {};
  if (customs && typeof customs === "object" && !Array.isArray(customs))
    for (const [k, v] of Object.entries(customs)) if (v !== null && typeof v !== "object") extra[`Leapsome: ${k}`] = v;

  return {
    leapsomeId: cleanText(first(u, "id", "userId", "_id")),
    email: cleanEmail(first(u, "email", "workEmail", "userName") ?? scimEmail),
    firstName: cleanText(first(u, "firstName", "first_name", "name.givenName")),
    lastName: cleanText(first(u, "lastName", "last_name", "name.familyName")),
    fullName: cleanText(first(u, "displayName", "fullName", "name.formatted", "name")) ?? undefined,
    gender: parseGender(first(u, "gender")),
    jobTitle: cleanText(first(u, "jobTitle", "position", "title")),
    department: cleanText(first(u, "department", "department.name", "team.name", `${ent}.department`)),
    businessUnit: cleanText(first(u, "businessUnit", "division", `${ent}.division`, "customAttributes.Business Unit", "customAttributes.businessUnit")),
    manager: cleanText(first(u, "manager.email", "manager.name", "managerEmail", `${ent}.manager.displayName`, `${ent}.manager.value`)),
    preferredFullName: cleanText(first(u, "preferredFullName", "preferred_full_name", "nickName")),
    team: cleanText(first(u, "team", "team.name", "primaryTeam") ?? (Array.isArray(getPath(u, "teams")) ? (getPath(u, "teams") as { name?: string }[])[0]?.name : null)),
    legalEntity: cleanText(first(u, "legalEntity", "company", `${ent}.organization`)),
    employmentType: cleanText(first(u, "employmentType", "contractType", `${ent}.employeeType`)),
    employeeCode: cleanText(first(u, "employeeId", "employeeNumber", `${ent}.employeeNumber`)),
    startDate: parseDate(first(u, "startDate", "hireDate", "startedAt", "start_date")),
    endDate: parseDate(first(u, "endDate", "terminationDate", "end_date")),
    status,
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

async function* pages() {
  const { token, base, path, pageSize } = env();
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  let url: string | null = `${base}${path}?limit=${pageSize}&page=1&startIndex=1&count=${pageSize}`;
  let page = 1;
  let prevFirst: string | null = null;
  while (url && page <= 500) {
    const json: unknown = await fetchJson(url, { headers });
    const list = extractList(json);
    const firstId = list.length ? JSON.stringify(getPath(list[0], "id")) : null;
    if (!list.length || firstId === prevFirst) return; // API ignored paging → stop
    yield list;
    prevFirst = firstId;
    const next = first(json, "next", "links.next", "meta.next", "nextPage", "paging.next");
    const cursor = first(json, "nextCursor", "meta.nextCursor", "cursor.next");
    if (typeof next === "string" && next.startsWith("http")) url = next;
    else if (typeof cursor === "string") url = `${base}${path}?limit=${pageSize}&cursor=${encodeURIComponent(cursor)}`;
    else if (list.length < pageSize) return;
    else {
      page++;
      url = `${base}${path}?limit=${pageSize}&page=${page}&startIndex=${(page - 1) * pageSize + 1}&count=${pageSize}`;
    }
  }
}

export const leapsome: Connector = {
  id: "leapsome",
  label: "Leapsome",
  description: "HRIS profile data: names, emails, job titles, departments, managers, employment status.",
  envVars: ["LEAPSOME_API_TOKEN", "LEAPSOME_BASE_URL", "LEAPSOME_USERS_PATH"],
  missingConfig: () => (env().token ? [] : ["LEAPSOME_API_TOKEN"]),
  async test() {
    const { token, base, path } = env();
    const json = await fetchJson(`${base}${path}?limit=1&count=1`, { headers: { Authorization: `Bearer ${token}` }, retries: 0 });
    return `Connected — sample returned ${extractList(json).length} user(s).`;
  },
  async sync({ writer, runId }) {
    const c = emptyCounts();
    for await (const list of pages()) {
      for (const u of list) {
        c.fetched++;
        try {
          const inc = mapLeapsomeUser(u);
          if (!inc.email && !inc.leapsomeId) {
            c.skipped++;
            continue;
          }
          tally(c, await writer.apply(inc, { source: "leapsome", syncRunId: runId }), inc.email ?? inc.leapsomeId ?? "user");
        } catch (e) {
          c.skipped++;
          c.errors.push(`Leapsome user ${getPath(u, "id")}: ${(e as Error).message}`);
        }
      }
    }
    return c;
  },
};

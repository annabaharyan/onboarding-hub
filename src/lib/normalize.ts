import type { Status } from "./fields";

export function normHeader(h: unknown): string {
  return String(h ?? "")
    .toLowerCase()
    .replace(/[_\-./\\()[\]:#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v !== null) {
    // ExcelJS rich text / hyperlink / formula cells
    const o = v as Record<string, unknown>;
    if ("text" in o) return cleanText(o.text);
    if ("result" in o) return cleanText(o.result);
    if ("richText" in o && Array.isArray(o.richText))
      return cleanText((o.richText as { text: string }[]).map((r) => r.text).join(""));
    if (v instanceof Date) return v.toISOString();
  }
  const s = String(v).replace(/\s+/g, " ").trim();
  if (!s || ["-", "—", "n/a", "na", "null", "none", "#n/a"].includes(s.toLowerCase())) return null;
  return s;
}

export function cleanEmail(v: unknown): string | null {
  const s = cleanText(v);
  if (!s) return null;
  const m = s.toLowerCase().replace(/^mailto:/, "").match(/[^\s<>"',;]+@[^\s<>"',;]+\.[a-z]{2,}/);
  return m ? m[0] : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};

/** Parses Excel serials, Date objects and common string formats into YYYY-MM-DD. Day-first for ambiguous dates (EU convention). */
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    // ExcelJS returns dates as UTC midnight
    return iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  if (typeof v === "object") return parseDate(cleanText(v));
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) return parseDate(Number(s));
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const a = +m[1], b = +m[2];
    // If the second part can't be a month, it's US style (MM/DD/YYYY)
    if (b > 12 && a <= 12) return iso(y, a, b);
    return iso(y, b, a);
  }
  const t = Date.parse(s);
  if (!isNaN(t) && /[a-z]/i.test(s)) {
    const d = new Date(t);
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}

/** Last day of the month for a given date string. */
export function monthEnd(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

const STATUS_WORDS: [RegExp, Status][] = [
  [/pre[\s-]?onboard|pre[\s-]?hire|offer accepted|signed/i, "pre_onboarding"],
  [/offboarded|terminat|\bleft\b|former|\bexit(ed)?\b|\bended\b/i, "offboarded"],
  [/offboard|notice|leaving|resign/i, "offboarding"],
  [/onboard|new hire|joining|probation/i, "onboarding"],
  [/leave|maternity|paternity|parental|sabbatical|sick/i, "on_leave"],
  [/inactive|deactivat|disabled|suspend/i, "inactive"],
  [/active|current|employed|working|yes|^1$/i, "active"],
];

export function parseStatus(v: unknown): Status | null {
  const s = cleanText(v);
  if (!s) return null;
  const k = s.toLowerCase().replace(/\s+/g, "_");
  if (["pre_onboarding", "onboarding", "active", "on_leave", "offboarding", "offboarded", "inactive"].includes(k))
    return k as Status;
  for (const [re, st] of STATUS_WORDS) if (re.test(s)) return st;
  return null;
}

export function parseGender(v: unknown): string | null {
  const s = cleanText(v);
  if (!s) return null;
  const l = s.toLowerCase();
  if (["m", "male", "man", "м"].includes(l)) return "Male";
  if (["f", "female", "woman", "ж", "w"].includes(l)) return "Female";
  return s;
}

let regionCache: Map<string, string> | null = null;
/** Country name → ISO-3166 alpha-2, built from Intl so no hardcoded list is needed. */
export function countryToCode(country: string | null | undefined): string | null {
  if (!country) return null;
  const c = country.trim();
  if (/^[A-Za-z]{2}$/.test(c)) return c.toUpperCase();
  if (!regionCache) {
    regionCache = new Map();
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a <= 90; a++)
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        try {
          const name = dn.of(code);
          if (name && name !== code) regionCache.set(name.toLowerCase(), code);
        } catch {}
      }
    const aliases: Record<string, string> = {
      usa: "US", "united states of america": "US", uk: "GB", england: "GB", "great britain": "GB",
      russia: "RU", "czech republic": "CZ", turkey: "TR", "south korea": "KR", uae: "AE",
      holland: "NL", moldova: "MD", "north macedonia": "MK", macedonia: "MK",
    };
    for (const [k, v] of Object.entries(aliases)) regionCache.set(k, v);
  }
  return regionCache.get(c.toLowerCase()) ?? null;
}

export function splitName(full: string | null): { firstName: string | null; lastName: string | null } {
  if (!full) return { firstName: null, lastName: null };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

export function safeJson<T>(s: string | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

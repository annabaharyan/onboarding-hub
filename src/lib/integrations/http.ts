export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: string) {
    super(message);
  }
}

/** JSON fetch with timeout and retry/backoff on 429 and 5xx (respects Retry-After). */
export async function fetchJson<T = unknown>(url: string, init: RequestInit & { retries?: number; timeoutMs?: number } = {}): Promise<T> {
  const { retries = 3, timeoutMs = 30_000, ...rest } = init;
  let attempt = 0;
  for (;;) {
    let res: Response;
    try {
      res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
    } catch (e) {
      if (attempt++ < retries) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new Error(`Network error calling ${new URL(url).host}: ${(e as Error).message}`);
    }
    if (res.ok) {
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    if ((res.status === 429 || res.status >= 500) && attempt++ < retries) {
      const ra = Number(res.headers.get("retry-after"));
      await sleep(ra > 0 ? Math.min(ra, 60) * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    const body = await res.text().catch(() => "");
    const hint =
      res.status === 401 ? " (check the API token)" : res.status === 403 ? " (token lacks permission)" : res.status === 404 ? " (check the base URL / path)" : "";
    throw new HttpError(res.status, `${new URL(url).host} responded ${res.status}${hint}: ${body.slice(0, 300)}`, body);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Extracts the record array from common API envelope shapes. */
export function extractList(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of ["data", "users", "employees", "items", "results", "Resources", "records", "values", "issues"]) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
      if (o[k] && typeof o[k] === "object") {
        const inner = extractList(o[k]);
        if (inner.length) return inner;
      }
    }
  }
  return [];
}

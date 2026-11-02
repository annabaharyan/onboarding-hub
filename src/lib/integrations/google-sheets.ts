import { createSign } from "node:crypto";
import { fetchJson } from "./http";

/**
 * Reads the climate-survey response Sheet using a Google service account (JWT Bearer flow —
 * no googleapis dependency needed, just a signed JWT exchanged for an access token).
 * The Sheet must be shared with the service account's email as a Viewer.
 */

const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const env = () => ({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
  // Private keys from env vars commonly arrive with literal \n instead of real newlines.
  privateKey: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  sheetId: process.env.CLIMATE_SURVEY_SHEET_ID || "",
  range: process.env.CLIMATE_SURVEY_SHEET_RANGE || "A:ZZ",
});

export function missingConfig(): string[] {
  const e = env();
  return [!e.email && "GOOGLE_SERVICE_ACCOUNT_EMAIL", !e.privateKey && "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", !e.sheetId && "CLIMATE_SURVEY_SHEET_ID"].filter(
    Boolean,
  ) as string[];
}

function base64url(input: Buffer | string): string {
  return (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signedJwt(email: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = { iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey);
  return `${unsigned}.${base64url(signature)}`;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  const { email, privateKey } = env();
  const assertion = signedJwt(email, privateKey);
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
  const res = await fetchJson<{ access_token: string; expires_in: number }>(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    retries: 1,
  });
  cachedToken = { token: res.access_token, expiresAt: Date.now() + res.expires_in * 1000 };
  return cachedToken.token;
}

/** Raw rows (values[0] is the header row) from the configured Sheet range. */
export async function fetchSheetRows(): Promise<string[][]> {
  const { sheetId, range } = env();
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const res = await fetchJson<{ values?: string[][] }>(url, { headers: { Authorization: `Bearer ${token}` } });
  return res.values ?? [];
}

export async function testConnection(): Promise<string> {
  const rows = await fetchSheetRows();
  const headers = rows[0] ?? [];
  return `Connected — ${Math.max(0, rows.length - 1)} response row(s). Columns: ${headers.slice(0, 8).join(", ")}${headers.length > 8 ? "…" : ""}`;
}

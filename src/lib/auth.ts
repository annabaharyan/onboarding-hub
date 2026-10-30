// Edge/Node-safe (Web Crypto only) — used from proxy.ts and server actions.
export const SESSION_COOKIE = "ohub_session";
const MAX_AGE_S = 60 * 60 * 24 * 14;

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(data: string) {
  const secret = process.env.AUTH_SECRET || process.env.APP_PASSWORD || "dev";
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export const authEnabled = () => Boolean(process.env.APP_PASSWORD);

export async function createSessionToken() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
  return `${exp}.${await hmac(String(exp))}`;
}

export async function verifySessionToken(token: string | undefined) {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = await hmac(exp);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function passwordMatches(input: string) {
  const a = await hmac(`pw:${input}`);
  const b = await hmac(`pw:${process.env.APP_PASSWORD ?? ""}`);
  return a === b;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_S,
};

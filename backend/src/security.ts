import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config";
import { pool } from "./db/pool";

export const SESSION_COOKIE = "asoc.sid";
export const CSRF_COOKIE = "asoc.csrf";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type ParsedCookies = Record<string, string>;

export function parseCookies(header: string | undefined): ParsedCookies {
  const out: ParsedCookies = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function sessionSecret(): string {
  return process.env.SESSION_SECRET || config.webhookSecret || "change-me";
}

function sign(value: string): string {
  const mac = createHmac("sha256", sessionSecret()).update(value).digest("hex");
  return `${value}.${mac}`;
}

function unsign(raw: string | undefined): string | null {
  if (!raw || !raw.includes(".")) return null;
  const idx = raw.lastIndexOf(".");
  const value = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  const expected = createHmac("sha256", sessionSecret()).update(value).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? value : null;
}

export function cookiePolicy() {
  const secure = config.production;
  return {
    cookies: [
      {
        name: SESSION_COOKIE,
        httpOnly: true,
        secure,
        sameSite: "lax" as const,
        path: "/",
        maxAgeSeconds: SESSION_TTL_MS / 1000,
        purpose: "Signed browser session. Server-only. Not readable by JavaScript.",
      },
      {
        name: CSRF_COOKIE,
        httpOnly: false,
        secure,
        sameSite: "lax" as const,
        path: "/",
        maxAgeSeconds: SESSION_TTL_MS / 1000,
        purpose: "Double-submit CSRF token. Frontend sends it as x-csrf-token.",
      },
    ],
    headers: [
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Cross-Origin-Opener-Policy",
    ],
    csrfHeader: "x-csrf-token",
    sameSite: "lax",
    webhookExempt: true,
  };
}

export function securityHeaders(): Record<string, string> {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "connect-src 'self' https://polygon-rpc.com https://*.vercel.app",
  ].join("; ");
  const headers: Record<string, string> = {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(self), geolocation=(self)",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-Cookie-Policy": "asoc.sid HttpOnly; asoc.csrf SameSite=Lax",
  };
  if (config.production) {
    headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload";
  }
  return headers;
}

function serializeCookie(
  name: string,
  value: string,
  opts: { httpOnly: boolean; maxAge: number },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${opts.maxAge}`,
  ];
  if (opts.httpOnly) parts.push("HttpOnly");
  if (config.production) parts.push("Secure");
  return parts.join("; ");
}

export function isCsrfExempt(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const path = req.path || req.url.split("?")[0];
  if (path.startsWith("/api/webhook")) return true;
  if (path.startsWith("/api/twilio")) return true;
  // Server-to-server alert dispatch is authenticated with x-webhook-secret.
  if (path === "/api/notifications/alert") return true;
  if (path.startsWith("/api/security/")) return true;
  return false;
}

function ipHash(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || "";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

async function persistSession(sessionId: string, csrf: string, req: Request): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO security_sessions (session_id, csrf_token, ip_hash, user_agent, expires_at)
       VALUES ($1,$2,$3,$4, now() + interval '12 hours')
       ON CONFLICT (session_id) DO UPDATE SET
         csrf_token = $2,
         last_seen = now(),
         ip_hash = $3,
         user_agent = $4,
         expires_at = now() + interval '12 hours'`,
      [sessionId, csrf, ipHash(req), String(req.headers["user-agent"] ?? "").slice(0, 180)],
    );
  } catch {
    // Postgres may be down; cookies still protect the browser.
  }
}

export function applySecurity(req: Request, res: Response, next: NextFunction): void {
  for (const [key, value] of Object.entries(securityHeaders())) {
    res.setHeader(key, value);
  }

  const cookies = parseCookies(req.headers.cookie);
  (req as Request & { cookies: ParsedCookies }).cookies = cookies;

  let sessionId = unsign(cookies[SESSION_COOKIE]);
  let csrf = cookies[CSRF_COOKIE];
  if (!sessionId || !csrf) {
    sessionId = randomBytes(16).toString("hex");
    csrf = randomBytes(16).toString("hex");
  }

  const sidCookie = serializeCookie(SESSION_COOKIE, sign(sessionId), {
    httpOnly: true,
    maxAge: SESSION_TTL_MS / 1000,
  });
  const csrfCookie = serializeCookie(CSRF_COOKIE, csrf, {
    httpOnly: false,
    maxAge: SESSION_TTL_MS / 1000,
  });
  res.setHeader("Set-Cookie", [sidCookie, csrfCookie]);
  (req as Request & { asocSession: string; asocCsrf: string }).asocSession = sessionId;
  (req as Request & { asocCsrf: string }).asocCsrf = csrf;

  void persistSession(sessionId, csrf, req);

  if (!isCsrfExempt(req)) {
    const header = String(req.headers["x-csrf-token"] ?? "");
    const cookieToken = csrf;
    const a = Buffer.from(header);
    const b = Buffer.from(cookieToken);
    if (!header || a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(403).json({ error: "csrf" });
      return;
    }
  }
  next();
}

export function allowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  return (
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.endsWith(".vercel.app") ||
    origin === "https://www.americashipsonclick.com" ||
    origin === "https://americashipsonclick.com"
  );
}

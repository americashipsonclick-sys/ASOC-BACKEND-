import { expect } from "chai";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  cookiePolicy,
  isCsrfExempt,
  parseCookies,
  securityHeaders,
  SESSION_COOKIE,
  CSRF_COOKIE,
} from "../backend/src/security";
import app from "../backend/src/index";

describe("cookie and security policy", () => {
  it("parses Cookie headers", () => {
    const cookies = parseCookies("asoc.sid=abc; asoc.csrf=xyz");
    expect(cookies[SESSION_COOKIE]).to.equal("abc");
    expect(cookies[CSRF_COOKIE]).to.equal("xyz");
  });

  it("exempts webhooks and safe methods from CSRF", () => {
    expect(isCsrfExempt({ method: "GET", path: "/api/loads", url: "/api/loads" } as never)).to.equal(true);
    expect(isCsrfExempt({ method: "POST", path: "/api/webhook/ASOC", url: "/api/webhook/ASOC" } as never)).to.equal(
      true,
    );
    expect(isCsrfExempt({ method: "POST", path: "/api/loads/1/accept", url: "/api/loads/1/accept" } as never)).to.equal(
      false,
    );
  });

  it("advertises HttpOnly session and SameSite=Lax CSRF cookies", () => {
    const policy = cookiePolicy();
    const session = policy.cookies.find((c) => c.name === SESSION_COOKIE);
    const csrf = policy.cookies.find((c) => c.name === CSRF_COOKIE);
    expect(session?.httpOnly).to.equal(true);
    expect(session?.sameSite).to.equal("lax");
    expect(csrf?.httpOnly).to.equal(false);
    expect(csrf?.sameSite).to.equal("lax");
    expect(securityHeaders()["X-Frame-Options"]).to.equal("DENY");
    expect(securityHeaders()["Content-Security-Policy"]).to.match(/frame-ancestors 'none'/);
  });

  it("sets security cookies on /health and rejects POSTs without CSRF", async () => {
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).to.equal(200);
      const body = (await health.json()) as { ok: boolean; green: boolean };
      expect(body.ok).to.equal(true);
      expect(body.green).to.equal(true);
      const setCookie = health.headers.getSetCookie?.() ?? [];
      expect(setCookie.some((c) => c.startsWith(`${SESSION_COOKIE}=`) && c.includes("HttpOnly"))).to.equal(true);
      expect(setCookie.some((c) => c.startsWith(`${CSRF_COOKIE}=`) && c.includes("SameSite=Lax"))).to.equal(true);

      const blocked = await fetch(`http://127.0.0.1:${port}/api/loads/x/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ driverId: "drv" }),
      });
      expect(blocked.status).to.equal(403);
      const err = (await blocked.json()) as { error: string };
      expect(err.error).to.equal("csrf");

      const session = await fetch(`http://127.0.0.1:${port}/api/security/session`);
      const data = (await session.json()) as { csrf: string };
      expect(data.csrf).to.be.a("string").and.not.equal("");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
  });
});

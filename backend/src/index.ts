import path from "node:path";
import express from "express";
import cors from "cors";
import { config } from "./config";
import { migrate } from "./db/pool";
import {
  dispatch,
  listLoads,
  listAvailableLoads,
  isAvailableLoadStatus,
  listVoiceActions,
  listAudit,
  acceptLoad,
} from "./dispatch";
import { verifySharedSecret, verifyAlchemySignature, alchemyTokenBalances } from "./alchemy";
import { bus } from "./events";
import { startCoinstallCron, coinstallCheck } from "./cron";
import { upsertDriverProfile, claimByToken, claimByReply } from "./notify";
import { readDriverBalances } from "./chain";
import { writeFileSync, mkdirSync } from "node:fs";
import { healthPayload } from "./health";
import { allowedOrigin, applySecurity, cookiePolicy } from "./security";

type RawReq = express.Request & { rawBody?: string };

const app = express();
app.set("trust proxy", 1);
app.use(applySecurity);
app.use(
  cors({
    origin: (origin, cb) => {
      cb(null, allowedOrigin(origin));
    },
    credentials: true,
  }),
);
const repoRoot = path.join(__dirname, "..", "..");
app.use(express.static(path.join(repoRoot, "frontend")));
app.use("/uploads", express.static(path.join(repoRoot, "uploads")));
app.use(express.urlencoded({ extended: false }));
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as RawReq).rawBody = buf.toString("utf8");
    },
  }),
);

function secretFrom(req: express.Request): string | undefined {
  const header = req.headers["x-webhook-secret"];
  if (typeof header === "string") return header;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return undefined;
}

function eventType(body: Record<string, unknown>): string {
  const event = body.event as { activity?: unknown } | undefined;
  if (event && Array.isArray(event.activity)) return "alchemy";
  return String(body.type ?? body.kind ?? "unknown");
}

async function webhookHandler(req: express.Request, res: express.Response) {
  const raw = (req as RawReq).rawBody ?? JSON.stringify(req.body ?? {});
  const body = (req.body ?? {}) as Record<string, unknown>;
  const type = eventType(body);
  const alchemySig = req.headers["x-alchemy-signature"];
  const secretOk = verifySharedSecret(secretFrom(req));
  const alchemyOk = typeof alchemySig === "string" && verifyAlchemySignature(raw, alchemySig);
  const authorized = type === "alchemy" ? secretOk || alchemyOk : secretOk;
  if (!authorized) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const result = await dispatch(type, body);
    res.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "dispatch failed";
    res.status(400).json({ error: message });
  }
}

app.post("/api/webhook/ASOC", webhookHandler);
app.post("/api/webhook/asoc", webhookHandler);

app.get("/api/loads", async (_req, res) => {
  const loads = await listLoads();
  res.json({ source: "postgres", loads });
});

app.get("/api/loads/available", async (_req, res) => {
  const loads = await listAvailableLoads();
  res.json({ source: "postgres", loads });
});

app.post("/api/loads/:loadId/accept", async (req, res) => {
  try {
    const inputMethod = req.body?.inputMethod === "voice" ? "voice" : "tap";
    const driverId = String(req.body?.driverId ?? "");
    const transcript = req.body?.transcript ? String(req.body.transcript) : undefined;
    if (inputMethod === "voice") {
      const result = (await dispatch("voice.command", {
        loadId: req.params.loadId,
        driverId,
        transcript: transcript ?? "accept this load",
      })) as { intent: string };
      if (result.intent !== "accept") {
        res.status(400).json({ error: "voice command was not an accept", result });
        return;
      }
      res.json({ ok: true, result });
      return;
    }
    const load = await acceptLoad({
      loadId: req.params.loadId,
      driverId,
      inputMethod: "tap",
      driverWallet: req.body?.driverWallet ? String(req.body.driverWallet) : undefined,
    });
    res.json({ ok: true, result: load });
  } catch (err) {
    const message = err instanceof Error ? err.message : "accept failed";
    res.status(400).json({ error: message });
  }
});

app.get("/api/voice/actions", async (_req, res) => {
  const actions = await listVoiceActions();
  res.json({ source: "postgres", actions });
});

app.get("/api/audit", async (_req, res) => {
  const logs = await listAudit();
  res.json({ source: "postgres", logs });
});

app.get("/api/loads/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  try {
    const loads = await listLoads();
    res.write(`event: snapshot\ndata: ${JSON.stringify(loads)}\n\n`);
  } catch (err) {
    res.write(`event: snapshot\ndata: []\n\n`);
    console.warn("load stream snapshot skipped", err instanceof Error ? err.message : err);
  }
  const onLoad = (load: unknown) => {
    res.write(`event: load\ndata: ${JSON.stringify(load)}\n\n`);
  };
  bus.on("load", onLoad);
  req.on("close", () => bus.off("load", onLoad));
});

app.get("/api/loads/available/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  try {
    const loads = await listAvailableLoads();
    res.write(`event: snapshot\ndata: ${JSON.stringify(loads)}\n\n`);
  } catch (err) {
    res.write(`event: snapshot\ndata: []\n\n`);
    console.warn("available stream snapshot skipped", err instanceof Error ? err.message : err);
  }
  const onLoad = (load: Record<string, unknown>) => {
    if (isAvailableLoadStatus(load.status)) {
      res.write(`event: load\ndata: ${JSON.stringify(load)}\n\n`);
      return;
    }
    res.write(`event: remove\ndata: ${JSON.stringify({ loadId: load.load_id })}\n\n`);
  };
  bus.on("load", onLoad);
  req.on("close", () => bus.off("load", onLoad));
});

app.get("/api/token/:address", async (req, res) => {
  const snap = await alchemyTokenBalances(req.params.address);
  res.json(snap ?? { error: "alchemy not configured" });
});

app.post("/api/admin/coinstall", async (req, res) => {
  if (!verifySharedSecret(secretFrom(req))) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const summary = await coinstallCheck();
  res.json({ ok: true, summary });
});

app.post("/api/loads/:loadId/proof", async (req, res) => {
  try {
    const result = await dispatch("load.proof", {
      ...(req.body ?? {}),
      loadId: req.params.loadId,
    });
    res.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "proof failed";
    res.status(400).json({ error: message });
  }
});

app.post("/api/admin/loads/:loadId/approve", async (req, res) => {
  if (!verifySharedSecret(secretFrom(req))) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (config.production) {
    res.status(403).json({ error: "production is locked until Nishant green-lights" });
    return;
  }
  try {
    const result = await dispatch("load.approve", {
      ...(req.body ?? {}),
      loadId: req.params.loadId,
      approvedBy: "manual",
    });
    res.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "approve failed";
    res.status(400).json({ error: message });
  }
});

app.post("/api/uploads", (req, res) => {
  try {
    const dataUrl = String(req.body?.dataUrl ?? "");
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0+.-]+);base64,(.+)$/);
    if (!match) {
      res.status(400).json({ error: "dataUrl image required" });
      return;
    }
    const ext = match[1].includes("png") ? "png" : match[1].includes("webp") ? "webp" : "jpg";
    const rawName = String(req.body?.name ?? `proof-${Date.now()}.${ext}`);
    const safe = rawName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const dir = path.join(repoRoot, "uploads");
    mkdirSync(dir, { recursive: true });
    const file = safe.endsWith(`.${ext}`) ? safe : `${safe}.${ext}`;
    writeFileSync(path.join(dir, file), Buffer.from(match[2], "base64"));
    res.json({ ok: true, url: `/uploads/${file}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "upload failed";
    res.status(400).json({ error: message });
  }
});

app.get("/api/e2e/board", async (req, res) => {
  const loadId = String(req.query.loadId ?? "");
  const wallet = String(req.query.wallet ?? config.testDriverWallet);
  let load = null;
  if (loadId) {
    const loads = await listLoads();
    load = loads.find((row: { load_id?: string }) => row.load_id === loadId) ?? null;
  }
  let chain = null;
  try {
    chain = wallet ? await readDriverBalances(wallet) : null;
  } catch (err) {
    chain = { error: err instanceof Error ? err.message : "chain read failed" };
  }
  res.json({
    load,
    chain,
    production: config.production,
    dryRun: config.dryRun,
    polygonRpc: config.polygonRpc,
    usdcAddress: config.usdcAddress,
    asocAddress: config.asocAddress,
    driverPayoutAddress: config.driverPayoutAddress,
  });
});

app.get("/api/phase1", (_req, res) => {
  res.json({
    phase: 1,
    chainId: 137,
    asocAddress: config.asocAddress || null,
    polygonRpc: config.polygonRpc,
    payoutChain: config.payoutChain,
    dryRun: config.dryRun,
    production: config.production,
    proof: "mint, stake, claimBonus — plate logging and email are phase 2",
  });
});

app.post("/api/drivers", async (req, res) => {
  try {
    const driver = await upsertDriverProfile(req.body ?? {});
    res.json({ ok: true, driver });
  } catch (err) {
    const message = err instanceof Error ? err.message : "driver save failed";
    res.status(400).json({ error: message });
  }
});

app.get("/l/:token", async (req, res) => {
  try {
    const load = await claimByToken(req.params.token);
    res.type("html").send(
      `<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:24px">` +
        `<h1>Load claimed</h1><p>${load.load_id} is yours. Drive.</p></body>`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "claim failed";
    res.status(400).type("html").send(
      `<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:24px">` +
        `<h1>Could not claim</h1><p>${message}</p></body>`,
    );
  }
});

function twiml(message: string): string {
  const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}

app.post("/api/twilio/sms", async (req, res) => {
  try {
    const from = String(req.body?.From ?? "");
    const body = String(req.body?.Body ?? "");
    const result = await claimByReply(from, body);
    const msg = result.claimed
      ? `ASOC: load ${(result.load as { load_id?: string }).load_id} is yours.`
      : "ASOC: reply YES to claim the last load we texted you.";
    res.type("text/xml").send(twiml(msg));
  } catch (err) {
    const message = err instanceof Error ? err.message : "claim failed";
    res.type("text/xml").send(twiml(`ASOC: ${message}`));
  }
});

app.get("/api/security/policy", (_req, res) => {
  res.json({ ok: true, policy: cookiePolicy() });
});

app.get("/api/security/session", (req, res) => {
  const csrf = (req as express.Request & { asocCsrf?: string }).asocCsrf || "";
  res.json({
    ok: true,
    csrf,
    cookies: cookiePolicy().cookies,
    csrfHeader: "x-csrf-token",
  });
});

app.get("/health", (_req, res) => {
  res.json(healthPayload());
});

app.get("/api/health", (_req, res) => {
  res.json(healthPayload());
});

app.get("/feed", (_req, res) => {
  res.sendFile(path.join(repoRoot, "frontend", "feed.html"));
});

async function main() {
  const dbLooksLocal = /localhost|127\.0\.0\.1/.test(config.databaseUrl);
  if (!(process.env.VERCEL && dbLooksLocal)) {
    try {
      await migrate();
    } catch (err) {
      console.warn(
        "Postgres is down — serving the chain UI anyway.",
        err instanceof Error ? err.message : err,
      );
    }
  }
  if (!process.env.VERCEL) {
    try {
      startCoinstallCron();
    } catch (err) {
      console.warn("coinstall cron skipped", err instanceof Error ? err.message : err);
    }
    app.listen(config.port, () => {
      console.log(`ASOC API on :${config.port}  feed /feed  chain /chain.html  embed /embed.html`);
    });
  }
}

export default app;

if (!process.env.VERCEL && require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

import cron from "node-cron";
import { config } from "./config";
import { pool, insertRun, audit } from "./db/pool";

async function ping(url: string): Promise<{ status: string; detail: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return { status: res.ok ? "ok" : `http_${res.status}`, detail: `${res.status}` };
  } catch (err) {
    return { status: "down", detail: err instanceof Error ? err.message : "error" };
  } finally {
    clearTimeout(timer);
  }
}

export async function coinstallCheck(): Promise<string> {
  const results = [];
  for (const bot of config.bots) {
    const result = bot.url
      ? await ping(bot.url)
      : { status: "unconfigured", detail: "no health url" };
    await pool.query(
      `INSERT INTO bot_status (bot_name, status, detail, last_check)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (bot_name) DO UPDATE SET status = $2, detail = $3, last_check = now()`,
      [bot.name, result.status, result.detail],
    );
    results.push({ name: bot.name, ...result });
  }
  const summary = results.map((r) => `${r.name}: ${r.status}`).join("; ");
  await insertRun("coinstall", "ok", summary, { results });
  await audit("coinstall", "hourly_summary", { results });

  if (config.notifyUrl) {
    await fetch(config.notifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "coinstall", summary, results }),
    }).catch(() => undefined);
  }

  return summary;
}

export function startCoinstallCron(): void {
  cron.schedule("0 * * * *", () => {
    coinstallCheck().catch((err) => {
      console.error("coinstall cron failed", err);
    });
  });
}

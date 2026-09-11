/**
 * Set Vercel production env for Phase 1.
 * Never prints secret values. DRY_RUN stays 1. PRODUCTION stays 0.
 *
 * Needs: VERCEL_TOKEN, VERCEL_PROJECT_ID (and VERCEL_ORG_ID / VERCEL_TEAM_ID if the project is on a team).
 * Needs: ASOC_ADDRESS from the mainnet deploy. PRIVATE_KEY and WEBHOOK_SECRET from secrets.
 */
const SENSITIVE = new Set(["PRIVATE_KEY", "PAYOUT_WALLET_PRIVATE_KEY", "WEBHOOK_SECRET", "VERCEL_TOKEN"]);

type EnvItem = { key: string; value: string; type: "plain" | "sensitive" };

function required(name: string): string {
  const value = process.env[name] ?? "";
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function present(name: string): boolean {
  return Boolean(process.env[name]);
}

function plan(): EnvItem[] {
  const asocAddress = process.env.ASOC_ADDRESS ?? "";
  const items: EnvItem[] = [
    { key: "ASOC_ADDRESS", value: asocAddress, type: "plain" },
    { key: "DRY_RUN", value: "1", type: "plain" },
    { key: "PRODUCTION", value: "0", type: "plain" },
    { key: "PAYOUT_CHAIN", value: "base", type: "plain" },
    {
      key: "POLYGON_RPC",
      value: process.env.POLYGON_RPC || "https://polygon-rpc.com",
      type: "plain",
    },
    {
      key: "POLYGON_MAINNET_RPC",
      value: process.env.POLYGON_MAINNET_RPC || process.env.POLYGON_RPC || "https://polygon-rpc.com",
      type: "plain",
    },
  ];
  if (present("PRIVATE_KEY")) {
    items.push({ key: "PRIVATE_KEY", value: process.env.PRIVATE_KEY as string, type: "sensitive" });
  }
  if (present("WEBHOOK_SECRET")) {
    items.push({ key: "WEBHOOK_SECRET", value: process.env.WEBHOOK_SECRET as string, type: "sensitive" });
  }
  return items;
}

async function upsert(item: EnvItem): Promise<void> {
  const token = required("VERCEL_TOKEN");
  const projectId = required("VERCEL_PROJECT_ID");
  const teamId = process.env.VERCEL_ORG_ID || process.env.VERCEL_TEAM_ID || "";
  const qs = new URLSearchParams({ upsert: "true" });
  if (teamId) qs.set("teamId", teamId);
  const res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env?${qs}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      key: item.key,
      value: item.value,
      type: item.type,
      target: ["production"],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${item.key} failed HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
}

async function main() {
  const items = plan();
  console.log("Vercel production env plan (values redacted):");
  for (const item of items) {
    const shown = !item.value
      ? "(empty — set after deploy)"
      : SENSITIVE.has(item.key)
        ? `sensitive (${item.value.length} chars)`
        : item.value;
    console.log(`  ${item.key}=${shown}  type=${item.type}  target=production`);
  }

  if (!process.env.VERCEL_TOKEN || !process.env.VERCEL_PROJECT_ID) {
    console.log("\nNo VERCEL_TOKEN/VERCEL_PROJECT_ID — listing only. Secrets were not sent.");
    return;
  }

  if (!process.env.ASOC_ADDRESS) {
    throw new Error("ASOC_ADDRESS required before writing Vercel production env.");
  }
  if (!present("PRIVATE_KEY") || !present("WEBHOOK_SECRET")) {
    throw new Error("PRIVATE_KEY and WEBHOOK_SECRET must be set in this environment before writing Vercel secrets.");
  }

  for (const item of items) {
    await upsert(item);
    console.log(`set ${item.key}`);
  }
  console.log("Done. DRY_RUN=1 PRODUCTION=0. Do not flip DRY_RUN until mint/stake/claim is on-chain.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

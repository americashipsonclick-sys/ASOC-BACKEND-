import * as dotenv from "dotenv";
import { ENV_SPEC, isAmoyRpc, looksLikeLocalRpc } from "../src/env-spec";
import { isSecureWebhookSecret } from "../src/alchemy";

dotenv.config();

function redact(name: string, value: string, secret?: boolean): string {
  if (!value) return "(empty)";
  if (!secret) return value;
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

async function chainId(rpc: string): Promise<string> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result ?? "";
}

async function main() {
  const missing: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  console.log("ASOC env check — every key, in order. Secrets redacted.\n");

  for (const spec of ENV_SPEC) {
    const present = Object.prototype.hasOwnProperty.call(process.env, spec.name);
    const value = process.env[spec.name] ?? "";
    if (!present) missing.push(spec.name);
    const state = !present ? "SKIPPED" : value ? "set" : "present-empty";
    console.log(
      `[${spec.group}] ${spec.name}=${redact(spec.name, value, spec.secret)}  (${state})  — ${spec.notes}`,
    );
  }

  const polygonRpc = process.env.POLYGON_RPC ?? "";
  const payoutChain = (process.env.PAYOUT_CHAIN ?? "").toLowerCase();
  const payoutKey = process.env.PAYOUT_WALLET_PRIVATE_KEY || process.env.PRIVATE_KEY || "";
  const production = process.env.PRODUCTION === "1";
  const dryRun = process.env.DRY_RUN !== "0";

  if (missing.length) {
    errors.push(`Skipped keys: ${missing.join(", ")}. Put every key in .env even if the value is blank.`);
  }
  if (!polygonRpc) {
    errors.push("POLYGON_RPC is empty. Point it at Polygon mainnet.");
  } else if (isAmoyRpc(polygonRpc)) {
    errors.push(`POLYGON_RPC is Amoy/testnet (${polygonRpc}). Mainnet only.`);
  } else if (looksLikeLocalRpc(polygonRpc)) {
    warnings.push("POLYGON_RPC is local. Fine for the mock E2E. Not a mainnet fire.");
  }

  if (!process.env.PAYOUT_WALLET_PRIVATE_KEY) {
    warnings.push("PAYOUT_WALLET_PRIVATE_KEY is empty. Local mock E2E still runs. A real USDC fire needs the funded wallet key in .env — not in chat.");
  }
  if (payoutChain !== "base") {
    errors.push(`PAYOUT_CHAIN must be base, not ${payoutChain || "(empty)"}. Driver USDC is Base only.`);
  }
  if (!payoutKey) {
    warnings.push("No payout signer key yet (PAYOUT_WALLET_PRIVATE_KEY or PRIVATE_KEY).");
  }
  if (production) {
    errors.push("PRODUCTION=1. Do not flip that until Nishant green-lights. Set PRODUCTION=0.");
  }
  if (!dryRun) {
    warnings.push("DRY_RUN=0. That can spend real USDC if the payout key and Base RPC are live. Local mock tests override this in-process.");
    if (!isSecureWebhookSecret(process.env.WEBHOOK_SECRET ?? "")) {
      errors.push("WEBHOOK_SECRET must be a unique random value of at least 32 characters before DRY_RUN=0.");
    }
  }
  if (!process.env.USDC_ADDRESS) {
    warnings.push("USDC_ADDRESS empty. Base native USDC is 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913.");
  }
  if (!process.env.DRIVER_PAYOUT_ADDRESS) {
    warnings.push("DRIVER_PAYOUT_ADDRESS empty until DriverPayout is deployed on Base.");
  }

  if (polygonRpc && !isAmoyRpc(polygonRpc) && !looksLikeLocalRpc(polygonRpc)) {
    try {
      const id = await chainId(polygonRpc);
      const n = Number.parseInt(id, 16);
      console.log(`\nPOLYGON_RPC eth_chainId = ${id} (${n})`);
      if (n !== 137) {
        errors.push(`POLYGON_RPC chain id is ${n}, not 137 mainnet.`);
      }
    } catch (err) {
      warnings.push(`Could not probe POLYGON_RPC: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log("");
  for (const line of warnings) console.log(`WARN  ${line}`);
  for (const line of errors) console.log(`FAIL  ${line}`);

  if (errors.length) {
    process.exitCode = 1;
    return;
  }
  console.log(
    dryRun
      ? "OK    Env keys are locked. DRY_RUN=1. PRODUCTION=0. Run the local E2E before any real USDC."
      : "OK    Env keys are locked. PRODUCTION still must stay 0 until Nishant says go.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

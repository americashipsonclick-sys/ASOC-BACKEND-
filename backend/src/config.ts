import * as dotenv from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ENV_SPEC } from "./env-spec";

dotenv.config();

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function specDefault(name: string): string {
  return ENV_SPEC.find((item) => item.name === name)?.defaultValue ?? "";
}

export const config = {
  port: Number(env("PORT", specDefault("PORT") || "3001")),
  webhookSecret: env("WEBHOOK_SECRET", specDefault("WEBHOOK_SECRET") || "change-me"),
  databaseUrl: env("DATABASE_URL", specDefault("DATABASE_URL")),
  dryRun: env("DRY_RUN", specDefault("DRY_RUN") || "1") !== "0",
  production: env("PRODUCTION", specDefault("PRODUCTION") || "0") === "1",
  polygonRpc: env("POLYGON_RPC", specDefault("POLYGON_RPC")),
  polygonMainnetRpc: env("POLYGON_MAINNET_RPC", specDefault("POLYGON_MAINNET_RPC")),
  baseRpc: env("BASE_RPC", specDefault("BASE_RPC")),
  baseMainnetRpc: env("BASE_MAINNET_RPC", specDefault("BASE_MAINNET_RPC")),
  privateKey: env("PRIVATE_KEY"),
  payoutWalletPrivateKey: env("PAYOUT_WALLET_PRIVATE_KEY"),
  payoutChain: env("PAYOUT_CHAIN", specDefault("PAYOUT_CHAIN") || "base").toLowerCase(),
  alchemyKey: env("ALCHEMY_API_KEY"),
  alchemySigningKey: env("ALCHEMY_WEBHOOK_SIGNING_KEY"),
  asocAddress: env("ASOC_ADDRESS"),
  haulLedgerAddress: env("HAUL_LEDGER_ADDRESS"),
  driverPayoutAddress: env("DRIVER_PAYOUT_ADDRESS"),
  usdcAddress: env("USDC_ADDRESS", specDefault("USDC_ADDRESS")),
  resendKey: env("RESEND_API_KEY"),
  emailFrom: env("EMAIL_FROM", specDefault("EMAIL_FROM")),
  notifyUrl: env("DISPATCH_NOTIFY_URL"),
  twilioSid: env("TWILIO_ACCOUNT_SID"),
  twilioToken: env("TWILIO_AUTH_TOKEN"),
  twilioFrom: env("TWILIO_FROM"),
  googleMapsKey: env("GOOGLE_MAPS_API_KEY"),
  publicBaseUrl: env("PUBLIC_BASE_URL", specDefault("PUBLIC_BASE_URL")),
  matchRadiusMiles: Number(env("MATCH_RADIUS_MILES", specDefault("MATCH_RADIUS_MILES") || "50")),
  gpsProofRequired: env("GPS_PROOF_REQUIRED", specDefault("GPS_PROOF_REQUIRED") || "1") !== "0",
  testDriverId: env("TEST_DRIVER_ID", specDefault("TEST_DRIVER_ID")),
  testDriverWallet: env("TEST_DRIVER_WALLET", specDefault("TEST_DRIVER_WALLET")),
  bots: [
    { name: "Scribe", url: env("BOT_SCRIBE_URL") },
    { name: "Front Desk", url: env("BOT_FRONT_DESK_URL") },
    { name: "Circuit", url: env("BOT_CIRCUIT_URL") },
    { name: "Scout", url: env("BOT_SCOUT_URL") },
    { name: "Anchor", url: env("BOT_ANCHOR_URL") },
    { name: "Commander", url: env("BOT_COMMANDER_URL") },
    { name: "Coinstall", url: env("BOT_COINSTALL_URL") },
  ],
};

export function schemaSql(): string {
  return readFileSync(path.join(__dirname, "..", "..", "database", "schema.sql"), "utf8");
}

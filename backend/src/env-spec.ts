/** Canonical env list. check-env walks this in order and refuses to skip a key. */
export type EnvSpec = {
  name: string;
  group: "polygon" | "payout" | "base" | "app" | "data" | "bots" | "comms" | "test";
  secret?: boolean;
  defaultValue?: string;
  notes: string;
};

export const ENV_SPEC: EnvSpec[] = [
  {
    name: "POLYGON_RPC",
    group: "polygon",
    defaultValue: "https://polygon-rpc.com",
    notes: "Must be Polygon mainnet (chain 137). Not Amoy.",
  },
  {
    name: "POLYGON_MAINNET_RPC",
    group: "polygon",
    defaultValue: "https://polygon-rpc.com",
    notes: "Hardhat polygon network URL. Same mainnet endpoint.",
  },
  {
    name: "PAYOUT_CHAIN",
    group: "payout",
    defaultValue: "base",
    notes: "Driver USDC is Base only.",
  },
  {
    name: "PAYOUT_WALLET_PRIVATE_KEY",
    group: "payout",
    secret: true,
    notes: "Funded payout wallet key. Paste locally. Never in chat.",
  },
  {
    name: "USDC_ADDRESS",
    group: "payout",
    defaultValue: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    notes: "Native USDC on Base mainnet.",
  },
  {
    name: "DRIVER_PAYOUT_ADDRESS",
    group: "payout",
    notes: "DriverPayout contract on Base. Empty until deploy.",
  },
  {
    name: "ASOC_ADDRESS",
    group: "polygon",
    notes: "ASOC token on Polygon. Empty until deploy.",
  },
  {
    name: "HAUL_LEDGER_ADDRESS",
    group: "polygon",
    notes: "HaulLedger on Polygon. Empty until deploy.",
  },
  {
    name: "PRIVATE_KEY",
    group: "polygon",
    secret: true,
    notes: "Deploy/mint signer. Can match payout key if it is the same wallet.",
  },
  {
    name: "BASE_RPC",
    group: "base",
    defaultValue: "https://sepolia.base.org",
    notes: "Kept in the list. Do not skip. Local/test default is Sepolia.",
  },
  {
    name: "BASE_MAINNET_RPC",
    group: "base",
    defaultValue: "https://mainnet.base.org",
    notes: "Base mainnet URL on file. Not the live switch.",
  },
  {
    name: "WEBHOOK_SECRET",
    group: "app",
    secret: true,
    defaultValue: "change-me",
    notes: "Shared secret for webhook + manual approve.",
  },
  {
    name: "SESSION_SECRET",
    group: "app",
    secret: true,
    notes: "Signs asoc.sid cookies. Blank falls back to WEBHOOK_SECRET. Never in git.",
  },
  {
    name: "ALCHEMY_API_KEY",
    group: "app",
    secret: true,
    notes: "Optional Alchemy token reads.",
  },
  {
    name: "ALCHEMY_WEBHOOK_SIGNING_KEY",
    group: "app",
    secret: true,
    notes: "Optional Alchemy webhook HMAC.",
  },
  {
    name: "DATABASE_URL",
    group: "data",
    defaultValue: "postgres://asoc:asoc@localhost:5432/asoc",
    notes: "Local Postgres.",
  },
  {
    name: "PORT",
    group: "app",
    defaultValue: "3001",
    notes: "API port.",
  },
  {
    name: "DRY_RUN",
    group: "payout",
    defaultValue: "1",
    notes: "1 = no real money. Flip to 0 only for a test payout, never as production.",
  },
  {
    name: "PRODUCTION",
    group: "app",
    defaultValue: "0",
    notes: "Stay 0 until Nishant green-lights. This is not the E2E switch.",
  },
  {
    name: "RESEND_API_KEY",
    group: "comms",
    secret: true,
    notes: "Email. Blank is ok for local E2E.",
  },
  {
    name: "EMAIL_FROM",
    group: "comms",
    defaultValue: "receipts@americashipsonclick.example",
    notes: "From address if Resend is set.",
  },
  {
    name: "DISPATCH_NOTIFY_URL",
    group: "bots",
    notes: "Coinstall notify hook. Blank is ok.",
  },
  { name: "BOT_SCRIBE_URL", group: "bots", notes: "Scribe health URL." },
  { name: "BOT_FRONT_DESK_URL", group: "bots", notes: "Front Desk health URL." },
  { name: "BOT_CIRCUIT_URL", group: "bots", notes: "Circuit health URL." },
  { name: "BOT_SCOUT_URL", group: "bots", notes: "Scout health URL." },
  { name: "BOT_ANCHOR_URL", group: "bots", notes: "Anchor health URL." },
  { name: "BOT_COMMANDER_URL", group: "bots", notes: "Commander health URL." },
  { name: "BOT_COINSTALL_URL", group: "bots", notes: "Coinstall health URL." },
  {
    name: "TWILIO_ACCOUNT_SID",
    group: "comms",
    notes: "SMS. Blank is ok for local E2E.",
  },
  {
    name: "TWILIO_AUTH_TOKEN",
    group: "comms",
    secret: true,
    notes: "SMS auth. Blank is ok for local E2E.",
  },
  {
    name: "TWILIO_FROM",
    group: "comms",
    notes: "SMS from number. Blank is ok for local E2E.",
  },
  {
    name: "GOOGLE_MAPS_API_KEY",
    group: "comms",
    secret: true,
    notes: "Static Maps for load satellite. Blank until after launch. Does not block post.",
  },
  {
    name: "PUBLIC_BASE_URL",
    group: "app",
    defaultValue: "http://localhost:3001",
    notes: "Claim-link origin.",
  },
  {
    name: "MATCH_RADIUS_MILES",
    group: "app",
    defaultValue: "50",
    notes: "SMS match radius.",
  },
  {
    name: "GPS_PROOF_REQUIRED",
    group: "payout",
    defaultValue: "1",
    notes: "Proof must include GPS flagged true.",
  },
  {
    name: "TEST_DRIVER_ID",
    group: "test",
    defaultValue: "test-driver-1",
    notes: "Local E2E driver id.",
  },
  {
    name: "TEST_DRIVER_WALLET",
    group: "test",
    defaultValue: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    notes: "Hardhat account 1. Swap for a real test wallet before a mainnet USDC fire.",
  },
];

export function isAmoyRpc(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes("amoy") || u.includes("80002") || u.includes("mumbai");
}

export function looksLikeLocalRpc(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes("127.0.0.1") || u.includes("localhost") || u.includes("0.0.0.0");
}

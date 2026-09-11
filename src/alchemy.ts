import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { isAmoyRpc } from "./env-spec";

export function isSecureWebhookSecret(secret: string): boolean {
  return secret.length >= 32 && secret !== "change-me";
}

export function verifySharedSecret(header: string | undefined): boolean {
  const got = header ?? "";
  const want = config.webhookSecret;
  if ((!config.dryRun || config.production) && !isSecureWebhookSecret(want)) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyAlchemySignature(rawBody: string, signature: string | undefined): boolean {
  if (!config.alchemySigningKey || !signature) return false;
  const hmac = createHmac("sha256", config.alchemySigningKey).update(rawBody).digest("hex");
  const a = Buffer.from(hmac);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type TokenSnapshot = {
  address: string;
  tokenBalances: unknown;
};

export async function alchemyTokenBalances(owner: string): Promise<TokenSnapshot | null> {
  if (!config.alchemyKey) return null;
  const host = isAmoyRpc(config.polygonRpc) ? "polygon-amoy" : "polygon-mainnet";
  const url = `https://${host}.g.alchemy.com/v2/${config.alchemyKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "alchemy_getTokenBalances",
      params: [owner, config.asocAddress ? [config.asocAddress] : "DEFAULT_TOKENS"],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { result?: { tokenBalances: unknown } };
  return { address: owner, tokenBalances: json.result?.tokenBalances ?? null };
}

export function parseAlchemyActivity(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const event = body.event as { activity?: Array<Record<string, unknown>> } | undefined;
  return event?.activity ?? [];
}

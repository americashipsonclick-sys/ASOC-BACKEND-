import { config } from "./config";

/** Public health body. Never include PRIVATE_KEY, webhook secrets, or wallet keys. */
export function healthPayload() {
  const asocAddress = config.asocAddress || null;
  return {
    ok: true,
    green: true,
    service: "asoc-web3",
    phase: 1,
    chainId: 137,
    asocAddress,
    dryRun: config.dryRun,
    production: config.production,
    payoutChain: config.payoutChain,
    liveMintEnabled: config.dryRun === false && Boolean(asocAddress),
  };
}

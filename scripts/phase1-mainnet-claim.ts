import { claimBonus } from "./phase1-mainnet-lib";

claimBonus().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

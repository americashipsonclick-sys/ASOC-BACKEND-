import { mintAndStake } from "./phase1-mainnet-lib";

mintAndStake().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

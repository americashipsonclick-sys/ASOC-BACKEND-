export const POLYGON_MAINNET_CHAIN_ID = 137;

export function assertPolygonMainnet(chainId: number | bigint): void {
  if (Number(chainId) !== POLYGON_MAINNET_CHAIN_ID) {
    throw new Error(`Refusing: chain ${chainId} is not Polygon mainnet (${POLYGON_MAINNET_CHAIN_ID})`);
  }
}

export function assertFunded(balanceWei: bigint, address: string): void {
  if (balanceWei === 0n) {
    throw new Error(`Deployer ${address} has 0 POL on Polygon. Fund it, then retry.`);
  }
}

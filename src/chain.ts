import { Contract, JsonRpcProvider, Wallet, formatUnits, id, type Signer } from "ethers";
import { config } from "./config";

const HAUL_ABI = [
  "function confirmPickup(string loadId, string plate)",
  "function recordHaul(string plate, string loadId, uint256 miles, uint256 rate, uint256 reserve) returns (bytes32)",
  "event PickupConfirmed(string loadId, string plate, uint256 confirmedAt)",
  "event HaulRecorded(bytes32 indexed haulHash, string plate, string loadId, uint256 miles, uint256 rate, uint256 reserve, uint256 recordedAt)",
];

const PAYOUT_ABI = [
  "function payOnDelivery(address driver, uint256 usdcAmount, string plate, string loadId, uint256 miles, uint256 rate, uint256 reserve)",
];

const ASOC_ABI = [
  "function mintPurchase(address to, uint256 amount, uint256 transactionVolume, bytes32 purchaseId)",
  "function stake(uint256 amount)",
  "function claimBonus()",
  "function notifyVolume(uint256 volume)",
  "function setPremium(address user, bool premium)",
  "function previewAccrued(address user) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function staked(address account) view returns (uint256)",
  "function sendPaidMessage(address to, bytes32 contentHash)",
  "function messageFee() view returns (uint256)",
  "event Minted(address indexed to, uint256 amount, uint256 transactionVolume, bytes32 indexed purchaseId, uint256 lockedUntilTimestamp)",
  "event Staked(address indexed user, uint256 amount)",
  "event BonusClaimed(address indexed user, uint256 paid, uint256 haircut)",
];

let testPayoutSigner: Signer | null = null;
let testPolygonSigner: Signer | null = null;

/** USDC is 6 decimals; ASOC is 18. One USDC dollar == one ASOC. */
export function usdcAmountToAsoc(usdcAmount: bigint): bigint {
  if (usdcAmount <= 0n) return 0n;
  return usdcAmount * 10n ** 12n;
}

/** Hardhat E2E injects the in-process signer so we do not hit mainnet. */
export function setChainTestContext(opts: {
  payoutSigner?: Signer | null;
  polygonSigner?: Signer | null;
}): void {
  if (opts.payoutSigner !== undefined) testPayoutSigner = opts.payoutSigner;
  if (opts.polygonSigner !== undefined) testPolygonSigner = opts.polygonSigner;
}

function payoutKey(): string {
  return config.payoutWalletPrivateKey || config.privateKey;
}

function payoutRpc(): string {
  if (config.payoutChain !== "base") {
    throw new Error("driver payouts are Base only");
  }
  return config.baseMainnetRpc || config.baseRpc;
}

function polygonSigner(): Signer | null {
  if (testPolygonSigner) return testPolygonSigner;
  if (!config.privateKey || config.dryRun) return null;
  const provider = new JsonRpcProvider(config.polygonRpc);
  return new Wallet(config.privateKey, provider);
}

function payoutSigner(): Signer | null {
  if (testPayoutSigner) return testPayoutSigner;
  const key = payoutKey();
  if (!key || config.dryRun) return null;
  const provider = new JsonRpcProvider(payoutRpc());
  return new Wallet(key, provider);
}

export async function confirmPickupOnChain(loadId: string, plate: string): Promise<string> {
  const wallet = polygonSigner();
  if (!wallet || !config.haulLedgerAddress) {
    return `dry-run:pickup:${loadId}`;
  }
  const ledger = new Contract(config.haulLedgerAddress, HAUL_ABI, wallet);
  const tx = await ledger.confirmPickup(loadId, plate);
  const rec = await tx.wait();
  return rec?.hash ?? tx.hash;
}

export async function recordHaulOnChain(args: {
  plate: string;
  loadId: string;
  miles: bigint;
  rate: bigint;
  reserve: bigint;
}): Promise<string> {
  const wallet = polygonSigner();
  if (!wallet || !config.haulLedgerAddress) {
    return `dry-run:haul:${args.loadId}`;
  }
  const ledger = new Contract(config.haulLedgerAddress, HAUL_ABI, wallet);
  const tx = await ledger.recordHaul(args.plate, args.loadId, args.miles, args.rate, args.reserve);
  const rec = await tx.wait();
  return rec?.hash ?? tx.hash;
}

export async function payDriverUsdc(args: {
  driver: string;
  usdcAmount: bigint;
  plate: string;
  loadId: string;
  miles: bigint;
  rate: bigint;
  reserve: bigint;
}): Promise<string> {
  const wallet = payoutSigner();
  if (!wallet || !config.driverPayoutAddress) {
    return `dry-run:payout:${args.loadId}`;
  }
  const payout = new Contract(config.driverPayoutAddress, PAYOUT_ABI, wallet);
  const tx = await payout.payOnDelivery(
    args.driver,
    args.usdcAmount,
    args.plate,
    args.loadId,
    args.miles,
    args.rate,
    args.reserve,
  );
  const rec = await tx.wait();
  return rec?.hash ?? tx.hash;
}

/** @deprecated Use payDriverUsdc. Kept so older call sites compile. */
export async function payDriverOnBase(args: {
  driver: string;
  usdcAmount: bigint;
  plate: string;
  loadId: string;
  miles: bigint;
  rate: bigint;
  reserve: bigint;
}): Promise<string> {
  return payDriverUsdc(args);
}

export async function mintAsoc(
  to: string,
  amount: bigint,
  transactionVolume: bigint,
  purchaseId: string,
): Promise<string> {
  if (config.dryRun) {
    return `dry-run:mint:${id(purchaseId)}`;
  }
  if (!config.asocAddress) throw new Error("ASOC_ADDRESS required for live mint");
  const wallet = polygonSigner();
  if (!wallet) throw new Error("PRIVATE_KEY required for live mint");
  const asoc = new Contract(config.asocAddress, ASOC_ABI, wallet);
  const tx = await asoc.mintPurchase(to, amount, transactionVolume, id(purchaseId));
  const rec = await tx.wait();
  return rec?.hash ?? tx.hash;
}

export async function setPremiumOnChain(user: string, premium: boolean): Promise<string> {
  if (config.dryRun) {
    return `dry-run:premium:${user}:${premium}`;
  }
  if (!config.asocAddress) throw new Error("ASOC_ADDRESS required for premium attestation");
  const wallet = polygonSigner();
  if (!wallet) throw new Error("PRIVATE_KEY required for premium attestation");
  const asoc = new Contract(config.asocAddress, ASOC_ABI, wallet);
  const tx = await asoc.setPremium(user, premium);
  const rec = await tx.wait();
  return rec?.hash ?? tx.hash;
}

export async function notifyVolume(volume: bigint): Promise<void> {
  if (config.dryRun) return;
  if (!config.asocAddress) throw new Error("ASOC_ADDRESS required for live volume credit");
  const wallet = polygonSigner();
  if (!wallet) throw new Error("PRIVATE_KEY required for live volume credit");
  const asoc = new Contract(config.asocAddress, ASOC_ABI, wallet);
  const tx = await asoc.notifyVolume(volume);
  await tx.wait();
}

const ERC20_VIEW_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

function readProvider(): JsonRpcProvider {
  return new JsonRpcProvider(config.polygonRpc);
}

export async function readDriverBalances(driver: string): Promise<{
  rpc: string;
  chainId: number;
  dryRun: boolean;
  production: boolean;
  driver: string;
  usdcAddress: string;
  asocAddress: string;
  usdc: string;
  asoc: string;
  usdcRaw: string;
  asocRaw: string;
}> {
  const provider = readProvider();
  const network = await provider.getNetwork();
  let usdc = "0";
  let asoc = "0";
  let usdcRaw = "0";
  let asocRaw = "0";
  if (config.usdcAddress) {
    const token = new Contract(config.usdcAddress, ERC20_VIEW_ABI, provider);
    const raw = (await token.balanceOf(driver)) as bigint;
    const decimals = Number(await token.decimals());
    usdcRaw = raw.toString();
    usdc = formatUnits(raw, decimals);
  }
  if (config.asocAddress) {
    const token = new Contract(config.asocAddress, ERC20_VIEW_ABI, provider);
    const raw = (await token.balanceOf(driver)) as bigint;
    asocRaw = raw.toString();
    asoc = formatUnits(raw, 18);
  }
  return {
    rpc: config.polygonRpc,
    chainId: Number(network.chainId),
    dryRun: config.dryRun,
    production: config.production,
    driver,
    usdcAddress: config.usdcAddress,
    asocAddress: config.asocAddress,
    usdc,
    asoc,
    usdcRaw,
    asocRaw,
  };
}

export { ASOC_ABI };

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";
import { assertPolygonMainnet } from "../backend/src/mainnet";

export const PROOF_PATH = path.join(__dirname, "..", "proof", "mainnet-control.json");
const ONE = ethers.parseEther("1");
/** 0.7% of 2 ASOC volume = 0.014, enough for a full 1% hourly on 1 staked token. */
const VOLUME = ethers.parseEther("2");

export type ControlProof = {
  chainId: number;
  asocAddress: string;
  wallet: string;
  mintTx: string | null;
  stakeTx: string | null;
  claimTx: string | null;
  purchaseId: string;
  mintedAt: string | null;
  stakedAt: string | null;
  claimAfter: string | null;
  claimedAt: string | null;
  bonus: string | null;
  staked: string | null;
};

export function loadProof(): ControlProof | null {
  if (!existsSync(PROOF_PATH)) return null;
  return JSON.parse(readFileSync(PROOF_PATH, "utf8")) as ControlProof;
}

export function saveProof(proof: ControlProof): void {
  mkdirSync(path.dirname(PROOF_PATH), { recursive: true });
  writeFileSync(PROOF_PATH, `${JSON.stringify(proof, null, 2)}\n`);
}

async function asocContract() {
  const address = process.env.ASOC_ADDRESS || loadProof()?.asocAddress;
  if (!address) throw new Error("ASOC_ADDRESS required (env or proof/mainnet-control.json)");
  const ASOC = await ethers.getContractFactory("ASOC");
  return ASOC.attach(address);
}

export async function mintAndStake(): Promise<ControlProof> {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is not set. Put it in secrets, never in chat or git.");
  }
  const [wallet] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  assertPolygonMainnet(network.chainId);

  const asoc = await asocContract();
  const purchaseId = process.env.PURCHASE_ID || `control-mint-1-${Date.now()}`;
  const purchaseHash = ethers.id(purchaseId);

  const mintTx = await asoc.mintPurchase(wallet.address, ONE, VOLUME, purchaseHash);
  const mintRec = await mintTx.wait();
  const stakeTx = await asoc.stake(ONE);
  const stakeRec = await stakeTx.wait();

  const now = Date.now();
  const proof: ControlProof = {
    chainId: 137,
    asocAddress: await asoc.getAddress(),
    wallet: wallet.address,
    mintTx: mintRec?.hash ?? mintTx.hash,
    stakeTx: stakeRec?.hash ?? stakeTx.hash,
    claimTx: null,
    purchaseId,
    mintedAt: new Date(now).toISOString(),
    stakedAt: new Date(now).toISOString(),
    claimAfter: new Date(now + 60 * 60 * 1000).toISOString(),
    claimedAt: null,
    bonus: null,
    staked: ethers.formatEther(await asoc.staked(wallet.address)),
  };
  saveProof(proof);
  console.log("MINT_TX", proof.mintTx);
  console.log("STAKE_TX", proof.stakeTx);
  console.log("WALLET", proof.wallet);
  console.log("CLAIM_AFTER", proof.claimAfter);
  console.log("Wrote proof/mainnet-control.json — wait exactly one hour, then npm run phase1:mainnet:claim");
  return proof;
}

export async function claimBonus(): Promise<ControlProof> {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is not set. Put it in secrets, never in chat or git.");
  }
  const proof = loadProof();
  if (!proof?.stakeTx) throw new Error("Run mint+stake first (npm run phase1:mainnet:control)");
  if (proof.claimAfter && Date.now() < Date.parse(proof.claimAfter)) {
    const waitMs = Date.parse(proof.claimAfter) - Date.now();
    throw new Error(`Wait until ${proof.claimAfter} (${Math.ceil(waitMs / 1000)}s remaining)`);
  }

  const [wallet] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  assertPolygonMainnet(network.chainId);
  const asoc = await asocContract();
  const before = (await asoc.balanceOf(wallet.address)) as bigint;
  const claimTx = await asoc.claimBonus();
  const rec = await claimTx.wait();
  const after = (await asoc.balanceOf(wallet.address)) as bigint;

  proof.claimTx = rec?.hash ?? claimTx.hash;
  proof.claimedAt = new Date().toISOString();
  proof.bonus = ethers.formatEther(after - before);
  saveProof(proof);
  console.log("CLAIM_TX", proof.claimTx);
  console.log("BONUS_ASOC", proof.bonus);
  console.log("Wrote proof/mainnet-control.json");
  return proof;
}

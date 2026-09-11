import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/** Local proof: a wallet mints, stakes, and receives the hourly bonus. */
async function main() {
  const [owner, wallet] = await ethers.getSigners();
  const ASOC = await ethers.getContractFactory("ASOC");
  const asoc = await ASOC.deploy();
  await asoc.waitForDeployment();

  const buyIn = ethers.parseEther("100");
  await asoc.mintPurchase(wallet.address, buyIn, buyIn, ethers.id("phase1-local-purchase"));
  // A second verified transaction supplies enough of the 0.7% slice for a full
  // 1% hourly payout. There is no unrestricted reward-budget seeding.
  await asoc.notifyVolume(ethers.parseEther("100"));
  await asoc.connect(wallet).stake(buyIn);
  await time.increase(60 * 60);
  await asoc.connect(wallet).claimBonus();

  const bonus = await asoc.balanceOf(wallet.address);
  const staked = await asoc.staked(wallet.address);
  const expected = ethers.parseEther("1");
  const tolerance = ethers.parseEther("0.0003");
  if (bonus < expected - tolerance || bonus > expected + tolerance) {
    throw new Error(`expected 1 ASOC hourly bonus, got ${ethers.formatEther(bonus)}`);
  }
  if (staked !== buyIn) {
    throw new Error("stake did not lock 100 ASOC");
  }

  console.log("Phase 1 proof ok");
  console.log("  contract", await asoc.getAddress());
  console.log("  wallet  ", wallet.address);
  console.log("  owner   ", owner.address);
  console.log("  staked  ", ethers.formatEther(staked), "ASOC");
  console.log("  bonus   ", ethers.formatEther(bonus), "ASOC (1% of 100 after 1 hour)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

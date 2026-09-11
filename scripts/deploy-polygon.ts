import { ethers } from "hardhat";

async function main() {
  const ASOC = await ethers.getContractFactory("ASOC");
  const asoc = await ASOC.deploy();
  await asoc.waitForDeployment();

  const HaulLedger = await ethers.getContractFactory("HaulLedger");
  const ledger = await HaulLedger.deploy();
  await ledger.waitForDeployment();

  console.log("ASOC", await asoc.getAddress());
  console.log("HaulLedger", await ledger.getAddress());

  const usdc = process.env.USDC_ADDRESS;
  if (usdc) {
    const DriverPayout = await ethers.getContractFactory("DriverPayout");
    const payout = await DriverPayout.deploy(usdc);
    await payout.waitForDeployment();
    console.log("DriverPayout", await payout.getAddress());
    console.log("USDC", usdc);
  } else {
    console.log("DriverPayout skipped (set USDC_ADDRESS to deploy the payout pipe)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

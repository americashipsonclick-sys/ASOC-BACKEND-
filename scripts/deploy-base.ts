import { ethers } from "hardhat";

async function main() {
  const usdc = process.env.USDC_ADDRESS;
  if (!usdc) throw new Error("USDC_ADDRESS required on Base");
  const DriverPayout = await ethers.getContractFactory("DriverPayout");
  const payout = await DriverPayout.deploy(usdc);
  await payout.waitForDeployment();
  console.log("DriverPayout", await payout.getAddress());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

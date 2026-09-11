import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const RATE = 2_000_000n;
const PAY = (RATE * 90n) / 100n;

async function main() {
  const [payer, driver] = await ethers.getSigners();
  const USDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await USDC.deploy();
  const Payout = await ethers.getContractFactory("DriverPayout");
  const payout = await Payout.deploy(await usdc.getAddress());
  await usdc.mint(await payout.getAddress(), PAY * 10n);
  const ASOC = await ethers.getContractFactory("ASOC");
  const asoc = await ASOC.deploy();
  const HaulLedger = await ethers.getContractFactory("HaulLedger");
  const ledger = await HaulLedger.deploy();

  const out = {
    rpc: "http://127.0.0.1:8545",
    chainId: 31337,
    payer: payer.address,
    driver: driver.address,
    usdc: await usdc.getAddress(),
    payout: await payout.getAddress(),
    asoc: await asoc.getAddress(),
    haulLedger: await ledger.getAddress(),
    rateUsdc: RATE.toString(),
    payUsdc: PAY.toString(),
    note: "Local live chain for Nishant handoff. Not Polygon mainnet.",
  };
  const dir = path.join(process.cwd(), "proof");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "e2e-local.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

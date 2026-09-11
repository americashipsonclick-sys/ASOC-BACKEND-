import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";
import { assertFunded, assertPolygonMainnet } from "../src/mainnet";

/** Deploy ASOC only to Polygon mainnet (137). Does not deploy HaulLedger or DriverPayout. */
async function main() {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is not set. Put it in secrets, never in chat or git.");
  }

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  assertPolygonMainnet(network.chainId);

  const balance = await ethers.provider.getBalance(deployer.address);
  assertFunded(balance, deployer.address);

  const ASOC = await ethers.getContractFactory("ASOC");
  const asoc = await ASOC.deploy();
  const deployTx = asoc.deploymentTransaction();
  await asoc.waitForDeployment();

  const receipt = deployTx ? await deployTx.wait() : null;
  const proof = {
    chainId: 137,
    network: "polygon",
    deployer: deployer.address,
    asocAddress: await asoc.getAddress(),
    deployTx: deployTx?.hash ?? null,
    blockNumber: receipt?.blockNumber ?? null,
    dryRunKeep: "1",
    productionKeep: "0",
    note: "ASOC token only. Haul ledger and Base payout stay off this deploy.",
  };

  mkdirSync(path.join(__dirname, "..", "proof"), { recursive: true });
  writeFileSync(path.join(__dirname, "..", "proof", "mainnet-deploy.json"), `${JSON.stringify(proof, null, 2)}\n`);

  console.log("ASOC_ADDRESS", proof.asocAddress);
  console.log("DEPLOY_TX", proof.deployTx);
  console.log("DEPLOYER", proof.deployer);
  console.log("Wrote proof/mainnet-deploy.json");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

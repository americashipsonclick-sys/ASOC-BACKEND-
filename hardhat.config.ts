import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const pk = process.env.PRIVATE_KEY;
const accounts = pk && pk.length > 0 ? [pk] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    polygonAmoy: {
      url: process.env.POLYGON_RPC || "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts,
    },
    polygon: {
      url: process.env.POLYGON_RPC || process.env.POLYGON_MAINNET_RPC || "https://polygon-rpc.com",
      chainId: 137,
      accounts,
    },
    baseSepolia: {
      url: process.env.BASE_RPC || "https://sepolia.base.org",
      chainId: 84532,
      accounts,
    },
    base: {
      url: process.env.BASE_MAINNET_RPC || "",
      chainId: 8453,
      accounts,
    },
  },
};

export default config;

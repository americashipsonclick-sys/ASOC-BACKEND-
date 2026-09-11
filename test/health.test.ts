import { expect } from "chai";
import { healthPayload } from "../src/health";
import { config } from "../src/config";
import { assertFunded, assertPolygonMainnet } from "../src/mainnet";

describe("production health", () => {
  it("is green and never includes signing keys", () => {
    const body = healthPayload();
    expect(body.ok).to.equal(true);
    expect(body.green).to.equal(true);
    expect(body.service).to.equal("asoc-web3");
    expect(body.phase).to.equal(1);
    expect(body.chainId).to.equal(137);
    expect(body.payoutChain).to.equal(config.payoutChain);
    expect(JSON.stringify(body)).to.not.match(/PRIVATE_KEY|0x[a-fA-F0-9]{64}/);
  });

  it("keeps live mint off while DRY_RUN is on", () => {
    const previous = config.dryRun;
    config.dryRun = true;
    expect(healthPayload().liveMintEnabled).to.equal(false);
    config.dryRun = previous;
  });
});

describe("polygon mainnet guard", () => {
  it("allows chain 137 and rejects everything else", () => {
    expect(() => assertPolygonMainnet(137)).to.not.throw();
    expect(() => assertPolygonMainnet(80002n)).to.throw(/not Polygon mainnet/);
    expect(() => assertPolygonMainnet(1)).to.throw(/not Polygon mainnet/);
  });

  it("refuses a zero-POL deployer", () => {
    expect(() => assertFunded(0n, "0xabc")).to.throw(/0 POL/);
    expect(() => assertFunded(1n, "0xabc")).to.not.throw();
  });
});

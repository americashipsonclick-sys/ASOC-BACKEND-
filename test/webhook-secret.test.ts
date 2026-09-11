import { expect } from "chai";
import { isSecureWebhookSecret, verifySharedSecret } from "../src/alchemy";
import { config } from "../src/config";
import { usdcAmountToAsoc } from "../src/chain";

describe("payout mint webhook gate", () => {
  it("rejects a missing or wrong webhook secret", () => {
    expect(verifySharedSecret(undefined)).to.equal(false);
    expect(verifySharedSecret("")).to.equal(false);
    expect(verifySharedSecret(config.webhookSecret + "-nope")).to.equal(false);
    expect(verifySharedSecret(config.webhookSecret)).to.equal(true);
  });

  it("requires a strong webhook secret before live transactions", () => {
    expect(isSecureWebhookSecret("change-me")).to.equal(false);
    expect(isSecureWebhookSecret("short")).to.equal(false);
    expect(isSecureWebhookSecret("a-unique-32-character-webhook-secret")).to.equal(true);
  });

  it("converts USDC payout (6 decimals) to the same dollar amount of ASOC (18 decimals)", () => {
    expect(usdcAmountToAsoc(0n)).to.equal(0n);
    expect(usdcAmountToAsoc(90_000_000n)).to.equal(90n * 10n ** 18n);
  });
});

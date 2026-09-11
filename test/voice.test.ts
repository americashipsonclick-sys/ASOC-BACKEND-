import { expect } from "chai";
import { parseVoiceCommand } from "../src/voice";

describe("voice commands", () => {
  it("treats accept this load and book it as the same accept intent", () => {
    expect(parseVoiceCommand("Accept this load")).to.equal("accept");
    expect(parseVoiceCommand("book it")).to.equal("accept");
    expect(parseVoiceCommand("please book this load now")).to.equal("accept");
  });

  it("does not accept unrelated speech", () => {
    expect(parseVoiceCommand("what's the rate")).to.equal("unknown");
    expect(parseVoiceCommand("")).to.equal("unknown");
  });
});

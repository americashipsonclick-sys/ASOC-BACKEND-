import { expect } from "chai";
import { isAvailableLoadStatus, validateLoadPostingEvidence } from "../backend/src/dispatch";

describe("load-board availability", () => {
  it("shows only unclaimed load statuses", () => {
    for (const status of ["created", "open", "posted", "pending", "live"]) {
      expect(isAvailableLoadStatus(status), status).to.equal(true);
    }
  });

  it("removes a load as soon as it is claimed or later", () => {
    for (const status of ["claimed", "accepted", "picked_up", "proof", "submitted", "paid", "delivered"]) {
      expect(isAvailableLoadStatus(status), status).to.equal(false);
    }
  });
});

describe("ASOC universal load-posting rule", () => {
  it("accepts a load photo without measurements", () => {
    const evidence = validateLoadPostingEvidence({
      loadPhotos: ["/uploads/load.jpg"],
    });
    expect(evidence.photos).to.deep.equal(["/uploads/load.jpg"]);
  });

  it("accepts complete exact measurements when no photo exists", () => {
    const evidence = validateLoadPostingEvidence({
      dimensions: { length: 48, width: 40, height: 52, unit: "in" },
      weight: 1200,
      weightUnit: "lb",
    });
    expect(evidence).to.include({
      length: 48,
      width: 40,
      height: 52,
      weight: 1200,
      dimensionUnit: "in",
      weightUnit: "lb",
    });
  });

  it("rejects a post with neither a photo nor complete positive measurements", () => {
    expect(() =>
      validateLoadPostingEvidence({
        length: 48,
        width: 40,
        height: 52,
      }),
    ).to.throw(/load photo, or exact length, width, height, and weight/i);
  });
});

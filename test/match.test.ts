import { expect } from "chai";
import { milesBetween } from "../backend/src/geo";
import { isClaimReply, matchDrivers, smsCopy, vehicleFits } from "../backend/src/match";

describe("load SMS match", () => {
  const dallas = { lat: 32.7767, lng: -96.797 };
  const fortWorth = { lat: 32.7555, lng: -97.3308 };
  const atlanta = { lat: 33.749, lng: -84.388 };

  it("puts Fort Worth inside 50 miles of Dallas and Atlanta outside", () => {
    expect(milesBetween(dallas.lat, dallas.lng, fortWorth.lat, fortWorth.lng)).to.be.below(50);
    expect(milesBetween(dallas.lat, dallas.lng, atlanta.lat, atlanta.lng)).to.be.above(50);
  });

  it("texts verified nearby drivers whose equipment fits", () => {
    const hits = matchDrivers(
      [
        {
          driverId: "near-van",
          phone: "+15551212",
          verified: true,
          vehicleType: "dry van",
          lat: fortWorth.lat,
          lng: fortWorth.lng,
          routeOriginLat: null,
          routeOriginLng: null,
          routeDestLat: null,
          routeDestLng: null,
        },
        {
          driverId: "far",
          phone: "+15550000",
          verified: true,
          vehicleType: "dry van",
          lat: atlanta.lat,
          lng: atlanta.lng,
          routeOriginLat: null,
          routeOriginLng: null,
          routeDestLat: null,
          routeDestLng: null,
        },
        {
          driverId: "wrong-truck",
          phone: "+15559999",
          verified: true,
          vehicleType: "flatbed",
          lat: fortWorth.lat,
          lng: fortWorth.lng,
          routeOriginLat: null,
          routeOriginLng: null,
          routeDestLat: null,
          routeDestLng: null,
        },
      ],
      {
        loadId: "LOAD-1",
        pickupLat: dallas.lat,
        pickupLng: dallas.lng,
        equipment: "dry van",
        originLabel: "Dallas, TX",
        destLabel: "Atlanta, GA",
        rate: "$2.15/mi",
      },
      50,
    );
    expect(hits.map((h) => h.driverId)).to.deep.equal(["near-van"]);
    expect(hits[0].compatibility).to.equal("exact");
    expect(hits[0].compatibilityScore).to.equal(100);
  });

  it("treats YES / CLAIM / BOOK IT as a claim reply", () => {
    expect(isClaimReply("YES")).to.equal(true);
    expect(isClaimReply("book it")).to.equal(true);
    expect(isClaimReply("what's the rate")).to.equal(false);
  });

  it("matches empty equipment against any truck", () => {
    expect(vehicleFits("reefer", "")).to.equal(true);
  });

  it("builds a text with pay, route, and claim link", () => {
    const text = smsCopy(
      {
        loadId: "LOAD-1",
        pickupLat: dallas.lat,
        pickupLng: dallas.lng,
        equipment: "dry van",
        originLabel: "Dallas, TX",
        destLabel: "Atlanta, GA",
        rate: "$2.15/mi",
      },
      32,
      "http://localhost:3001/l/abc",
    );
    expect(text).to.include("32 mi");
    expect(text).to.include("Dallas, TX → Atlanta, GA");
    expect(text).to.include("Reply YES");
    expect(text).to.include("http://localhost:3001/l/abc");
  });
});

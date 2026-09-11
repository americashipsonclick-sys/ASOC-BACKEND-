import { expect } from "chai";
import { nativeDirectionsUrl, previewStaticRouteMap, staticRouteMapUrl } from "../src/maps";

describe("static route map", () => {
  it("returns null without a key so posting never waits on Google", () => {
    expect(staticRouteMapUrl(32.7767, -96.797, 29.7604, -95.3698, "")).to.equal(null);
  });

  it("builds one Static Maps URL with pickup, drop, and a path", () => {
    const url = staticRouteMapUrl(32.7767, -96.797, 29.7604, -95.3698, "test-key")!;
    expect(url.startsWith("https://maps.googleapis.com/maps/api/staticmap?")).to.equal(true);
    expect(url).to.include("maptype=hybrid");
    expect(url).to.include("32.7767%2C-96.797");
    expect(url).to.include("29.7604%2C-95.3698");
    expect(url).to.include("path=");
    expect(url).to.include("key=test-key");
  });

  it("preview payload tells Nishant whether Google is configured", () => {
    const preview = previewStaticRouteMap(32.7767, -96.797, 29.7604, -95.3698, "");
    expect(preview.configured).to.equal(false);
    expect(preview.url).to.equal(null);
    expect(preview.size).to.equal("400x220");
    expect(preview.maptype).to.equal("hybrid");
    expect(preview.pickup.lat).to.equal(32.7767);
    expect(preview.delivery.lng).to.equal(-95.3698);
  });

  it("opens Apple Maps directions on iPhone", () => {
    const url = nativeDirectionsUrl(29.7604, -95.3698, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    expect(url).to.equal("https://maps.apple.com/?daddr=29.7604%2C-95.3698&dirflg=d");
  });

  it("opens Google Maps driving directions on Android and desktop", () => {
    const url = nativeDirectionsUrl(29.7604, -95.3698, "Mozilla/5.0 (Linux; Android 14)");
    expect(url).to.include("https://www.google.com/maps/dir/?api=1");
    expect(url).to.include("destination=29.7604%2C-95.3698");
    expect(url).to.include("travelmode=driving");
  });

  it("returns null without delivery coordinates", () => {
    expect(nativeDirectionsUrl(Number.NaN, -95.3698)).to.equal(null);
  });
});

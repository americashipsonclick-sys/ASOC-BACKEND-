import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { config } from "../backend/src/config";
import { setChainTestContext } from "../backend/src/chain";
import { closePool, migrate } from "../backend/src/db/pool";
import { dispatch, listAvailableLoads } from "../backend/src/dispatch";
import app from "../backend/src/index";

const RATE = 100_000_000n;
const RESERVE = 10_000_000n;
const PAY = RATE - RESERVE;

describe("e2e load → claim → GPS proof → approve → USDC + ASOC mint", function () {
  this.timeout(180_000);

  let pg: EmbeddedPostgres | undefined;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "asoc-e2e-"));
  const port = 55432;
  const previous = {
    databaseUrl: config.databaseUrl,
    dryRun: config.dryRun,
    driverPayoutAddress: config.driverPayoutAddress,
    haulLedgerAddress: config.haulLedgerAddress,
    asocAddress: config.asocAddress,
    gpsProofRequired: config.gpsProofRequired,
    production: config.production,
    notificationsDryRun: config.notificationsDryRun,
    webhookSecret: config.webhookSecret,
    alchemySigningKey: config.alchemySigningKey,
  };

  before(async () => {
    pg = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "asoc",
      password: "asoc",
      port,
      persistent: false,
    });
    await pg.initialise();
    await pg.start();
    try {
      await pg.createDatabase("asoc");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/already exists/i.test(message)) throw err;
    }
    config.databaseUrl = `postgres://asoc:asoc@127.0.0.1:${port}/asoc`;
    config.dryRun = false;
    config.production = false;
    config.notificationsDryRun = true;
    config.webhookSecret = "phase1-test-webhook-secret-at-least-32-characters";
    config.alchemySigningKey = "phase1-test-alchemy-signing-key";
    config.gpsProofRequired = true;
    config.asocAddress = "";
    config.haulLedgerAddress = "";
    await closePool();
    await migrate();
  });

  after(async () => {
    setChainTestContext({ payoutSigner: null, polygonSigner: null });
    Object.assign(config, previous);
    await closePool();
    if (pg) await pg.stop();
  });

  it("posts a load, claims it, submits GPS-flagged proof, approves, pays USDC, then mints ASOC", async () => {
    const [payer, driver] = await ethers.getSigners();
    const USDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await USDC.deploy();
    const Payout = await ethers.getContractFactory("DriverPayout");
    const payout = await Payout.deploy(await usdc.getAddress());
    await usdc.mint(await payout.getAddress(), PAY);
    const ASOC = await ethers.getContractFactory("ASOC");
    const asoc = await ASOC.deploy();
    config.driverPayoutAddress = await payout.getAddress();
    config.asocAddress = await asoc.getAddress();
    setChainTestContext({ payoutSigner: payer, polygonSigner: payer });

    const loadId = `E2E-${Date.now()}`;
    const created = (await dispatch("load.created", {
      loadId,
      origin: "Dallas, TX",
      dest: "Atlanta, GA",
      pickupLat: 32.7767,
      pickupLng: -96.797,
      rate: RATE.toString(),
      miles: 780,
      plate: "TST1234",
      driverWallet: driver.address,
      loadPhotos: ["/proof-photos/e2e-dock-proof.jpg"],
    })) as { load: { status: string } };
    expect(created.load.status).to.equal("created");
    expect((await listAvailableLoads()).some((load) => load.load_id === loadId)).to.equal(true);

    const claimed = (await dispatch("load.accept", {
      loadId,
      driverId: "test-driver-1",
      driverWallet: driver.address,
    })) as { status: string };
    expect(claimed.status).to.equal("claimed");
    expect((await listAvailableLoads()).some((load) => load.load_id === loadId)).to.equal(false);

    try {
      await dispatch("load.proof", { loadId, plate: "TST1234" });
      expect.fail("proof without GPS should fail");
    } catch (err) {
      expect((err as Error).message).to.match(/GPS flagged proof required/i);
    }

    try {
      await dispatch("load.proof", {
        loadId,
        plate: "TST1234",
        gpsFlagged: true,
        gpsLat: 33.749,
        gpsLng: -84.388,
      });
      expect.fail("proof without photos should fail");
    } catch (err) {
      expect((err as Error).message).to.match(/photos required/i);
    }

    const proof = (await dispatch("load.proof", {
      loadId,
      plate: "TST1234",
      gpsFlagged: true,
      gpsLat: 33.749,
      gpsLng: -84.388,
      miles: 780,
      rate: RATE.toString(),
      driverWallet: driver.address,
      photos: ["/proof-photos/e2e-dock-proof.jpg"],
    })) as { status: string; gps_flagged: boolean; proof_photos: string[] };
    expect(proof.status).to.equal("proof");
    expect(proof.gps_flagged).to.equal(true);
    expect(proof.proof_photos).to.include("/proof-photos/e2e-dock-proof.jpg");

    const paid = (await dispatch("load.approve", {
      loadId,
      approvedBy: "manual",
    })) as { status: string; payout_tx: string; mint_tx: string };
    expect(paid.status).to.equal("paid");
    expect(paid.payout_tx).to.match(/^0x/);
    expect(paid.mint_tx).to.match(/^0x/);
    expect(await usdc.balanceOf(driver.address)).to.equal(PAY);
    expect(await asoc.balanceOf(driver.address)).to.equal(PAY * 10n ** 12n);
  });

  it("matches drivers, alerts them, tracks location, advances status, and returns QR details", async () => {
    const loadId = `OPS-${Date.now()}`;
    const [, opsWallet] = await ethers.getSigners();
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not bind");
      const base = `http://127.0.0.1:${address.port}`;
      const sessionResponse = await fetch(`${base}/api/security/session`);
      const session = (await sessionResponse.json()) as { csrf: string };
      const cookies = sessionResponse.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0])
        .join("; ");
      const browserHeaders = {
        "content-type": "application/json",
        cookie: cookies,
        "x-csrf-token": session.csrf,
      };

      for (const account of [
        {
          email: `driver-${loadId}@example.com`,
          password: "Driver-password-1234",
          role: "driver",
          driverId: "ops-near",
        },
        {
          email: `shipper-${loadId}@example.com`,
          password: "Shipper-password-1234",
          role: "shipper",
        },
      ]) {
        const response = await fetch(`${base}/api/auth/register`, {
          method: "POST",
          headers: browserHeaders,
          body: JSON.stringify(account),
        });
        expect(response.status).to.equal(201);
      }
      const loginResponse = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: browserHeaders,
        body: JSON.stringify({
          email: `shipper-${loadId}@example.com`,
          password: "Shipper-password-1234",
        }),
      });
      expect(loginResponse.status).to.equal(200);
      const meResponse = await fetch(`${base}/api/auth/me`, {
        headers: { cookie: cookies },
      });
      expect(meResponse.status).to.equal(200);
      const me = (await meResponse.json()) as { account: { role: string } };
      expect(me.account.role).to.equal("shipper");

      for (const driver of [
        {
          driverId: "ops-near",
          phone: "+12145550101",
          email: "near@example.com",
          vehicleType: "dry van",
          lat: 32.78,
          lng: -96.8,
        },
        {
          driverId: "ops-next",
          phone: "+12145550102",
          email: "next@example.com",
          vehicleType: "dry van",
          lat: 32.9,
          lng: -96.9,
        },
      ]) {
        const response = await fetch(`${base}/api/drivers`, {
          method: "POST",
          headers: browserHeaders,
          body: JSON.stringify(driver),
        });
        expect(response.status).to.equal(200);
      }

      const createResponse = await fetch(`${base}/api/loads`, {
        method: "POST",
        headers: browserHeaders,
        body: JSON.stringify({
          loadId,
          origin: "Dallas, TX",
          dest: "Austin, TX",
          pickupLat: 32.7767,
          pickupLng: -96.797,
          equipment: "dry van",
          rate: "850",
          plate: "OPS123",
          driverWallet: opsWallet.address,
          shipperEmail: "shipper@example.com",
          loadPhotos: ["/proof-photos/e2e-dock-proof.jpg"],
        }),
      });
      expect(createResponse.status).to.equal(201);

      const matchedResponse = await fetch(`${base}/api/drivers/map`, {
        method: "POST",
        headers: browserHeaders,
        body: JSON.stringify({ loadId }),
      });
      expect(matchedResponse.status).to.equal(200);
      const matched = (await matchedResponse.json()) as {
        count: number;
        drivers: { driverId: string; milesAway: number }[];
      };
      expect(matched.count).to.equal(2);
      expect(matched.drivers.map((driver) => driver.driverId)).to.deep.equal(["ops-near", "ops-next"]);
      expect(matched.drivers[0].milesAway).to.be.at.most(matched.drivers[1].milesAway);

      const alertResponse = await fetch(`${base}/api/notifications/alert`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-secret": config.webhookSecret,
        },
        body: JSON.stringify({ loadId, channels: ["sms", "email"] }),
      });
      expect(alertResponse.status).to.equal(200);
      const alert = (await alertResponse.json()) as {
        matched: number;
        notifications: { status: string }[];
      };
      expect(alert.matched).to.equal(2);
      expect(alert.notifications).to.have.length(4);
      expect(alert.notifications.every((item) => item.status === "logged")).to.equal(true);

      const acceptedResponse = await fetch(`${base}/api/loads/${loadId}/status`, {
        method: "PATCH",
        headers: browserHeaders,
        body: JSON.stringify({ status: "accepted", actorId: "ops-near" }),
      });
      expect(acceptedResponse.status).to.equal(200);

      const locationResponse = await fetch(`${base}/api/drivers/ops-near/location`, {
        method: "POST",
        headers: browserHeaders,
        body: JSON.stringify({ loadId, lat: 31.9686, lng: -99.9018, accuracy: 12 }),
      });
      expect(locationResponse.status).to.equal(200);

      for (const status of ["picked_up", "in_transit", "delivered"]) {
        const response = await fetch(`${base}/api/loads/${loadId}/status`, {
          method: "PUT",
          headers: browserHeaders,
          body: JSON.stringify({ status, actorId: "ops-near" }),
        });
        expect(response.status, status).to.equal(200);
      }

      const detailsResponse = await fetch(`${base}/api/loads/${loadId}`);
      expect(detailsResponse.status).to.equal(200);
      const details = (await detailsResponse.json()) as {
        load: { status: string };
        latestLocation: { driver_id: string };
        statusHistory: unknown[];
      };
      expect(details.load.status).to.equal("delivered");
      expect(details.latestLocation.driver_id).to.equal("ops-near");
      expect(details.statusHistory).to.have.length(4);

      const qrResponse = await fetch(`${base}/api/loads/${loadId}/qr`);
      const qr = (await qrResponse.json()) as { qr: { loadId: string; qrValue: string } };
      expect(qr.qr.loadId).to.equal(loadId);
      expect(qr.qr.qrValue).to.include(`/api/loads/${loadId}`);

      const notificationsResponse = await fetch(`${base}/api/loads/${loadId}/notifications`);
      const notifications = (await notificationsResponse.json()) as { notifications: unknown[] };
      expect(notifications.notifications).to.have.length(6);

      const detailAliasResponse = await fetch(`${base}/api/detail/${loadId}`);
      expect(detailAliasResponse.status).to.equal(200);

      const previousDryRun = config.dryRun;
      config.dryRun = true;
      setChainTestContext({ payoutSigner: null });
      try {
        const paymentResponse = await fetch(`${base}/api/payments/process`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-webhook-secret": config.webhookSecret,
          },
          body: JSON.stringify({
            loadId,
            plate: "OPS123",
            driverWallet: opsWallet.address,
            photos: ["/proof-photos/e2e-dock-proof.jpg"],
          }),
        });
        const payment = (await paymentResponse.json()) as {
          result: { payoutChain: string; dryRun: boolean; load: { status: string } };
          error?: string;
        };
        expect(paymentResponse.status, payment.error).to.equal(200);
        expect(payment.result.payoutChain).to.equal("base");
        expect(payment.result.dryRun).to.equal(true);
        expect(payment.result.load.status).to.equal("paid");

        const replayResponse = await fetch(`${base}/api/payments/process`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-webhook-secret": config.webhookSecret,
          },
          body: JSON.stringify({ loadId }),
        });
        const replay = (await replayResponse.json()) as { result: { idempotent: boolean } };
        expect(replayResponse.status).to.equal(200);
        expect(replay.result.idempotent).to.equal(true);
      } finally {
        config.dryRun = previousDryRun;
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("proves HTTP webhook mint → wallet stake → hourly claim", async () => {
    const [owner, wallet] = await ethers.getSigners();
    const ASOC = await ethers.getContractFactory("ASOC");
    const asoc = await ASOC.deploy();
    config.asocAddress = await asoc.getAddress();
    setChainTestContext({ polygonSigner: owner });

    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not bind");
      const endpoint = `http://127.0.0.1:${address.port}/api/webhook/ASOC`;
      const payload = JSON.stringify({
        type: "token.mint",
        purchaseId: "phase1-http-purchase",
        to: wallet.address,
        tokens: "100",
        volumeTokens: "200",
      });

      const alchemySignature = createHmac("sha256", config.alchemySigningKey)
        .update(payload)
        .digest("hex");
      const alchemyOnly = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-alchemy-signature": alchemySignature,
        },
        body: payload,
      });
      expect(alchemyOnly.status).to.equal(401);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-secret": config.webhookSecret,
        },
        body: payload,
      });
      const result = (await response.json()) as {
        ok: boolean;
        result: { tx: string; dryRun: boolean };
      };
      expect(response.status).to.equal(200);
      expect(result.ok).to.equal(true);
      expect(result.result.dryRun).to.equal(false);
      expect(result.result.tx).to.match(/^0x/);
      expect(await asoc.balanceOf(wallet.address)).to.equal(ethers.parseEther("100"));

      await asoc.connect(wallet).stake(ethers.parseEther("100"));
      await time.increase(60 * 60);
      await asoc.connect(wallet).claimBonus();
      expect(await asoc.balanceOf(wallet.address)).to.be.closeTo(
        ethers.parseEther("1"),
        ethers.parseEther("0.001"),
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});

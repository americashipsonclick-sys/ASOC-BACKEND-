import { pool, audit, insertRun } from "./db/pool";
import { isAddress } from "ethers";
import { publishLoad, publishVoice } from "./events";
import { emailReceipt, emailShipperTracking, sendEmail } from "./email";
import { config } from "./config";
import {
  confirmPickupOnChain,
  recordHaulOnChain,
  payDriverUsdc,
  mintAsoc,
  setPremiumOnChain,
  usdcAmountToAsoc,
} from "./chain";
import { alchemyTokenBalances, parseAlchemyActivity } from "./alchemy";
import { parseVoiceCommand } from "./voice";
import { staticRouteMapUrl } from "./maps";

function asString(v: unknown, fallback = ""): string {
  return v == null ? fallback : String(v);
}

function asBig(v: unknown, fallback = 0n): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string" && v !== "") {
    const whole = v.includes(".") ? v.split(".")[0] : v;
    return BigInt(whole || "0");
  }
  return fallback;
}

export async function listVoiceActions(limit = 200) {
  const { rows } = await pool.query(
    "SELECT * FROM voice_actions ORDER BY created_at DESC LIMIT $1",
    [limit],
  );
  return rows;
}

export async function listLoads() {
  const { rows } = await pool.query("SELECT * FROM loads ORDER BY updated_at DESC LIMIT 200");
  return rows;
}

const AVAILABLE_LOAD_STATUSES = new Set(["created", "open", "posted", "pending", "live"]);

export function isAvailableLoadStatus(status: unknown): boolean {
  return AVAILABLE_LOAD_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

export async function listAvailableLoads() {
  const { rows } = await pool.query(
    `SELECT * FROM loads
     WHERE lower(status) = ANY($1::text[])
     ORDER BY updated_at DESC
     LIMIT 200`,
    [Array.from(AVAILABLE_LOAD_STATUSES)],
  );
  return rows;
}

export async function listAudit(limit = 200) {
  const { rows } = await pool.query(
    "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1",
    [limit],
  );
  return rows;
}

/** Same acceptance path for tap and voice. */
export async function acceptLoad(args: {
  loadId: string;
  driverId: string;
  inputMethod: "tap" | "voice" | "sms";
  transcript?: string;
  driverWallet?: string;
}) {
  const loadId = args.loadId;
  const driverId = args.driverId;
  if (!loadId) throw new Error("loadId required");
  if (!driverId) throw new Error("driverId required");

  const existing = await pool.query("SELECT * FROM loads WHERE load_id = $1", [loadId]);
  if (existing.rowCount === 0) throw new Error("load not found");
  const current = existing.rows[0] as { status: string; driver_id: string | null; driver_wallet: string | null };
  if (current.status === "paid" || current.status === "delivered") throw new Error("load already delivered");
  if ((current.status === "accepted" || current.status === "claimed") && current.driver_id !== driverId) {
    throw new Error("load already claimed");
  }

  const driver = await pool.query(
    "SELECT first_name, truck_number, trailer FROM drivers WHERE driver_id = $1",
    [driverId],
  );
  const hauler = (driver.rows[0] ?? {}) as {
    first_name?: string;
    truck_number?: string;
    trailer?: string;
  };
  await pool.query(
    `UPDATE loads SET
       driver_id = $2,
       driver_wallet = COALESCE($4, driver_wallet),
       status = 'claimed',
       accepted_via = $3,
       accepted_at = now(),
       hauler_first_name = COALESCE($5, hauler_first_name),
       hauler_truck = COALESCE($6, hauler_truck),
       hauler_trailer = COALESCE($7, hauler_trailer),
       updated_at = now()
     WHERE load_id = $1`,
    [
      loadId,
      driverId,
      args.inputMethod,
      args.driverWallet || null,
      hauler.first_name || null,
      hauler.truck_number || null,
      hauler.trailer || null,
    ],
  );

  const payload = {
    loadId,
    driverId,
    inputMethod: args.inputMethod,
    transcript: args.transcript ?? null,
    timestamp: new Date().toISOString(),
  };
  await audit("load_board", "load.accept", payload);

  const { rows } = await pool.query("SELECT * FROM loads WHERE load_id = $1", [loadId]);
  const load = rows[0];
  publishLoad(load);
  await emailReceipt(asString(load.customer_email) || undefined, "Load accepted", payload);
  const shipperEmail = asString(load.shipper_email) || undefined;
  if (shipperEmail) {
    const detailUrl = `${config.publicBaseUrl}/api/loads/${encodeURIComponent(loadId)}`;
    try {
      const providerId = await sendEmail(
        shipperEmail,
        `ASOC load ${loadId} accepted`,
        `Driver ${driverId} accepted load ${loadId}.\n\nLoad details: ${detailUrl}`,
      );
      await pool.query(
        `INSERT INTO notifications
           (load_id, driver_id, channel, notification_type, recipient, status, provider_id, detail_url)
         VALUES ($1,$2,'email','load_accepted',$3,$4,$5,$6)`,
        [
          loadId,
          driverId,
          shipperEmail,
          providerId.startsWith("dry-run:") ? "logged" : "sent",
          providerId,
          detailUrl,
        ],
      );
    } catch (err) {
      console.warn("shipper acceptance email skipped", err instanceof Error ? err.message : err);
    }
  }
  return load;
}

async function onVoiceCommand(body: Record<string, unknown>) {
  const driverId = asString(body.driverId ?? body.driver_id);
  const loadId = asString(body.loadId ?? body.load_id);
  const transcript = asString(body.transcript ?? body.text);
  if (!driverId) throw new Error("driverId required");
  if (!transcript) throw new Error("transcript required");

  const intent = parseVoiceCommand(transcript);
  const accepted = intent === "accept" && Boolean(loadId);

  const inserted = await pool.query(
    `INSERT INTO voice_actions (driver_id, load_id, transcript, intent, accepted)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [driverId, loadId || null, transcript, intent, accepted],
  );
  const action = inserted.rows[0];
  await audit("voice", "voice.command", {
    driverId,
    loadId,
    transcript,
    intent,
    accepted,
    timestamp: action.created_at,
  });
  publishVoice(action);

  let load = null;
  if (accepted) {
    load = await acceptLoad({
      loadId,
      driverId,
      inputMethod: "voice",
      transcript,
    });
  }

  return { action, load, intent };
}

async function onLoadAccept(body: Record<string, unknown>) {
  const inputMethod = asString(body.inputMethod ?? body.input_method, "tap") === "voice" ? "voice" : "tap";
  if (inputMethod === "voice") {
    return onVoiceCommand({ ...body, transcript: body.transcript ?? "accept this load" });
  }
  return acceptLoad({
    loadId: asString(body.loadId ?? body.load_id),
    driverId: asString(body.driverId ?? body.driver_id),
    inputMethod: "tap",
    driverWallet: asString(body.driverWallet ?? body.driver_wallet) || undefined,
  });
}

async function upsertLoad(loadId: string, fields: Record<string, unknown>, payload: unknown) {
  const current = await pool.query("SELECT * FROM loads WHERE load_id = $1", [loadId]);
  if (current.rowCount === 0) {
    await pool.query(
      `INSERT INTO loads (load_id, plate, miles, rate, reserve, driver_id, driver_wallet, shipper_email, customer_email, status, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [
        loadId,
        fields.plate ?? null,
        fields.miles ?? null,
        fields.rate ?? null,
        fields.reserve ?? null,
        fields.driver_id ?? null,
        fields.driver_wallet ?? null,
        fields.shipper_email ?? null,
        fields.customer_email ?? null,
        fields.status ?? "created",
        JSON.stringify(payload),
      ],
    );
  } else {
    await pool.query(
      `UPDATE loads SET
        plate = COALESCE($2, plate),
        miles = COALESCE($3, miles),
        rate = COALESCE($4, rate),
        reserve = COALESCE($5, reserve),
        driver_id = COALESCE($6, driver_id),
        driver_wallet = COALESCE($7, driver_wallet),
        shipper_email = COALESCE($8, shipper_email),
        customer_email = COALESCE($9, customer_email),
        status = COALESCE($10, status),
        payload = payload || $11::jsonb,
        pickup_tx = COALESCE($12, pickup_tx),
        delivery_tx = COALESCE($13, delivery_tx),
        payout_tx = COALESCE($14, payout_tx),
        updated_at = now()
       WHERE load_id = $1`,
      [
        loadId,
        fields.plate ?? null,
        fields.miles ?? null,
        fields.rate ?? null,
        fields.reserve ?? null,
        fields.driver_id ?? null,
        fields.driver_wallet ?? null,
        fields.shipper_email ?? null,
        fields.customer_email ?? null,
        fields.status ?? null,
        JSON.stringify(payload),
        fields.pickup_tx ?? null,
        fields.delivery_tx ?? null,
        fields.payout_tx ?? null,
      ],
    );
  }
  const { rows } = await pool.query("SELECT * FROM loads WHERE load_id = $1", [loadId]);
  const load = rows[0];
  publishLoad(load);
  return load;
}

async function onTokenMint(body: Record<string, unknown>) {
  const to = asString(body.to ?? body.wallet ?? body.address);
  const amount =
    body.tokens != null ? asBig(body.tokens) * 10n ** 18n : asBig(body.amount);
  const transactionVolume =
    body.volumeTokens != null
      ? asBig(body.volumeTokens) * 10n ** 18n
      : asBig(body.transactionVolume ?? body.transaction_volume, amount);
  const purchaseId = asString(
    body.purchaseId ?? body.purchase_id ?? body.paymentId ?? body.transactionId ?? body.idempotencyKey,
  );
  if (!to) throw new Error("wallet address required");
  if (!isAddress(to)) throw new Error("valid wallet address required");
  if (amount <= 0n) throw new Error("amount or tokens required");
  if (transactionVolume <= 0n) throw new Error("positive transaction volume required");
  if (!purchaseId) throw new Error("purchaseId required");
  const tx = await mintAsoc(to, amount, transactionVolume, purchaseId);
  await insertRun("token", "ok", "mint", {
    to,
    amount: amount.toString(),
    transactionVolume: transactionVolume.toString(),
    purchaseId,
    tx,
  });
  return {
    to,
    amount: amount.toString(),
    transactionVolume: transactionVolume.toString(),
    purchaseId,
    tx,
    dryRun: tx.startsWith("dry-run:"),
  };
}

async function onPremiumAttestation(body: Record<string, unknown>) {
  const user = asString(body.user ?? body.wallet ?? body.address);
  if (!isAddress(user)) throw new Error("valid wallet address required");
  if (typeof body.premium !== "boolean") throw new Error("premium boolean required");
  const tx = await setPremiumOnChain(user, body.premium);
  await insertRun("membership", "ok", "premium attestation", {
    user,
    premium: body.premium,
    membershipId: asString(body.membershipId ?? body.membership_id) || null,
    tx,
  });
  return { user, premium: body.premium, tx, dryRun: tx.startsWith("dry-run:") };
}

/**
 * After USDC payOnDelivery confirms, mint the same dollar amount of ASOC
 * through the secret-gated token.mint webhook handler. HTTP callers still
 * need x-webhook-secret; this in-process fire is the platform after payout.
 */
async function firePayoutMintWebhook(
  driver: string,
  usdcAmount: bigint,
  meta: { loadId: string; payoutTx: string; transactionVolume: bigint },
): Promise<{ to: string; amount: string; tx: string; skipped?: boolean }> {
  const amount = usdcAmountToAsoc(usdcAmount);
  if (amount <= 0n) {
    return { to: driver, amount: "0", tx: "", skipped: true };
  }
  try {
    if (!config.webhookSecret) {
      throw new Error("WEBHOOK_SECRET required to mint ASOC after payout");
    }
    const minted = await onTokenMint({
      to: driver,
      amount: amount.toString(),
      transactionVolume: meta.transactionVolume.toString(),
      purchaseId: `payout:${meta.loadId}:${meta.payoutTx}`,
      source: "payout",
      loadId: meta.loadId,
      payoutTx: meta.payoutTx,
    });
    await audit("webhook", "token.mint", {
      to: driver,
      amount: minted.amount,
      tx: minted.tx,
      loadId: meta.loadId,
      payoutTx: meta.payoutTx,
      verified: "webhook_secret",
    });
    return minted;
  } catch (err) {
    const message = err instanceof Error ? err.message : "mint failed";
    console.warn("payout mint webhook failed", meta.loadId, message);
    await audit("webhook", "token.mint.failed", {
      to: driver,
      amount: amount.toString(),
      loadId: meta.loadId,
      payoutTx: meta.payoutTx,
      error: message,
    });
    return { to: driver, amount: amount.toString(), tx: "" };
  }
}

type LoadPostingEvidence = {
  photos: string[];
  length: number | null;
  width: number | null;
  height: number | null;
  weight: number | null;
  dimensionUnit: string;
  weightUnit: string;
};

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function validateLoadPostingEvidence(body: Record<string, unknown>): LoadPostingEvidence {
  const photos = collectPhotos({
    photos: body.loadPhotos ?? body.load_photos ?? body.photos ?? body.photoUrls ?? body.images,
  });
  const dimensions =
    body.dimensions && typeof body.dimensions === "object"
      ? (body.dimensions as Record<string, unknown>)
      : {};
  const length = positiveNumber(body.length ?? body.loadLength ?? body.load_length ?? dimensions.length);
  const width = positiveNumber(body.width ?? body.loadWidth ?? body.load_width ?? dimensions.width);
  const height = positiveNumber(body.height ?? body.loadHeight ?? body.load_height ?? dimensions.height);
  const weight = positiveNumber(body.weight ?? body.loadWeight ?? body.load_weight);

  if (photos.length === 0 && [length, width, height, weight].some((value) => value == null)) {
    throw new Error(
      "ASOC posting rule: provide at least one load photo, or exact length, width, height, and weight",
    );
  }

  return {
    photos,
    length,
    width,
    height,
    weight,
    dimensionUnit: asString(
      body.dimensionUnit ?? body.dimension_unit ?? dimensions.unit,
      "in",
    ),
    weightUnit: asString(body.weightUnit ?? body.weight_unit, "lb"),
  };
}

async function onLoadCreated(body: Record<string, unknown>) {
  const loadId = asString(body.loadId ?? body.load_id);
  if (!loadId) throw new Error("loadId required");
  const evidence = validateLoadPostingEvidence(body);
  const rate = asBig(body.rate);
  const reserve = (rate * 10n) / 100n;
  const load = await upsertLoad(
    loadId,
    {
      plate: asString(body.plate) || null,
      miles: body.miles ?? null,
      rate: rate.toString(),
      reserve: reserve.toString(),
      driver_id: body.driverId ?? body.driver_id ?? null,
      driver_wallet: body.driverWallet ?? body.driver_wallet ?? null,
      shipper_email: body.shipperEmail ?? body.shipper_email ?? null,
      customer_email: body.customerEmail ?? body.customer_email ?? null,
      status: "created",
    },
    body,
  );
  const commodity = asString(body.commodity ?? body.cargo ?? body.freight ?? body.product);
  const hot =
    body.timeSensitive === true ||
    body.time_sensitive === true ||
    body.express === true ||
    /express|medicine|pharma|hot|rush|stat/i.test(commodity);
  await pool.query(
    `UPDATE loads SET
       pickup_lat = COALESCE($2, pickup_lat),
       pickup_lng = COALESCE($3, pickup_lng),
       dest_lat = COALESCE($4, dest_lat),
       dest_lng = COALESCE($5, dest_lng),
       origin_label = COALESCE($6, origin_label),
       dest_label = COALESCE($7, dest_label),
       equipment = COALESCE($8, equipment),
       commodity = COALESCE($9, commodity),
       time_sensitive = COALESCE($10, time_sensitive),
       load_photos = $11::jsonb,
       load_length = $12,
       load_width = $13,
       load_height = $14,
       load_weight = $15,
       dimension_unit = $16,
       weight_unit = $17
     WHERE load_id = $1`,
    [
      loadId,
      body.pickupLat ?? body.pickup_lat ?? null,
      body.pickupLng ?? body.pickup_lng ?? null,
      body.destLat ?? body.dest_lat ?? body.dropoffLat ?? body.dropoff_lat ?? null,
      body.destLng ?? body.dest_lng ?? body.dropoffLng ?? body.dropoff_lng ?? null,
      asString(body.origin ?? body.origin_label) || null,
      asString(body.dest ?? body.dest_label) || null,
      asString(body.equipment ?? body.vehicleType) || null,
      commodity || null,
      hot,
      JSON.stringify(evidence.photos),
      evidence.length,
      evidence.width,
      evidence.height,
      evidence.weight,
      evidence.dimensionUnit,
      evidence.weightUnit,
    ],
  );
  const { rows } = await pool.query("SELECT * FROM loads WHERE load_id = $1", [loadId]);
  let saved = rows[0] ?? load;
  try {
    const mapUrl = staticRouteMapUrl(
      Number(saved.pickup_lat),
      Number(saved.pickup_lng),
      Number(saved.dest_lat),
      Number(saved.dest_lng),
    );
    if (mapUrl) {
      await pool.query("UPDATE loads SET map_url = $2 WHERE load_id = $1", [loadId, mapUrl]);
      saved = { ...saved, map_url: mapUrl };
      publishLoad(saved);
    }
  } catch (err) {
    console.warn("static map skipped", err instanceof Error ? err.message : err);
  }
  await emailReceipt(asString(body.customerEmail ?? body.customer_email) || undefined, "Load created", {
    loadId,
    rate: rate.toString(),
    reserve: reserve.toString(),
  });
  let sms: { sent: number; reason?: string; radius?: number } = { sent: 0, reason: "skipped" };
  try {
    const { notifyDriversForLoad } = await import("./notify");
    sms = await notifyDriversForLoad(saved, body);
  } catch (err) {
    console.warn("sms match skipped", err instanceof Error ? err.message : err);
  }
  return { load: saved, sms };
}

async function onPickup(body: Record<string, unknown>) {
  const loadId = asString(body.loadId ?? body.load_id);
  const plate = asString(body.plate);
  if (!loadId || !plate) throw new Error("loadId and plate required");
  const pickupTx = await confirmPickupOnChain(loadId, plate);
  const load = await upsertLoad(
    loadId,
    { plate, status: "picked_up", pickup_tx: pickupTx },
    body,
  );
  await emailShipperTracking(asString(body.shipperEmail ?? load.shipper_email) || undefined, loadId, plate);
  await emailReceipt(asString(body.customerEmail ?? load.customer_email) || undefined, "Pickup", {
    loadId,
    plate,
    tx: pickupTx,
  });
  return load;
}

async function onDelivery(body: Record<string, unknown>) {
  const loadId = asString(body.loadId ?? body.load_id);
  const plate = asString(body.plate);
  if (!loadId || !plate) throw new Error("loadId and plate required");
  const miles = asBig(body.miles);
  const rate = asBig(body.rate);
  const reserve = rate > 0n ? (rate * 10n) / 100n : asBig(body.reserve);
  const driver = asString(body.driverWallet ?? body.driver_wallet);
  const deliveryTx = await recordHaulOnChain({ plate, loadId, miles, rate, reserve });

  const load = await upsertLoad(
    loadId,
    {
      plate,
      miles: miles.toString(),
      rate: rate.toString(),
      reserve: reserve.toString(),
      driver_wallet: driver || null,
      status: "submitted",
      delivery_tx: deliveryTx,
    },
    body,
  );
  await emailReceipt(asString(body.customerEmail ?? load.customer_email) || undefined, "Delivery submitted", {
    loadId,
    plate,
    miles: miles.toString(),
    rate: rate.toString(),
    reserve: reserve.toString(),
    deliveryTx,
  });
  return load;
}

function flagged(v: unknown): boolean {
  if (v === true || v === 1 || v === "1") return true;
  if (typeof v === "string" && v.toLowerCase() === "true") return true;
  return false;
}

function collectPhotos(body: Record<string, unknown>): string[] {
  const raw = body.photos ?? body.photoUrls ?? body.images;
  if (Array.isArray(raw)) return raw.map((item) => String(item)).filter((item) => item.trim().length > 0);
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

async function onProof(body: Record<string, unknown>) {
  const loadId = asString(body.loadId ?? body.load_id);
  if (!loadId) throw new Error("loadId required");
  const gpsLat = body.gpsLat ?? body.gps_lat ?? body.lat;
  const gpsLng = body.gpsLng ?? body.gps_lng ?? body.lng;
  const gpsOk = flagged(body.gpsFlagged ?? body.gps_flagged ?? body.gps);
  if (config.gpsProofRequired && !gpsOk) {
    throw new Error("GPS flagged proof required");
  }
  const lat = Number(gpsLat);
  const lng = Number(gpsLng);
  if (config.gpsProofRequired && (!Number.isFinite(lat) || !Number.isFinite(lng))) {
    throw new Error("gpsLat and gpsLng required");
  }
  const photos = collectPhotos(body);
  if (photos.length === 0) {
    throw new Error("photos required");
  }

  const existing = await pool.query("SELECT * FROM loads WHERE load_id = $1", [loadId]);
  if (existing.rowCount === 0) throw new Error("load not found");
  const current = existing.rows[0] as { status: string };
  if (current.status === "paid") throw new Error("load already paid");
  if (current.status !== "claimed" && current.status !== "accepted" && current.status !== "picked_up") {
    throw new Error(`load must be claimed before proof (status ${current.status})`);
  }

  await pool.query(
    `UPDATE loads SET
       plate = COALESCE($2, plate),
       miles = COALESCE($3, miles),
       rate = COALESCE($4, rate),
       driver_wallet = COALESCE($5, driver_wallet),
       gps_lat = $6,
       gps_lng = $7,
       gps_flagged = $8,
       proof_photos = $9::jsonb,
       proof_at = now(),
       status = 'proof',
       payload = payload || $10::jsonb,
       updated_at = now()
     WHERE load_id = $1`,
    [
      loadId,
      asString(body.plate) || null,
      body.miles != null ? asString(body.miles) : null,
      body.rate != null ? asString(body.rate) : null,
      asString(body.driverWallet ?? body.driver_wallet) || null,
      Number.isFinite(lat) ? lat : null,
      Number.isFinite(lng) ? lng : null,
      gpsOk,
      JSON.stringify(photos),
      JSON.stringify({ ...body, photos }),
    ],
  );
  const { rows } = await pool.query("SELECT * FROM loads WHERE load_id = $1", [loadId]);
  const load = rows[0];
  publishLoad(load);
  await audit("load_board", "load.proof", {
    loadId,
    gpsLat: lat,
    gpsLng: lng,
    gpsFlagged: gpsOk,
    photos,
  });
  return load;
}

async function onApprove(body: Record<string, unknown>) {
  const loadId = asString(body.loadId ?? body.load_id);
  if (!loadId) throw new Error("loadId required");
  const existing = await pool.query("SELECT * FROM loads WHERE load_id = $1", [loadId]);
  if (existing.rowCount === 0) throw new Error("load not found");
  const current = existing.rows[0] as {
    status: string;
    gps_flagged: boolean;
    proof_photos: unknown;
    plate: string | null;
    miles: string | number | null;
    rate: string | number | null;
    reserve: string | number | null;
    driver_wallet: string | null;
    customer_email: string | null;
  };
  if (current.status === "paid") throw new Error("load already paid");
  if (current.status !== "proof" && current.status !== "submitted") {
    throw new Error(`load must be GPS-proofed before approve (status ${current.status})`);
  }
  if (config.gpsProofRequired && !current.gps_flagged) {
    throw new Error("GPS flagged proof required before approve");
  }
  const savedPhotos = Array.isArray(current.proof_photos) ? current.proof_photos : [];
  if (savedPhotos.length === 0) {
    throw new Error("photos required before approve");
  }

  const plate = asString(body.plate) || asString(current.plate);
  const driver = asString(body.driverWallet ?? body.driver_wallet) || asString(current.driver_wallet);
  const miles = asBig(body.miles ?? current.miles);
  const rate = asBig(body.rate ?? current.rate);
  const reserve = rate > 0n ? (rate * 10n) / 100n : asBig(body.reserve ?? current.reserve);
  if (!plate) throw new Error("plate required");
  if (!driver) throw new Error("driverWallet required");
  const usdcAmount = rate > reserve ? rate - reserve : 0n;

  const deliveryTx = await recordHaulOnChain({ plate, loadId, miles, rate, reserve });
  const payoutTx = await payDriverUsdc({ driver, usdcAmount, plate, loadId, miles, rate, reserve });
  const mint = await firePayoutMintWebhook(driver, usdcAmount, {
    loadId,
    payoutTx,
    transactionVolume: usdcAmountToAsoc(rate),
  });

  await pool.query(
    `UPDATE loads SET
       plate = $2,
       miles = $3,
       rate = $4,
       reserve = $5,
       driver_wallet = $6,
       status = 'paid',
       delivery_tx = COALESCE($7, delivery_tx),
       payout_tx = $8,
       mint_tx = COALESCE($9, mint_tx),
       approved_at = now(),
       approved_by = $10,
       payload = payload || $11::jsonb,
       updated_at = now()
     WHERE load_id = $1`,
    [
      loadId,
      plate,
      miles.toString(),
      rate.toString(),
      reserve.toString(),
      driver,
      deliveryTx,
      payoutTx,
      mint.tx || null,
      asString(body.approvedBy ?? body.approved_by) || "manual",
      JSON.stringify({ ...body, mint }),
    ],
  );
  const { rows } = await pool.query("SELECT * FROM loads WHERE load_id = $1", [loadId]);
  const load = rows[0];
  publishLoad(load);
  await audit("load_board", "load.approve", {
    loadId,
    payoutTx,
    mintTx: mint.tx,
    usdc: usdcAmount.toString(),
    asoc: mint.amount,
    driver,
  });
  await emailReceipt(asString(body.customerEmail ?? current.customer_email) || undefined, "Paid", {
    loadId,
    plate,
    payoutTx,
    mintTx: mint.tx,
    usdc: usdcAmount.toString(),
    asoc: mint.amount,
  });
  return load;
}

async function onDriver(body: Record<string, unknown>) {
  const loadId = asString(body.loadId ?? body.load_id);
  if (!loadId) throw new Error("loadId required");
  return upsertLoad(
    loadId,
    {
      driver_id: body.driverId ?? body.driver_id ?? null,
      driver_wallet: body.driverWallet ?? body.driver_wallet ?? null,
      status: asString(body.status) || "driver_update",
    },
    body,
  );
}

async function onAlchemy(body: Record<string, unknown>) {
  const activity = parseAlchemyActivity(body);
  for (const item of activity) {
    const owner = asString(item.toAddress ?? item.fromAddress);
    const snapshot = owner ? await alchemyTokenBalances(owner) : null;
    await insertRun("alchemy", "ok", asString(item.category ?? "activity"), { item, snapshot });
    if (asString(item.category) === "token" || item.hash) {
      await emailReceipt(asString(body.customerEmail) || undefined, "Token event", {
        hash: asString(item.hash),
        from: asString(item.fromAddress),
        to: asString(item.toAddress),
        value: asString(item.value),
      });
    }
  }
  return { activity: activity.length };
}

async function onPaidMessage(body: Record<string, unknown>) {
  const fromWallet = asString(body.from ?? body.fromWallet);
  const toWallet = asString(body.to ?? body.toWallet);
  const contentHash = asString(body.contentHash ?? body.content_hash);
  try {
    await pool.query(
      "INSERT INTO messages (from_wallet, to_wallet, content_hash, fee, tx_hash) VALUES ($1,$2,$3,$4,$5)",
      [fromWallet, toWallet, contentHash, asString(body.fee), asString(body.txHash ?? body.tx_hash)],
    );
  } catch (err) {
    console.warn("message log skipped (no database)", err instanceof Error ? err.message : err);
  }
  await emailReceipt(asString(body.customerEmail) || undefined, "Paid message", {
    from: fromWallet,
    to: toWallet,
    contentHash,
  });
  return { ok: true, from: fromWallet, to: toWallet, contentHash };
}

export async function dispatch(type: string, body: Record<string, unknown>) {
  await audit("webhook", type, body);
  switch (type) {
    case "token.mint":
    case "mint":
      return onTokenMint(body);
    case "membership.premium":
    case "premium.attest":
      return onPremiumAttestation(body);
    case "load.created":
    case "load_created":
      return onLoadCreated(body);
    case "load.pickup":
    case "pickup":
      return onPickup(body);
    case "load.delivered":
    case "delivery":
      return onDelivery(body);
    case "driver.update":
    case "driver":
      return onDriver(body);
    case "alchemy":
      return onAlchemy(body);
    case "paid_message":
    case "message.paid":
      return onPaidMessage(body);
    case "load.accept":
    case "accept":
      return onLoadAccept(body);
    case "load.proof":
    case "proof":
      return onProof(body);
    case "load.approve":
    case "approve":
      return onApprove(body);
    case "voice.command":
    case "voice":
      return onVoiceCommand(body);
    default:
      if (body.event && typeof body.event === "object") {
        return onAlchemy(body);
      }
      throw new Error(`unknown event type: ${type}`);
  }
}

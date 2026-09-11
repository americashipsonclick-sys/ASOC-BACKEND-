import { randomBytes } from "node:crypto";
import { pool, audit } from "./db/pool";
import { config } from "./config";
import { matchDrivers, smsCopy, isClaimReply, type DriverMatchInput, type LoadMatchInput } from "./match";
import { sendSms, normalizePhone } from "./sms";

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function upsertDriverProfile(body: Record<string, unknown>) {
  const driverId = String(body.driverId ?? body.driver_id ?? "").trim();
  const phone = normalizePhone(String(body.phone ?? ""));
  if (!driverId) throw new Error("driverId required");
  if (!phone || phone.length < 8) throw new Error("phone required");
  await pool.query(
    `INSERT INTO drivers (
       driver_id, phone, verified, vehicle_type, lat, lng,
       route_origin_lat, route_origin_lng, route_dest_lat, route_dest_lng,
       first_name, truck_number, trailer, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
     ON CONFLICT (driver_id) DO UPDATE SET
       phone = EXCLUDED.phone,
       verified = EXCLUDED.verified,
       vehicle_type = EXCLUDED.vehicle_type,
       lat = EXCLUDED.lat,
       lng = EXCLUDED.lng,
       route_origin_lat = EXCLUDED.route_origin_lat,
       route_origin_lng = EXCLUDED.route_origin_lng,
       route_dest_lat = EXCLUDED.route_dest_lat,
       route_dest_lng = EXCLUDED.route_dest_lng,
       first_name = COALESCE(EXCLUDED.first_name, drivers.first_name),
       truck_number = COALESCE(NULLIF(EXCLUDED.truck_number, ''), drivers.truck_number),
       trailer = COALESCE(NULLIF(EXCLUDED.trailer, ''), drivers.trailer),
       updated_at = now()`,
    [
      driverId,
      phone,
      body.verified === false ? false : true,
      String(body.vehicleType ?? body.vehicle_type ?? ""),
      num(body.lat),
      num(body.lng),
      num(body.routeOriginLat ?? body.route_origin_lat),
      num(body.routeOriginLng ?? body.route_origin_lng),
      num(body.routeDestLat ?? body.route_dest_lat),
      num(body.routeDestLng ?? body.route_dest_lng),
      String(body.firstName ?? body.first_name ?? "").trim() || null,
      String(body.truckNumber ?? body.truck_number ?? body.truck ?? "").trim() || null,
      String(body.trailer ?? body.trailerNumber ?? body.trailer_number ?? "").trim() || null,
    ],
  );
  const { rows } = await pool.query("SELECT * FROM drivers WHERE driver_id = $1", [driverId]);
  return rows[0];
}

export function loadFromRow(row: Record<string, unknown>, body: Record<string, unknown> = {}): LoadMatchInput {
  return {
    loadId: String(row.load_id ?? body.loadId ?? ""),
    pickupLat: num(row.pickup_lat ?? body.pickupLat ?? body.pickup_lat),
    pickupLng: num(row.pickup_lng ?? body.pickupLng ?? body.pickup_lng),
    equipment: String(row.equipment ?? body.equipment ?? body.vehicleType ?? ""),
    originLabel: String(row.origin_label ?? body.origin ?? body.origin_label ?? ""),
    destLabel: String(row.dest_label ?? body.dest ?? body.dest_label ?? ""),
    rate: String(row.rate ?? body.rate ?? ""),
  };
}

export async function notifyDriversForLoad(row: Record<string, unknown>, body: Record<string, unknown> = {}) {
  const load = loadFromRow(row, body);
  if (load.pickupLat == null || load.pickupLng == null) {
    await audit("sms", "skip_no_pickup", { loadId: load.loadId });
    return { sent: 0, reason: "no pickup coords" };
  }
  const { rows } = await pool.query("SELECT * FROM drivers WHERE verified = true");
  const drivers: DriverMatchInput[] = rows.map((d) => ({
    driverId: String(d.driver_id),
    phone: String(d.phone),
    verified: Boolean(d.verified),
    vehicleType: String(d.vehicle_type ?? ""),
    lat: num(d.lat),
    lng: num(d.lng),
    routeOriginLat: num(d.route_origin_lat),
    routeOriginLng: num(d.route_origin_lng),
    routeDestLat: num(d.route_dest_lat),
    routeDestLng: num(d.route_dest_lng),
  }));
  const hits = matchDrivers(drivers, load, config.matchRadiusMiles);
  let sent = 0;
  for (const hit of hits) {
    const token = randomBytes(16).toString("hex");
    const claimUrl = `${config.publicBaseUrl}/l/${token}`;
    const text = smsCopy(load, hit.milesAway, claimUrl);
    const sid = await sendSms(hit.phone, text);
    await pool.query(
      `INSERT INTO sms_offers (token, load_id, driver_id, phone, miles_away, twilio_sid)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [token, load.loadId, hit.driverId, hit.phone, hit.milesAway, sid],
    );
    sent += 1;
  }
  await audit("sms", "blast", { loadId: load.loadId, sent, radius: config.matchRadiusMiles });
  return { sent, radius: config.matchRadiusMiles };
}

export async function claimByToken(token: string) {
  const { acceptLoad } = await import("./dispatch");
  const { rows } = await pool.query("SELECT * FROM sms_offers WHERE token = $1", [token]);
  if (rows.length === 0) throw new Error("offer not found");
  const offer = rows[0] as { load_id: string; driver_id: string };
  const load = await acceptLoad({
    loadId: offer.load_id,
    driverId: offer.driver_id,
    inputMethod: "sms",
    transcript: "YES",
  });
  await pool.query("UPDATE sms_offers SET claimed_at = now() WHERE token = $1", [token]);
  return load;
}

export async function claimByReply(fromPhone: string, body: string) {
  if (!isClaimReply(body)) return { claimed: false, reason: "not a claim word" };
  const phone = normalizePhone(fromPhone);
  const { rows } = await pool.query(
    `SELECT * FROM sms_offers
     WHERE phone = $1 AND claimed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [phone],
  );
  if (rows.length === 0) return { claimed: false, reason: "no open offer" };
  const load = await claimByToken(String(rows[0].token));
  return { claimed: true, load };
}

import { pool, audit } from "./db/pool";
import { publishLoad } from "./events";
import { config } from "./config";
import { findMatchingDriversForLoad, loadFromRow } from "./notify";

export const LOAD_STATUSES = [
  "posted",
  "accepted",
  "picked_up",
  "in_transit",
  "delivered",
] as const;

export type LoadStatus = (typeof LOAD_STATUSES)[number];

const STATUS_ALIASES: Record<string, LoadStatus> = {
  created: "posted",
  open: "posted",
  pending: "posted",
  live: "posted",
  claimed: "accepted",
};

const NEXT_STATUS: Record<LoadStatus, LoadStatus | null> = {
  posted: "accepted",
  accepted: "picked_up",
  picked_up: "in_transit",
  in_transit: "delivered",
  delivered: null,
};

function number(value: unknown, name: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

export function normalizeLoadStatus(value: unknown): LoadStatus {
  const raw = String(value ?? "").trim().toLowerCase();
  const status = STATUS_ALIASES[raw] ?? raw;
  if (!LOAD_STATUSES.includes(status as LoadStatus)) {
    throw new Error(`status must be one of: ${LOAD_STATUSES.join(", ")}`);
  }
  return status as LoadStatus;
}

export function assertStatusTransition(currentValue: unknown, nextValue: unknown): LoadStatus {
  const current = normalizeLoadStatus(currentValue);
  const next = normalizeLoadStatus(nextValue);
  if (current === next) return next;
  if (NEXT_STATUS[current] !== next) {
    throw new Error(`invalid load status transition: ${current} -> ${next}`);
  }
  return next;
}

export async function matchDriversForRequest(body: Record<string, unknown>) {
  const loadId = String(body.loadId ?? body.load_id ?? "").trim();
  let row: Record<string, unknown> = {};
  if (loadId) {
    const found = await pool.query("SELECT * FROM loads WHERE load_id = $1", [loadId]);
    if (found.rowCount === 0) throw new Error("load not found");
    row = found.rows[0];
  }
  const resolved = loadFromRow(row, body);
  if (!resolved.loadId) throw new Error("loadId required");
  const result = await findMatchingDriversForLoad(row, { ...body, loadId: resolved.loadId });
  return {
    load: result.load,
    radiusMiles: result.radiusMiles,
    count: result.matches.length,
    sort: ["distance_asc", "compatibility"],
    drivers: result.matches,
  };
}

export async function listDrivers() {
  const { rows } = await pool.query(
    `SELECT driver_id, phone, email, verified, vehicle_type, lat, lng,
            first_name, truck_number, trailer, updated_at
     FROM drivers
     ORDER BY updated_at DESC
     LIMIT 500`,
  );
  return rows;
}

export async function listLoadNotifications(loadIdValue: unknown) {
  const loadId = String(loadIdValue ?? "").trim();
  if (!loadId) throw new Error("loadId required");
  const load = await pool.query("SELECT 1 FROM loads WHERE load_id = $1", [loadId]);
  if (load.rowCount === 0) throw new Error("load not found");
  const { rows } = await pool.query(
    `SELECT * FROM notifications
     WHERE load_id = $1
     ORDER BY created_at DESC
     LIMIT 500`,
    [loadId],
  );
  return rows;
}

export async function updateDriverLocation(
  driverIdValue: unknown,
  body: Record<string, unknown>,
) {
  const driverId = String(driverIdValue ?? "").trim();
  if (!driverId) throw new Error("driverId required");
  const lat = number(body.lat ?? body.latitude, "lat", -90, 90);
  const lng = number(body.lng ?? body.longitude, "lng", -180, 180);
  const loadId = String(body.loadId ?? body.load_id ?? "").trim() || null;
  const accuracy = body.accuracy == null ? null : number(body.accuracy, "accuracy", 0, 100_000);
  const recordedAt = body.recordedAt ?? body.recorded_at ?? null;

  const driver = await pool.query("SELECT * FROM drivers WHERE driver_id = $1", [driverId]);
  if (driver.rowCount === 0) throw new Error("driver not found");
  if (loadId) {
    const load = await pool.query("SELECT driver_id FROM loads WHERE load_id = $1", [loadId]);
    if (load.rowCount === 0) throw new Error("load not found");
    const assigned = String(load.rows[0].driver_id ?? "");
    if (assigned && assigned !== driverId) throw new Error("load assigned to another driver");
  }

  await pool.query(
    "UPDATE drivers SET lat = $2, lng = $3, updated_at = now() WHERE driver_id = $1",
    [driverId, lat, lng],
  );
  const { rows } = await pool.query(
    `INSERT INTO driver_locations (driver_id, load_id, lat, lng, accuracy_meters, recorded_at)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, now()))
     RETURNING *`,
    [driverId, loadId, lat, lng, accuracy, recordedAt],
  );
  await audit("tracking", "driver.location", {
    driverId,
    loadId,
    lat,
    lng,
    accuracyMeters: accuracy,
  });
  return rows[0];
}

export async function updateLoadStatus(
  loadIdValue: unknown,
  body: Record<string, unknown>,
) {
  const loadId = String(loadIdValue ?? "").trim();
  if (!loadId) throw new Error("loadId required");
  const found = await pool.query("SELECT * FROM loads WHERE load_id = $1", [loadId]);
  if (found.rowCount === 0) throw new Error("load not found");
  const current = found.rows[0] as Record<string, unknown>;
  const next = assertStatusTransition(current.status, body.status);
  const actorId = String(body.actorId ?? body.actor_id ?? body.driverId ?? body.driver_id ?? "").trim() || null;
  const note = String(body.note ?? "").trim() || null;

  if (actorId && current.driver_id && String(current.driver_id) !== actorId) {
    throw new Error("load assigned to another driver");
  }
  const result = await pool.query(
    `UPDATE loads SET
       status = $2,
       driver_id = COALESCE(driver_id, $3),
       updated_at = now()
     WHERE load_id = $1
     RETURNING *`,
    [loadId, next, actorId],
  );
  await pool.query(
    `INSERT INTO load_status_events (load_id, from_status, to_status, actor_id, note)
     VALUES ($1,$2,$3,$4,$5)`,
    [loadId, normalizeLoadStatus(current.status), next, actorId, note],
  );
  const load = result.rows[0];
  publishLoad(load);
  await audit("load_board", "load.status", {
    loadId,
    from: normalizeLoadStatus(current.status),
    to: next,
    actorId,
  });
  return load;
}

export async function getLoadDetails(loadIdValue: unknown) {
  const loadId = String(loadIdValue ?? "").trim();
  if (!loadId) throw new Error("loadId required");
  const loadResult = await pool.query("SELECT * FROM loads WHERE load_id = $1", [loadId]);
  if (loadResult.rowCount === 0) throw new Error("load not found");
  const load = loadResult.rows[0] as Record<string, unknown>;
  const [history, location] = await Promise.all([
    pool.query(
      "SELECT * FROM load_status_events WHERE load_id = $1 ORDER BY created_at ASC",
      [loadId],
    ),
    pool.query(
      `SELECT * FROM driver_locations
       WHERE load_id = $1
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [loadId],
    ),
  ]);
  const detailUrl = `${config.publicBaseUrl}/api/loads/${encodeURIComponent(loadId)}`;
  return {
    load,
    requirements: {
      equipment: load.equipment ?? null,
      photoRequired: !Array.isArray(load.load_photos) || load.load_photos.length === 0,
      dimensions: {
        length: load.load_length ?? null,
        width: load.load_width ?? null,
        height: load.load_height ?? null,
        unit: load.dimension_unit ?? "in",
      },
      weight: { value: load.load_weight ?? null, unit: load.weight_unit ?? "lb" },
      gpsProofRequired: config.gpsProofRequired,
    },
    latestLocation: location.rows[0] ?? null,
    statusHistory: history.rows,
    links: {
      self: detailUrl,
      qr: `${detailUrl}/qr`,
      accept: `${detailUrl}/accept`,
    },
  };
}

export async function getLoadQrDetails(loadId: unknown) {
  const details = await getLoadDetails(loadId);
  return {
    loadId: details.load.load_id,
    qrValue: details.links.self,
    detailsUrl: details.links.self,
    status: details.load.status,
    requirements: details.requirements,
  };
}

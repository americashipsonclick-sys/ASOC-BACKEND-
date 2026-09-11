import { pool } from "../src/db/pool";

const rows = [
  {
    load_id: "LOAD-1042",
    origin_label: "Dallas, TX",
    dest_label: "Atlanta, GA",
    pickup_lat: 32.78,
    pickup_lng: -96.8,
    dest_lat: 33.75,
    dest_lng: -84.39,
    commodity: "dry van",
    time_sensitive: false,
  },
  {
    load_id: "LOAD-1043",
    origin_label: "Chicago, IL",
    dest_label: "Denver, CO",
    pickup_lat: 41.88,
    pickup_lng: -87.63,
    dest_lat: 39.74,
    dest_lng: -104.99,
    commodity: "express",
    time_sensitive: true,
    hauler_first_name: "Rosa",
    hauler_truck: "4418",
  },
  {
    load_id: "LOAD-1048",
    origin_label: "Phoenix, AZ",
    dest_label: "Los Angeles, CA",
    pickup_lat: 33.45,
    pickup_lng: -112.07,
    dest_lat: 34.05,
    dest_lng: -118.24,
    commodity: "medicine",
    time_sensitive: true,
    hauler_first_name: "DeShawn",
    hauler_trailer: "WAB-229",
  },
  {
    load_id: "LOAD-1051",
    origin_label: "Houston, TX",
    dest_label: "Memphis, TN",
    pickup_lat: 29.76,
    pickup_lng: -95.37,
    dest_lat: 35.15,
    dest_lng: -90.05,
    commodity: "produce",
    time_sensitive: false,
    hauler_first_name: "Mei",
    hauler_truck: "9021",
  },
  {
    load_id: "LOAD-1055",
    origin_label: "Miami, FL",
    dest_label: "Jacksonville, FL",
    pickup_lat: 25.76,
    pickup_lng: -80.19,
    dest_lat: 30.33,
    dest_lng: -81.66,
    commodity: "electronics",
    time_sensitive: true,
    hauler_first_name: "Luis",
    hauler_truck: "1104",
  },
  {
    load_id: "LOAD-1060",
    origin_label: "Seattle, WA",
    dest_label: "Portland, OR",
    pickup_lat: 47.61,
    pickup_lng: -122.33,
    dest_lat: 45.52,
    dest_lng: -122.68,
    commodity: "auto parts",
    time_sensitive: false,
    hauler_first_name: "Aisha",
    hauler_trailer: "T-774",
  },
];

async function main() {
  for (const row of rows) {
    await pool.query(
      `UPDATE loads SET
         origin_label = $2,
         dest_label = $3,
         pickup_lat = $4,
         pickup_lng = $5,
         dest_lat = $6,
         dest_lng = $7,
         commodity = $8,
         time_sensitive = $9,
         hauler_first_name = COALESCE($10, hauler_first_name),
         hauler_truck = COALESCE($11, hauler_truck),
         hauler_trailer = COALESCE($12, hauler_trailer),
         payload = payload || $13::jsonb,
         updated_at = now()
       WHERE load_id = $1`,
      [
        row.load_id,
        row.origin_label,
        row.dest_label,
        row.pickup_lat,
        row.pickup_lng,
        row.dest_lat,
        row.dest_lng,
        row.commodity,
        row.time_sensitive,
        row.hauler_first_name ?? null,
        row.hauler_truck ?? null,
        row.hauler_trailer ?? null,
        JSON.stringify({
          origin: row.origin_label,
          destination: row.dest_label,
          commodity: row.commodity,
          timeSensitive: row.time_sensitive,
          express: /express/i.test(row.commodity),
        }),
      ],
    );
  }
  console.log("stamped", rows.length, "loads");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

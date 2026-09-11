import { pool } from "../src/db/pool";

const samples = [
  {
    load_id: "LOAD-1042",
    status: "pending",
    origin: "Dallas, TX",
    destination: "Atlanta, GA",
    miles: 780,
    rate: 240000,
  },
  {
    load_id: "LOAD-1043",
    status: "claimed",
    origin: "Chicago, IL",
    destination: "Denver, CO",
    miles: 920,
    rate: 310000,
  },
  {
    load_id: "LOAD-1048",
    status: "live",
    origin: "Phoenix, AZ",
    destination: "Los Angeles, CA",
    miles: 370,
    rate: 185000,
  },
  {
    load_id: "LOAD-1051",
    status: "proof",
    origin: "Houston, TX",
    destination: "Memphis, TN",
    miles: 560,
    rate: 210000,
  },
  {
    load_id: "LOAD-1055",
    status: "submitted",
    origin: "Miami, FL",
    destination: "Jacksonville, FL",
    miles: 350,
    rate: 125000,
    delivery_tx: "seed-delivery-1055",
  },
  {
    load_id: "LOAD-1060",
    status: "paid",
    origin: "Seattle, WA",
    destination: "Portland, OR",
    miles: 175,
    rate: 90000,
    delivery_tx: "seed-delivery-1060",
    payout_tx: "seed-payout-1060",
  },
];

async function main() {
  let inserted = 0;
  for (const row of samples) {
    const payload = {
      origin: row.origin,
      destination: row.destination,
      route: `${row.origin} → ${row.destination}`,
      seed: true,
    };
    const result = await pool.query(
      `INSERT INTO loads (load_id, miles, rate, reserve, status, payload, delivery_tx, payout_tx)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
       ON CONFLICT (load_id) DO NOTHING`,
      [
        row.load_id,
        row.miles,
        row.rate,
        Math.trunc((row.rate * 10) / 100),
        row.status,
        JSON.stringify(payload),
        row.delivery_tx ?? null,
        row.payout_tx ?? null,
      ],
    );
    inserted += result.rowCount ?? 0;
  }
  console.log(`seeded ${inserted} new loads (${samples.length} sample set)`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

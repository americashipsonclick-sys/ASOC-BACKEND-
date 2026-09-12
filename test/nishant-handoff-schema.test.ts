import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";

describe("Nishant backend handoff SQL", function () {
  this.timeout(180_000);

  let postgres: EmbeddedPostgres;
  let pool: Pool;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "asoc-handoff-schema-"));
  const port = 55433;

  before(async () => {
    postgres = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: "asoc",
      password: "asoc",
      port,
      persistent: false,
    });
    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase("asoc_handoff");
    pool = new Pool({
      connectionString: `postgres://asoc:asoc@127.0.0.1:${port}/asoc_handoff`,
    });
  });

  after(async () => {
    await pool?.end();
    await postgres?.stop();
  });

  it("creates all three tables and is safe to rerun", async () => {
    await pool.query(`
      CREATE TABLE loads (load_id TEXT PRIMARY KEY);
      CREATE TABLE drivers (driver_id TEXT PRIMARY KEY);
    `);
    const sql = fs.readFileSync(
      path.join(process.cwd(), "docs", "handoffs", "nishant-backend", "schema.sql"),
      "utf8",
    );
    await pool.query(sql);
    await pool.query(sql);

    const result = await pool.query(`
      SELECT
        to_regclass('public.notifications')::text AS notifications,
        to_regclass('public.driver_locations')::text AS driver_locations,
        to_regclass('public.load_status_events')::text AS load_status_events
    `);
    expect(result.rows[0]).to.deep.equal({
      notifications: "notifications",
      driver_locations: "driver_locations",
      load_status_events: "load_status_events",
    });
  });

  it("accepts valid linked rows and rejects invalid coordinates", async () => {
    await pool.query("INSERT INTO drivers (driver_id) VALUES ('driver-1')");
    await pool.query("INSERT INTO loads (load_id) VALUES ('load-1')");
    await pool.query(
      `INSERT INTO notifications
         (driver_id, load_id, channel, event_type, recipient, body, idempotency_key)
       VALUES ('driver-1', 'load-1', 'sms', 'load.created', '+15555550100', 'Test', 'notice-1')`,
    );
    await pool.query(
      `INSERT INTO driver_locations
         (driver_id, load_id, latitude, longitude, captured_at)
       VALUES ('driver-1', 'load-1', 32.7767, -96.797, now())`,
    );
    await pool.query(
      `INSERT INTO load_status_events
         (load_id, previous_status, status, idempotency_key)
       VALUES ('load-1', 'created', 'claimed', 'status-1')`,
    );

    try {
      await pool.query(
        `INSERT INTO driver_locations
           (driver_id, latitude, longitude, captured_at)
         VALUES ('driver-1', 91, -96.797, now())`,
      );
      expect.fail("latitude outside -90..90 should fail");
    } catch (error) {
      expect((error as Error).message).to.match(/driver_locations_latitude_check/);
    }
  });
});

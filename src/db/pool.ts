import { Pool } from "pg";
import { config, schemaSql } from "../config";

let instance: Pool | undefined;

export function getPool(): Pool {
  if (!instance) {
    instance = new Pool({ connectionString: config.databaseUrl });
  }
  return instance;
}

export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const real = getPool() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});

export async function closePool(): Promise<void> {
  if (!instance) return;
  await instance.end();
  instance = undefined;
}

export async function migrate(): Promise<void> {
  await getPool().query(schemaSql());
}

export async function audit(source: string, eventType: string, payload: unknown): Promise<void> {
  try {
    await getPool().query(
      "INSERT INTO audit_logs (source, event_type, payload) VALUES ($1, $2, $3::jsonb)",
      [source, eventType, JSON.stringify(payload)],
    );
  } catch (err) {
    console.warn("audit skipped (no database)", err instanceof Error ? err.message : err);
  }
}

export async function insertRun(
  kind: string,
  status: string,
  summary: string,
  payload: unknown,
): Promise<void> {
  try {
    await getPool().query(
      "INSERT INTO runs (kind, status, summary, payload) VALUES ($1, $2, $3, $4::jsonb)",
      [kind, status, summary, JSON.stringify(payload)],
    );
  } catch (err) {
    console.warn("run log skipped (no database)", err instanceof Error ? err.message : err);
  }
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log("migrated");
      return closePool();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

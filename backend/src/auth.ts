import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { pool, audit } from "./db/pool";

const scrypt = promisify(scryptCallback);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = new Set(["driver", "shipper"]);

type PublicAccount = {
  accountId: string;
  email: string;
  role: "driver" | "shipper";
  displayName: string | null;
  driverId: string | null;
};

function publicAccount(row: Record<string, unknown>): PublicAccount {
  return {
    accountId: String(row.account_id),
    email: String(row.email),
    role: String(row.role) as PublicAccount["role"],
    displayName: row.display_name ? String(row.display_name) : null,
    driverId: row.driver_id ? String(row.driver_id) : null,
  };
}

function normalizeEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new Error("valid email required");
  return email;
}

function validatePassword(value: unknown): string {
  const password = String(value ?? "");
  if (password.length < 12) throw new Error("password must be at least 12 characters");
  if (password.length > 256) throw new Error("password is too long");
  return password;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

async function passwordMatches(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltHex, expectedHex] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltHex || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = (await scrypt(password, Buffer.from(saltHex, "hex"), expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function registerAccount(body: Record<string, unknown>): Promise<PublicAccount> {
  const email = normalizeEmail(body.email);
  const password = validatePassword(body.password);
  const role = String(body.role ?? "").trim().toLowerCase();
  if (!ROLES.has(role)) throw new Error("role must be driver or shipper");
  const driverId = role === "driver" ? String(body.driverId ?? body.driver_id ?? "").trim() || null : null;
  const displayName = String(body.displayName ?? body.display_name ?? "").trim() || null;
  const accountId = randomUUID();
  const passwordHash = await hashPassword(password);
  try {
    const { rows } = await pool.query(
      `INSERT INTO accounts (account_id, email, password_hash, role, display_name, driver_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING account_id, email, role, display_name, driver_id`,
      [accountId, email, passwordHash, role, displayName, driverId],
    );
    await audit("auth", "account.registered", { accountId, role });
    return publicAccount(rows[0]);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      throw new Error("email already registered");
    }
    throw err;
  }
}

export async function loginAccount(
  body: Record<string, unknown>,
  sessionId: string,
  csrfToken: string,
): Promise<PublicAccount> {
  const email = normalizeEmail(body.email);
  const password = validatePassword(body.password);
  const { rows } = await pool.query("SELECT * FROM accounts WHERE lower(email) = $1", [email]);
  const row = rows[0] as Record<string, unknown> | undefined;
  const locked =
    row?.locked_until != null && new Date(String(row.locked_until)).getTime() > Date.now();
  if (!row || locked || !(await passwordMatches(password, String(row.password_hash)))) {
    if (row && !locked) {
      await pool.query(
        `UPDATE accounts SET
           failed_login_count = failed_login_count + 1,
           locked_until = CASE
             WHEN failed_login_count + 1 >= 10 THEN now() + interval '15 minutes'
             ELSE locked_until
           END,
           updated_at = now()
         WHERE account_id = $1`,
        [row.account_id],
      );
    }
    await audit("auth", "login.failed", { email });
    throw new Error("invalid email or password");
  }
  if (row.disabled_at) throw new Error("account disabled");
  await pool.query(
    `INSERT INTO security_sessions (session_id, csrf_token, account_id, expires_at)
     VALUES ($1,$2,$3,now() + interval '12 hours')
     ON CONFLICT (session_id) DO UPDATE SET
       account_id = EXCLUDED.account_id,
       csrf_token = EXCLUDED.csrf_token,
       last_seen = now(),
       expires_at = now() + interval '12 hours'`,
    [sessionId, csrfToken, row.account_id],
  );
  await pool.query(
    "UPDATE accounts SET failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE account_id = $1",
    [row.account_id],
  );
  await audit("auth", "login.succeeded", { accountId: row.account_id, role: row.role });
  return publicAccount(row);
}

export async function logoutAccount(sessionId: string): Promise<void> {
  await pool.query(
    "UPDATE security_sessions SET account_id = NULL, last_seen = now() WHERE session_id = $1",
    [sessionId],
  );
}

export async function currentAccount(sessionId: string): Promise<PublicAccount | null> {
  const { rows } = await pool.query(
    `SELECT a.account_id, a.email, a.role, a.display_name, a.driver_id
     FROM security_sessions s
     JOIN accounts a ON a.account_id = s.account_id
     WHERE s.session_id = $1 AND s.expires_at > now() AND a.disabled_at IS NULL`,
    [sessionId],
  );
  return rows[0] ? publicAccount(rows[0]) : null;
}

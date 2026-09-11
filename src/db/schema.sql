CREATE TABLE IF NOT EXISTS loads (
  id SERIAL PRIMARY KEY,
  load_id TEXT UNIQUE NOT NULL,
  plate TEXT,
  miles NUMERIC,
  rate NUMERIC,
  reserve NUMERIC,
  driver_id TEXT,
  driver_wallet TEXT,
  shipper_email TEXT,
  customer_email TEXT,
  status TEXT NOT NULL DEFAULT 'created',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  pickup_tx TEXT,
  delivery_tx TEXT,
  payout_tx TEXT,
  accepted_via TEXT,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bot_status (
  bot_name TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  detail TEXT,
  last_check TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  from_wallet TEXT,
  to_wallet TEXT,
  content_hash TEXT,
  fee TEXT,
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loads_status_idx ON loads (status);
CREATE INDEX IF NOT EXISTS loads_updated_idx ON loads (updated_at DESC);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS voice_actions (
  id SERIAL PRIMARY KEY,
  driver_id TEXT NOT NULL,
  load_id TEXT,
  transcript TEXT NOT NULL,
  intent TEXT NOT NULL,
  accepted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS voice_actions_created_idx ON voice_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS voice_actions_driver_idx ON voice_actions (driver_id, created_at DESC);

ALTER TABLE loads ADD COLUMN IF NOT EXISTS accepted_via TEXT;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS origin_label TEXT;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS dest_label TEXT;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS equipment TEXT;

CREATE TABLE IF NOT EXISTS drivers (
  driver_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT true,
  vehicle_type TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  route_origin_lat DOUBLE PRECISION,
  route_origin_lng DOUBLE PRECISION,
  route_dest_lat DOUBLE PRECISION,
  route_dest_lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drivers_phone_idx ON drivers (phone);

CREATE TABLE IF NOT EXISTS sms_offers (
  id SERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  load_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  miles_away DOUBLE PRECISION,
  twilio_sid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sms_offers_phone_idx ON sms_offers (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_offers_token_idx ON sms_offers (token);

ALTER TABLE loads ADD COLUMN IF NOT EXISTS gps_lat DOUBLE PRECISION;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS gps_lng DOUBLE PRECISION;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS gps_flagged BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS proof_at TIMESTAMPTZ;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS dest_lat DOUBLE PRECISION;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS dest_lng DOUBLE PRECISION;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS commodity TEXT;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS time_sensitive BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS hauler_first_name TEXT;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS hauler_truck TEXT;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS hauler_trailer TEXT;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS map_url TEXT;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS mint_tx TEXT;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS proof_photos JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS load_photos JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS load_length NUMERIC;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS load_width NUMERIC;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS load_height NUMERIC;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS load_weight NUMERIC;
ALTER TABLE loads ADD COLUMN IF NOT EXISTS dimension_unit TEXT NOT NULL DEFAULT 'in';
ALTER TABLE loads ADD COLUMN IF NOT EXISTS weight_unit TEXT NOT NULL DEFAULT 'lb';

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS truck_number TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS trailer TEXT;


# Nishant backend handoff

This is the handoff for the repository's Express/Node.js ASOC API. No file, module, route, or symbol named `ASU` exists in this checkout; this document assumes “ASU” means the existing ASOC backend.

## Delivery status

- `notifications`, `driver_locations`, and `load_status_events` are now part of the canonical idempotent migration in `src/db/schema.sql`.
- Copy/paste SQL for only those three tables is in [`schema.sql`](./schema.sql). It targets PostgreSQL 14+ and assumes the existing `loads` and `drivers` tables have already been created.
- Existing driver matching and Twilio SMS offer/claim behavior is built.
- The new tables are schema-ready, but no current route writes or reads them. Wiring those writes and notification CRUD endpoints is remaining feature work.
- This handoff does not change the locked Phase 1 economics or contract behavior. Messaging remains a later-phase integration.

## Existing backend files to carry forward

| File | Built behavior |
|---|---|
| `src/index.ts` | Express app, CORS/body parsing, webhook authorization, HTTP/SSE routes, Twilio inbound webhook |
| `src/dispatch.ts` | Event router; load create/accept/pickup/delivery/proof/approve; mint and premium attestation; validation and audit calls |
| `src/notify.ts` | Driver profile upsert, nearby-driver SMS fan-out, token and reply claims |
| `src/match.ts` | Distance/equipment matching, claim-word parsing, SMS copy |
| `src/sms.ts` | Twilio REST send and E.164-style phone normalization; safe dry-run fallback |
| `src/voice.ts` | Voice accept-intent parsing |
| `src/events.ts` | In-process load/voice event bus used by SSE |
| `src/geo.ts` | Great-circle and route-distance calculations |
| `src/maps.ts` | Google Static Maps URL and native directions URL builders |
| `src/email.ts` | Resend email sender and receipt/tracking templates |
| `src/alchemy.ts` | Shared-secret and Alchemy HMAC verification; token reads |
| `src/chain.ts` | Polygon ASOC/haul calls and separate Base USDC payout calls |
| `src/cron.ts` | Hourly bot health check and optional dispatch webhook |
| `src/config.ts` | Runtime configuration mapping |
| `src/env-spec.ts` | Canonical environment-variable inventory |
| `src/db/schema.sql` | Complete, idempotent PostgreSQL schema, including the three handoff tables |
| `src/db/pool.ts` | Lazy `pg` pool, migration, audit, and run-log helpers |
| `src/db/migrate.ts` | Migration CLI |
| `.env.example` | Secret-free configuration template |
| `test/availability.test.ts` | Availability and load-posting validation |
| `test/match.test.ts` | Location/equipment matching and SMS claim behavior |
| `test/voice.test.ts` | Voice intent behavior |
| `test/webhook-secret.test.ts` | Webhook security and payout-to-ASOC conversion |
| `test/e2e-load-payout.test.ts` | Embedded PostgreSQL plus HTTP/contract end-to-end proof |

## Existing HTTP surface

All JSON webhook events use `POST /api/webhook/ASOC` (lowercase alias also exists) with either `x-webhook-secret` or `Authorization: Bearer …`. Alchemy-shaped events may instead use a valid `x-alchemy-signature`.

| Method and path | Purpose | Protection |
|---|---|---|
| `POST /api/webhook/ASOC` | Dispatch mint, membership, load, driver, message, accept, proof, approve, voice, or Alchemy events | Shared secret; Alchemy signature only for Alchemy events |
| `GET /api/loads` | Recent load rows | Public |
| `GET /api/loads/available` | Unclaimed load rows | Public |
| `POST /api/loads/:loadId/accept` | Tap or voice claim | Public |
| `GET /api/voice/actions` | Recent voice actions | Public |
| `GET /api/audit` | Recent audit events | Public |
| `GET /api/loads/stream` | All-load SSE snapshot/updates | Public |
| `GET /api/loads/available/stream` | Available-load SSE snapshot/updates/removals | Public |
| `GET /api/token/:address` | Alchemy token-balance snapshot | Public |
| `POST /api/admin/coinstall` | Run bot health check | Shared secret |
| `POST /api/loads/:loadId/proof` | GPS/photo delivery proof | Public |
| `POST /api/admin/loads/:loadId/approve` | Approve, pay, and mint; deliberately blocked when `PRODUCTION=1` | Shared secret |
| `POST /api/uploads` | Save a data-URL image to local public storage | Public |
| `GET /api/e2e/board` | Load and chain test snapshot | Public |
| `GET /api/phase1` | Phase/config snapshot | Public |
| `POST /api/drivers` | Upsert driver profile and matching location | Public |
| `GET /l/:token` | Claim the SMS offer represented by a token | Token possession |
| `POST /api/twilio/sms` | Twilio inbound SMS; claim latest offer on YES/CLAIM/BOOK | Public Twilio webhook |
| `GET /health` | Service health | Public |
| `GET /feed` | Public load board | Public |

The webhook dispatch recognizes: `token.mint`, `membership.premium`, `load.created`, `load.pickup`, `load.delivered`, `driver.update`, Alchemy events, `message.paid`, `load.accept`, `load.proof`, `load.approve`, and `voice.command`, plus aliases in `src/dispatch.ts`.

## Environment variables

Start from `.env.example`; keep every key present even when an optional value is blank. Never commit `.env` or paste private keys/tokens into tickets, chat, or this handoff.

### Required for the API and PostgreSQL

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `WEBHOOK_SECRET` | Webhook/admin shared secret; use a unique 32+ character value outside dry-run |
| `PORT` | Local API port; Vercel supplies its own runtime port |
| `PUBLIC_BASE_URL` | Public HTTPS origin used in SMS claim links |
| `DRY_RUN` | Keep `1` unless a controlled live transaction is authorized |
| `PRODUCTION` | Keep `0` until the explicit production gate is cleared |
| `PAYOUT_CHAIN` | Must remain `base` |
| `POLYGON_RPC`, `POLYGON_MAINNET_RPC` | Polygon RPC configuration |
| `BASE_RPC`, `BASE_MAINNET_RPC` | Base test/mainnet RPC configuration |
| `MATCH_RADIUS_MILES` | Nearby-driver SMS radius |
| `GPS_PROOF_REQUIRED` | Require GPS-flagged proof when not `0` |

### Required only for the corresponding live integration

| Variable | Purpose / handling |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio REST account SID |
| `TWILIO_AUTH_TOKEN` | **Secret** used for Twilio REST authentication |
| `TWILIO_FROM` | Twilio SMS-capable sender in E.164 form |
| `PRIVATE_KEY` | **Secret** Polygon deploy/mint signer |
| `PAYOUT_WALLET_PRIVATE_KEY` | **Secret** funded Base payout signer |
| `ASOC_ADDRESS` | Deployed Polygon ASOC contract |
| `HAUL_LEDGER_ADDRESS` | Deployed Polygon haul-ledger contract |
| `DRIVER_PAYOUT_ADDRESS` | Deployed Base DriverPayout contract |
| `USDC_ADDRESS` | Base native USDC contract |
| `ALCHEMY_API_KEY` | **Secret** optional Polygon token reads |
| `ALCHEMY_WEBHOOK_SIGNING_KEY` | **Secret** optional Alchemy HMAC validation |
| `RESEND_API_KEY` | **Secret** optional live email |
| `EMAIL_FROM` | Verified sender used with Resend |
| `GOOGLE_MAPS_API_KEY` | **Secret** optional Google Static Maps |
| `DISPATCH_NOTIFY_URL` | Optional Coinstall summary webhook |
| `BOT_SCRIBE_URL` | Optional Scribe health endpoint |
| `BOT_FRONT_DESK_URL` | Optional Front Desk health endpoint |
| `BOT_CIRCUIT_URL` | Optional Circuit health endpoint |
| `BOT_SCOUT_URL` | Optional Scout health endpoint |
| `BOT_ANCHOR_URL` | Optional Anchor health endpoint |
| `BOT_COMMANDER_URL` | Optional Commander health endpoint |
| `BOT_COINSTALL_URL` | Optional Coinstall health endpoint |
| `TEST_DRIVER_ID`, `TEST_DRIVER_WALLET` | Local/test fixtures only |

`VERCEL` is inspected by the runtime but is platform-provided, not an operator secret or a value to set manually.

### Twilio console

1. Configure the SMS-capable number's incoming-message webhook as `POST https://<PUBLIC_BASE_URL>/api/twilio/sms`.
2. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM` in the deployment environment.
3. Keep `DRY_RUN=1` for setup checks. Outbound SMS logs locally until all three values exist and dry-run is disabled.
4. Send a load-created webhook containing pickup coordinates after registering a verified nearby driver. Confirm a row appears in `sms_offers`, the Twilio SID is recorded, and replying `YES` claims the load.

## Setup, migration, redeploy, and tests

```bash
cp .env.example .env
npm ci
docker compose up -d postgres
npm run db:migrate
npm run env:check
npm run compile
npm test
```

The migration command executes the canonical `src/db/schema.sql`, including these new tables. For an already-initialized ASOC database, the isolated equivalent is:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f docs/handoffs/nishant-backend/schema.sql
```

Verify the result:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT to_regclass('public.notifications'), to_regclass('public.driver_locations'), to_regclass('public.load_status_events');"
npm run api
curl -fsS http://localhost:3001/health
```

For Vercel, add the same variables to the intended Preview/Production environment without exposing their values, then redeploy the branch/project. Do not point Twilio at the new deployment until `/health`, the database migration, and one dry-run load flow pass. After deploy, repeat the health request against the HTTPS URL and inspect runtime logs for migration or Twilio errors.

## Required follow-up and blockers

1. Decide the authenticated API contract for creating/listing/reading notifications, posting driver locations, and appending load status events. No such routes are built yet.
2. Add transactional writes from each load state transition to `load_status_events`; current code only changes `loads.status` and writes selected audit events.
3. Add a worker that atomically claims queued notifications, sends them, records provider IDs/errors, and retries with backoff.
4. Decide retention/downsampling for `driver_locations`; it is append-only and can grow quickly.
5. Supply deployment-owned inputs: production `DATABASE_URL`, public URL, secure webhook secret, Twilio credentials/number, and any enabled provider/chain credentials and deployed addresses.
6. Before exposing the current API, add application authentication/authorization to public mutating/read routes and validate Twilio's `X-Twilio-Signature`. The existing Twilio webhook does not verify that signature.
7. Replace `/api/uploads` local filesystem persistence for Vercel; function filesystems are ephemeral.
8. Confirm whether “ASU” names another service or repository. Nothing with that name is present here.
9. Resolve the maps documentation mismatch: `MAPS-HANDOFF.md` advertises `GET /api/maps/static`, and `src/maps.ts` has the preview builder, but `src/index.ts` does not register that route.
10. Normalize load-status vocabulary before mobile integration. The backend writes `claimed` and `driver_update`, while guards/UI also recognize `accepted`, `in_transit`, and `enroute`.
11. Add direct tests for Twilio sending/signature handling, the inbound SMS route, driver-profile upserts, email delivery, and the hourly cron. Current tests cover matching/copy but not those provider-facing paths.

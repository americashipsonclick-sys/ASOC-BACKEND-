# ASOC load operations API

Node.js + Express + PostgreSQL endpoints for load matching, alerts, GPS tracking,
status progression, and QR-ready load details.

## Endpoints

### Create a load

`POST /api/loads`

Accepts pickup/drop coordinates, equipment, rate, shipper details, and the
existing ASOC posting evidence rule: at least one photo, or positive length,
width, height, and weight. It stores the load and runs matching notifications.

### Match a posted load to drivers

`POST /api/drivers/match`

```json
{ "loadId": "LOAD-1001" }
```

You may instead provide `loadId`, `pickupLat`, `pickupLng`, `equipment`, origin,
destination, and rate directly. Results include compatible verified drivers,
sorted by ascending distance.

`POST /api/drivers/map` is an alias for clients that use the map naming.

### Alert matching drivers

`POST /api/notifications/alert`

Requires `x-webhook-secret`. This endpoint is deliberately server-to-server.

```json
{
  "loadId": "LOAD-1001",
  "channels": ["sms", "email"]
}
```

Every attempt is written to `notifications`. SMS offers contain a one-time claim
link. With `NOTIFICATIONS_DRY_RUN=1`, messages are logged but not sent.

### Update a driver's GPS position

`POST /api/drivers/:driverId/location`

```json
{
  "loadId": "LOAD-1001",
  "lat": 32.7767,
  "lng": -96.797,
  "accuracy": 12
}
```

Coordinates are validated, the driver's current position is updated, and an
append-only point is stored in `driver_locations`.

### Advance load status

`PATCH /api/loads/:loadId/status` or `PUT /api/loads/:loadId/status`

```json
{
  "status": "in_transit",
  "actorId": "DRIVER-42",
  "note": "Departed pickup"
}
```

Allowed sequence:

`posted → accepted → picked_up → in_transit → delivered`

Existing `created` and `claimed` records are treated as `posted` and `accepted`.
Skipped or reversed transitions are rejected. Each accepted transition is
stored in `load_status_events`.

### Load details and QR payload

- `GET /api/loads/:loadId`
- `GET /api/loads/:loadId/qr`
- `GET /api/loads/:loadId/notifications`
- `GET /api/drivers`

`GET /api/detail/:loadId` is an alias for load-detail clients.

The QR endpoint returns a stable `qrValue` pointing to the load-detail endpoint,
plus equipment, dimensions, weight, photo, and GPS-proof requirements. The
frontend can render that value as a QR image without storing image files.

### Driver and shipper accounts

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Registration accepts `email`, a password of at least 12 characters, and role
`driver` or `shipper`. Passwords are salted and hashed with Node.js `scrypt`;
only signed HttpOnly session cookies are returned to the browser.

### Process delivered-load payment

`POST /api/payments/process`

Requires `x-webhook-secret`. The load must be `delivered`, have a driver wallet,
plate, GPS location, and delivery photos. The endpoint atomically claims the
load for payment, records the attempt, and is idempotent after success.

Driver USDC is paid on **Base only**. Polygon remains the ASOC token and holder
reward network. With `DRY_RUN=1`, the response contains dry-run transaction
references and no money moves.

## PostgreSQL

Run the idempotent schema after setting `DATABASE_URL`:

```bash
npm run db:migrate
```

New database objects:

- `drivers.email`
- `driver_locations`
- `load_status_events`
- `notifications`
- `accounts`
- `payment_attempts`
- `security_sessions.account_id`

## Environment variables

Required for deployed data:

```env
DATABASE_URL=postgresql://...
PUBLIC_BASE_URL=https://your-backend-domain
WEBHOOK_SECRET=at-least-32-random-characters
SESSION_SECRET=a-different-32-character-random-secret
MATCH_RADIUS_MILES=50
NOTIFICATIONS_DRY_RUN=1
```

Required only when sending real notifications:

```env
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=
RESEND_API_KEY=
EMAIL_FROM=
```

Keep `NOTIFICATIONS_DRY_RUN=1` for initial testing. It is independent from
blockchain `DRY_RUN`, which must remain `1` until the Polygon
mint → stake → one-hour claim proof succeeds.

## Verification

```bash
npx tsc --noEmit
npm test
```

The endpoint integration test covers driver creation, distance ordering, SMS
and email dry-run logs, GPS updates, all status transitions, notification
history, load details, and QR payload.

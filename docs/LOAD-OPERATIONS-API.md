# ASOC load operations API

Node.js + Express + PostgreSQL endpoints for load matching, alerts, GPS tracking,
status progression, and QR-ready load details.

## Endpoints

### Match a posted load to drivers

`POST /api/drivers/match`

```json
{ "loadId": "LOAD-1001" }
```

You may instead provide `loadId`, `pickupLat`, `pickupLng`, `equipment`, origin,
destination, and rate directly. Results include compatible verified drivers,
sorted by ascending distance.

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

The QR endpoint returns a stable `qrValue` pointing to the load-detail endpoint,
plus equipment, dimensions, weight, photo, and GPS-proof requirements. The
frontend can render that value as a QR image without storing image files.

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

## Environment variables

Required for deployed data:

```env
DATABASE_URL=postgresql://...
PUBLIC_BASE_URL=https://your-backend-domain
WEBHOOK_SECRET=at-least-32-random-characters
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

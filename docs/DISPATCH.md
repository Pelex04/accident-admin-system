# Dispatcher alerts and the live board

How a crash reaches next of kin and a medical dispatcher, and how the dispatcher watches it happen.

## The idea

The vehicle phone sends every confirmed alert over two independent paths:

1. **SMS** straight to the dispatcher and the next of kin. This works with no internet and is the guaranteed path.
2. **HTTPS** to this server, which pushes it to the live board. This adds the early warning (a crash that is still counting down), delivery results and acknowledgement.

The server never needs to receive the SMS itself. The phone reports which messages it sent and which were delivered.

## Roles

**Contacts** now have a `role`: `next_of_kin` (default) or `dispatcher`. Set it in the dashboard (Vehicles, Contacts) or through the API. The phone reads it from `GET /api/device/me` and sends a short factual message to dispatchers and a personal one to next of kin.

**Admin accounts** have a new role, `dispatcher`. It can read everything a viewer can and is the only role that can acknowledge crashes. It cannot change records. Admins and super admins watch the board but cannot acknowledge, so "acknowledged by" always names a dispatcher. Dispatchers land on the live board after signing in.

## Reference code

Every crash has a short `ref` (for example `K7Q2`), made of letters and digits with no 0, 1, I or O so it can be read aloud. The phone makes the code and puts it in the SMS and in `POST /api/device/crash`, so the SMS and the board row can be matched even when the phone could not reach the server. Send `ref` as 4 to 6 characters from that set. A missing or invalid `ref` is replaced by a server made one and reported in `warnings`.

## Device API additions

`PATCH /api/device/crash/:clientEventId` accepts an optional `deliveries` list:

```json
{
  "status": "alert_sent",
  "deliveries": [
    { "role": "dispatcher",  "phoneNumber": "+265999000111", "status": "delivered" },
    { "role": "next_of_kin", "phoneNumber": "+265888111222", "status": "failed" }
  ]
}
```

`status` is `pending`, `sent`, `delivered` or `failed`. One row is kept per phone number. A result never goes backwards (a late `sent` does not replace `delivered`). Bad entries are dropped and listed in `warnings`; the rest of the update is still saved. At most 20 entries per request.

## Live board API (admin login required)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/live` | Crashes from the last 24 hours (`?hours=1..168`), each with `vehicleName` and `deliveries`, plus `seq` (stream position). |
| GET | `/api/live/stream` | Server-Sent Events. Send `Authorization: Bearer ...` and, on reconnect, `Last-Event-ID`. |
| POST | `/api/live/:id/ack` | Dispatcher accounts only (admins get 403). First acknowledgement stands. |

Stream messages: `hello` (position), `incident` (full crash, sent on every change, `id` is the position), `reset` (the stored position is from a wiped database, reload with `GET /api/live`). A comment line `: ping` arrives every 20 seconds. A screen that reconnects with its last id receives everything it missed. One account can hold 5 streams at once.

The dashboard reads the stream with `fetch`, not `EventSource`, so the normal Authorization header is used and no token is placed in a URL.

`GET /api/alerts` also reports `crash_in_progress` (counting down, last 2 hours) and `dispatcher_unreached` (a dispatcher SMS failed).

## Database changes

Applied automatically at start and safe to repeat: `contacts.role`, `crash_events.ref / updated_at / acknowledged_at / acknowledged_by`, and the new tables `alert_deliveries` and `change_log` (pruned after 7 days).

## Hosting note

On Render's free plan the service sleeps after about 15 minutes without a request and takes around a minute to wake. The phones check in about hourly, which does not keep it awake. For real dispatch use an always-on plan, or keep SMS as the primary path (it does not depend on this server).

## Directions, distance and drive time

Each crash card on the live board has **Directions** (Google Maps) and **Waze** buttons, and a **Send to phone** button
that shows a QR code for the same directions link. If the SMS to the dispatcher failed, the QR code is shown on that
card by itself. Both apps start from the phone's own position, so use them once you are on the move.

The card also shows distance and drive time from a **starting point** each person saves for their own account (a
station, a base, wherever they usually leave from). A laptop has no GPS, so guessing from the browser can be
kilometres out. A saved point says plainly where the figure comes from.

| Method and path | Who | What |
|---|---|---|
| `GET /api/live/base` | any signed in account | `{ base: { label, latitude, longitude } }` or `{ base: null }` |
| `PUT /api/live/base` | any signed in account | Body `{ label?, latitude, longitude }`. 400 for numbers out of range. |
| `DELETE /api/live/base` | any signed in account | Removes it. |
| `GET /api/live/:id/route` | any signed in account | `{ needsBase: true }`, or `{ needsBase: false, from, distanceKm, minutes, source }`. 404 if the crash has no location yet. |

`source` is `road` (from a routing service) or `estimate` (straight line distance times 1.4, at 40 km/h). The board
labels estimates as estimates. An estimate is used when the routing service is slow, down or answers with something
unusable, so the card never shows an empty gap. Road answers are remembered for 10 minutes; estimates are not.

**Routing service.** `ROUTING_URL` is the address of an OSRM compatible service. If it is not set, the public demo
server `https://router.project-osrm.org` is used: free, but with no guarantee and a request to keep use light. For
anything you rely on, run your own OSRM or use a paid service and set `ROUTING_URL`. Set it to `off` to always use
the straight line estimate. Drive times do not include traffic.

The dispatcher SMS carries a directions link (`google.com/maps/dir//lat,lng`). The next of kin SMS carries a plain
map pin.

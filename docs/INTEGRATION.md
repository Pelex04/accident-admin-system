# Integration Guide: Wiring the Android App to the Admin Backend

This describes the future work needed to connect the existing Android app to this admin backend. No changes have been made to the Android app in this phase. This is a reference for whoever does that work next.

## Why this is separate

The Android app currently works entirely offline over SMS, per the handover document. Adding backend calls is optional and additive. If the backend is unreachable, for example no data connection at the crash site, the existing SMS based alert flow must keep working exactly as it does today. Treat every backend call below as best effort and non blocking.

## Suggested touch points in the existing app

### 1. AlertService, when a crash event starts

Call `POST /api/events` with the vehicle's GPS coordinates as soon as they are available, and again with an updated status once the SMS alert is confirmed sent or fails. This mirrors the state machine already described in the handover document (detected, countdown, cancelled, alert_sent).

Example request body when the crash is first detected:

```json
{
  "vehicleId": "the id assigned to this device in the admin dashboard",
  "latitude": -15.78,
  "longitude": 35.0,
  "status": "detected"
}
```

The response includes an `id`. Store it so the same call sequence can `PUT /api/events/:id` to update status as the countdown resolves or the SMS send succeeds or fails.

### 2. CountdownActivity, on cancel

When the user cancels the false alarm, call `PUT /api/events/:id` with `{ "status": "cancelled", "cancelledBy": "user" }`.

### 3. A new lightweight background check, for SIM balance

Since the Arduino side owns the GSM module and SIM800L, USSD balance queries belong in firmware, not the Android app. If a balance check ends up living on the Android side instead, for example because the phone's own SIM matters too, call:

```
POST /api/sim/:vehicleId/heartbeat
{ "balanceText": "raw text captured from the USSD or carrier SMS response" }
```

The server does the keyword matching for low balance, so the app does not need to parse the text itself.

### 4. Boot receiver or a periodic check

A simple daily heartbeat call, even without balance text, lets the admin dashboard show "last seen" per vehicle and flag devices that have gone silent. This is often a stronger signal than balance parsing, since a dead battery, dead SIM, or failed GSM module all look the same from the admin side: no check in.

## Authentication for device to server calls

The current API only supports admin user login (`POST /api/auth/login`) intended for the dashboard. Before wiring the Android app to these endpoints, add a separate device authentication scheme, for example a long lived API key per vehicle, so a lost or stolen phone cannot be used to log in as an admin. This has not been built yet and should be scoped as its own piece of work before any device starts calling the API in production.

## Network conditions to design for

- No connectivity at all: every backend call must fail silently and never block the SMS alert path
- Intermittent connectivity: queue failed calls locally on the device and retry later, rather than dropping them
- Backend unreachable but SMS working: this is the expected common case in rural areas, and is exactly why SMS remains the primary channel, with the backend as a secondary layer for fleet visibility

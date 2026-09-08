# API Reference

Base URL during local development: http://localhost:4000/api

All endpoints except /auth/login and /health require an Authorization header:

```
Authorization: Bearer <token>
```

## Seeded admin login

Set in server/.env, defaults from .env.example are:

```
email: admin@accidentdetection.local
password: change_this_password
```

Change this password before any real deployment.

## Auth

### POST /auth/login

Request:
```json
{ "email": "admin@accidentdetection.local", "password": "change_this_password" }
```

Response:
```json
{ "token": "...", "admin": { "id": "...", "email": "...", "role": "super_admin" } }
```

## Vehicles

- GET /vehicles - list all vehicles
- POST /vehicles - body: { name, arduinoSimNumber }
- GET /vehicles/:id
- PUT /vehicles/:id - body: any of { name, arduinoSimNumber, status }
- DELETE /vehicles/:id
- GET /vehicles/:id/contacts
- POST /vehicles/:id/contacts - body: { name, phoneNumber, priority }

## Contacts

- PUT /contacts/:id - body: any of { name, phoneNumber, priority }
- DELETE /contacts/:id

## Crash events

- GET /events - optional query params: vehicleId, status
- GET /events/:id
- POST /events - body: { vehicleId, latitude, longitude, status }, status defaults to detected. This is the endpoint a future version of the Android app would call when a crash is detected.
- PUT /events/:id - body: any of { status, cancelledBy, notes, latitude, longitude }

Valid status values: detected, countdown, cancelled, alert_sent, alert_failed

## Sim status

- GET /sim - list all sim statuses
- GET /sim/:vehicleId
- POST /sim/:vehicleId/heartbeat - body: { balanceText }. This is the endpoint a future version of the Android app or Arduino firmware would call to report a check in and the raw USSD balance text it received. The server scans balanceText for keywords such as low balance, expired, and recharge now to set lowBalanceFlag automatically.
- POST /sim/:vehicleId/mark-topped-up - clears lowBalanceFlag after a manual top up

## Alerts

- GET /alerts - combined feed of low balance flags, stale device heartbeats, and crash alert outcomes, sorted by most recent first

## Health

- GET /health - no auth required, returns { status: "ok", time }

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

## Roles, admins and audit log

Every route except `/api/health` and `/api/auth/login` needs `Authorization: Bearer <token>`.
Read routes (GET) work for every role. Changes need `admin` or `super_admin`. A response of
`403 { "code": "forbidden" }` means the role is too low, and `403 { "code": "password_change_required" }` means the
account must call `POST /api/auth/change-password` first.

### Auth

- `POST /api/auth/login` `{ email, password }` returns `{ token, admin }`. `admin` has `id, email, role, active, mustChangePassword, createdAt, lastLoginAt`.
  Returns `429` after too many attempts.
- `GET /api/auth/me` returns the signed in admin.
- `POST /api/auth/change-password` `{ currentPassword, newPassword }` returns a fresh `{ token, admin }`. All other sessions end.

### Admins (super admin only)

- `GET /api/admins`
- `POST /api/admins` `{ email, role, password? }` returns `201 { admin, temporaryPassword }`. The temporary password appears only when the server generated it, and the new admin must change it at first sign in.
- `PUT /api/admins/:id` `{ role?, active? }`. You cannot change your own role or status.
- `POST /api/admins/:id/reset-password` returns `{ temporaryPassword }` and ends that admin's sessions.
- `DELETE /api/admins/:id` returns `204`. You cannot delete yourself.

### Audit log (super admin only)

- `GET /api/audit?limit=200&action=vehicle&adminEmail=a@b.c&before=<ISO time>` returns entries newest first:
  `{ id, at, adminId, adminEmail, action, entityType, entityId, summary, ip }`.
  Actions: `auth.login`, `auth.login_failed`, `auth.password_changed`, `admin.*`, `vehicle.*`, `contact.*`, `event.*`, `sim.topped_up`.

### Validation added

Vehicle and contact names are 1 to 120 characters, phone numbers look like `+265991234567`, SIM numbers must be unique,
contact priority is a whole number from 1 to 99, latitude is within -90 to 90 and longitude within -180 to 180, notes
are at most 2000 characters. Deleting a vehicle also deletes its contacts and SIM status, and keeps its crash history.

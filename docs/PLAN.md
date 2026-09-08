# Admin System Plan

## Context

The existing system has two parts:

1. Arduino device (crash sensor, SIM800L GSM module) that detects a crash and sends an SMS containing the word ACCIDENT to a driver's phone.
2. Android app that receives that SMS, runs a cancel countdown, gets GPS coordinates, and sends emergency SMS to saved contacts.

Everything today lives on a single phone with local SharedPreferences storage. There is no central place to see crash history across vehicles, manage contacts remotely, or know when a SIM card is low on airtime.

This plan adds a new component: a backend API plus a web based admin dashboard. The Android app and Arduino firmware are not modified in this phase. The API is designed so a future version of the Android app can report events to it, and so the plan document below defines that contract.

## Goals for this phase

1. Central backend with a real data model for vehicles, contacts, crash events, and SIM status.
2. Admin authentication.
3. A web dashboard for admins to view and manage all of the above.
4. SIM balance and heartbeat monitoring, since Airtel Malawi bundles running out silently break the alert chain.
5. Clear API documentation so the Android app can be wired up to this backend later without redesigning it.

## Architecture

```
Arduino (firmware, unchanged this phase)
      |
      | SMS
      v
Android App (unchanged this phase)
      |
      | HTTPS (future work, documented in docs/INTEGRATION.md)
      v
Admin Backend API (Node.js, Express)
      |
      v
Data store (JSON file store via lowdb for this phase, swappable for Postgres later)
      |
      v
Admin Web Dashboard (static HTML, CSS, vanilla JS, calls the API)
```

Reasoning for the stack: no build tooling is required for the dashboard, and the backend has no native dependencies, so it runs anywhere Node.js runs, including low resource hosting. The data layer is abstracted behind a small module so swapping lowdb for Postgres or MySQL later does not require route changes.

## Data model

### Vehicle
- id
- name (for example driver name or plate number)
- arduinoSimNumber
- registeredAt
- status (active, inactive)

### Contact
- id
- vehicleId
- name
- phoneNumber
- priority

### CrashEvent
- id
- vehicleId
- detectedAt
- latitude
- longitude
- status (detected, countdown, cancelled, alert_sent, alert_failed)
- cancelledBy (optional)
- notes

### SimStatus
- id
- vehicleId
- lastHeartbeatAt
- lastKnownBalanceText (raw balance string, since Airtel USSD replies are free text)
- lowBalanceFlag
- lastCheckedAt

### AdminUser
- id
- email
- passwordHash
- role (super_admin, fleet_manager, viewer)

## API surface (v1)

- POST /api/auth/login
- GET /api/vehicles
- POST /api/vehicles
- GET /api/vehicles/:id
- PUT /api/vehicles/:id
- DELETE /api/vehicles/:id
- GET /api/vehicles/:id/contacts
- POST /api/vehicles/:id/contacts
- PUT /api/contacts/:id
- DELETE /api/contacts/:id
- GET /api/events
- GET /api/events/:id
- POST /api/events (ingest a crash event, called by the Android app in a future phase)
- PUT /api/events/:id (update status, for example cancelled or alert_sent)
- GET /api/sim
- GET /api/sim/:vehicleId
- POST /api/sim/:vehicleId/heartbeat (device check in, with optional balance text)
- GET /api/alerts (recent low balance and crash alerts, combined feed for the dashboard)

Full request and response shapes are in docs/API.md.

## Dashboard pages

1. Login
2. Overview: recent crash events, vehicles with low SIM balance, vehicles that have not checked in recently
3. Vehicles: list, add, edit, delete, drill into a vehicle to see its contacts and event history
4. Contacts: manage per vehicle
5. Crash events: full history with filters by vehicle and status
6. SIM status: balance text per vehicle, last heartbeat, manual mark as topped up

## Build order (atomic commits)

1. Repo scaffolding, gitignore, root README
2. This plan document and API doc
3. Server: package scaffold and config
4. Server: data layer (lowdb wrapper and schema init)
5. Server: auth (login, JWT middleware, seed admin user)
6. Server: vehicles routes
7. Server: contacts routes
8. Server: crash events routes
9. Server: sim status and heartbeat routes
10. Server: combined alerts feed route
11. Server: seed script with demo data
12. Dashboard: shared shell, login page, api client
13. Dashboard: overview page
14. Dashboard: vehicles page
15. Dashboard: contacts page
16. Dashboard: events page
17. Dashboard: sim status page
18. Integration doc for the Android app
19. Root README with setup and run instructions

## Out of scope for this phase

- Modifying the Android app or Arduino firmware directly
- Real SMS gateway integration (Twilio or Africa's Talking), documented as a future step
- Production grade database and hosting
- Automated USSD balance parsing on the device side, since that lives in firmware, not the admin system

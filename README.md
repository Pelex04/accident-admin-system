# Accident Detection Admin System

Admin backend and web dashboard for the IoT based Road Traffic Accident Detection System.

This is a new component that sits alongside the existing Arduino firmware and Android app. It does not modify either of those. It gives an admin a central place to manage vehicles, emergency contacts, crash event history, and SIM airtime status across all deployed devices.

See docs/PLAN.md for the full plan and docs/API.md for the API reference. See docs/INTEGRATION.md for how the Android app can be wired up to this backend in a future phase.

## Structure

- server: Node.js and Express API
- dashboard: static HTML, CSS, and JS admin dashboard that talks to the API
- docs: plan, API reference, and integration notes

## Quick start

Start the API:

```
cd server
cp .env.example .env
npm install
npm run seed
npm start
```

This starts the API on http://localhost:4000 and creates a seeded admin login plus one demo vehicle. The seeded login is in docs/API.md, change the password before any real deployment.

Serve the dashboard in a second terminal:

```
cd dashboard
python3 -m http.server 8080
```

Then open http://localhost:8080/login.html in a browser. The dashboard's API base URL is set in dashboard/js/api.js, update it if the API is not running on localhost:4000.

## Status

Backend API and web dashboard are functional and covered by manual end to end testing (login, vehicle and contact management, crash event lifecycle, sim heartbeat and low balance detection, alerts feed). The Android app and Arduino firmware are unchanged in this phase, see docs/INTEGRATION.md for how to connect them later.

## Deployment, roles and security

The API uses PostgreSQL in production (`DATABASE_URL`) and a local SQLite file for development. It has three admin
roles (viewer, admin, super admin), an audit log, and sign in rate limits. See [docs/DEPLOY.md](docs/DEPLOY.md) for
setup and [docs/API.md](docs/API.md) for the endpoints. The developer of the mobile app should start with
[docs/MOBILE_APP_GUIDE.md](docs/MOBILE_APP_GUIDE.md).

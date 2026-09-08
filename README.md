# Accident Detection Admin System

Admin backend and web dashboard for the IoT based Road Traffic Accident Detection System.

This is a new component that sits alongside the existing Arduino firmware and Android app. It does not modify either of those. It gives an admin a central place to manage vehicles, emergency contacts, crash event history, and SIM airtime status across all deployed devices.

See docs/PLAN.md for the full plan and docs/API.md for the API reference. See docs/INTEGRATION.md for how the Android app can be wired up to this backend in a future phase.

## Structure

- server: Node.js and Express API
- dashboard: static HTML, CSS, and JS admin dashboard that talks to the API
- docs: plan, API reference, and integration notes

## Quick start

```
cd server
cp .env.example .env
npm install
npm run seed
npm start
```

Then open dashboard/index.html in a browser, or serve the dashboard folder with any static file server. The default seeded admin login is in docs/API.md.
